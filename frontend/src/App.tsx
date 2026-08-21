import { useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import type { MatchState } from "./api/types";
import { PlayingCard } from "./components/PlayingCard";
import { HowToPlayModal } from "./components/HowToPlayModal";
import { unlockAudio, playShotAlert } from "./lib/sound";
import { setHostToken, isHost, setPlayerToken, getTokenFor } from "./lib/identity";
import "./App.css";

type Screen = "home" | "players" | "game";
type GameMode = "local" | "multiplayer";

function getCodeFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("m");
}

function setCodeInUrl(code: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("m", code);
  window.history.replaceState({}, "", url);
}

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

// Same four suit colors used on the cards, cycled by turn order so each
// avatar reads as consistently "that player's color" all game long. Text
// color is paired per swatch — the mustard diamond tone needs dark text,
// the rest read better with white.
const AVATAR_COLORS: { bg: string; fg: string }[] = [
  { bg: "var(--suit-clubs)", fg: "#fff" },
  { bg: "var(--suit-diamonds)", fg: "var(--fg)" },
  { bg: "var(--suit-hearts)", fg: "#fff" },
  { bg: "var(--suit-spades)", fg: "#fff" },
];

function getAvatarColor(index: number): { bg: string; fg: string } {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

const MAX_PLAYERS = 15;
const POLL_INTERVAL_MS = 2000;

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [match, setMatch] = useState<MatchState | null>(null);
  // Purely a client-side presentation choice (same backend either way): local
  // just means "no reason to show/share a link, and no reason to poll since
  // only this device ever interacts with the match". A resumed session (link
  // opened fresh) has no way to know which was originally picked, so it
  // defaults to the safer assumption — multiplayer — which still works fine
  // for a local game, just polls a little more than strictly necessary.
  const [gameMode, setGameMode] = useState<GameMode>("multiplayer");
  const [joinName, setJoinName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(!!getCodeFromUrl());
  const [houseRuleInput, setHouseRuleInput] = useState("");
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [turnAnnounce, setTurnAnnounce] = useState<string | null>(null);
  const [displaySeconds, setDisplaySeconds] = useState<number | null>(null);

  const previousPlayerId = useRef<number | null>(null);
  const previousPendingShotId = useRef<number | null>(null);
  const joinInputRef = useRef<HTMLInputElement | null>(null);

  // Resume an in-progress match if the link already has a code (shared link / refresh).
  useEffect(() => {
    const code = getCodeFromUrl();
    if (!code) return;
    api
      .getMatch(code)
      .then((state) => {
        setMatch(state);
        setScreen(state.status === "WAITING" ? "players" : "game");
      })
      .catch(() => setError("Partida não encontrada."))
      .finally(() => setInitialLoading(false));
  }, []);

  // Multiplayer sync: every device polls the same match state, so everyone's
  // screen reflects whoever's action actually happened (not just this
  // device's own). Paused while a mutation from this device is in flight,
  // so a slightly-stale poll response can't clobber an optimistic update.
  // Skipped entirely in local mode — only this device ever acts, so there's
  // nothing else to sync from.
  useEffect(() => {
    if (!match || loading || gameMode === "local" || (screen !== "players" && screen !== "game")) return;
    const code = match.code;
    const interval = setInterval(() => {
      api
        .getMatch(code)
        .then(setMatch)
        .catch(() => {
          /* transient poll failure — try again next tick */
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [screen, match?.code, loading, gameMode]);

  // Announce a new turn (but not on the very first render of the game screen).
  useEffect(() => {
    const currentId = match?.currentPlayer?.id ?? null;
    if (currentId !== null && previousPlayerId.current !== null && currentId !== previousPlayerId.current) {
      setTurnAnnounce(match?.currentPlayer?.name ?? null);
      const timer = setTimeout(() => setTurnAnnounce(null), 1400);
      previousPlayerId.current = currentId;
      return () => clearTimeout(timer);
    }
    previousPlayerId.current = currentId;
  }, [match?.currentPlayer?.id, match?.currentPlayer?.name]);

  // Shot-roulette alert: visibility is driven entirely by the server
  // (match.shotTimer.pendingPlayer), so every device shows/hides it in sync.
  // The vibrate/sound side effect only fires once per pending event (on the
  // null → set transition), not on every poll while it's still pending.
  useEffect(() => {
    const pendingId = match?.shotTimer.pendingPlayer?.id ?? null;
    if (pendingId !== null && previousPendingShotId.current === null) {
      navigator.vibrate?.([100, 80, 100, 80, 100]);
      playShotAlert();
    }
    previousPendingShotId.current = pendingId;
  }, [match?.shotTimer.pendingPlayer?.id]);

  // The countdown display: resynced to the server's authoritative
  // remainingSeconds every poll (phones' clocks drift, so the server counts,
  // not the client), ticking down locally between polls just so it doesn't
  // look frozen for two seconds at a time.
  useEffect(() => {
    setDisplaySeconds(match?.shotTimer.remainingSeconds ?? null);
  }, [match?.shotTimer.remainingSeconds]);

  useEffect(() => {
    if (screen !== "game" || match?.status !== "IN_PROGRESS" || match?.shotTimer.pendingPlayer) return;
    const interval = setInterval(() => {
      setDisplaySeconds((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => clearInterval(interval);
  }, [screen, match?.status, match?.shotTimer.pendingPlayer]);

  async function handleDismissShot() {
    if (!match) return;
    try {
      setMatch(await api.shotAck(match.code));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateMatch(mode: GameMode) {
    setLoading(true);
    setError(null);
    try {
      const { code, hostToken } = await api.createMatch();
      setCodeInUrl(code);
      setHostToken(code, hostToken);
      setGameMode(mode);
      const state = await api.getMatch(code);
      setMatch(state);
      setScreen("players");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!match || !joinName.trim()) return;
    setLoading(true);
    setError(null);
    unlockAudio();
    try {
      const { player, token } = await api.join(match.code, joinName.trim());
      setPlayerToken(match.code, player.id, token);
      setJoinName("");
      setMatch(await api.getMatch(match.code));
      // Local mode: same device is about to type the next name too — keep
      // the keyboard up and focus ready instead of making them tap back in.
      joinInputRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    if (!match) return;
    setLoading(true);
    setError(null);
    unlockAudio(); // real click, safe place to unlock for the shot timer later
    try {
      const state = await api.startMatch(match.code);
      previousPlayerId.current = state.currentPlayer?.id ?? null;
      previousPendingShotId.current = null;
      setMatch(state);
      setScreen("game");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReveal() {
    if (!match) return;
    setLoading(true);
    setError(null);
    unlockAudio();
    try {
      const state = await api.revealCard(match.code, match.currentPlayer?.id);
      setMatch(state);
      // Best-effort tactile feedback — iOS Safari has no Vibration API at
      // all, so this silently no-ops there; Android Chrome picks it up.
      navigator.vibrate?.(60);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdvance() {
    if (!match) return;
    setLoading(true);
    setError(null);
    try {
      setMatch(await api.advanceTurn(match.code, match.currentPlayer?.id));
      setHouseRuleInput("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveHouseRule() {
    if (!match || !houseRuleInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setMatch(await api.setHouseRule(match.code, houseRuleInput.trim(), match.currentPlayer?.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setError("Não consegui copiar automaticamente — selecione o link manualmente.");
    }
  }

  const canAct = !!match && !!getTokenFor(match.code, match.currentPlayer?.id);
  const canAdvance = canAct || (!!match && isHost(match.code));

  return (
    <div className="app">
      {error && (
        <div className="error">
          <span>{error}</span>
          <button type="button" className="error-dismiss" onClick={() => setError(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}

      {showHowToPlay && <HowToPlayModal onClose={() => setShowHowToPlay(false)} />}

      {initialLoading ? (
        <div className="screen">
          <p className="loading-hint">Carregando partida…</p>
        </div>
      ) : (
        <>
          {screen === "home" && (
            <div className="screen">
              <div className="hero">
                <div className="card-fan" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <h1>Drink Game</h1>
                <p className="tagline">
                  Um baralho de verdade. Jogue com o celular passando de mão em mão, ou cada um no
                  seu, pelo link.
                </p>
              </div>
              <div className="home-actions">
                <button disabled={loading} onClick={() => handleCreateMatch("multiplayer")}>
                  {loading ? "Criando…" : "Jogar com o grupo (cada um no seu)"}
                </button>
                <button type="button" className="secondary" disabled={loading} onClick={() => handleCreateMatch("local")}>
                  {loading ? "Criando…" : "Jogar neste celular"}
                </button>
                <button type="button" className="secondary" onClick={() => setShowHowToPlay(true)}>
                  Como jogar
                </button>
              </div>
            </div>
          )}

          {screen === "players" && match && (
            <div className="screen">
              <div className="players-header">
                <h2>{gameMode === "local" ? "Jogadores" : "Sala de espera"}</h2>
                <span className="player-count">
                  {match.players.length}/{MAX_PLAYERS}
                </span>
              </div>

              {match.players.map((p) => (
                <div className="player-row" key={p.id}>
                  <span
                    className="avatar avatar-small"
                    style={{ background: getAvatarColor(p.turnOrder).bg, color: getAvatarColor(p.turnOrder).fg }}
                    aria-hidden="true"
                  >
                    {getInitial(p.name)}
                  </span>
                  <span className="joined-name">{p.name}</span>
                </div>
              ))}

              <div className="player-row">
                <label className="sr-only" htmlFor="join-name">
                  Seu nome
                </label>
                <input
                  id="join-name"
                  ref={joinInputRef}
                  value={joinName}
                  placeholder={gameMode === "local" ? `Jogador ${match.players.length + 1}` : "Seu nome"}
                  maxLength={30}
                  disabled={match.players.length >= MAX_PLAYERS}
                  onChange={(e) => setJoinName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleJoin();
                    }
                  }}
                />
                <button disabled={loading || !joinName.trim() || match.players.length >= MAX_PLAYERS} onClick={handleJoin}>
                  {loading ? "Entrando…" : "Entrar"}
                </button>
              </div>

              {match.players.length >= MAX_PLAYERS && (
                <p className="field-hint">Sala cheia — máximo de {MAX_PLAYERS} jogadores.</p>
              )}

              {isHost(match.code) && (
                <button disabled={loading || match.players.length < 2} onClick={handleStart}>
                  {loading
                    ? "Iniciando…"
                    : match.players.length < 2
                      ? "Iniciar jogo (mínimo 2)"
                      : "Iniciar jogo"}
                </button>
              )}

              {gameMode === "multiplayer" && (
                <div className="link-hint">
                  <code>{window.location.href}</code>
                  <button type="button" onClick={handleCopyLink}>
                    {linkCopied ? "Copiado!" : "Copiar link"}
                  </button>
                </div>
              )}
            </div>
          )}

          {screen === "game" && match && (
            <div className="screen">
              {turnAnnounce && (
                <div className="turn-announce" role="status" aria-live="polite">
                  É a sua vez, {turnAnnounce}!
                </div>
              )}

              {match.shotTimer.pendingPlayer && (
                <button
                  type="button"
                  className="shot-announce"
                  onClick={handleDismissShot}
                  role="status"
                  aria-live="assertive"
                >
                  <span className="shot-announce-title">Hora do shot, {match.shotTimer.pendingPlayer.name}!</span>
                  <span className="shot-announce-hint">Toque para continuar</span>
                </button>
              )}

              <div className="game-header">
                <p className="round">Rodada {match.currentRound}</p>
                {displaySeconds !== null && (
                  <span className={`shot-timer ${displaySeconds <= 30 ? "shot-timer-urgent" : ""}`}>
                    Shot em {formatTime(displaySeconds)}
                  </span>
                )}
              </div>
              <div className="current-player">
                <span
                  className="avatar"
                  style={{
                    background: getAvatarColor(match.currentPlayerIndex).bg,
                    color: getAvatarColor(match.currentPlayerIndex).fg,
                  }}
                >
                  {getInitial(match.currentPlayer?.name ?? "")}
                </span>
                <h2>Vez de {match.currentPlayer?.name}</h2>
              </div>

              {match.houseRule && (
                <div className="house-rule">
                  <strong>Regra da rodada:</strong> {match.houseRule}
                </div>
              )}

              {match.revealedCard && match.deck.drawn >= match.deck.total && (
                <p className="last-card-badge">Última carta antes de embaralhar!</p>
              )}

              <PlayingCard
                card={match.revealedCard}
                revealed={!!match.revealedCard}
                onReveal={canAct ? handleReveal : () => {}}
                loading={loading || !canAct}
              />

              {!canAct && !match.revealedCard && (
                <p className="field-hint waiting-hint">Aguardando {match.currentPlayer?.name} jogar…</p>
              )}

              {canAct && match.revealedCard?.rank === "K" && (
                <div className="house-rule-form">
                  <label className="sr-only" htmlFor="house-rule-input">
                    Nova regra da rodada
                  </label>
                  <input
                    id="house-rule-input"
                    value={houseRuleInput}
                    placeholder="Qual é a nova regra?"
                    maxLength={200}
                    onChange={(e) => setHouseRuleInput(e.target.value)}
                  />
                  <button disabled={loading || !houseRuleInput.trim()} onClick={handleSaveHouseRule}>
                    Salvar regra
                  </button>
                </div>
              )}

              {canAdvance && match.revealedCard && (
                <button disabled={loading} onClick={handleAdvance}>
                  {loading ? "Avançando…" : "Próximo jogador"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
