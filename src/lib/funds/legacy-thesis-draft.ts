/**
 * The old guide "Ny investeringstese" (`/fond/ny`) kept its answers in the browser
 * (`sessionStorage`) until "Udgiv opsætning", and remembered a team it had already created (when an
 * own specialist needed a draft). `/fond/ny` now opens the same Teamopsætning as editing, so a
 * guide left half-way must not lose its answers: this reads what the guide left behind, field by
 * field and never throwing, so Teamopsætning can carry it into a draft in the team.
 */
import { initialWizardState, type WizardState } from "./thesis-wizard.ts";

/** The guide's answers (`{ state, area }`). */
export const LEGACY_DRAFT_KEY = "interlect.newThesis.draft";
/** The team the guide already created (`{ fundId, configId, published }`). */
export const LEGACY_CREATED_KEY = "interlect.newThesis.created";

export interface LegacyCreated {
  fundId: string;
  configId: string;
  published: boolean;
}

export interface LegacyThesisDraft {
  /** The answers, or null when the guide left none (or only an untouched start). */
  answers: { state: WizardState; area: number } | null;
  /** A team the guide created but did not publish; null when there is none. */
  created: LegacyCreated | null;
}

type ReadableStorage = Pick<Storage, "getItem">;

export function readLegacyCreated(storage: ReadableStorage): LegacyCreated | null {
  try {
    const parsed = JSON.parse(storage.getItem(LEGACY_CREATED_KEY) ?? "null") as {
      fundId?: unknown;
      configId?: unknown;
      published?: unknown;
    } | null;
    return parsed && typeof parsed.fundId === "string" && typeof parsed.configId === "string"
      ? { fundId: parsed.fundId, configId: parsed.configId, published: parsed.published === true }
      : null;
  } catch {
    return null;
  }
}

/** The guide had seven steps (0..6). */
const LAST_AREA = 6;

export function readLegacyAnswers(
  storage: ReadableStorage,
): { state: WizardState; area: number } | null {
  try {
    const raw = storage.getItem(LEGACY_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: Partial<WizardState>; area?: unknown };
    if (!parsed.state || typeof parsed.state !== "object") return null;
    const base = initialWizardState();
    const state = { ...base, ...parsed.state } as WizardState;
    // Old or damaged drafts must never break the page: field by field, otherwise the default.
    const list = <T>(value: unknown, fallback: T[]): T[] =>
      Array.isArray(value) ? (value as T[]) : fallback;
    state.criteria = list(state.criteria, base.criteria);
    if (state.criteria.length === 0) state.criteria = base.criteria;
    // Old drafts had five cards; there are the four real specialists now.
    state.specialists = base.specialists.map((fallback, index) => {
      const value = Array.isArray(state.specialists) ? state.specialists[index] : undefined;
      return typeof value === "boolean" ? value : fallback;
    });
    if (!Number.isInteger(state.customSpecialists) || state.customSpecialists < 0) {
      state.customSpecialists = 0;
    }
    state.phases = list(state.phases, []);
    state.geo = list(state.geo, []);
    state.geoExtra = list(state.geoExtra, []);
    state.sectors = list(state.sectors, []);
    state.sectorExtra = list(state.sectorExtra, []);
    if (state.gates !== null) state.gates = Array.isArray(state.gates) ? state.gates : null;
    if (state.type !== null && !(Number.isInteger(state.type) && state.type >= 0 && state.type < 5))
      state.type = null;
    if (!Number.isInteger(state.risk) || state.risk < 0 || state.risk > 4) state.risk = base.risk;
    for (const key of ["name", "other", "thesis", "ticketMin", "ticketMax"] as const) {
      if (typeof state[key] !== "string") state[key] = base[key];
    }
    const area =
      typeof parsed.area === "number" ? Math.max(0, Math.min(LAST_AREA, parsed.area)) : 0;
    return { state, area };
  } catch {
    return null;
  }
}

/**
 * Did the guide get past an untouched start? A name, a type or any answer beyond the defaults
 * counts; an empty start is not carried over (there is nothing to keep).
 */
export function hasLegacyAnswers(state: WizardState): boolean {
  const base = initialWizardState();
  return (
    state.name.trim() !== "" ||
    state.type !== null ||
    state.thesis.trim() !== "" ||
    state.phases.length > 0 ||
    state.geo.length > 0 ||
    state.geoExtra.length > 0 ||
    state.sectors.length > 0 ||
    state.sectorExtra.length > 0 ||
    state.ticketMin !== base.ticketMin ||
    state.ticketMax !== base.ticketMax ||
    state.risk !== base.risk ||
    state.gates !== null ||
    state.specialists.some((on) => !on)
  );
}

/** Everything the old guide left behind; a published team counts as nothing left. */
export function readLegacyThesisDraft(storage: ReadableStorage): LegacyThesisDraft {
  const created = readLegacyCreated(storage);
  const answers = readLegacyAnswers(storage);
  return {
    answers: answers && hasLegacyAnswers(answers.state) ? answers : null,
    created: created && !created.published ? created : null,
  };
}

/** Forget the old guide's draft once Teamopsætning has taken it over. */
export function clearLegacyThesisDraft(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(LEGACY_DRAFT_KEY);
    storage.removeItem(LEGACY_CREATED_KEY);
  } catch {
    // without storage there is nothing to clear
  }
}
