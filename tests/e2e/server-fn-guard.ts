/**
 * The paid-call guard for the e2e scripts, as pure functions (used by lib.ts, covered by
 * server-fn-guard.test.ts and `node tests/e2e/guard-selftest.ts`).
 *
 * How it identifies a call: vite.config.ts gives production builds readable server-function ids
 * (`<name>_createServerFn_handler--<hash>`, scripts/lib/server-fn-id.mjs); the dev server uses
 * base64url JSON with the same export name. `serverFnNameFromUrl` reads both. A call is allowed
 * only when its name is on the reviewed SAFE list, or PAID but explicitly let through
 * (E2E_ALLOW_PAID=1, or E2E_ALLOW_FUNCTIONS=name1,name2). An id that cannot be read (an old
 * preview built before this change, an opaque hash) or a name on neither list is BLOCKED.
 */
import { serverFnNameFromUrl } from "../../scripts/lib/server-fn-id.mjs";
import { PAID_API_ROUTES, PAID_FUNCTIONS, SAFE_FUNCTIONS } from "./server-fn-classes.ts";

export type GuardDecision =
  | { action: "allow"; name: string }
  | { action: "block"; name: string | null; reason: "paid" | "unclassified" | "unreadable" };

export interface GuardOptions {
  allowPaid?: boolean;
  /** Export names let through even though they are paid (one non-paid write, a named run). */
  allowFunctions?: readonly string[];
}

export function decideServerFnCall(url: string, options: GuardOptions = {}): GuardDecision {
  const name = serverFnNameFromUrl(url);
  if (!name) return { action: "block", name: null, reason: "unreadable" };
  if (options.allowPaid) return { action: "allow", name };
  if (PAID_FUNCTIONS.has(name)) {
    return options.allowFunctions?.includes(name)
      ? { action: "allow", name }
      : { action: "block", name, reason: "paid" };
  }
  if (SAFE_FUNCTIONS.has(name)) return { action: "allow", name };
  return { action: "block", name, reason: "unclassified" };
}

/**
 * True when a request goes to a PAID API route (`POST /api/brain/chat`), which lib.ts blocks
 * unless E2E_ALLOW_PAID=1. Only the path counts, so it works against any base URL.
 */
export function isPaidApiCall(url: string): boolean {
  try {
    return PAID_API_ROUTES.has(new URL(url).pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}

/**
 * Old-style export name (`findCompanyCandidates_createServerFn_handler`) for the fixtures that
 * intercept one function with `name.startsWith("findCompanyCandidates_")`; null when unreadable.
 */
export function serverFunctionName(url: string): string | null {
  const name = serverFnNameFromUrl(url);
  return name ? `${name}_createServerFn_handler` : null;
}
