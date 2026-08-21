import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { generateMatchCode } from "../lib/code.js";

export const matchesRouter = Router();

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
    deck: { total: deckTotal, drawn: deckDrawn },
  };
}

// POST /api/matches — create a new match, returns the join code/link.
matchesRouter.post("/", async (_req, res) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateMatchCode();
    try {
      const match = await prisma.match.create({ data: { id: code } });
      return res.status(201).json({ code: match.id });
    } catch (err: any) {
      if (err?.code === "P2002") continue; // code collision, retry
      throw err;
    }
  }
  res.status(500).json({ error: "Failed to generate a unique match code" });
});

// GET /api/matches/:code — current state (used for initial load and refresh).
matchesRouter.get("/:code", async (req, res) => {
  const state = await loadMatchState(req.params.code.toUpperCase());
  if (!state) return res.status(404).json({ error: "Match not found" });
  res.json(state);
});

// POST /api/matches/:code/players — set the full player list and turn order.
matchesRouter.post("/:code/players", async (req, res) => {
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
});

// POST /api/matches/:code/start — shuffle the deck and begin the first turn.
matchesRouter.post("/:code/start", async (req, res) => {
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
});

// POST /api/matches/:code/reveal — draw the next card for the current player's turn.
matchesRouter.post("/:code/reveal", async (req, res) => {
  const code = req.params.code.toUpperCase();

  const match = await prisma.match.findUnique({ where: { id: code } });
  if (!match) return res.status(404).json({ error: "Match not found" });
  if (match.status !== "IN_PROGRESS") {
    return res.status(409).json({ error: "Match is not in progress" });
  }
  if (match.revealedCardId) {
    const state = await loadMatchState(code);
    return res.json(state); // already revealed this turn — idempotent
  }

  let next = await prisma.matchDeckCard.findFirst({
    where: { matchId: code, drawn: false },
    orderBy: { position: "asc" },
  });

  if (!next) {
    // Deck exhausted — reshuffle and continue.
    const allCards = await prisma.card.findMany({ select: { id: true } });
    const shuffled = shuffle(allCards);
    await prisma.$transaction([
      prisma.matchDeckCard.deleteMany({ where: { matchId: code } }),
      prisma.matchDeckCard.createMany({
        data: shuffled.map((c, i) => ({ matchId: code, cardId: c.id, position: i })),
      }),
    ]);
    next = await prisma.matchDeckCard.findFirst({
      where: { matchId: code, drawn: false },
      orderBy: { position: "asc" },
    });
  }
  if (!next) return res.status(500).json({ error: "Deck is empty" });

  await prisma.$transaction([
    prisma.matchDeckCard.update({ where: { id: next.id }, data: { drawn: true } }),
    prisma.match.update({ where: { id: code }, data: { revealedCardId: next.cardId } }),
  ]);

  const state = await loadMatchState(code);
  res.json(state);
});

// POST /api/matches/:code/advance — close the current turn and move to the next player.
matchesRouter.post("/:code/advance", async (req, res) => {
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
    },
  });

  const state = await loadMatchState(code);
  res.json(state);
});
