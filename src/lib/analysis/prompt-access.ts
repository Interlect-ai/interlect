import type { AppRole } from "@/lib/supabase/types";

/**
 * Only an Admin may read the literal prompt texts. One place for the rule, so the
 * server function and its test agree.
 */
export function canReadPrompts(roles: readonly AppRole[]): boolean {
  return roles.includes("admin");
}
