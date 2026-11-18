/**
 * Brain is switched off until the Brain migrations (0040-0043) have run and the product owner has
 * approved turning it on. While off, the queue consumer acknowledges messages without work,
 * the cron route does nothing and enqueueBrainCapture is a no-op, so the code can ship
 * before the database is ready. Set BRAIN_ENABLED=true (Preview and Production) to turn on.
 */
export function isBrainEnabled(): boolean {
  return process.env["BRAIN_ENABLED"] === "true";
}
