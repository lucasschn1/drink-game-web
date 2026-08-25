import { useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import type { MatchState, Suit } from "./api/types";
import { PlayingCard } from "./components/PlayingCard";
import { HowToPlayModal } from "./components/HowToPlayModal";
import { HostPanel } from "./components/HostPanel";
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

const SUIT_LABEL: Record<Suit, string> = {
  hearts: "copas",
  diamonds: "ouros",
  clubs: "paus",
  spades: "espadas",
};

const WAITING_ROOM_TIPS = [
  "Você sabia? Se sair um Rei, todo mundo cria uma regra nova pra rodada.",
  "Duas cartas seguidas do mesmo naipe dobram a regra — fica de olho.",
  "A cada 3 minutos alguém é sorteado pro shot da rodada.",
  "O baralho não repete carta — todas as 52 saem antes de embaralhar de novo.",
];

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
  const [showHostPanel, setShowHostPanel] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [turnAnnounce, setTurnAnnounce] = useState<string | null>(null);
  const [displaySeconds, setDisplaySeconds] = useState<number | null>(null);
  // Waiting-room polish: which player rows are still mid entrance-animation,
  // and whether the just-clicked start button is mid flourish.
  const [enteringPlayerIds, setEnteringPlayerIds] = useState<Set<number>>(new Set());
  const [startFlourish, setStartFlourish] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);

  const previousPlayerId = useRef<number | null>(null);
  // Belt-and-suspenders against a double-tap firing two /reveal requests:
  // `loading` alone has a gap between the tap and React re-rendering the
  // disabled button, and this ref closes it synchronously, immediately.
  const revealInFlight = useRef(false);
  const previousPendingShotId = useRef<number | null>(null);
  const joinInputRef = useRef<HTMLInputElement | null>(null);
  // Every player id this device has already rendered once — used to detect
  // which rows are new (and so should animate in) without replaying the
  // entrance on every poll for players who were already in the room.
  const seenPlayerIds = useRef<Set<number>>(new Set());

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

  // Shared by both the regular poll below and the shot-timer's early
  // zero-crossing fetch — fire-and-forget, silently ignores transient
  // failures since both callers just want "try to catch up on the next
  // opportunity" rather than surfacing a network blip as a user-facing error.
  function refreshMatch(code: string) {
    api
      .getMatch(code)
      .then(setMatch)
      .catch(() => {});
  }

  // Multiplayer sync: every device polls the same match state, so everyone's
  // screen reflects whoever's action actually happened (not just this
  // device's own). Paused while a mutation from this device is in flight,
  // so a slightly-stale poll response can't clobber an optimistic update.
  // Skipped entirely in local mode — only this device ever acts, so there's
  // nothing else to sync from.
  useEffect(() => {
    if (!match || loading || gameMode === "local" || (screen !== "players" && screen !== "game")) return;
    const code = match.code;
    const interval = setInterval(() => refreshMatch(code), POLL_INTERVAL_MS);
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

  // Waiting-room entrance animation: fires once per player id, the first
  // time this device ever renders it (covers both "just joined live" and
  // "was already in the room when this device loaded the screen"). Ids
  // already seen never replay it, so a 2s poll doesn't re-animate the whole
  // roster every tick.
  useEffect(() => {
    if (!match) return;
    const freshIds = match.players.map((p) => p.id).filter((id) => !seenPlayerIds.current.has(id));
    if (freshIds.length === 0) return;
    freshIds.forEach((id) => seenPlayerIds.current.add(id));
    setEnteringPlayerIds((prev) => new Set([...prev, ...freshIds]));
    const timer = setTimeout(() => {
      setEnteringPlayerIds((prev) => {
        const next = new Set(prev);
        freshIds.forEach((id) => next.delete(id));
        return next;
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [match?.players]);

  // Rotates the waiting-room tip every few seconds — only while it's
  // actually on screen, so it's not silently ticking in the background.
  useEffect(() => {
    if (screen !== "players") return;
    const interval = setInterval(() => {
      setTipIndex((i) => (i + 1) % WAITING_ROOM_TIPS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [screen]);

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

  // Every device runs this same countdown, regardless of whose turn it is or
  // whether the current card has been flipped — the shot alert isn't tied to
  // either. The moment a device's own clock reaches zero, it asks the server
  // immediately instead of waiting for the next scheduled poll tick (up to
  // POLL_INTERVAL_MS away): maybeTriggerShotTimer runs as a side effect of
  // any GET, so whichever client notices first is the one that actually
  // flips pendingShotPlayerId. Every other client still only sees it on
  // their next regular poll, but this shaves that worst case down
  // dramatically instead of every client independently waiting the full
  // interval.
  useEffect(() => {
    if (screen !== "game" || match?.status !== "IN_PROGRESS" || match?.shotTimer.pendingPlayer) return;
    const code = match.code;
    const interval = setInterval(() => {
      setDisplaySeconds((prev) => {
        if (prev === null || prev <= 0) return prev; // already at zero — wait for the poll, don't refetch every tick
        const next = prev - 1;
        if (next <= 0) refreshMatch(code);
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [screen, match?.status, match?.shotTimer.pendingPlayer, match?.code]);

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
    setStartFlourish(true);
    try {
      // Floors the button's flourish at ~450ms so it actually gets seen —
      // a fast local response would otherwise cut to the game screen before
      // the animation registers at all.
      const [state] = await Promise.all([
        api.startMatch(match.code),
        new Promise((resolve) => setTimeout(resolve, 450)),
      ]);
      previousPlayerId.current = state.currentPlayer?.id ?? null;
      previousPendingShotId.current = null;
      setMatch(state);
      setScreen("game");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setStartFlourish(false);
    }
  }

  async function handleReveal() {
    if (!match || revealInFlight.current) return;
    revealInFlight.current = true;
    setLoading(true);
    setError(null);
    unlockAudio();
    // Fires the instant the tap registers rather than after the round-trip —
    // a real card flip doesn't wait for a server to confirm before it feels
    // like something happened.
    navigator.vibrate?.(60);
    try {
      const state = await api.revealCard(match.code, match.currentPlayer?.id);
      setMatch(state);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      revealInFlight.current = false;
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

  // Opens the device's native share sheet (WhatsApp, Mensagens, etc.) when
  // available — falls back to copy on desktop browsers and any share
  // failure that isn't just the user dismissing the sheet.
  async function handleShareLink() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Drink Game", text: "Entra na nossa partida!", url });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          await handleCopyLink();
        }
      }
      return;
    }
    await handleCopyLink();
  }

  async function handleKick(playerId: number) {
    if (!match) return;
    setLoading(true);
    setError(null);
    try {
      setMatch(await api.kickPlayer(match.code, playerId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEndMatch() {
    if (!match) return;
    setLoading(true);
    setError(null);
    try {
      setMatch(await api.endMatch(match.code));
      setShowHostPanel(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const canAct = !!match && !!getTokenFor(match.code, match.currentPlayer?.id);
  const canAdvance = canAct || (!!match && isHost(match.code));
  const amHost = !!match && isHost(match.code);

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

      {showHostPanel && match && (
        <HostPanel
          players={match.players}
          onClose={() => setShowHostPanel(false)}
          onKick={handleKick}
          onEndMatch={handleEndMatch}
          loading={loading}
        />
      )}

      {initialLoading ? (
        <div className="screen">
          <p className="loading-hint">Carregando partida…</p>
        </div>
      ) : match?.status === "FINISHED" ? (
        <div className="screen">
          <div className="hero">
            <h1>Partida encerrada</h1>
            <p className="tagline">Valeu, galera! Bora começar outra?</p>
          </div>
          <div className="home-actions">
            <button
              onClick={() => {
                window.history.replaceState({}, "", window.location.pathname);
                setMatch(null);
                setScreen("home");
              }}
            >
              Nova partida
            </button>
          </div>
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
                <div
                  className={`player-row ${enteringPlayerIds.has(p.id) ? "enter" : ""}`}
                  key={p.id}
                >
                  <span
                    className="avatar avatar-small"
                    style={{ background: getAvatarColor(p.turnOrder).bg, color: getAvatarColor(p.turnOrder).fg }}
                    aria-hidden="true"
                  >
                    {getInitial(p.name)}
                  </span>
                  <span className="joined-name">{p.name}</span>
                  {amHost && (
                    <button
                      type="button"
                      className="remove-player"
                      disabled={loading}
                      aria-label={`Remover ${p.name}`}
                      onClick={() => handleKick(p.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}

              <p className={`status-line ${match.players.length >= 2 ? "ready" : ""}`}>
                <span className="status-dot" aria-hidden="true" />
                {match.players.length >= 2
                  ? "Prontos pra começar!"
                  : `Faltam pelo menos ${2 - match.players.length} pra começar`}
              </p>

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

              <p className="tip-card">
                <span className="tip-text" key={tipIndex}>
                  {WAITING_ROOM_TIPS[tipIndex]}
                </span>
              </p>

              {isHost(match.code) && (
                <button
                  className={`start-btn ${startFlourish ? "flourish" : ""}`}
                  disabled={loading || match.players.length < 2}
                  onClick={handleStart}
                >
                  {loading
                    ? "Iniciando…"
                    : match.players.length < 2
                      ? "Iniciar jogo (mínimo 2)"
                      : "Iniciar jogo"}
                </button>
              )}

              {gameMode === "multiplayer" &&
                (typeof navigator.share === "function" ? (
                  <div className="link-hint">
                    <button className="share-btn" type="button" onClick={handleShareLink}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />
                      </svg>
                      Compartilhar link
                    </button>
                  </div>
                ) : (
                  <div className="link-hint">
                    <code>{window.location.href}</code>
                    <button type="button" onClick={handleCopyLink}>
                      {linkCopied ? "Copiado!" : "Copiar link"}
                    </button>
                  </div>
                ))}
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
                <div className="game-header-right">
                  {displaySeconds !== null && (
                    <span className={`shot-timer ${displaySeconds <= 30 ? "shot-timer-urgent" : ""}`}>
                      Shot em {formatTime(displaySeconds)}
                    </span>
                  )}
                  {amHost && (
                    <button type="button" className="secondary host-panel-trigger" onClick={() => setShowHostPanel(true)}>
                      Gerenciar
                    </button>
                  )}
                </div>
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

              {match.comboSuit && (
                <div className="combo-strip">
                  <span className={`combo-chip suit-${match.comboSuit}`}>
                    2× {SUIT_LABEL[match.comboSuit]} seguidas
                  </span>
                </div>
              )}

              {/* Hidden (not just covered) while the turn-announce overlay is up —
                  its unflip transition runs at the same moment, and 3D
                  transform layers don't reliably respect z-index against 2D
                  siblings on every browser (notably iOS Safari), so the flip
                  could paint through the message instead of staying behind it. */}
              <div style={turnAnnounce ? { visibility: "hidden" } : undefined}>
                <PlayingCard
                  card={match.revealedCard}
                  revealed={!!match.revealedCard}
                  onReveal={canAct ? handleReveal : () => {}}
                  loading={loading || !canAct}
                />
              </div>

              {match.comboSuit && (
                <p className="combo-hint">
                  Regra dobrada: quem bebeu na carta anterior bebe de novo.
                </p>
              )}

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
