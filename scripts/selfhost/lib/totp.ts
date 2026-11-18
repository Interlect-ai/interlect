/**
 * A TOTP code (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), as an authenticator app makes it.
 * Only the self-host end-to-end test uses it (scripts/selfhost/e2e.ts), to turn on two-step
 * sign-in for its local test admin the way a person would. Pure, so it is unit tested.
 */
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 (RFC 4648) as Supabase shows the key; spaces, dashes and padding are ignored. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  if (!clean) throw new Error("The TOTP key is empty");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`The TOTP key has a character that is not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

export function totp(secret: string, nowMs = Date.now(), digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 30_000)));
  const hash = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hash[hash.length - 1]! & 0x0f;
  const code = (hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

/** Milliseconds left of the current 30-second step (a code typed near the end may expire). */
export function totpMsLeft(nowMs = Date.now()): number {
  return 30_000 - (nowMs % 30_000);
}
