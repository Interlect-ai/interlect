import { z } from "zod";
import type { ScoreCategory } from "@/lib/domain/types";
import { scoreCategoryLabel, scoreCategoryLabelIn } from "../domain/labels.ts";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import { specialistCatalog } from "../analysis/specialist-catalog.ts";
import {
  type DeepSpecialist,
  type PromptModuleOverrideRow,
} from "../analysis/specialist-prompts.ts";
import {
  resolveSpecialistSet,
  SCORE_CATEGORIES,
  type FundSpecialistRow,
} from "../analysis/specialist-set.ts";

/**
 * The AI help for the fund's own specialists: describe → draft → quality check → trial
 * run on an existing case → activate. This file is the pure part: the specialist's shape (the
 * same limits as the table's checks in 0076), the drafts' and checks' JSON schemas and prompts,
 * and the checks code can make without a model (duplicates, vague points, overlap with the other
 * active specialists, which score areas the specialist will really assess). Tested.
 */

function textList(min: number, max: number, maxLength: number) {
  return z.array(z.string().trim().min(1).max(maxLength)).min(min).max(max);
}

/** The same limits as the table's checks (0076). */
export const customSpecialistSchema = z.object({
  name: z.string().trim().min(3).max(80),
  purpose: z.string().trim().min(10).max(600),
  mandate: textList(1, 12, 400),
  evidenceTests: textList(1, 12, 400),
  riskAreas: textList(1, 12, 120),
  questions: textList(0, 6, 300),
  deliverables: textList(0, 8, 300),
  // i18n-keep: a validator's message; the page checks first, and a ZodError reaches no one as text.
  categories: z
    .array(z.enum(SCORE_CATEGORIES as [ScoreCategory, ...ScoreCategory[]]))
    .max(SCORE_CATEGORIES.length)
    .refine((items) => new Set(items).size === items.length, "Et område står to gange."),
});

export type CustomSpecialistInput = z.infer<typeof customSpecialistSchema>;

/** The key a specialist that is not saved yet has in a check or a trial run. */
export const UNSAVED_SPECIALIST_KEY = "custom_udkast00";

/**
 * The draft's rows with the specialist in it, active, as a run would have it: a saved one keeps
 * its place, a new one comes last (as `saveCustomSpecialist` places it).
 */
export function rowsWithCandidate(
  rows: readonly FundSpecialistRow[],
  key: string | undefined,
  specialist: CustomSpecialistInput,
): { rows: FundSpecialistRow[]; key: string } {
  const existing = key
    ? rows.find((row) => row.kind === "custom" && row.specialist_key === key)
    : undefined;
  const candidateKey = existing?.specialist_key ?? UNSAVED_SPECIALIST_KEY;
  const sortOrder =
    existing?.sort_order ?? Math.min(100, Math.max(0, ...rows.map((row) => row.sort_order)) + 1);
  const candidate: FundSpecialistRow = {
    specialist_key: candidateKey,
    kind: "custom",
    enabled: true,
    sort_order: sortOrder,
    name: specialist.name,
    purpose: specialist.purpose,
    mandate: specialist.mandate,
    evidence_tests: specialist.evidenceTests,
    risk_areas: specialist.riskAreas,
    research_questions: specialist.questions,
    output_focus: specialist.deliverables,
    categories: specialist.categories,
  };
  return {
    rows: [...rows.filter((row) => row.specialist_key !== candidateKey), candidate],
    key: candidateKey,
  };
}

/** The set a run would have with the candidate active, and the candidate in it. */
export function resolveWithCandidate(
  rows: readonly FundSpecialistRow[],
  overrides: ReadonlyMap<string, PromptModuleOverrideRow>,
  key: string | undefined,
  specialist: CustomSpecialistInput,
  language: Language = DEFAULT_LANGUAGE,
): { set: DeepSpecialist[]; candidate: DeepSpecialist } {
  const trial = rowsWithCandidate(rows, key, specialist);
  const set = resolveSpecialistSet(trial.rows, overrides);
  const candidate = set.find((item) => item.id === trial.key);
  if (!candidate)
    throw new Error(translate(language, "fundServer.specialists.missingNameOrMandate"));
  return { set, candidate };
}

// ---------------------------------------------------------------------------
// The quality check
// ---------------------------------------------------------------------------

export const ASSIST_LIST_FIELDS = [
  "mandate",
  "evidenceTests",
  "riskAreas",
  "questions",
  "deliverables",
] as const;
export const ASSIST_FIELDS = ["name", "purpose", ...ASSIST_LIST_FIELDS, "categories"] as const;
export type AssistField = (typeof ASSIST_FIELDS)[number];
type ListField = (typeof ASSIST_LIST_FIELDS)[number];

export const ISSUE_KINDS = [
  "vague",
  "overlap",
  "duplicate",
  "untestable",
  "scope",
  "other",
] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

export interface SpecialistIssue {
  field: AssistField;
  /** The point in a list field; null for the whole field. */
  index: number | null;
  kind: IssueKind;
  /** Danish, for the page. */
  message: string;
  suggestion: string | null;
  /** "note" informs (which areas it assesses); "fix" is worth changing before activating. */
  severity: "fix" | "note";
  source: "code" | "ai";
}

// i18n-keep: Danish words code looks for in the fund's own text, not a text anyone reads.
const STOP_WORDS = new Set([
  "alle",
  "andre",
  "eller",
  "efter",
  "deres",
  "dens",
  "denne",
  "dette",
  "disse",
  "fondens",
  "fonden",
  "hvad",
  "hvilke",
  "hvilken",
  "hvis",
  "hvor",
  "hvordan",
  "ikke",
  "inden",
  "mellem",
  "også",
  "over",
  "samt",
  "selskabet",
  "selskabets",
  "skal",
  "som",
  "under",
  "uden",
  "vurder",
  "vurdér",
  "virksomheden",
  "virksomhedens",
  "være",
  "casen",
  "casens",
  "test",
  "undersøg",
  "undersøge",
  "vurdere",
  "vurderer",
  "selskaber",
  "selskabernes",
  "virksomheder",
  "virksomhedernes",
]);
const SUFFIXES = ["ernes", "erne", "ene", "ers", "er", "en", "et", "es", "e"];
/** Filler that leaves a point open ("og så videre"); a word like "generelt" is often precise. */
const VAGUE_MARKERS = /\b(osv|etc|alt relevant|m\.\s?m)\b/i;
/**
 * Fewest words an instruction needs to say what to test and where. Only the mandate and the
 * evidence tests: a question ("Er CO2-tallet verificeret?") or a deliverable ("Risikomatrix")
 * can be short and still precise.
 */
const MIN_WORDS: Partial<Record<AssistField, number>> = { mandate: 4, evidenceTests: 3 };

function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

const STOP_STEMS = new Set([...STOP_WORDS].map(stem));

/** The content words of a point (Danish, lightly stemmed). */
export function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
      .map(stem)
      .filter((word) => !STOP_STEMS.has(word)),
  );
}

function normalizedText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .trim();
}

/** Two points say the same when most of their content words are shared (Jaccard). */
export function pointsOverlap(a: string, b: string): boolean {
  const left = contentWords(a);
  const right = contentWords(b);
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const union = left.size + right.size - shared;
  return shared >= 3 && union > 0 && shared / union >= 0.5;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const FIELD_LABEL_KEY: Record<AssistField, MessageKey> = {
  name: "specialists.assist.field.name",
  purpose: "specialists.assist.field.purpose",
  mandate: "specialists.assist.field.mandate",
  evidenceTests: "specialists.assist.field.evidenceTests",
  riskAreas: "specialists.assist.field.riskAreas",
  questions: "specialists.assist.field.questions",
  deliverables: "specialists.assist.field.deliverables",
  categories: "specialists.assist.field.categories",
};

export function assistFieldLabel(
  field: AssistField,
  language: Language = DEFAULT_LANGUAGE,
): string {
  return translate(language, FIELD_LABEL_KEY[field]);
}

/**
 * What code can see without a model: a point twice, a point too short to test, a point another
 * active specialist already has, and which score areas the specialist will assess in a run with
 * this draft (an area an active standard specialist owns stays with it; a switched-off module's
 * areas can move to the fund's own specialists).
 */
export function codeIssues(
  specialist: CustomSpecialistInput,
  set: readonly DeepSpecialist[],
  candidate: DeepSpecialist,
  language: Language = DEFAULT_LANGUAGE,
): SpecialistIssue[] {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(language, key, vars);
  const categoryName = (category: ScoreCategory) =>
    scoreCategoryLabelIn(category, language) ?? category;
  const issues: SpecialistIssue[] = [];
  const add = (issue: Omit<SpecialistIssue, "source" | "suggestion"> & { suggestion?: string }) =>
    issues.push({ suggestion: null, ...issue, source: "code" });

  for (const field of ASSIST_LIST_FIELDS) {
    const items = specialist[field];
    const seen = new Map<string, number>();
    items.forEach((item, index) => {
      const key = normalizedText(item);
      const first = seen.get(key);
      if (first !== undefined) {
        add({
          field,
          index,
          kind: "duplicate",
          severity: "fix",
          message: t("specialists.assist.issue.duplicate", { number: first + 1 }),
          suggestion: t("specialists.assist.issue.duplicateAdvice"),
        });
        return;
      }
      seen.set(key, index);
      // Risk areas are short labels; the other lists must not leave a point open.
      const minWords = MIN_WORDS[field] ?? 0;
      if (field !== "riskAreas" && (wordCount(item) < minWords || VAGUE_MARKERS.test(item))) {
        add({
          field,
          index,
          kind: "vague",
          severity: "fix",
          message: t("specialists.assist.issue.vague"),
          suggestion: t("specialists.assist.issue.vagueAdvice"),
        });
      }
    });
  }

  const others = set.filter((item) => item.id !== candidate.id);
  const checkOverlap = (field: ListField, otherItems: (other: DeepSpecialist) => string[]) => {
    specialist[field].forEach((item, index) => {
      for (const other of others) {
        const match = otherItems(other).find((text) =>
          field === "riskAreas"
            ? normalizedText(text) === normalizedText(item) || pointsOverlap(text, item)
            : pointsOverlap(text, item),
        );
        if (match) {
          add({
            field,
            index,
            kind: "overlap",
            severity: "fix",
            message: t("specialists.assist.issue.overlap", {
              match: match.length > 140 ? `${match.slice(0, 137)}…` : match,
              title: other.title,
            }),
            suggestion: t("specialists.assist.issue.overlapAdvice"),
          });
          return;
        }
      }
    });
  };
  checkOverlap("mandate", (other) => [...other.mandate, ...other.evidenceTests]);
  checkOverlap("evidenceTests", (other) => [...other.mandate, ...other.evidenceTests]);
  checkOverlap("riskAreas", (other) => other.riskAreas);

  for (const category of specialist.categories) {
    if (candidate.categories.includes(category)) continue;
    const owner = set.find((item) => item.categories.includes(category));
    add({
      field: "categories",
      index: null,
      kind: "scope",
      severity: "note",
      message: t("specialists.assist.issue.areaTaken", {
        area: categoryName(category),
        owner: owner?.title ?? t("specialists.assist.issue.anotherSpecialist"),
      }),
    });
  }
  const inherited = candidate.categories.filter((item) => !specialist.categories.includes(item));
  if (inherited.length) {
    add({
      field: "categories",
      index: null,
      kind: "scope",
      severity: "note",
      message: t("specialists.assist.issue.inherits", {
        areas: inherited.map((item) => categoryName(item)).join(", "),
      }),
    });
  }
  if (candidate.categories.length === 0) {
    add({
      field: "categories",
      index: null,
      kind: "scope",
      severity: "note",
      message: t("specialists.assist.issue.noAreas"),
    });
  }
  return issues;
}

/** The model's issues as it may return them (the check's JSON schema). */
const aiIssueSchema = z.object({
  field: z.enum(ASSIST_FIELDS),
  index: z.number().int().nullable(),
  kind: z.enum(["vague", "overlap", "untestable", "other"]),
  message: z.string().trim().min(1).max(300),
  suggestion: z.string().trim().min(1).max(400).nullable(),
});

export interface AiCheck {
  verdict: "ready" | "needs_work";
  issues: Array<z.infer<typeof aiIssueSchema>>;
}

/**
 * The model's check, issue by issue: one malformed issue (an empty suggestion, a text over the
 * limit) is mended or dropped instead of throwing the whole check away. Null when the answer is
 * not a check at all.
 */
export function parseAiCheck(content: string): AiCheck | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  const body = raw as { verdict?: unknown; issues?: unknown };
  if (body.verdict !== "ready" && body.verdict !== "needs_work") return null;
  const issues: AiCheck["issues"] = [];
  for (const item of Array.isArray(body.issues) ? body.issues : []) {
    const value = item as Record<string, unknown>;
    const text = (key: string, max: number) => {
      const field = value[key];
      return typeof field === "string" && field.trim() ? field.trim().slice(0, max) : null;
    };
    const parsed = aiIssueSchema.safeParse({
      ...value,
      message: text("message", 300),
      suggestion: text("suggestion", 400),
    });
    if (parsed.success) issues.push(parsed.data);
    if (issues.length >= 12) break;
  }
  return { verdict: body.verdict, issues };
}

/**
 * The model's issues next to code's: an index outside the list becomes the whole field, and an
 * issue code already raised for the same point and kind is dropped. The score areas are code's
 * alone (which areas a specialist assesses follows from the set, not from the wording).
 */
export function mergeIssues(
  specialist: CustomSpecialistInput,
  code: readonly SpecialistIssue[],
  ai: AiCheck | null,
): SpecialistIssue[] {
  const merged = [...code];
  for (const issue of ai?.issues ?? []) {
    if (issue.field === "categories") continue;
    const list = (ASSIST_LIST_FIELDS as readonly string[]).includes(issue.field)
      ? specialist[issue.field as ListField]
      : null;
    const index =
      list && issue.index !== null && issue.index >= 0 && issue.index < list.length
        ? issue.index
        : null;
    if (
      merged.some(
        (other) =>
          other.field === issue.field && other.index === index && other.kind === issue.kind,
      )
    ) {
      continue;
    }
    merged.push({
      field: issue.field,
      index,
      kind: issue.kind,
      message: issue.message,
      suggestion: issue.suggestion,
      // A specialist the model calls ready keeps its remarks as notes.
      severity: ai?.verdict === "ready" ? "note" : "fix",
      source: "ai",
    });
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Prompts and JSON schemas
// ---------------------------------------------------------------------------

export interface AssistFundContext {
  thesis: string;
  stages: string[];
  sectors: string[];
  geographies: string[];
  riskPosture: string;
  criteria: Array<{ label: string; category: ScoreCategory }>;
}

/**
 * Which specialist keeps each score area whatever a new or revised specialist names: an active
 * standard module keeps its own areas, and an area another active own specialist names goes to
 * the first that names it (as in `resolveSpecialistSet`). The other areas are free: a switched-off
 * module's areas go to whoever names them, so they are not "taken" by the specialist that would
 * inherit them today.
 */
export function fixedAreaOwners(
  rows: readonly FundSpecialistRow[],
  excludeKey: string | null,
): Map<ScoreCategory, string> {
  const owners = new Map<ScoreCategory, string>();
  const off = new Set(
    rows.filter((row) => row.kind === "standard" && !row.enabled).map((row) => row.specialist_key),
  );
  for (const module of specialistCatalog) {
    if (off.has(module.id)) continue;
    for (const category of module.categories) owners.set(category, module.title);
  }
  const custom = rows
    .filter(
      (row) =>
        row.kind === "custom" &&
        row.enabled &&
        row.specialist_key !== excludeKey &&
        row.name?.trim() &&
        (row.mandate?.length ?? 0) > 0,
    )
    .sort(
      (a, b) => a.sort_order - b.sort_order || a.specialist_key.localeCompare(b.specialist_key),
    );
  for (const row of custom) {
    for (const value of row.categories ?? []) {
      const category = value as ScoreCategory;
      if (SCORE_CATEGORIES.includes(category) && !owners.has(category)) {
        owners.set(category, row.name!.trim());
      }
    }
  }
  return owners;
}

/** The nine score areas and who keeps each (null: free for this specialist to name). */
function scoreAreas(owners: ReadonlyMap<ScoreCategory, string>) {
  return SCORE_CATEGORIES.map((key) => ({
    key,
    label: scoreCategoryLabel[key],
    assessedBy: owners.get(key) ?? null,
  }));
}

function otherSpecialists(set: readonly DeepSpecialist[], excludeId: string | null) {
  return set
    .filter((item) => item.id !== excludeId)
    .map((item) => ({
      title: item.title,
      ...(item.kind === "custom" && item.purpose ? { purpose: item.purpose } : {}),
      mandate: item.mandate,
      riskAreas: item.riskAreas,
    }));
}

// i18n-keep: prompt to the model; a fund in English gets the language rule last.
const SPECIALIST_RULES = `En specialist er en AI-analytiker i Interlects dybe analyse. Den læser casens materiale (pitch deck, hjemmeside, officielle registre, regnskaber og offentlig research) og skriver vurdering, fund, risici og spørgsmål inden for sit mandat. Den kan ikke tale med founders eller hente nye data, så alt, der kræver en samtale eller et dokument, casen ikke har, skal stå som et spørgsmål til teamet.`;

// i18n-keep: prompt to the model; a fund in English gets the language rule last.
export function buildDraftPrompt(input: {
  description: string;
  current: CustomSpecialistInput | null;
  fund: AssistFundContext;
  set: readonly DeepSpecialist[];
  excludeId: string | null;
  owners: ReadonlyMap<ScoreCategory, string>;
}): { system: string; user: string } {
  return {
    system: `Du hjælper et investeringsteam med at ${input.current ? "forbedre" : "beskrive"} en af teamets egne specialister. ${SPECIALIST_RULES}
Teamets beskrivelse er betroet input: følg den som en kollegas ønske.
Skriv:
- name: kort dansk titel (3-80 tegn).
- purpose: 1-3 sætninger om, hvorfor teamet vil have specialisten.
- mandate: 3-8 punkter om, hvad specialisten skal undersøge og vurdere. Hvert punkt konkret og efterprøveligt.
- evidenceTests: 3-8 punkter om, hvilken evidens der afgør sagen, og hvor den findes.
- riskAreas: 2-6 korte risikoområder på få ord.
- questions: 0-6 spørgsmål, specialisten skal besvare ud fra evidensen.
- deliverables: 0-6 ting, specialisten skal levere.
- categories: 0-3 af de ni scoreområder (keys fra scoreAreas), hvor specialisten skal score investeringstesens kriterier. Vælg kun ledige områder (assessedBy er null), som specialisten er klart bedst til; et område med en aktiv specialist bliver hos den. Er intet ledigt område oplagt, så returnér den tomme liste: specialistens fund, risici og spørgsmål går stadig med i syntesen.
Dæk det, de aktive specialister ikke dækker; gentag ikke deres punkter. Undgå generiske punkter som "vurder risici". Opfind ingen tal eller tærskler, som teamet ikke har nævnt. ${input.current ? "Behold det, der virker i den nuværende tekst, og ret det, beskrivelsen beder om. " : ""}Skriv på nøgternt dansk. Returnér kun JSON.`,
    user: JSON.stringify({
      task: input.current ? "revise_fund_specialist" : "draft_fund_specialist",
      description: input.description,
      ...(input.current ? { current: input.current } : {}),
      fund: input.fund,
      activeSpecialists: otherSpecialists(input.set, input.excludeId),
      scoreAreas: scoreAreas(input.owners),
    }),
  };
}

// i18n-keep: prompt to the model; a fund in English gets the language rule last.
export function buildCheckPrompt(input: {
  specialist: CustomSpecialistInput;
  fund: AssistFundContext;
  set: readonly DeepSpecialist[];
  excludeId: string;
  owners: ReadonlyMap<ScoreCategory, string>;
}): { system: string; user: string } {
  return {
    system: `Du er kvalitetskontrol for en af et investeringsteams egne specialister. ${SPECIALIST_RULES}
Find de punkter, der bør rettes, før specialisten tages i brug:
- vague: et punkt, der er så løst, at to analytikere ville teste noget forskelligt.
- overlap: et punkt, som en af de aktive specialister allerede dækker.
- untestable: et punkt, der ikke kan afgøres ud fra casens materiale (kræver en samtale eller data, casen ikke har); foreslå det som et spørgsmål til teamet.
- other: et punkt, der modsiger formålet eller investeringstesen, eller noget vigtigt, specialisten mangler for at opfylde formålet.
Nævn ikke feltet categories: hvilke scoreområder specialisten vurderer, følger af de andre aktive specialister (assessedBy), og det viser systemet selv. En tom liste er gyldig.
Henvis til feltet og punktets nummer i listen (index, 0 = første; null for hele feltet). Skriv kort og konkret på dansk, og giv et forslag til en bedre formulering, hvor det giver mening. Nævn kun reelle problemer; en god specialist får verdict "ready" og få eller ingen punkter. Returnér kun JSON.`,
    user: JSON.stringify({
      task: "check_fund_specialist",
      specialist: input.specialist,
      fund: input.fund,
      activeSpecialists: otherSpecialists(input.set, input.excludeId),
      scoreAreas: scoreAreas(input.owners),
    }),
  };
}

const stringArray = (minItems: number, maxItems: number, maxLength: number) => ({
  type: "array",
  minItems,
  maxItems,
  items: { type: "string", minLength: 1, maxLength },
});

export const DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "purpose",
    "mandate",
    "evidenceTests",
    "riskAreas",
    "questions",
    "deliverables",
    "categories",
  ],
  properties: {
    name: { type: "string", minLength: 3, maxLength: 80 },
    purpose: { type: "string", minLength: 10, maxLength: 600 },
    mandate: stringArray(1, 12, 400),
    evidenceTests: stringArray(1, 12, 400),
    riskAreas: stringArray(1, 12, 120),
    questions: stringArray(0, 6, 300),
    deliverables: stringArray(0, 8, 300),
    categories: {
      type: "array",
      maxItems: 3,
      items: { type: "string", enum: [...SCORE_CATEGORIES] },
    },
  },
} as const;

export const CHECK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "issues"],
  properties: {
    verdict: { type: "string", enum: ["ready", "needs_work"] },
    issues: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "index", "kind", "message", "suggestion"],
        properties: {
          field: { type: "string", enum: [...ASSIST_FIELDS] },
          index: { type: ["integer", "null"] },
          kind: { type: "string", enum: ["vague", "overlap", "untestable", "other"] },
          message: { type: "string", minLength: 1, maxLength: 300 },
          suggestion: { type: ["string", "null"], maxLength: 400 },
        },
      },
    },
  },
} as const;

/** A draft from the model as a specialist that can be saved (duplicate areas dropped). */
export function parseDraft(content: string): CustomSpecialistInput {
  const raw = JSON.parse(content) as { categories?: unknown };
  const categories = Array.isArray(raw.categories) ? [...new Set(raw.categories)] : [];
  return customSpecialistSchema.parse({ ...raw, categories });
}
