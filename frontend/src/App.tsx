import { useEffect, useState } from "react";
import { api } from "./api/client";
import type { MatchState } from "./api/types";
import { PlayingCard } from "./components/PlayingCard";
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

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [match, setMatch] = useState<MatchState | null>(null);
  const [playerNames, setPlayerNames] = useState<string[]>(["", ""]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      .catch(() => setError("Partida não encontrada."));
  }, []);

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
    if (!match) return;
    const names = playerNames.map((n) => n.trim()).filter(Boolean);
    if (names.length < 2) {
      setError("Adicione pelo menos 2 jogadores.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.setPlayers(match.code, names);
      const state = await api.startMatch(match.code);
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
    try {
      setMatch(await api.revealCard(match.code));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdvance() {
    if (!match) return;
    setLoading(true);
    try {
      setMatch(await api.advanceTurn(match.code));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      {error && <div className="error">{error}</div>}

      {screen === "home" && (
        <div className="screen">
          <h1>Drink Game</h1>
          <button disabled={loading} onClick={handleCreateMatch}>
            Começar partida
          </button>
        </div>
      )}

      {screen === "players" && match && (
        <div className="screen">
          <h2>Jogadores</h2>
          {playerNames.map((name, i) => (
            <input
              key={i}
              value={name}
              placeholder={`Jogador ${i + 1}`}
              onChange={(e) => {
                const next = [...playerNames];
                next[i] = e.target.value;
                setPlayerNames(next);
              }}
            />
          ))}
          <div className="row">
            <button onClick={() => setPlayerNames([...playerNames, ""])}>
              + Adicionar jogador
            </button>
            {playerNames.length > 2 && (
              <button onClick={() => setPlayerNames(playerNames.slice(0, -1))}>
                Remover último
              </button>
            )}
          </div>
          <button disabled={loading} onClick={handleStart}>
            Iniciar jogo
          </button>
          <p className="link-hint">
            Link da partida: <code>{window.location.href}</code>
          </p>
        </div>
      )}

      {screen === "game" && match && (
        <div className="screen">
          <p className="round">Rodada {match.currentRound}</p>
          <h2>Vez de {match.currentPlayer?.name}</h2>

          <PlayingCard
            card={match.revealedCard}
            revealed={!!match.revealedCard}
            onReveal={handleReveal}
            loading={loading}
          />

          {match.revealedCard && (
            <button disabled={loading} onClick={handleAdvance}>
              Próximo jogador
            </button>
          )}
        </div>
      )}
    </div>
  );
}
