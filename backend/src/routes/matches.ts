import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { generateMatchCode } from "../lib/code.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const matchesRouter = Router();

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

async function loadMatchState(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      players: { orderBy: { turnOrder: "asc" } },
      revealedCard: true,
    },
  });
  if (!match) return null;

  const deckTotal = await prisma.matchDeckCard.count({ where: { matchId } });
  const deckDrawn = await prisma.matchDeckCard.count({ where: { matchId, drawn: true } });
  const currentPlayer = match.players[match.currentPlayerIndex] ?? null;

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
  };
}

// POST /api/matches — create a new match, returns the join code/link.
matchesRouter.post(
  "/",
  createMatchLimiter,
  asyncHandler(async (_req, res) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateMatchCode();
      try {
        const match = await prisma.match.create({ data: { id: code } });
        res.status(201).json({ code: match.id });
        return;
      } catch (err: any) {
        if (err?.code === "P2002") continue; // code collision, retry
        throw err;
      }
    }
    res.status(500).json({ error: "Failed to generate a unique match code" });
  }),
);

// GET /api/matches/:code — current state (used for initial load and refresh).
matchesRouter.get(
  "/:code",
  asyncHandler(async (req, res) => {
    const state = await loadMatchState(req.params.code.toUpperCase());
    if (!state) return res.status(404).json({ error: "Match not found" });
    res.json(state);
  }),
);

// POST /api/matches/:code/players — set the full player list and turn order.
matchesRouter.post(
  "/:code/players",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const names: unknown = req.body?.names;

    if (!Array.isArray(names) || names.length < 2 || names.length > 15) {
      return res.status(400).json({ error: "Provide between 2 and 15 player names" });
    }
    const trimmed = names.map((n) => String(n).trim()).filter(Boolean);
    if (trimmed.length !== names.length) {
      return res.status(400).json({ error: "Player names cannot be empty" });
    }

    const match = await prisma.match.findUnique({ where: { id: code } });
    if (!match) return res.status(404).json({ error: "Match not found" });
    if (match.status !== "WAITING") {
      return res.status(409).json({ error: "Match already started" });
    }

    await prisma.$transaction([
      prisma.player.deleteMany({ where: { matchId: code } }),
      prisma.player.createMany({
        data: trimmed.map((name, i) => ({ matchId: code, name, turnOrder: i })),
      }),
    ]);

    const state = await loadMatchState(code);
    res.json(state);
  }),
);

// POST /api/matches/:code/start — shuffle the deck and begin the first turn.
matchesRouter.post(
  "/:code/start",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();

    const match = await prisma.match.findUnique({
      where: { id: code },
      include: { players: true },
    });
    if (!match) return res.status(404).json({ error: "Match not found" });
    if (match.status !== "WAITING") {
      return res.status(409).json({ error: "Match already started" });
    }
    if (match.players.length < 2) {
      return res.status(400).json({ error: "Add at least 2 players before starting" });
    }

    const allCards = await prisma.card.findMany({ select: { id: true } });
    const shuffled = shuffle(allCards);

    await prisma.$transaction([
      prisma.matchDeckCard.deleteMany({ where: { matchId: code } }),
      prisma.matchDeckCard.createMany({
        data: shuffled.map((c, i) => ({ matchId: code, cardId: c.id, position: i })),
      }),
      prisma.match.update({
        where: { id: code },
        data: { status: "IN_PROGRESS", currentPlayerIndex: 0, currentRound: 1, revealedCardId: null },
      }),
    ]);

    const state = await loadMatchState(code);
    res.json(state);
  }),
);

type RevealOutcome = "not_found" | "not_in_progress" | "deck_empty" | "ok";

// POST /api/matches/:code/reveal — draw the next card for the current player's turn.
//
// Runs the whole check-then-draw inside one transaction with the Match row
// locked (`FOR UPDATE`), so two concurrent reveal requests for the same
// match can't both pass the "not revealed yet" check and each draw a card —
// the second one blocks until the first commits, then sees revealedCardId
// already set and no-ops. `Match` is a reserved word in MySQL 8 (used by
// MATCH() AGAINST()), so it has to be backtick-quoted in raw SQL.
matchesRouter.post(
  "/:code/reveal",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();

    const outcome = await prisma.$transaction<RevealOutcome>(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string; revealedCardId: number | null }[]>`
        SELECT status, revealedCardId FROM \`Match\` WHERE id = ${code} FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked) return "not_found";
      if (locked.status !== "IN_PROGRESS") return "not_in_progress";
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
    const text: unknown = req.body?.text;

    if (typeof text !== "string" || !text.trim() || text.trim().length > 200) {
      return res.status(400).json({ error: "Provide a rule up to 200 characters" });
    }

    const match = await prisma.match.findUnique({ where: { id: code } });
    if (!match) return res.status(404).json({ error: "Match not found" });
    if (match.status !== "IN_PROGRESS") {
      return res.status(409).json({ error: "Match is not in progress" });
    }

    await prisma.match.update({ where: { id: code }, data: { houseRule: text.trim() } });

    const state = await loadMatchState(code);
    res.json(state);
  }),
);

// POST /api/matches/:code/advance — close the current turn and move to the next player.
matchesRouter.post(
  "/:code/advance",
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();

    const match = await prisma.match.findUnique({
      where: { id: code },
      include: { players: true },
    });
    if (!match) return res.status(404).json({ error: "Match not found" });
    if (match.status !== "IN_PROGRESS") {
      return res.status(409).json({ error: "Match is not in progress" });
    }

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
