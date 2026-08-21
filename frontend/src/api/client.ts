import type { MatchState } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  createMatch: () => request<{ code: string }>("/matches", { method: "POST" }),

  getMatch: (code: string) => request<MatchState>(`/matches/${code}`),

  setPlayers: (code: string, names: string[]) =>
    request<MatchState>(`/matches/${code}/players`, {
      method: "POST",
      body: JSON.stringify({ names }),
    }),

  startMatch: (code: string) =>
    request<MatchState>(`/matches/${code}/start`, { method: "POST" }),

  revealCard: (code: string) =>
    request<MatchState>(`/matches/${code}/reveal`, { method: "POST" }),

  advanceTurn: (code: string) =>
    request<MatchState>(`/matches/${code}/advance`, { method: "POST" }),
};
