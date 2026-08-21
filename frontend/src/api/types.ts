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

export interface MatchState {
  code: string;
  status: MatchStatus;
  currentRound: number;
  currentPlayerIndex: number;
  currentPlayer: Player | null;
  players: Player[];
  revealedCard: Card | null;
  deck: { total: number; drawn: number };
}
