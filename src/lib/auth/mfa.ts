/**
 * MFA: TOTP with Supabase Auth. A user with a verified factor must use an aal2 session;
 * the server middleware refuses aal1 (auth-middleware.ts) and so does the database (0094).
 * Pure helpers shared by the server check and the pages.
 */

/** The `aal` claim of an access token that Supabase Auth has already verified, or null. */
export function tokenAal(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims: unknown = JSON.parse(atob(padded));
    if (claims && typeof claims === "object" && "aal" in claims) {
      const aal = (claims as { aal: unknown }).aal;
      return typeof aal === "string" ? aal : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** True when the user has a verified factor; only those must answer a code. */
export function hasVerifiedFactor(
  factors: ReadonlyArray<{ status?: string | null }> | null | undefined,
): boolean {
  return (factors ?? []).some((factor) => factor.status === "verified");
}

/** The server's rule: a session without aal2 is refused when the user has a verified factor. */
export function mfaSatisfied(
  factors: ReadonlyArray<{ status?: string | null }> | null | undefined,
  token: string,
): boolean {
  return !hasVerifiedFactor(factors) || tokenAal(token) === "aal2";
}

export type MfaStep = "ok" | "challenge" | "enroll";

/**
 * What a signed-in user must do next, from Supabase's assurance levels: answer a code (a factor
 * and an aal1 session), set up a factor (none yet), or nothing.
 */
export function mfaStep(level: { currentLevel: string | null; nextLevel: string | null }): MfaStep {
  if (level.currentLevel === "aal2") return "ok";
  if (level.nextLevel === "aal2") return "challenge";
  return "enroll";
}

/** Six digits, spaces and dashes ignored (authenticator apps show "123 456"). */
export function normalizeTotpCode(input: string): string {
  return input.replace(/[\s-]/g, "");
}

export function isTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}
