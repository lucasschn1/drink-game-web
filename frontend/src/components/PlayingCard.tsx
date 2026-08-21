import type { Card, Suit } from "../api/types";
import "./PlayingCard.css";

const SUIT_PATHS: Record<Suit, string> = {
  // Simple, crisp glyph paths (viewBox 0 0 32 32) instead of Unicode, so
  // rendering stays consistent across iOS/Android/desktop.
  hearts:
    "M16 28 C16 28 3 19.5 3 11.3 C3 6.2 6.9 3 11 3 C13.4 3 15.4 4.2 16 6.1 C16.6 4.2 18.6 3 21 3 C25.1 3 29 6.2 29 11.3 C29 19.5 16 28 16 28 Z",
  diamonds: "M16 2 L29 16 L16 30 L3 16 Z",
  clubs:
    "M16 4 C19.3 4 22 6.7 22 10 C22 11.8 21.2 13.4 19.9 14.5 C21.1 13.9 22.5 13.5 24 13.5 C27.3 13.5 30 16.2 30 19.5 C30 22.8 27.3 25.5 24 25.5 C21.8 25.5 19.9 24.3 18.9 22.6 C18.6 24 18.6 25.5 19.5 28 L12.5 28 C13.4 25.5 13.4 24 13.1 22.6 C12.1 24.3 10.2 25.5 8 25.5 C4.7 25.5 2 22.8 2 19.5 C2 16.2 4.7 13.5 8 13.5 C9.5 13.5 10.9 13.9 12.1 14.5 C10.8 13.4 10 11.8 10 10 C10 6.7 12.7 4 16 4 Z",
  spades:
    "M16 2 C16 2 29 12.5 29 19.3 C29 24 25.4 27.3 21.3 27.3 C19.2 27.3 17.4 26.4 16 25 C16.6 27 17.4 28.4 19.5 30 L12.5 30 C14.6 28.4 15.4 27 16 25 C14.6 26.4 12.8 27.3 10.7 27.3 C6.6 27.3 3 24 3 19.3 C3 12.5 16 2 16 2 Z",
};

// One flat, saturated poster color per suit — color itself is the primary
// suit signal here (Swiss-poster idiom), the corner indices are the
// secondary/traditional cue.
const SUIT_CLASS: Record<Suit, string> = {
  hearts: "suit-hearts",
  diamonds: "suit-diamonds",
  clubs: "suit-clubs",
  spades: "suit-spades",
};

function SuitIcon({ suit, className }: { suit: Suit; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d={SUIT_PATHS[suit]} fill="currentColor" />
    </svg>
  );
}

// Heraldic shield + chalice + crown, for the card back — a tavern coat-of-arms
// instead of a bare wordmark. Cream lines on the ink field, one ruby jewel
// accent (reuses --suit-hearts, already part of the palette).
function CrestEmblem({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 120" className={className} aria-hidden="true">
      {/* laurel sprigs flanking the base */}
      <path
        d="M14 96 C20 90 24 82 24 74"
        fill="none"
        stroke="var(--bg)"
        strokeWidth="1.4"
        opacity="0.55"
      />
      <path
        d="M15 92 L20 89 M14 86 L19.5 84 M15.5 80 L20.5 79"
        stroke="var(--bg)"
        strokeWidth="1.4"
        opacity="0.55"
        strokeLinecap="round"
      />
      <path
        d="M86 96 C80 90 76 82 76 74"
        fill="none"
        stroke="var(--bg)"
        strokeWidth="1.4"
        opacity="0.55"
      />
      <path
        d="M85 92 L80 89 M86 86 L80.5 84 M84.5 80 L79.5 79"
        stroke="var(--bg)"
        strokeWidth="1.4"
        opacity="0.55"
        strokeLinecap="round"
      />

      {/* shield outline (outer + inner hairline) */}
      <path
        d="M50 14 L88 26 L88 56 C88 84 71 102 50 110 C29 102 12 84 12 56 L12 26 Z"
        fill="var(--bg)"
        stroke="var(--bg)"
        strokeWidth="2.5"
      />
      <path
        d="M50 21 L80 31 L80 56 C80 78 66 93 50 100 C34 93 20 78 20 56 L20 31 Z"
        fill="none"
        stroke="var(--fg)"
        strokeWidth="1"
        opacity="0.3"
      />

      {/* small crown resting on the shield's peak */}
      <path
        d="M40 12 L44 4 L50 10 L56 4 L60 12 L58 15 L42 15 Z"
        fill="var(--bg)"
      />
      <circle cx="50" cy="6" r="1.6" fill="var(--bg)" />

      {/* chalice at the shield's heart */}
      <path
        d="M39 40 C39 49 43.5 55.5 50 55.5 C56.5 55.5 61 49 61 40"
        fill="none"
        stroke="var(--fg)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect x="48" y="55" width="4" height="13" fill="var(--fg)" />
      <path
        d="M40 72 C40 69.5 44.2 68 50 68 C55.8 68 60 69.5 60 72 L60 74.5 L40 74.5 Z"
        fill="var(--fg)"
      />
      <circle cx="50" cy="45" r="3.4" fill="var(--suit-hearts)" />
    </svg>
  );
}

// Tiny corner fleuron used to echo the back's heraldry on the front faces.
function CornerFleuron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path
        d="M10 1 L13 7 L19 10 L13 13 L10 19 L7 13 L1 10 L7 7 Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface PlayingCardProps {
  card: Card | null;
  revealed: boolean;
  onReveal: () => void;
  loading: boolean;
}

export function PlayingCard({ card, revealed, onReveal, loading }: PlayingCardProps) {
  const suitClass = card ? SUIT_CLASS[card.suit] : "";

  return (
    <div className="playing-card-scene">
      <button
        type="button"
        className={`playing-card ${revealed ? "flipped" : ""}`}
        onClick={!revealed ? onReveal : undefined}
        disabled={loading}
        aria-label={revealed ? undefined : "Revelar carta"}
      >
        <div className="playing-card-face playing-card-back">
          <div className="back-frame">
            <div className="back-lattice" />
            <span className="back-corner back-corner-tl" aria-hidden="true" />
            <span className="back-corner back-corner-tr" aria-hidden="true" />
            <span className="back-corner back-corner-bl" aria-hidden="true" />
            <span className="back-corner back-corner-br" aria-hidden="true" />
            <CrestEmblem className="back-crest" />
            <span className="back-wordmark">Drink Game</span>
          </div>
        </div>

        <div className={`playing-card-face playing-card-front ${suitClass}`}>
          {card && (
            <>
              <CornerFleuron className="front-fleuron front-fleuron-tl" />
              <CornerFleuron className="front-fleuron front-fleuron-br" />

              <div className="poster-body">
                <div className="corner corner-top">
                  <span className="rank">{card.rank}</span>
                  <span className="corner-divider" />
                  <SuitIcon suit={card.suit} className="corner-suit" />
                </div>

                <SuitIcon suit={card.suit} className="poster-suit-watermark" />
                <span className="poster-rank">{card.rank}</span>
                <SuitIcon suit={card.suit} className="poster-suit" />

                <div className="corner corner-bottom">
                  <span className="rank">{card.rank}</span>
                  <span className="corner-divider" />
                  <SuitIcon suit={card.suit} className="corner-suit" />
                </div>
              </div>

              <p className="rule-text">{card.text}</p>
            </>
          )}
        </div>
      </button>
    </div>
  );
}
