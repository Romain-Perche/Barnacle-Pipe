// Sealing saved tokens of outside services (SF-117 research.md §3, SF-118 research.md §4): AES-256-GCM with node:crypto,
// each service with its own key (PIPEDRIVE_TOKEN_KEY, GMAIL_TOKEN_KEY, read by env.ts readTokenKey()).
// Stored value: version byte 1 ‖ 12-byte random IV ‖ 16-byte tag ‖ ciphertext. The additional authenticated data
// "<purpose>:<user id>" binds a value to its user and its service: copied to another user's row, or to the other
// service, it does not open. "pipedrive-token" is exactly SF-117's string, so tokens saved before the move still open.
// Nothing here logs anything, and errors carry no part of the token.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;
const IV = 12;
const TAG = 16;

export type SealPurpose = "pipedrive-token" | "gmail-token";

export class TokenUnreadable extends Error {
  constructor() {
    super("A saved token can't be read.");
    this.name = "TokenUnreadable";
  }
}

const aad = (purpose: SealPurpose, userId: number) => Buffer.from(`${purpose}:${userId}`);

export function sealToken(key: Buffer, purpose: SealPurpose, userId: number, token: string): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG });
  cipher.setAAD(aad(purpose, userId));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function openToken(key: Buffer, purpose: SealPurpose, userId: number, sealed: Buffer): string {
  if (sealed.length <= 1 + IV + TAG || sealed[0] !== VERSION) throw new TokenUnreadable();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(1, 1 + IV), { authTagLength: TAG });
    decipher.setAAD(aad(purpose, userId));
    decipher.setAuthTag(sealed.subarray(1 + IV, 1 + IV + TAG));
    return Buffer.concat([decipher.update(sealed.subarray(1 + IV + TAG)), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenUnreadable();
  }
}
