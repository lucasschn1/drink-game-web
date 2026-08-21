// This device's credentials for a given match, kept in localStorage.
//
// A device can hold more than one player token: single-device pass-and-play
// still works exactly like before because that one phone joins several
// names in a row before starting, accumulating a token for each — so later
// it can act on behalf of whoever's turn it is. A device that joined only
// once (true multiplayer) only ever has its own token, so it can only act
// on its own turn.

interface MatchIdentity {
  hostToken?: string;
  playerTokens: Record<number, string>;
}

function storageKey(matchCode: string): string {
  return `dg:${matchCode}`;
}

function readIdentity(matchCode: string): MatchIdentity {
  try {
    const raw = localStorage.getItem(storageKey(matchCode));
    if (!raw) return { playerTokens: {} };
    const parsed = JSON.parse(raw);
    return { hostToken: parsed.hostToken, playerTokens: parsed.playerTokens ?? {} };
  } catch {
    return { playerTokens: {} };
  }
}

function writeIdentity(matchCode: string, identity: MatchIdentity): void {
  try {
    localStorage.setItem(storageKey(matchCode), JSON.stringify(identity));
  } catch {
    // localStorage unavailable (private mode, quota) — degrade to read-only
    // for this device; nothing else to do about it.
  }
}

export function setHostToken(matchCode: string, hostToken: string): void {
  const identity = readIdentity(matchCode);
  identity.hostToken = hostToken;
  writeIdentity(matchCode, identity);
}

export function getHostToken(matchCode: string): string | null {
  return readIdentity(matchCode).hostToken ?? null;
}

export function isHost(matchCode: string): boolean {
  return !!getHostToken(matchCode);
}

export function setPlayerToken(matchCode: string, playerId: number, token: string): void {
  const identity = readIdentity(matchCode);
  identity.playerTokens[playerId] = token;
  writeIdentity(matchCode, identity);
}

export function getTokenFor(matchCode: string, playerId: number | undefined | null): string | null {
  if (playerId == null) return null;
  return readIdentity(matchCode).playerTokens[playerId] ?? null;
}
