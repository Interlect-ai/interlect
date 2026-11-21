/**
 * "Spørg mig først" (spec B.1 punkt 3): the question as a small store, so any start (case
 * page, case list, Opret case) can await it; `LimitChoiceDialog.tsx` renders it.
 */
import type { LimitChoice } from "./model-tiers.ts";

type Kind = "screening" | "deep";

export interface Pending {
  fundId: string;
  kind: Kind;
  resolve: (choice: LimitChoice | null) => void;
}

// Questions wait in line: two starts at once (Opret case for two teams) never cancel each other.
const queue: Pending[] = [];
let pending: Pending | null = null;
const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens the choice (after any question already open) and resolves with it, or null on cancel. */
export function askLimitChoice(fundId: string, kind: Kind): Promise<LimitChoice | null> {
  return new Promise((resolve) => {
    queue.push({ fundId, kind, resolve });
    if (!pending) {
      pending = queue.shift() ?? null;
      emit();
    }
  });
}

export function answer(choice: LimitChoice | null) {
  const current = pending;
  pending = queue.shift() ?? null;
  emit();
  current?.resolve(choice);
}

type StartResult = { status: string };

/**
 * Starts a run; when the team wants to be asked first and the full run does not fit, asks and
 * starts again with the choice. Null = the person cancelled: nothing started.
 */
export async function startWithLimitChoice<R extends StartResult>(
  fundId: string,
  kind: Kind,
  start: (atLimit?: LimitChoice) => Promise<R>,
  remembered?: { choice?: LimitChoice | null },
): Promise<R | null> {
  const first = await start();
  if (first.status !== "limit_choice_needed") return first;
  // In a batch "smaller" and "cancel" are used for the rest of the cases, so they are asked once.
  // "Raise the limit once" is for one run only: it is asked again for the next case.
  const choice =
    remembered && remembered.choice !== undefined
      ? remembered.choice
      : await askLimitChoice(fundId, kind);
  if (remembered && choice !== "raise_once") remembered.choice = choice;
  if (!choice) return null;
  return start(choice);
}

export function currentLimitChoice(): Pending | null {
  return pending;
}
