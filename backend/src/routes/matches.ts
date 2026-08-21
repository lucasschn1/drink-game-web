import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { generateMatchCode } from "../lib/code.js";
import { generateToken } from "../lib/token.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const matchesRouter = Router();

const SHOT_TIMER_SECONDS = 180;
const MAX_PLAYERS = 15;

// Match creation is the only endpoint with no natural rate limit from game
// flow (reveal/advance are gated by clicks a few times per minute at most).
// 20 per 15 min per IP is generous for real use, tight enough to stop a
// script from spamming empty matches into the database.
const createMatchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getToken(req: { header(name: string): string | undefined }): string | null {
  return req.header("x-player-token") ?? null;
}

// If the shot-roulette countdown has expired and nothing is pending yet,
// atomically pick a random player and mark them pending — race-safe across
// many devices polling concurrently, since only one concurrent
// `WHERE pendingShotPlayerId IS NULL` can ever apply. No server-side
// scheduler needed: this runs as a side effect of normal polling.
// `Match` is a reserved word in MySQL 8 (MATCH() AGAINST()), hence backticks.
async function maybeTriggerShotTimer(matchId: string) {
  await prisma.$executeRaw`
    UPDATE \`Match\` m
    JOIN (SELECT id FROM Player WHERE matchId = ${matchId} ORDER BY RAND() LIMIT 1) p ON 1 = 1
    SET m.pendingShotPlayerId = p.id
    WHERE m.id = ${matchId}
      AND m.pendingShotPlayerId IS NULL
      AND m.shotTimerEndsAt IS NOT NULL
      AND m.shotTimerEndsAt <= NOW()
  `;
}

async function loadMatchState(matchId: string) {
  await maybeTriggerShotTimer(matchId);

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      players: {
        orderBy: { turnOrder: "asc" },
        select: { id: true, matchId: true, name: true, turnOrder: true },
      },
      revealedCard: true,
    },
  });
  if (!match) return null;

  const deckTotal = await prisma.matchDeckCard.count({ where: { matchId } });
  const deckDrawn = await prisma.matchDeckCard.count({ where: { matchId, drawn: true } });
  const currentPlayer = match.players[match.currentPlayerIndex] ?? null;
  const pendingPlayer = match.players.find((p) => p.id === match.pendingShotPlayerId) ?? null;
  const remainingSeconds = match.shotTimerEndsAt
    ? Math.max(0, Math.ceil((match.shotTimerEndsAt.getTime() - Date.now()) / 1000))
    : null;

  return {
    code: match.id,
    status: match.status,
    currentRound: match.currentRound,
    currentPlayerIndex: match.currentPlayerIndex,
    currentPlayer,
    players: match.players,
    revealedCard: match.revealedCard,
    houseRule: match.houseRule,
    deck: { total: deckTotal, drawn: deckDrawn },
    // Seconds, not a timestamp — phone clocks routinely drift several
    // seconds from the server, so the client only ever counts down a
    // number it already has, resynced every poll.
    shotTimer: { remainingSeconds, pendingPlayer },
  };
}

// POST /api/matches — create a new match, returns the join code/link and a
// host token (given only here, needed to /start and to force-/advance).
matchesRouter.post(
  "/",
  createMatchLimiter,
  asyncHandler(async (_req, res) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateMatchCode();
      const hostToken = generateToken();
      try {
        const match = await prisma.match.create({ data: { id: code, hostToken } });
        res.status(201).json({ code: match.id, hostToken });
        return;
      } catch (err: any) {
        if (err?.code === "P2002") continue; // code collision, retry
        throw err;
      }
    }
    res.status(500).json({ error: "Failed to generate a unique match code" });
  }),
);

// GET /api/matches/:code — current state (used for initial load and polling).
matchesRouter.get(
  "/:code",
  asyncHandler(async (req, res) => {
    const state = await loadMatchState(req.params.code.toUpperCase());
    if (!state) return res.status(404).json({ error: "Match not found" });
    res.json(state);
  }),
);

// POST /api/matches/:code/join — add one player under their own name, return
// a token only to them. Repeated calls from the same device (typing several
// names in a row before starting) is how single-device pass-and-play still
// works — that device just ends up holding every token it joined with.
matchesRouter.post(
  "/:code/join",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const name = String(req.body?.name ?? "").trim();

    if (!name) return res.status(400).json({ error: "Name is required" });
    if (name.length > 30) return res.status(400).json({ error: "Name is too long" });

    const match = await prisma.match.findUnique({ where: { id: code } });
    if (!match) return res.status(404).json({ error: "Match not found" });
    if (match.status !== "WAITING") {
      return res.status(409).json({ error: "Match already started" });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await prisma.player.findMany({ where: { matchId: code } });
      if (existing.length >= MAX_PLAYERS) {
        return res.status(400).json({ error: `Match is full (max ${MAX_PLAYERS} players)` });
      }
      if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        return res.status(409).json({ error: "That name is already taken" });
      }

      const token = generateToken();
      try {
        const player = await prisma.player.create({
          data: { matchId: code, name, turnOrder: existing.length, token },
        });
        res.status(201).json({
          player: { id: player.id, matchId: player.matchId, name: player.name, turnOrder: player.turnOrder },
          token,
        });
        return;
      } catch (err: any) {
        if (err?.code === "P2002") continue; // turnOrder race with another concurrent join, retry
        throw err;
      }
    }
    res.status(500).json({ error: "Failed to join — please try again" });
  }),
);

// POST /api/matches/:code/start — shuffle the deck and begin the first turn.
// Requires the host token issued at creation.
matchesRouter.post(
  "/:code/start",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const token = getToken(req);

    const match = await prisma.match.findUnique({
      where: { id: code },
      include: { players: true },
    });
    if (!match) return res.status(404).json({ error: "Match not found" });
    if (!token || !match.hostToken || token !== match.hostToken) {
      return res.status(403).json({ error: "Only the host can start the match" });
    }
    if (match.status !== "WAITING") {
      return res.status(409).json({ error: "Match already started" });
    }
    if (match.players.length < 2) {
      return res.status(400).json({ error: "Add at least 2 players before starting" });
    }

    const allCards = await prisma.card.findMany({ select: { id: true } });
    const shuffled = shuffle(allCards);
    const shotTimerEndsAt = new Date(Date.now() + SHOT_TIMER_SECONDS * 1000);

    await prisma.$transaction([
      prisma.matchDeckCard.deleteMany({ where: { matchId: code } }),
      prisma.matchDeckCard.createMany({
        data: shuffled.map((c, i) => ({ matchId: code, cardId: c.id, position: i })),
      }),
      prisma.match.update({
        where: { id: code },
        data: {
          status: "IN_PROGRESS",
          currentPlayerIndex: 0,
          currentRound: 1,
          revealedCardId: null,
          shotTimerEndsAt,
          pendingShotPlayerId: null,
        },
      }),
    ]);

    const state = await loadMatchState(code);
    res.json(state);
  }),
);

type RevealOutcome = "not_found" | "not_in_progress" | "forbidden" | "deck_empty" | "ok";

// POST /api/matches/:code/reveal — draw the next card for the current player's turn.
//
// Runs the whole check-then-draw inside one transaction with the Match row
// locked (`FOR UPDATE`), so two concurrent reveal requests for the same
// match can't both pass the "not revealed yet" check and each draw a card —
// the second one blocks until the first commits, then sees revealedCardId
// already set and no-ops.
matchesRouter.post(
  "/:code/reveal",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const token = getToken(req);

    const outcome = await prisma.$transaction<RevealOutcome>(async (tx) => {
      const rows = await tx.$queryRaw<
        { status: string; revealedCardId: number | null; currentPlayerIndex: number }[]
      >`
        SELECT status, revealedCardId, currentPlayerIndex FROM \`Match\` WHERE id = ${code} FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked) return "not_found";
      if (locked.status !== "IN_PROGRESS") return "not_in_progress";

      const players = await tx.player.findMany({ where: { matchId: code }, orderBy: { turnOrder: "asc" } });
      const currentPlayer = players[locked.currentPlayerIndex];
      if (!token || !currentPlayer || !currentPlayer.token || currentPlayer.token !== token) return "forbidden";

      if (locked.revealedCardId) return "ok"; // already revealed this turn — idempotent

      let next = await tx.matchDeckCard.findFirst({
        where: { matchId: code, drawn: false },
        orderBy: { position: "asc" },
      });

      if (!next) {
        // Deck exhausted — reshuffle and continue.
        const allCards = await tx.card.findMany({ select: { id: true } });
        const shuffled = shuffle(allCards);
        await tx.matchDeckCard.deleteMany({ where: { matchId: code } });
        await tx.matchDeckCard.createMany({
          data: shuffled.map((c, i) => ({ matchId: code, cardId: c.id, position: i })),
        });
        next = await tx.matchDeckCard.findFirst({
          where: { matchId: code, drawn: false },
          orderBy: { position: "asc" },
        });
      }
      if (!next) return "deck_empty";

      await tx.matchDeckCard.update({ where: { id: next.id }, data: { drawn: true } });
      await tx.match.update({ where: { id: code }, data: { revealedCardId: next.cardId } });
      return "ok";
    });

    if (outcome === "not_found") return res.status(404).json({ error: "Match not found" });
    if (outcome === "not_in_progress") return res.status(409).json({ error: "Match is not in progress" });
    if (outcome === "forbidden") return res.status(403).json({ error: "Not your turn" });
    if (outcome === "deck_empty") return res.status(500).json({ error: "Deck is empty" });

    const state = await loadMatchState(code);
    res.json(state);
  }),
);

// POST /api/matches/:code/house-rule — record the custom rule created by a K draw.
matchesRouter.post(
  "/:code/house-rule",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const token = getToken(req);
    const text: unknown = req.body?.text;

    if (typeof text !== "string" || !text.trim() || text.trim().length > 200) {
      return res.status(400).json({ error: "Provide a rule up to 200 characters" });
    }

    const match = await prisma.match.findUnique({ where: { id: code }, include: { players: true } });
    if (!match) return res.status(404).json({ error: "Match not found" });
    if (match.status !== "IN_PROGRESS") {
      return res.status(409).json({ error: "Match is not in progress" });
    }

    const currentPlayer = match.players
      .sort((a, b) => a.turnOrder - b.turnOrder)
      .find((p) => p.turnOrder === match.currentPlayerIndex);
    if (!token || !currentPlayer || !currentPlayer.token || currentPlayer.token !== token) {
      return res.status(403).json({ error: "Not your turn" });
    }

    await prisma.match.update({ where: { id: code }, data: { houseRule: text.trim() } });

    const state = await loadMatchState(code);
    res.json(state);
  }),
);

// POST /api/matches/:code/advance — close the current turn and move to the next player.
// Accepts either the current player's own token, or the host token (lets the
// host force-skip someone who lost their token — dead phone, closed private
// tab — since there's no reconnect flow yet).
matchesRouter.post(
  "/:code/advance",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const token = getToken(req);

    const match = await prisma.match.findUnique({
      where: { id: code },
      include: { players: { orderBy: { turnOrder: "asc" } } },
    });
    if (!match) return res.status(404).json({ error: "Match not found" });
    if (match.status !== "IN_PROGRESS") {
      return res.status(409).json({ error: "Match is not in progress" });
    }

    const currentPlayer = match.players[match.currentPlayerIndex];
    const authorized = !!token && (token === currentPlayer?.token || token === match.hostToken);
    if (!authorized) return res.status(403).json({ error: "Not your turn" });

    const playerCount = match.players.length;
    const nextIndex = (match.currentPlayerIndex + 1) % playerCount;
    const wrapped = nextIndex === 0;

    await prisma.match.update({
      where: { id: code },
      data: {
        currentPlayerIndex: nextIndex,
        currentRound: wrapped ? match.currentRound + 1 : match.currentRound,
        revealedCardId: null,
        // A house rule from a K only lasts "until the end of the round" —
        // clear it exactly when the round itself increments.
        ...(wrapped ? { houseRule: null } : {}),
      },
    });

    const state = await loadMatchState(code);
    res.json(state);
  }),
);

// POST /api/matches/:code/shot/ack — dismiss the shot-roulette alert and
// restart the 3:00 countdown. No per-player auth — anyone can tap it, it's a
// shared party moment, not a turn action. A second/late tap is a no-op.
matchesRouter.post(
  "/:code/shot/ack",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();

    await prisma.$executeRaw`
      UPDATE \`Match\`
      SET pendingShotPlayerId = NULL, shotTimerEndsAt = DATE_ADD(NOW(), INTERVAL ${SHOT_TIMER_SECONDS} SECOND)
      WHERE id = ${code} AND pendingShotPlayerId IS NOT NULL
    `;

    const state = await loadMatchState(code);
    if (!state) return res.status(404).json({ error: "Match not found" });
    res.json(state);
  }),
);

// POST /api/matches/:code/end — host ends the match early, any status.
matchesRouter.post(
  "/:code/end",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const token = getToken(req);

    const match = await prisma.match.findUnique({ where: { id: code } });
    if (!match) return res.status(404).json({ error: "Match not found" });
    if (!token || !match.hostToken || token !== match.hostToken) {
      return res.status(403).json({ error: "Only the host can end the match" });
    }

    await prisma.match.update({ where: { id: code }, data: { status: "FINISHED" } });

    const state = await loadMatchState(code);
    res.json(state);
  }),
);

type KickOutcome = "not_found" | "forbidden" | "finished" | "player_not_found" | "too_few_players" | "ok";

// POST /api/matches/:code/kick — host removes a player. Locks the Match row
// for the same reason /reveal does: a concurrent /advance or second /kick
// between reading currentPlayerIndex and writing the removal could otherwise
// invalidate the turn math mid-request. Before the match starts this is a
// plain removal; mid-match it also has to re-densify everyone's turnOrder
// (kept contiguous from 0 since /join and /advance both assume that) and
// hand the turn to whoever the removed player's *successor* was — the same
// player, not just the same numeric slot.
matchesRouter.post(
  "/:code/kick",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const token = getToken(req);
    const playerId = Number(req.body?.playerId);

    const outcome = await prisma.$transaction<KickOutcome>(async (tx) => {
      const rows = await tx.$queryRaw<
        { status: string; hostToken: string | null; currentPlayerIndex: number }[]
      >`
        SELECT status, hostToken, currentPlayerIndex FROM \`Match\` WHERE id = ${code} FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked) return "not_found";
      if (!token || !locked.hostToken || token !== locked.hostToken) return "forbidden";
      if (locked.status === "FINISHED") return "finished";

      const players = await tx.player.findMany({ where: { matchId: code }, orderBy: { turnOrder: "asc" } });
      const target = players.find((p) => p.id === playerId);
      if (!target) return "player_not_found";

      const remaining = players.filter((p) => p.id !== playerId);
      if (locked.status === "IN_PROGRESS" && remaining.length < 2) return "too_few_players";

      const wasCurrent = target.id === players[locked.currentPlayerIndex]?.id;

      await tx.player.delete({ where: { id: playerId } });
      // Re-densify turnOrder in original relative order — safe as sequential
      // updates because each new index is always <= the old one, so a
      // target slot is never still occupied by a not-yet-updated row.
      for (let i = 0; i < remaining.length; i++) {
        await tx.player.update({ where: { id: remaining[i].id }, data: { turnOrder: i } });
      }

      if (locked.status === "IN_PROGRESS") {
        // Whoever should be "up" now is the same *player* as before: the
        // removed one's successor if they were current, otherwise unchanged.
        const successorId = players[(locked.currentPlayerIndex + 1) % players.length]?.id;
        const nextCurrentId = wasCurrent ? successorId : players[locked.currentPlayerIndex]?.id;
        const nextIndex = Math.max(
          0,
          remaining.findIndex((p) => p.id === nextCurrentId),
        );
        await tx.match.update({
          where: { id: code },
          data: { currentPlayerIndex: nextIndex, ...(wasCurrent ? { revealedCardId: null } : {}) },
        });
      }

      return "ok";
    });

    if (outcome === "not_found") return res.status(404).json({ error: "Match not found" });
    if (outcome === "forbidden") return res.status(403).json({ error: "Only the host can remove a player" });
    if (outcome === "finished") return res.status(409).json({ error: "Match already finished" });
    if (outcome === "player_not_found") return res.status(404).json({ error: "Player not found" });
    if (outcome === "too_few_players") {
      return res.status(400).json({ error: "Can't remove — the match needs at least 2 players" });
    }

    const state = await loadMatchState(code);
    res.json(state);
  }),
);
