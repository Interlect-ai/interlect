import { createHash } from "node:crypto";

/**
 * (TS-21): a fingerprint of the exact prompt a model call received, before masking (the
 * masked text depends on the fund's dictionary, the prompt does not). The prompt itself is never
 * stored on the run; the fingerprint shows afterwards whether two calls got the same prompt, also
 * when the setup version and the template version are the same (a changed setup text, a new
 * evidence sheet). Server-only: the column is not granted to the browser (0115, 0129).
 */
export function promptFingerprint(prompt: {
  system: string;
  user: string;
  /** The JSON schema the answer must follow is part of what the model is asked. */
  schema?: unknown;
}): string {
  const hash = createHash("sha256");
  hash.update("system\u0000").update(prompt.system);
  hash.update("\u0000user\u0000").update(prompt.user);
  if (prompt.schema !== undefined) {
    hash.update("\u0000schema\u0000").update(JSON.stringify(prompt.schema));
  }
  return hash.digest("hex");
}

/**
 * The run's fingerprint from its calls' fingerprints (a deep analysis makes one call per
 * specialist plus the synthesis). Sorted by step, so the order the calls finished in does not
 * matter; a run with one call keeps that call's fingerprint.
 */
export function runPromptFingerprint(
  steps: ReadonlyArray<{ stepKey: string; fingerprint: string | null }>,
): string | null {
  const known = steps
    .filter((step): step is { stepKey: string; fingerprint: string } => !!step.fingerprint)
    .sort((a, b) => (a.stepKey < b.stepKey ? -1 : a.stepKey > b.stepKey ? 1 : 0));
  if (known.length === 0) return null;
  if (known.length === 1) return known[0]!.fingerprint;
  const hash = createHash("sha256");
  for (const step of known) hash.update(`${step.stepKey}\u0000${step.fingerprint}\u0000`);
  return hash.digest("hex");
}
