import type { ScoreCategory } from "@/lib/domain/types";
import { scoreCategoryLabelIn } from "../domain/labels.ts";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import type { SpecialistModuleId } from "../analysis/specialist-prompts.ts";
import { SCORE_CATEGORIES } from "../analysis/specialist-set.ts";
import {
  ASSIST_LIST_FIELDS,
  assistFieldLabel,
  customSpecialistSchema,
  type AssistField,
  type CustomSpecialistInput,
  type SpecialistIssue,
} from "./specialist-assist.ts";

/**
 * The specialist step of the fund setup ("Specialister" and v0.9): what each
 * card says, the before/after of an AI revision, a check's suggestion laid into the editor, why a
 * specialist cannot be saved yet, and what changed in the set since the active version. Pure and
 * tested; the page is SpecialistCards.tsx, the data comes from specialists.functions.ts.
 */

/** Short names as the case page's tabs (deep-view.ts), the role and three focus points. */
// i18n-keep: Danish source; the page shows it via standardSpecialistCardIn(…, language) below.
export const STANDARD_SPECIALIST_CARDS: Record<
  SpecialistModuleId,
  { label: string; role: string; focus: readonly [string, string, string] }
> = {
  people_team: {
    label: "Team",
    role: "Founders, ledelse og team",
    focus: ["Founder-market fit", "Roller og huller", "Tidligere resultater"],
  },
  product_market_gtm: {
    label: "Produkt og marked",
    role: "Problem, PMF og go-to-market",
    focus: ["Betalende kunder", "Markedsstørrelse og timing", "Konkurrenter"],
  },
  technology_risk: {
    label: "Teknologi og IP",
    role: "Teknologi, data og tværgående risici",
    focus: ["Teknisk forspring", "Patenter og IP", "Teknisk risiko"],
  },
  fund_finance_deal: {
    label: "Tese og deal",
    role: "Tesematch, økonomi og deal",
    focus: ["Match med tesen", "Regnskaber og runway", "Værdiansættelse og vilkår"],
  },
};

/** The same card in the fund's language (the page; the Danish constant above stays as it is). */
export function standardSpecialistCardIn(
  id: SpecialistModuleId,
  language: Language = DEFAULT_LANGUAGE,
): {
  label: string;
  role: string;
  focus: readonly [string, string, string];
  /** What the specialist looks at in each focus area, in the same order as `focus`. */
  text: readonly [string, string, string];
} {
  const key = (part: string) => `specialists.cards.standard.${id}.${part}` as MessageKey;
  return {
    label: translate(language, key("label")),
    role: translate(language, key("role")),
    focus: [
      translate(language, key("focus1")),
      translate(language, key("focus2")),
      translate(language, key("focus3")),
    ],
    text: [
      translate(language, key("text1")),
      translate(language, key("text2")),
      translate(language, key("text3")),
    ],
  };
}

export function standardSpecialistLabel(id: string, language: Language = DEFAULT_LANGUAGE): string {
  return id in STANDARD_SPECIALIST_CARDS
    ? standardSpecialistCardIn(id as SpecialistModuleId, language).label
    : id;
}

/** "Founder-market fit og Team-market fit"; empty list gives "". */
export function areaList(
  categories: readonly ScoreCategory[],
  language: Language = DEFAULT_LANGUAGE,
): string {
  const labels = categories.map((category) => scoreCategoryLabelIn(category, language) ?? category);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} ${translate(language, "specialists.cards.and")} ${labels.at(-1)}`;
}

// ---------------------------------------------------------------------------
// Before and after
// ---------------------------------------------------------------------------

export interface DiffRow {
  text: string;
  change: "same" | "added" | "removed";
}

const norm = (text: string) => text.trim().replace(/\s+/g, " ");

/**
 * The points of a list before and after, in the new order with each removed point where it stood
 * (longest common subsequence; the lists hold at most 12 points).
 */
export function listDiff(before: readonly string[], after: readonly string[]): DiffRow[] {
  const a = before.map(norm).filter(Boolean);
  const b = after.map(norm).filter(Boolean);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ text: a[i]!, change: "same" });
      i += 1;
      j += 1;
    } else if (j < b.length && (i >= a.length || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      rows.push({ text: b[j]!, change: "added" });
      j += 1;
    } else {
      rows.push({ text: a[i]!, change: "removed" });
      i += 1;
    }
  }
  return rows;
}

export interface FieldDiff {
  field: string;
  label: string;
  rows: DiffRow[];
}

/** The fields an AI revision changed, each as before/after rows; unchanged fields are left out. */
export function fieldDiffs(
  before: Partial<Record<string, string | readonly string[]>>,
  after: Partial<Record<string, string | readonly string[]>>,
  labels: Readonly<Record<string, string>>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const [field, label] of Object.entries(labels)) {
    const asList = (value: string | readonly string[] | undefined) =>
      typeof value === "string" ? [value] : [...(value ?? [])];
    const rows = listDiff(asList(before[field]), asList(after[field]));
    if (rows.some((row) => row.change !== "same")) diffs.push({ field, label, rows });
  }
  return diffs;
}

const CUSTOM_DIFF_FIELDS = [
  "name",
  "purpose",
  "mandate",
  "evidenceTests",
  "riskAreas",
  "questions",
  "deliverables",
  "areas",
] as const;

function customDiffLabels(language: Language): Record<string, string> {
  return Object.fromEntries(
    CUSTOM_DIFF_FIELDS.map((field) => [
      field,
      translate(language, `specialists.cards.diff.${field}` as MessageKey),
    ]),
  );
}

/** Before/after of the fund's own specialist (the score areas by their Danish names). */
export function customSpecialistDiffs(
  before: CustomSpecialistInput,
  after: CustomSpecialistInput,
  language: Language = DEFAULT_LANGUAGE,
): FieldDiff[] {
  const shape = (specialist: CustomSpecialistInput) => ({
    ...specialist,
    areas: specialist.categories.map(
      (category) => scoreCategoryLabelIn(category, language) ?? category,
    ),
  });
  return fieldDiffs(shape(before), shape(after), customDiffLabels(language));
}

export function moduleDiffLabels(language: Language = DEFAULT_LANGUAGE): Record<string, string> {
  return {
    mandate: translate(language, "specialists.cards.module.mandate"),
    evidenceTests: translate(language, "specialists.cards.module.evidenceTests"),
    riskAreas: translate(language, "specialists.cards.module.riskAreas"),
  };
}

/** The limits of a standard specialist's text (saveModulePromptOverride): 1-12 points each. */
const MODULE_POINT_MAX: Record<"mandate" | "evidenceTests" | "riskAreas", number> = {
  mandate: 400,
  evidenceTests: 400,
  riskAreas: 120,
};

/** Why a standard specialist's text cannot be saved or sent yet, one Danish line per list. */
export function moduleTextProblems(
  text: {
    mandate: readonly string[];
    evidenceTests: readonly string[];
    riskAreas: readonly string[];
  },
  language: Language = DEFAULT_LANGUAGE,
): string[] {
  const labels = moduleDiffLabels(language);
  return (Object.keys(MODULE_POINT_MAX) as Array<keyof typeof MODULE_POINT_MAX>)
    .filter((field) => {
      const points = text[field];
      return (
        points.length < 1 ||
        points.length > 12 ||
        points.some((point) => point.length > MODULE_POINT_MAX[field])
      );
    })
    .map((field) =>
      translate(language, "specialists.cards.problem.module", {
        label: labels[field]!,
        max: MODULE_POINT_MAX[field],
      }),
    );
}

// ---------------------------------------------------------------------------
// The editor of the fund's own specialist
// ---------------------------------------------------------------------------

export function emptySpecialist(): CustomSpecialistInput {
  return {
    name: "",
    purpose: "",
    mandate: [],
    evidenceTests: [],
    riskAreas: [],
    questions: [],
    deliverables: [],
    categories: [],
  };
}

/** One point per line in the editor; blank lines are dropped. */
export function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The specialist as it is saved: trimmed, without blank points, the areas in their fixed order. */
export function cleanSpecialist(specialist: CustomSpecialistInput): CustomSpecialistInput {
  const list = (items: readonly string[]) => items.map((item) => item.trim()).filter(Boolean);
  return {
    name: specialist.name.trim(),
    purpose: specialist.purpose.trim(),
    mandate: list(specialist.mandate),
    evidenceTests: list(specialist.evidenceTests),
    riskAreas: list(specialist.riskAreas),
    questions: list(specialist.questions),
    deliverables: list(specialist.deliverables),
    categories: SCORE_CATEGORIES.filter((category) => specialist.categories.includes(category)),
  };
}

const FIELD_RULES: Partial<Record<AssistField, MessageKey>> = {
  name: "specialists.cards.rule.name",
  purpose: "specialists.cards.rule.purpose",
  mandate: "specialists.cards.rule.mandate",
  evidenceTests: "specialists.cards.rule.evidenceTests",
  riskAreas: "specialists.cards.rule.riskAreas",
  questions: "specialists.cards.rule.questions",
  deliverables: "specialists.cards.rule.deliverables",
};

/**
 * Why the specialist cannot be checked, tried or saved yet, one Danish line per field (the same
 * limits as the table, 0076); empty when it can.
 */
export function specialistFormProblems(
  specialist: CustomSpecialistInput,
  language: Language = DEFAULT_LANGUAGE,
): string[] {
  const parsed = customSpecialistSchema.safeParse(cleanSpecialist(specialist));
  if (parsed.success) return [];
  const fields: AssistField[] = [];
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as AssistField | undefined;
    if (field && !fields.includes(field)) fields.push(field);
  }
  return fields.map((field) => {
    const rule = FIELD_RULES[field];
    return rule
      ? `${assistFieldLabel(field, language)}: ${translate(language, rule)}`
      : translate(language, "specialists.cards.problem.fix", {
          field: assistFieldLabel(field, language),
        });
  });
}

export interface IssueAction {
  /** Also the identity of the action ("Brug forslaget" replaces a point); the page shows it via issueActionLabel. */
  // i18n-keep: the action's identity, shown via issueActionLabel(…, language).
  label: "Brug forslaget" | "Slet punktet";
  next: CustomSpecialistInput;
}

/** The action's button text in the fund's language. */
export function issueActionLabel(
  action: Pick<IssueAction, "label">,
  language: Language = DEFAULT_LANGUAGE,
): string {
  return translate(
    language,
    action.label === "Brug forslaget"
      ? "specialists.cards.issue.useSuggestion"
      : "specialists.cards.issue.deletePoint",
  );
}

/**
 * What a check's issue lets the user do in the editor, if anything. The model's suggestion is a
 * better wording (the check prompt asks for one), so it replaces the point, the name or the
 * purpose. Code's suggestions are advice ("Slet det ene."), so they are never pasted in, but a
 * repeated point can be removed. A suggestion for a whole list is left to the user (it may be a
 * wording or advice). Null when there is nothing to do or the point is no longer there.
 */
export function issueAction(
  specialist: CustomSpecialistInput,
  issue: Pick<SpecialistIssue, "field" | "index" | "kind" | "suggestion" | "source">,
): IssueAction | null {
  const isList = (ASSIST_LIST_FIELDS as readonly string[]).includes(issue.field);
  const field = issue.field as (typeof ASSIST_LIST_FIELDS)[number];
  const points = isList ? [...specialist[field]] : [];
  const inRange = issue.index !== null && issue.index >= 0 && issue.index < points.length;
  if (issue.source === "code") {
    if (issue.kind !== "duplicate" || !isList || !inRange) return null;
    points.splice(issue.index!, 1);
    // i18n-keep: the action's identity, shown via issueActionLabel(…, language).
    return { label: "Slet punktet", next: { ...specialist, [field]: points } };
  }
  const suggestion = issue.suggestion?.trim();
  if (!suggestion) return null;
  if (issue.field === "name" || issue.field === "purpose") {
    if (norm(specialist[issue.field]) === norm(suggestion)) return null;
    return { label: "Brug forslaget", next: { ...specialist, [issue.field]: suggestion } };
  }
  if (!isList || !inRange || norm(points[issue.index!]!) === norm(suggestion)) return null;
  points[issue.index!] = suggestion;
  return { label: "Brug forslaget", next: { ...specialist, [field]: points } };
}

// ---------------------------------------------------------------------------
// The set since the active version (Gennemse og udgiv)
// ---------------------------------------------------------------------------

/** The part of FundSpecialistsView (specialists.functions.ts) the comparison reads. */
export interface SpecialistSetLike {
  standard: Array<{ id: string; title: string; enabled: boolean }>;
  custom: Array<CustomSpecialistInput & { key: string; enabled: boolean }>;
}

/** What changed in the set of specialists, in Danish, for the list before publishing. */
export function specialistSetChanges(
  before: SpecialistSetLike,
  after: SpecialistSetLike,
  language: Language = DEFAULT_LANGUAGE,
): string[] {
  const t = (key: MessageKey, vars: Record<string, string>) => translate(language, key, vars);
  const changes: string[] = [];
  for (const module of after.standard) {
    const was = before.standard.find((item) => item.id === module.id);
    if (!was || was.enabled === module.enabled) continue;
    const label = standardSpecialistLabel(module.id, language);
    changes.push(
      t(
        module.enabled
          ? "specialists.cards.change.standardOn"
          : "specialists.cards.change.standardOff",
        { name: label },
      ),
    );
  }
  for (const own of after.custom) {
    const was = before.custom.find((item) => item.key === own.key);
    if (!was) {
      changes.push(
        t(own.enabled ? "specialists.cards.change.newOwn" : "specialists.cards.change.newOwnOff", {
          name: own.name,
        }),
      );
      continue;
    }
    if (was.enabled !== own.enabled) {
      changes.push(
        t(own.enabled ? "specialists.cards.change.ownOn" : "specialists.cards.change.ownOff", {
          name: own.name,
        }),
      );
    }
    // cleanSpecialist keeps only the specialist's own fields (not key, enabled or order).
    if (JSON.stringify(cleanSpecialist(was)) !== JSON.stringify(cleanSpecialist(own))) {
      changes.push(t("specialists.cards.change.ownChanged", { name: own.name }));
    }
  }
  for (const own of before.custom) {
    if (!after.custom.some((item) => item.key === own.key)) {
      changes.push(t("specialists.cards.change.ownRemoved", { name: own.name }));
    }
  }
  return changes;
}
