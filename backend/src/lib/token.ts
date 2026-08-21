import { randomBytes } from "node:crypto";

// Per-player/host credentials — not real auth, just enough to stop casual
// cross-device interference in multiplayer (see schema.prisma comments).
export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}
