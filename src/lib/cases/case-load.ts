/**
 * The case page never waits for ever. A case that has not arrived after
 * CASE_LOAD_TIMEOUT_MS is shown as an error with "Prøv igen" instead of an endless "Henter case".
 * The slowest case on staging took about 7 s (all 27 cases in E2E Testfond A, 15 Oct), so 30 s
 * only catches a request that hangs.
 */
export const CASE_LOAD_TIMEOUT_MS = 30_000;

export class CaseLoadTimeout extends Error {
  constructor() {
    super("case load timed out");
    this.name = "CaseLoadTimeout";
  }
}

/** The answer of `promise`, or a CaseLoadTimeout after `ms`; the timer never outlives the race. */
export function withTimeout<T>(promise: Promise<T>, ms: number = CASE_LOAD_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CaseLoadTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export type CasePageState =
  "case" | "waiting" | "timeout" | "refused" | "error" | "teamError" | "notFound";

/**
 * What the case page shows when it has no case to draw yet. "waiting" covers the time before the
 * session and the team are known (the old page showed "Casen blev ikke fundet" for a moment
 * there) as well as the request itself.
 */
export function casePageState(input: {
  hasCase: boolean;
  sessionLoading: boolean;
  teamsLoading: boolean;
  teamsFailed: boolean;
  hasTeam: boolean;
  caseLoading: boolean;
  caseError: unknown;
  isRefusal: (error: unknown) => boolean;
}): CasePageState {
  if (input.hasCase) return "case";
  if (input.caseError) {
    if (input.caseError instanceof CaseLoadTimeout) return "timeout";
    return input.isRefusal(input.caseError) ? "refused" : "error";
  }
  if (input.sessionLoading || input.teamsLoading || input.caseLoading) return "waiting";
  if (input.teamsFailed) return "teamError";
  if (!input.hasTeam) return "refused";
  return "notFound";
}
