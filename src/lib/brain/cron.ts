import { timingSafeEqual } from "node:crypto";
import { createHash } from "node:crypto";

/**
 * Vercel Cron calls the route with "Authorization: Bearer <CRON_SECRET>". Constant time; without
 * a secret every call is refused (gap C §7). Pure (tested).
 */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const given = createHash("sha256").update(header).digest();
  return timingSafeEqual(expected, given);
}

/** The nightly key: the UTC date, so one run per fund and day. */
export function nightlyKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
