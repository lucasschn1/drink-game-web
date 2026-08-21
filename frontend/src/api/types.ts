export type MatchStatus = "WAITING" | "IN_PROGRESS" | "FINISHED";

export interface Player {
  id: number;
  matchId: string;
  name: string;
  turnOrder: number;
}

export interface Card {
  id: number;
  text: string;
  category: string;
  target: string;
  intensity: string;
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
