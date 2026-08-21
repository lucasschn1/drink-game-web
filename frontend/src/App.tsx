import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import type { MatchState } from "./api/types";
import { PlayingCard } from "./components/PlayingCard";
import { HowToPlayModal } from "./components/HowToPlayModal";
import "./App.css";

type Screen = "home" | "players" | "game";

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

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [match, setMatch] = useState<MatchState | null>(null);
  const [playerNames, setPlayerNames] = useState<string[]>(["", ""]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(!!getCodeFromUrl());
  const [houseRuleInput, setHouseRuleInput] = useState("");
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [turnAnnounce, setTurnAnnounce] = useState<string | null>(null);

  const previousPlayerId = useRef<number | null>(null);

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

  const duplicateIndexes = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<number>();
    playerNames.forEach((name, i) => {
      const key = name.trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) {
        dupes.add(i);
        dupes.add(seen.get(key)!);
      } else {
        seen.set(key, i);
      }
    });
    return dupes;
  }, [playerNames]);

  const validNames = playerNames.map((n) => n.trim()).filter(Boolean);
  const canStart = validNames.length >= 2 && duplicateIndexes.size === 0;

  async function handleCreateMatch() {
    setLoading(true);
    setError(null);
    try {
      const { code } = await api.createMatch();
      setCodeInUrl(code);
      const state = await api.getMatch(code);
      setMatch(state);
      setScreen("players");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    if (!match || !canStart) return;
    setLoading(true);
    setError(null);
    try {
      await api.setPlayers(match.code, validNames);
      const state = await api.startMatch(match.code);
      previousPlayerId.current = state.currentPlayer?.id ?? null;
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
    try {
      const state = await api.revealCard(match.code);
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
      setMatch(await api.advanceTurn(match.code));
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
      setMatch(await api.setHouseRule(match.code, houseRuleInput.trim()));
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
              <h1>Drink Game</h1>
              <button disabled={loading} onClick={handleCreateMatch}>
                {loading ? "Criando…" : "Começar partida"}
              </button>
              <button type="button" className="secondary" onClick={() => setShowHowToPlay(true)}>
                Como jogar
              </button>
            </div>
          )}

          {screen === "players" && match && (
            <div className="screen">
              <h2>Jogadores</h2>
              {playerNames.map((name, i) => (
                <div className="player-row" key={i}>
                  <label className="sr-only" htmlFor={`player-${i}`}>
                    Nome do jogador {i + 1}
                  </label>
                  <input
                    id={`player-${i}`}
                    value={name}
                    placeholder={`Jogador ${i + 1}`}
                    className={duplicateIndexes.has(i) ? "input-error" : ""}
                    onChange={(e) => {
                      const next = [...playerNames];
                      next[i] = e.target.value;
                      setPlayerNames(next);
                    }}
                  />
                  {playerNames.length > 2 && (
                    <button
                      type="button"
                      className="remove-player"
                      aria-label={`Remover jogador ${i + 1}`}
                      onClick={() => setPlayerNames(playerNames.filter((_, idx) => idx !== i))}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {duplicateIndexes.size > 0 && (
                <p className="field-hint field-hint-error">Nomes repetidos — ajuste antes de continuar.</p>
              )}
              <button type="button" onClick={() => setPlayerNames([...playerNames, ""])}>
                + Adicionar jogador
              </button>
              <button disabled={loading || !canStart} onClick={handleStart}>
                {loading ? "Iniciando…" : "Iniciar jogo"}
              </button>
              <div className="link-hint">
                <code>{window.location.href}</code>
                <button type="button" onClick={handleCopyLink}>
                  {linkCopied ? "Copiado!" : "Copiar link"}
                </button>
              </div>
            </div>
          )}

          {screen === "game" && match && (
            <div className="screen">
              {turnAnnounce && (
                <div className="turn-announce" role="status" aria-live="polite">
                  É a sua vez, {turnAnnounce}!
                </div>
              )}

              <p className="round">Rodada {match.currentRound}</p>
              <div className="current-player">
                <span className="avatar">{getInitial(match.currentPlayer?.name ?? "")}</span>
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
                onReveal={handleReveal}
                loading={loading}
              />

              {match.revealedCard?.rank === "K" && (
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

              {match.revealedCard && (
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
