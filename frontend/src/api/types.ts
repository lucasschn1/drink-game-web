export type MatchStatus = "WAITING" | "IN_PROGRESS" | "FINISHED";

export interface Player {
  id: number;
  matchId: string;
  name: string;
  turnOrder: number;
}

export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

export interface Card {
  id: number;
  rank: string;
  suit: Suit;
  text: string;
}

export interface ShotTimer {
  remainingSeconds: number | null;
  pendingPlayer: Player | null;
}

export interface MatchState {
  code: string;
  status: MatchStatus;
  currentRound: number;
  currentPlayerIndex: number;
  currentPlayer: Player | null;
  players: Player[];
  revealedCard: Card | null;
  // Set when the revealed card's suit matches the previously drawn card's
  // suit — the "combo de naipe" bonus (rule doubles for this turn).
  comboSuit: Suit | null;
  houseRule: string | null;
  deck: { total: number; drawn: number };
  shotTimer: ShotTimer;
}
