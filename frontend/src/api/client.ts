import type { MatchState } from "./types";
import { getHostToken, getTokenFor } from "../lib/identity";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // `headers` must be merged LAST — spreading ...options after a headers
  // key would let options.headers silently replace it wholesale (dropping
  // Content-Type whenever a caller also passes custom headers, which is
  // exactly what broke /house-rule: body-less calls never noticed).
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

function authHeaders(token: string | null): HeadersInit {
  return token ? { "X-Player-Token": token } : {};
}

export const api = {
  createMatch: () => request<{ code: string; hostToken: string }>("/matches", { method: "POST" }),

  getMatch: (code: string) => request<MatchState>(`/matches/${code}`),

  join: (code: string, name: string) =>
    request<{ player: { id: number; matchId: string; name: string; turnOrder: number }; token: string }>(
      `/matches/${code}/join`,
      { method: "POST", body: JSON.stringify({ name }) },
    ),

  startMatch: (code: string) =>
    request<MatchState>(`/matches/${code}/start`, {
      method: "POST",
      headers: authHeaders(getHostToken(code)),
    }),

  revealCard: (code: string, currentPlayerId: number | undefined) =>
    request<MatchState>(`/matches/${code}/reveal`, {
      method: "POST",
      headers: authHeaders(getTokenFor(code, currentPlayerId)),
    }),

  advanceTurn: (code: string, currentPlayerId: number | undefined) =>
    request<MatchState>(`/matches/${code}/advance`, {
      method: "POST",
      headers: authHeaders(getTokenFor(code, currentPlayerId) ?? getHostToken(code)),
    }),

  setHouseRule: (code: string, text: string, currentPlayerId: number | undefined) =>
    request<MatchState>(`/matches/${code}/house-rule`, {
      method: "POST",
      headers: authHeaders(getTokenFor(code, currentPlayerId)),
      body: JSON.stringify({ text }),
    }),

  shotAck: (code: string) => request<MatchState>(`/matches/${code}/shot/ack`, { method: "POST" }),

  endMatch: (code: string) =>
    request<MatchState>(`/matches/${code}/end`, {
      method: "POST",
      headers: authHeaders(getHostToken(code)),
    }),

  kickPlayer: (code: string, playerId: number) =>
    request<MatchState>(`/matches/${code}/kick`, {
      method: "POST",
      headers: authHeaders(getHostToken(code)),
      body: JSON.stringify({ playerId }),
    }),
};
