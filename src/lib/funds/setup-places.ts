/**
 * (TS-17, §2): Teamopsætning is one page with four places instead of two flows
 * with eight steps each. "Ny", "Redigér" and "Fortsæt kladde" use the same places:
 *
 *   Jeres tese · Sådan screener vi · Sådan analyserer vi · Gennemse og udgiv
 *
 * Every step the editor had keeps its fields; the steps are grouped under the place they belong
 * to. This file holds the pure rules (which step lives where, which places a draft changed, the
 * `?sted=` search parameter), so they can be tested with node --test.
 */
import type { GuideStepKey } from "./editor-rules.ts";

export type SetupPlaceKey = "thesis" | "screening" | "analysis" | "publish";

export interface SetupPlace {
  key: SetupPlaceKey;
  /** The editor's steps shown in this place, in order. */
  steps: readonly GuideStepKey[];
}

export const SETUP_PLACES: readonly SetupPlace[] = [
  { key: "thesis", steps: ["start", "basis", "thesis"] },
  { key: "screening", steps: ["weights", "mandate", "screening"] },
  { key: "analysis", steps: ["specialists"] },
  { key: "publish", steps: ["publish"] },
];

export const SETUP_PLACE_KEYS: readonly SetupPlaceKey[] = SETUP_PLACES.map((place) => place.key);

/** The place a step of the old editor lives in now ("Redigér" on a card opens that place). */
export function placeOfStep(step: GuideStepKey | null | undefined): SetupPlaceKey {
  if (!step) return "thesis";
  return SETUP_PLACES.find((place) => place.steps.includes(step))?.key ?? "thesis";
}

/** `?sted=` from the address; anything else is the first place. */
export function parsePlace(value: unknown): SetupPlaceKey | undefined {
  return typeof value === "string" && (SETUP_PLACE_KEYS as readonly string[]).includes(value)
    ? (value as SetupPlaceKey)
    : undefined;
}

/** The fields of the setup, grouped by the place where they are edited. */
export interface PlaceComparable {
  fundName: string;
  strategyType: string;
  thesis: string;
  stages: readonly string[];
  geographies: readonly string[];
  sectors: readonly string[];
  fundSizeEur: number | null;
  ticketMinEur: number | null;
  ticketMaxEur: number | null;
  ticketNote?: string | null | undefined;
  riskPosture: string;
  stageExpectations?: unknown;
  dealbreakers?: unknown;
  approvalMode?: unknown;
  analysisThreshold: number;
  gates: ReadonlyArray<unknown>;
  criteria: ReadonlyArray<unknown>;
  /**
   * "Hvem er I, og hvordan tænker I?" is edited in "Jeres tese".: the fixed rules'
   * edits and, per stage, the threshold and the economy are edited in "Sådan screener vi".
   */
  setup?: { about?: string | undefined; fixedRules?: unknown; stages?: unknown } | undefined;
}

/** What lives outside the form: the screening instruction and the specialists' own text. */
export interface PlaceExtras {
  screeningInstruction?: unknown;
  screeningCards?: unknown;
  moduleOverrides?: unknown;
  researchModuleOverrides?: unknown;
}

const THESIS_FIELDS = [
  "fundName",
  "strategyType",
  "thesis",
  "stages",
  "geographies",
  "sectors",
  "fundSizeEur",
  "ticketMinEur",
  "ticketMaxEur",
  "ticketNote",
  "riskPosture",
  "stageExpectations",
  "dealbreakers",
] as const satisfies ReadonlyArray<keyof PlaceComparable>;

const SCREENING_FIELDS = [
  "analysisThreshold",
  "approvalMode",
  "gates",
  "criteria",
] as const satisfies ReadonlyArray<keyof PlaceComparable>;

/** Stable JSON: `undefined` and `null` count as the same, and key order does not matter. */
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, inner: unknown) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(
        Object.entries(inner as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return inner;
  });
}

/**
 * The places where the draft differs from the published version, for the coral dot on the place
 * and for showing the "Udgiv" bar only when there is something to publish. `specialistsChanged`
 * comes from the specialists' own table (it is not part of the version's fields). With no
 * published version everything is new, so every place but "publish" counts as changed.
 */
export function changedPlaces(
  published: (PlaceComparable & PlaceExtras) | null,
  draft: PlaceComparable & PlaceExtras,
  specialistsChanged = false,
): Set<SetupPlaceKey> {
  const changed = new Set<SetupPlaceKey>();
  if (!published) {
    changed.add("thesis");
    changed.add("screening");
    changed.add("analysis");
    return changed;
  }
  if (
    THESIS_FIELDS.some((field) => !same(published[field], draft[field])) ||
    (published.setup?.about ?? "").trim() !== (draft.setup?.about ?? "").trim()
  ) {
    changed.add("thesis");
  }
  if (
    SCREENING_FIELDS.some((field) => !same(published[field], draft[field])) ||
    !same(published.setup?.fixedRules, draft.setup?.fixedRules) ||
    !same(published.setup?.stages, draft.setup?.stages) ||
    !same(published.screeningInstruction, draft.screeningInstruction) ||
    !same(published.screeningCards, draft.screeningCards)
  ) {
    changed.add("screening");
  }
  if (
    specialistsChanged ||
    !same(published.moduleOverrides, draft.moduleOverrides) ||
    !same(published.researchModuleOverrides, draft.researchModuleOverrides)
  ) {
    changed.add("analysis");
  }
  return changed;
}

/**
 * A click inside the setup before a draft exists: does it change something (and so start the
 * draft), or does it only look (a fold, a tab, a link)? Pure, so it can be tested on plain data.
 */
export interface ClickTarget {
  tag: string;
  role?: string | null;
  type?: string | null;
  ariaExpanded?: string | null;
  browse?: boolean;
}

export function clickStartsDraft(target: ClickTarget): boolean {
  if (target.browse) return false;
  const tag = target.tag.toLowerCase();
  if (tag === "a" || tag === "summary") return false;
  if (target.ariaExpanded !== null && target.ariaExpanded !== undefined) return false;
  if (target.role === "tab") return false;
  if (tag === "button") return true;
  if (tag === "input") {
    // A range changes through its own change event, which starts the draft by itself.
    return ["checkbox", "radio", "file"].includes((target.type ?? "").toLowerCase());
  }
  return target.role === "switch" || target.role === "slider" || target.role === "menuitem";
}
