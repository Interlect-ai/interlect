/**
 * Role change that cannot leave a person with no role, or with two roles after a partial
 * failure (B10-1, done in code; an RPC would make it fully atomic).
 *
 * Order: ADD the new roles first (one statement, idempotent), then REMOVE the old ones (one
 * statement), then run `afterChange` (the audit event, which fails closed). Because the new
 * role exists before the old one goes, the person is never without access in between. If the
 * remove or the audit fails, the change is rolled back: the removed rows are put back first
 * (never zero roles), then the added ones are deleted. If even the rollback fails, the error
 * says so, so an Admin checks the person's role instead of trusting a half state.
 *
 * Pure of Supabase: the caller passes a `RoleStore`, so the order and the rollback are tested
 * with injected failures (role-change.test.ts).
 */
import type { AppRole } from "@/lib/supabase/types";
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

export interface RoleRow {
  role: AppRole;
  grantedBy: string | null;
}

export interface RoleStore {
  /** One atomic, idempotent statement (upsert, ignore duplicates). */
  add(rows: RoleRow[]): Promise<void>;
  /** One atomic statement deleting exactly these roles. */
  remove(roles: AppRole[]): Promise<void>;
}

export interface RoleChangePlan {
  add: AppRole[];
  remove: AppRole[];
  result: AppRole[];
}

/** What to add and remove to go from `current` to `desired` (order-stable, no duplicates). */
export function planRoleChange(
  current: readonly AppRole[],
  desired: readonly AppRole[],
): RoleChangePlan {
  const want = [...new Set(desired)];
  const have = new Set(current);
  return {
    add: want.filter((role) => !have.has(role)),
    remove: [...have].filter((role) => !want.includes(role)),
    result: want,
  };
}

/** The rollback itself failed: the person's roles may be half changed. */
export class RoleChangeInconsistentError extends Error {
  constructor(language: Language = "da") {
    super(translate(language, "appServer.access.roleHalfChanged"));
    this.name = "RoleChangeInconsistentError";
  }
}

export async function applyRoleChange(input: {
  /** The rows as they are now (with who granted them), read just before. */
  current: readonly RoleRow[];
  desired: readonly AppRole[];
  grantedBy: string | null;
  store: RoleStore;
  /** Runs after the change; throwing rolls the change back (the audit event). */
  afterChange?: (plan: RoleChangePlan) => Promise<void>;
  /** The language of the refusals (the page's); Danish when left out. */
  language?: Language;
}): Promise<RoleChangePlan> {
  if (input.desired.length === 0) {
    throw new Error(translate(input.language ?? "da", "appServer.access.roleRequired"));
  }
  const plan = planRoleChange(
    input.current.map((row) => row.role),
    input.desired,
  );
  if (plan.add.length === 0 && plan.remove.length === 0) return plan;

  // A failure here changes nothing: one statement.
  if (plan.add.length > 0) {
    await input.store.add(plan.add.map((role) => ({ role, grantedBy: input.grantedBy })));
  }

  let removed = false;
  try {
    if (plan.remove.length > 0) {
      await input.store.remove(plan.remove);
      removed = true;
    }
    await input.afterChange?.(plan);
  } catch (cause) {
    try {
      // Put the old rows back before the new ones go: never zero roles, never two at rest.
      if (removed) {
        const restore = input.current.filter((row) => plan.remove.includes(row.role));
        await input.store.add(restore);
      }
      if (plan.add.length > 0) await input.store.remove(plan.add);
    } catch (rollbackCause) {
      console.error("[role-change] rollback failed", rollbackCause);
      throw new RoleChangeInconsistentError(input.language);
    }
    throw cause;
  }
  return plan;
}
