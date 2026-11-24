// Sealing Pipedrive tokens (SF-117 research.md §3): AES-256-GCM with node:crypto, key from PIPEDRIVE_TOKEN_KEY.
// Stored value: version byte 1 ‖ 12-byte random IV ‖ 16-byte tag ‖ ciphertext. The additional authenticated data
// "pipedrive-token:<user id>" binds a value to its user: copied to another user's row it does not open. Nothing here
// logs anything, and errors carry no part of the token.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;
const IV = 12;
const TAG = 16;

export class TokenUnreadable extends Error {
  constructor() {
    super("The saved Pipedrive token can't be read.");
    this.name = "TokenUnreadable";
  }
}

const aad = (userId: number) => Buffer.from(`pipedrive-token:${userId}`);

export function sealToken(key: Buffer, userId: number, token: string): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(userId));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function openToken(key: Buffer, userId: number, sealed: Buffer): string {
  if (sealed.length <= 1 + IV + TAG || sealed[0] !== VERSION) throw new TokenUnreadable();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(1, 1 + IV));
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(sealed.subarray(1 + IV, 1 + IV + TAG));
    return Buffer.concat([decipher.update(sealed.subarray(1 + IV + TAG)), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenUnreadable();
  }
}
