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

export type VidenciaGuessValue = "par" | "impar";

export interface VidenciaState {
  guess: VidenciaGuessValue;
  // null while the bet is placed but the card isn't revealed yet.
  correct: boolean | null;
}

export interface VidenciaHandoff {
  fromPlayerName: string;
  ruleText: string;
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
  // The current player's par/ímpar bet on this turn's card, and (once
  // revealed) whether it hit.
  videncia: VidenciaState | null;
  // Set only for the player who just inherited the previous player's card
  // (+ a shot) after that player guessed vidência correctly — cleared once
  // they acknowledge it, before their own turn's reveal.
  handoff: VidenciaHandoff | null;
  shotTimer: ShotTimer;
}
