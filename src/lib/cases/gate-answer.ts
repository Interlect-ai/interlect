/**
 * A team answer to a mandate requirement (pure; tested). Shared by the answer editor and the
 * page, so the editor asks for a reason exactly when the server will treat the answer as an
 * override (answerCaseTask).
 */

/** Shortest written reason for an override (the server's rule, tasks.functions.ts). */
export const OVERRIDE_REASON_MIN = 10;

/**
 * "Opfyldt" overrides the requirement when it is not met now (the AI's breach or a recorded
 * "Ikke opfyldt"), and a revised override stays one.
 */
export function needsOverride(input: {
  passed: boolean | null;
  passedNow: boolean | null;
  previousOverride: boolean;
}): boolean {
  return input.passed === true && (input.passedNow === false || input.previousOverride);
}

/** The reason is long enough (code points, like the server). */
export function overrideReasonOk(text: string): boolean {
  return Array.from(text.trim()).length >= OVERRIDE_REASON_MIN;
}
