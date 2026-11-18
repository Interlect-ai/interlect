/**
 * "Skal afklares": tasks pr. case (migration 0034). Types and names from the prototype
 * Case Screening v5. Pure file, so the AI task builder can be tested with node --test.
 */

import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";

export const caseTaskKinds = [
  "task",
  "question",
  "verification",
  "document",
  "research",
  "meeting",
] as const;
export type CaseTaskKind = (typeof caseTaskKinds)[number];

// i18n-keep: Danish source; the pages use the task-type labels from the dictionary (task-types.ts).
export const caseTaskKindLabel: Record<CaseTaskKind, string> = {
  task: "Opgave",
  question: "Spørgsmål til selskabet",
  verification: "Verificering",
  document: "Dokument",
  research: "Research",
  meeting: "Møde",
};

export const caseTaskAnswerKinds = ["text", "number", "select", "file", "ai"] as const;
export type CaseTaskAnswerKind = (typeof caseTaskAnswerKinds)[number];

/** Highest number of AI tasks written per run (gap analysis §5). */
export const MAX_AI_TASKS_PER_RUN = 15;
/**
 * A deep analysis finds more (specialists, risks, condition), so it may write more; the order of
 * `buildAiTaskDrafts` makes sure binding gates and critical risks are never the ones cut.
 */
export const MAX_AI_TASKS_PER_DEEP_RUN = 30;
/** With a curated `nextSteps` list the deep analysis writes few, concrete tasks. */
export const MAX_AI_TASKS_PER_CURATED_RUN = 18;
/** The curated list the synthesis writes (max in the JSON schema and in code). */
export const MAX_NEXT_STEPS = 10;
/** Highest number of "unknowns" turned into tasks per criterion. */
export const MAX_UNKNOWNS_PER_CRITERION = 2;
/** The deep analysis asks for one per criterion: the specialists' own questions carry the rest. */
export const MAX_UNKNOWNS_PER_CRITERION_DEEP = 1;
/** Highest number of a specialist's questions / unknowns turned into tasks. */
export const MAX_SPECIALIST_QUESTIONS = 2;
export const MAX_SPECIALIST_UNKNOWNS = 1;
/** The screening's curated list: few, concrete tasks; gates and research add their own. */
export const MAX_SCREENING_NEXT_STEPS = 8;

/**
 * A task has a short title and the question in its description.
 * The model is asked for at most six words; code holds the line (`shortTaskTitle`).
 */
export const TASK_TITLE = { maxWords: 6, schemaMax: 60 } as const;
/** The task's question or action in one sentence (the description). */
export const TASK_QUESTION = { schemaMax: 260, max: 400 } as const;
/**
 * The deadline a new AI task gets, in days from the run (Copenhagen date). Unknown gates,
 * critical risks and the synthesis's priority-1 steps are urgent; the rest get two weeks.
 */
export const TASK_DUE_DAYS = { urgent: 7, normal: 14 } as const;
/** Tiers at or below this are urgent (see the order in `buildAiTaskDrafts`). */
const URGENT_TIER = 3.5;

export interface AiTaskDraft {
  kind: CaseTaskKind;
  title: string;
  why: string | null;
  /** The question or concrete action (a risk's mitigation). Shown as the task's description. */
  description?: string | null;
  /** The subject of a fallback task (a risk's name); the planner skips it when a task on the case already covers the subject. */
  topic?: string;
  linkedKind: "gate" | "criterion" | null;
  linkedKey: string | null;
  dedupeKey: string;
  /**
   * The full wording the gap is keyed and compared by: the question, not the short title,
   * so the same gap is recognised across runs whose short titles differ, and old tasks (whose
   * title was the whole question) still match.
   */
  matchText: string;
  /** Days from the run to the task's deadline (TASK_DUE_DAYS). */
  dueInDays: number;
}

export interface AiTaskSource {
  /** The fund's language: the builder's own wording is stored in it. Danish if unset. */
  language?: Language;
  /** The run's fund setup version; gate tasks are asked again under a new version. */
  configVersionId?: string | null;
  gates: Array<{ key: string; label: string; treatment?: string }>;
  criteria: Array<{ key: string; label: string; description?: string }>;
  /** Gates the AI could not decide (passed = null), from scoreScreening. */
  unresolvedGateKeys: string[];
  /** Criteria scored with the stage prior because evidence was missing. */
  missingCriterionKeys: string[];
  assessments: Array<{ criterionKey: string; unknowns: string[] }>;
  openQuestions: string[];
  /** Deep analysis only: findings of type question/unknown. */
  findings?: Array<{ findingType: string; statement: string }>;
  /** Deep analysis only: the synthesis's risks (high and critical ones become tasks). */
  risks?: Array<{
    riskKey?: string;
    label: string;
    level: string;
    rationale: string;
    mitigation: string | null;
  }>;
  /** Deep analysis only: what each specialist asked and could not establish. */
  specialists?: Array<{
    moduleId: string;
    /** "Team", "Teknologi og IP" … */
    label: string;
    /** The fund's criteria this specialist owns (questions are linked to one of them). */
    criterionKeys: string[];
    questions: string[];
    unknowns: string[];
  }>;
  /** Deep analysis only: the condition the synthesis puts on an investment (prompt v10+). */
  investmentCondition?: string | null;
  /** Deep analysis only: the strongest counter-reading; one task asks the team to test it. */
  contraryCase?: string | null;
  /**
   * Deep analysis from prompt v10c: the synthesis's own curated, merged list of concrete next
   * steps. When present (even empty) the builder uses it instead of the raw per-specialist
   * questions, unknowns and mitigations. Undefined for older stored output: the old builder runs.
   */
  nextSteps?: NextStep[] | undefined;
  /**
   * What the research's follow-up rounds could not settle from public sources, as one
   * concrete question to the founders per criterion or gate (`founderQuestions`).
   */
  researchQuestions?: Array<{
    kind: "criterion" | "gate";
    key: string;
    question: string;
    note: string;
  }>;
  /** Highest number of tasks (default MAX_AI_TASKS_PER_RUN). */
  maxTasks?: number;
  /** Highest number of unknowns per criterion (default MAX_UNKNOWNS_PER_CRITERION). */
  maxUnknownsPerCriterion?: number;
}

/** Lower case, single spaces, no trailing punctuation: the same gap is the same key. */
export function normalizeTaskText(text: string): string {
  return text
    .toLocaleLowerCase("da-DK")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?:;,\s]+$/u, "");
}

/**
 * A title of at most TASK_TITLE.maxWords words. A longer text is cut after the last
 * whole word that fits, without trailing joining words or punctuation, and marked with "…";
 * `cut` tells the caller to keep the whole text as the description.
 */
export function shortTaskTitle(text: string): { title: string; cut: boolean } {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  if (words.length <= TASK_TITLE.maxWords && clean.length <= TASK_TITLE.schemaMax) {
    return { title: clean, cut: false };
  }
  const kept = words.slice(0, TASK_TITLE.maxWords);
  while (kept.length > 1 && kept.join(" ").length > TASK_TITLE.schemaMax - 1) kept.pop();
  // A title never ends on a joining word ("for", "og", "the") or a dangling sign.
  while (kept.length > 2 && TRAILING_JOINERS.has(kept.at(-1)!.toLocaleLowerCase("da-DK"))) {
    kept.pop();
  }
  const head = kept.join(" ").replace(/[\s,;:\-–(]+$/u, "");
  return { title: `${clip(head, TASK_TITLE.schemaMax - 1)}…`, cut: true };
}

// i18n-keep: Danish and English joining words code strips from the end of a cut title.
const TRAILING_JOINERS = new Set([
  "og",
  "i",
  "at",
  "en",
  "et",
  "af",
  "på",
  "til",
  "for",
  "med",
  "om",
  "fra",
  "de",
  "den",
  "det",
  "eller",
  "and",
  "or",
  "of",
  "to",
  "the",
  "a",
  "an",
  "in",
  "on",
  "with",
  "from",
]);

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  // Code points, so an emoji is never cut in half (the whole AI-task batch would fail).
  const points = Array.from(clean);
  if (points.length <= max) return clean;
  const head = points.slice(0, max - 1).join("");
  // Cut at a word boundary (a sentence end is preferred), never mid-word; a text without any
  // space in its first half (an unbroken string) is cut hard as a last resort.
  const boundary = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  const space = head.lastIndexOf(" ");
  const nextIsSpace = clean.charAt(head.length) === " ";
  let cut = head;
  if (boundary >= head.length * 0.5) cut = head.slice(0, boundary + 1);
  else if (!nextIsSpace && space >= head.length * 0.4) cut = head.slice(0, space);
  const trimmed = cut.replace(/[\s,;:\-–(]+$/u, "");
  return `${trimmed}…`;
}

/**
 * The same gap is the same key. A gate task also carries the setup version it was asked under:
 * "Opfyldt" to a gate only counts under its own version (gate-answers.ts), so a gate that is
 * still unresolved under a new version must be asked again (harden round 2, S4R2-1).
 */
function dedupeKey(
  linkedKind: string | null,
  linkedKey: string | null,
  title: string,
  configVersionId: string | null,
): string {
  const kind =
    linkedKind === "gate" && configVersionId ? `gate@${configVersionId}` : (linkedKind ?? "none");
  return clip(`${kind}:${linkedKey ?? ""}:${normalizeTaskText(title)}`, 400);
}

// i18n-keep: Danish words code matches in Danish task texts (dedupe), not a text anyone reads.
const STOP_WORDS = new Set([
  "og",
  "i",
  "at",
  "er",
  "en",
  "et",
  "af",
  "på",
  "til",
  "for",
  "med",
  "der",
  "det",
  "de",
  "den",
  "som",
  "om",
  "har",
  "hvad",
  "hvor",
  "hvilke",
  "hvilken",
  "hvem",
  "hvordan",
  "kan",
  "skal",
  "ikke",
  "eller",
  "fra",
  "sig",
  "sin",
  "deres",
  "være",
  "blive",
  "bliver",
]);

/**
 * The fixed prefixes the builder puts on risk and condition titles. They are not part of the gap
 * ("Reducer risikoen: X" and "Afklar kritisk risiko: X" are the same gap when a risk's level
 * changes between runs), so they are left out when titles are compared.
 */
const FIXED_TITLE_PREFIX =
  /^(afklar kritisk risiko|reducer risikoen|investeringsbetingelse|afklar|find dokumentation|indhent dokumentation for|clarify critical risk|reduce the risk|investment condition|clarify|find documentation)\s*:?\s+/u;

// i18n-keep: Danish words code matches in Danish task texts (dedupe), not a text anyone reads.
const NOT_DOCUMENTED = "(?:dokumenteret|oplyst|verificeret|afklaret|fundet|belyst)";
// i18n-keep: Danish words code matches in Danish task texts (dedupe), not a text anyone reads.
const OLD_WORDING_LEAD = new RegExp(`^der er (?:endnu )?ikke ${NOT_DOCUMENTED}\\s+`, "u");
// i18n-keep: Danish words code matches in Danish task texts (dedupe), not a text anyone reads.
const OLD_WORDING_TAIL = new RegExp(
  `\\s+(?:er|var|findes|foreligger) (?:endnu )?ikke ${NOT_DOCUMENTED}$`,
  "u",
);

/**
 * A title with the builder's fixed wording removed, so the old wording ("X er ikke dokumenteret",
 * "Der er ikke dokumenteret X") and the new one ("Indhent dokumentation for X") compare as the
 * same gap, also next to a task a person has already touched.
 */
function comparableTitle(text: string): string {
  return normalizeTaskText(text)
    .replace(FIXED_TITLE_PREFIX, "")
    .replace(OLD_WORDING_LEAD, "")
    .replace(OLD_WORDING_TAIL, "");
}

function significantTokens(text: string): Set<string> {
  return new Set(
    comparableTitle(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => (word.length > 2 || /\d/.test(word)) && !STOP_WORDS.has(word))
      // A crude Danish stem (endings differ: "årlig"/"årlige", "kunde"/"kunder").
      .map((word) => (/\d/.test(word) ? word : Array.from(word).slice(0, 5).join(""))),
  );
}

/**
 * Two titles that say the same thing in other words (the AI words the same gap differently in
 * every run). Conservative on purpose: both need at least four significant words, the same
 * numbers (2023 is not 2024) and an overlap of 80 percent, so two short, different questions
 * are never merged.
 */
export function isNearDuplicateTitle(a: string, b: string): boolean {
  const left = significantTokens(a);
  const right = significantTokens(b);
  if (left.size < 4 || right.size < 4) return comparableTitle(a) === comparableTitle(b);
  const numbers = (tokens: Set<string>) =>
    [...tokens]
      .filter((token) => /\d/.test(token))
      .sort()
      .join(",");
  if (numbers(left) !== numbers(right)) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared) >= 0.8;
}

/** Which kind of work a diligence text asks for (deterministic, by the words used). */
export function classifyTaskKind(text: string): CaseTaskKind {
  const lower = text.toLocaleLowerCase("da-DK");
  if (/referenc|interview|samtale|møde/.test(lower)) return "meeting";
  if (
    /dokumentation|kontrakt|aftale|regnskab|cap table|kapitaltabel|licens|patent|vedtægt|policy|dokument/.test(
      lower,
    )
  )
    return "document";
  if (/verific|bekræft|kontroller|kontrol|tjek|audit|gennemgå|gennemgang|test/.test(lower))
    return "verification";
  if (lower.includes("?")) return "question";
  return "research";
}

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const match = /^.+?[.!?](?=\s+[A-ZÆØÅ0-9]|$)/u.exec(clean);
  return match ? match[0] : clean;
}

/** The criterion a specialist's question belongs to: the only one, else the best word match. */
function linkCriterion(
  text: string,
  keys: readonly string[],
  criteria: ReadonlyMap<string, { label: string; description?: string | undefined }>,
): string | null {
  const known = keys.filter((key) => criteria.has(key));
  if (known.length === 0) return null;
  if (known.length === 1) return known[0]!;
  const words = significantTokens(text);
  let best: { key: string; score: number } | null = null;
  let tie = false;
  for (const key of known) {
    const criterion = criteria.get(key)!;
    const own = significantTokens(`${criterion.label} ${criterion.description ?? ""}`);
    let score = 0;
    for (const word of words) if (own.has(word)) score += 1;
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { key, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && !tie ? best.key : null;
}

/** Words every case has: sharing one says nothing about the subject. */
// i18n-keep: Danish words code matches in Danish task texts (dedupe), not a text anyone reads.
const DOMAIN_COMMON = new Set([
  "kunde",
  "kunder",
  "marked",
  "markedet",
  "selskab",
  "selskabet",
  "virksomhed",
  "virksomheden",
  "produkt",
  "produktet",
  "team",
  "teamet",
  "founder",
  "founders",
  "risiko",
  "risikoen",
  "analyse",
  "omsætning",
  "finansiering",
  "investering",
]);

function topicTokens(text: string): Set<string> {
  return new Set(
    [...comparableTitle(text).split(/[^\p{L}\p{N}]+/u)]
      .filter((word) => word.length > 4 && !STOP_WORDS.has(word) && !DOMAIN_COMMON.has(word))
      .map((word) => Array.from(word).slice(0, 5).join("")),
  );
}

/**
 * Two texts about the same subject (used to decide that a task already covers a risk): they
 * share at least three subject words (longer than four letters, none of the words every case
 * has), or all of them when the topic has fewer than three. Never a single common word.
 */
export function topicOverlap(topic: string, other: string): boolean {
  const own = topicTokens(topic);
  if (own.size < 2) return false;
  let shared = 0;
  for (const word of topicTokens(other)) if (own.has(word)) shared += 1;
  return shared >= Math.min(3, own.size);
}

/** One curated next step from the synthesis (prompt v10c) or the screening. */
export interface NextStep {
  /** At most TASK_TITLE.maxWords words; older output had the whole action here. */
  title: string;
  /** The precise question or action in one sentence; null in older output. */
  question: string | null;
  why: string;
  kind: CaseTaskKind;
  linkedKind: "gate" | "criterion" | null;
  linkedKey: string | null;
  /** 1 = most important. */
  priority: 1 | 2 | 3;
}

/**
 * A title that arrived as a raw JSON-ish list (`Hvad er X?","Hvordan er Y?`) is several titles.
 * Splits such text, and strips quote, bracket and backslash artefacts from every title.
 */
export function splitJsonishTitles(text: string): string[] {
  const trimmed = text.trim();
  let parts: string[] = [trimmed];
  if (/^\[?\s*\\?"/.test(trimmed) || /\\?"\s*,\s*\\?"/.test(trimmed)) {
    try {
      const parsed: unknown = JSON.parse(trimmed.startsWith("[") ? trimmed : `[${trimmed}]`);
      if (Array.isArray(parsed))
        parts = parsed.filter((item): item is string => typeof item === "string");
    } catch {
      parts = trimmed.split(/\\?"\s*,\s*\\?"/);
    }
  }
  return parts.map(cleanTitlePart).filter(Boolean);
}

/** Quote, bracket and backslash artefacts off one title (the cleanup every title goes through). */
function cleanTitlePart(part: string): string {
  return part
    .replace(/\\"/g, '"')
    .replace(/^[\s[\]"'\\]+/, "")
    .replace(/[\s[\]"'\\]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// A whole word only: "Aftaler med kunder" is not the verb "Aftal", "Erfaring" is not "Er".
const ACTION_START =
  /^(indhent|verific(?:er|\u00e9r)?|bekr\u00e6ft|book|bed om|afklar|find|kontakt|f\u00e5|sp\u00f8rg|gennemg\u00e5|kortl\u00e6g|tjek|unders\u00f8g|hent|anmod|aftal|test|sikr|hvad|hvem|hvordan|hvilke|hvilken|hvorn\u00e5r|hvorfor|hvor|er|har|kan|skal)(?![\p{L}\p{N}])/iu;

/**
 * Titles a gap as an action. A text that already starts with a verb or is a question stays;
 * "X er ikke dokumenteret" and "Der er ikke dokumenteret X" become "Indhent dokumentation for X";
 * anything else gets "Afklar: ". Deterministic, nothing is invented.
 */
export function actionTitle(text: string, language: Language = DEFAULT_LANGUAGE): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return clean;
  if (language === "en") {
    // The AI writes an English fund's gaps in English: an action or a question stays.
    if (ENGLISH_ACTION_START.test(clean) || clean.includes("?")) return clean;
    return translate(language, "caseServer.tasks.clarify", { text: clean });
  }
  if (ACTION_START.test(clean) || clean.includes("?")) return clean;
  const none =
    /^der er (?:endnu )?ikke (?:dokumenteret|oplyst|verificeret|afklaret|fundet)\s+(.+?)\.?$/iu.exec(
      clean,
    );
  if (none?.[1]) return `Indhent dokumentation for ${none[1]}`;
  const subject =
    /^(.+?)\s+(?:er|var|findes|foreligger)\s+(?:endnu\s+)?ikke\s+(?:dokumenteret|oplyst|verificeret|afklaret|fundet|belyst)\.?$/iu.exec(
      clean,
    );
  if (subject?.[1]) return `Indhent dokumentation for ${subject[1]}`;
  return `Afklar: ${clean}`;
}

const ENGLISH_ACTION_START =
  /^(obtain|verify|confirm|book|ask|clarify|find|contact|get|review|map|check|investigate|request|agree|test|ensure|assess|what|who|how|which|when|why|where|is|are|does|do|has|have|can|should)(?![\p{L}\p{N}])/iu;

const NEXT_STEP_KINDS: readonly CaseTaskKind[] = caseTaskKinds;

/**
 * Validates a curated list (the synthesis's, and the screening's) in code: drops empty
 * entries, cleans titles, keeps the kind within the known ones, and links an entry only to a gate
 * or criterion that exists in the fund's setup (else it stays unlinked). A title over six words is
 * cut, and the whole wording is kept as the question when the model gave none. At most `max`
 * (MAX_NEXT_STEPS), most important first.
 */
export function sanitizeNextSteps(
  steps: ReadonlyArray<{
    title?: unknown;
    question?: unknown;
    why?: unknown;
    kind?: unknown;
    linkedKind?: unknown;
    linkedKey?: unknown;
    priority?: unknown;
  }>,
  keys: { gates: readonly string[]; criteria: readonly string[] },
  max: number = MAX_NEXT_STEPS,
): NextStep[] {
  const out: NextStep[] = [];
  for (const step of steps) {
    if (typeof step.title !== "string") continue;
    const parts = splitJsonishTitles(step.title);
    for (const part of parts) {
      const full = clip(part, 200);
      if (!full) continue;
      const short = shortTaskTitle(full);
      const asked =
        parts.length === 1 && typeof step.question === "string"
          ? clip(step.question, TASK_QUESTION.max)
          : "";
      const kindOk = NEXT_STEP_KINDS.includes(step.kind as CaseTaskKind);
      const linkedKey = typeof step.linkedKey === "string" ? step.linkedKey : null;
      const linkOk =
        linkedKey !== null &&
        ((step.linkedKind === "gate" && keys.gates.includes(linkedKey)) ||
          (step.linkedKind === "criterion" && keys.criteria.includes(linkedKey)));
      const priority = step.priority === 1 || step.priority === 3 ? step.priority : 2;
      out.push({
        title: short.title,
        question: asked || (short.cut ? full : null),
        why: typeof step.why === "string" ? clip(step.why, 400) : "",
        kind: kindOk ? (step.kind as CaseTaskKind) : "task",
        linkedKind: linkOk ? (step.linkedKind as "gate" | "criterion") : null,
        linkedKey: linkOk ? linkedKey : null,
        priority,
      });
    }
  }
  return out
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.priority - b.step.priority || a.index - b.index)
    .map((item) => item.step)
    .slice(0, max);
}

/**
 * Every question and gap a run found, as tasks, most important first (nothing is cut here).
 * Order: unknown binding gates, other unknown gates, critical risks, high risks, the investment
 * condition, criteria without evidence, the specialists' questions, the criteria's unknowns, open
 * questions, the specialists' unknowns, and last the check of the counter-thesis.
 * `needs_information` is a result of the same gaps and adds no task of its own.
 */
export function buildAiTaskDrafts(source: AiTaskSource): AiTaskDraft[] {
  const language = source.language ?? DEFAULT_LANGUAGE;
  const say = (key: MessageKey, vars?: TranslateVars) => translate(language, key, vars);
  const gateInfo = new Map(source.gates.map((gate) => [gate.key, gate]));
  const criterionInfo = new Map(source.criteria.map((criterion) => [criterion.key, criterion]));
  const criterionLabel = new Map(
    source.criteria.map((criterion) => [criterion.key, criterion.label]),
  );
  const ranked: Array<{ tier: number; draft: AiTaskDraft }> = [];
  type PushDraft = Omit<AiTaskDraft, "dedupeKey" | "matchText" | "dueInDays"> & {
    /** The wording the gap is keyed and compared by, when it is not the title. */
    matchText?: string | undefined;
  };
  const push = (tier: number, draft: PushDraft) => {
    // A title that is a raw JSON-ish list becomes several tasks; quote/bracket artefacts go.
    const parts = splitJsonishTitles(draft.title);
    if (parts.length > 1) {
      for (const part of parts) push(tier, { ...draft, title: part, matchText: undefined });
      return;
    }
    const title = clip(parts[0] ?? "", 200);
    if (!title) return;
    // The wording is cleaned as a title is, so a key keeps matching the one an older run stored.
    const matchText = clip(cleanTitlePart(draft.matchText ?? "") || title, 200);
    const key = dedupeKey(
      draft.linkedKind,
      draft.linkedKey,
      matchText,
      source.configVersionId ?? null,
    );
    if (
      ranked.some(
        (existing) =>
          existing.draft.dedupeKey === key ||
          // The same gap in other words, also when one wording is linked to a criterion and the
          // other is not (gates only match by key).
          (existing.draft.linkedKind !== "gate" &&
            draft.linkedKind !== "gate" &&
            isNearDuplicateTitle(existing.draft.matchText, matchText)),
      )
    )
      return;
    const { matchText: _matchText, ...rest } = draft;
    ranked.push({
      tier,
      draft: {
        ...rest,
        title,
        dedupeKey: key,
        matchText,
        dueInDays: tier <= URGENT_TIER ? TASK_DUE_DAYS.urgent : TASK_DUE_DAYS.normal,
      },
    });
  };
  /** A short title; the whole wording goes to the description when it had to be cut. */
  const titled = (text: string, description?: string | null) => {
    const short = shortTaskTitle(text);
    return {
      title: short.title,
      description: description ?? (short.cut ? clip(text, TASK_QUESTION.max) : null),
    };
  };

  const curated = source.nextSteps !== undefined;
  const steps = source.nextSteps ?? [];
  for (const key of source.unresolvedGateKeys) {
    const gate = gateInfo.get(key);
    if (!gate) continue;
    // A curated step on the requirement gives the gate task its short title and question
    // (the first, most important one); the key stays on the requirement, so an answer given under
    // this setup version is never asked again in other words.
    const step = steps.find((entry) => entry.linkedKind === "gate" && entry.linkedKey === key);
    const clarify = say("caseServer.tasks.clarify", { text: gate.label });
    const own = step
      ? { title: shortTaskTitle(step.title).title, description: step.question }
      : titled(clarify);
    push(gate.treatment === "hard" ? 1 : 2, {
      kind: step?.kind ?? "question",
      title: own.title,
      description:
        own.description ?? clip(say("caseServer.tasks.gateQuestion", { label: gate.label }), 400),
      why: step?.why
        ? clip(`${say("caseServer.tasks.gateUnknown")} ${step.why}`, 600)
        : say("caseServer.tasks.gateUnknown"),
      linkedKind: "gate",
      linkedKey: key,
      matchText: clarify,
    });
  }
  // A critical risk is covered when a curated step shares two words with its title (one, when the
  // title has only one significant word).
  const covered = (label: string) =>
    steps.some(
      (step) =>
        topicOverlap(label, step.title) || (step.question && topicOverlap(label, step.question)),
    );
  for (const step of steps) {
    // A step on a gate that already has its own task: the first one gave that task its title and
    // question; further steps on the same requirement are folded into its `why` instead of
    // becoming a second task on it (the gate dedupe key carries the requirement, so the
    // near-duplicate check cannot catch it).
    if (step.linkedKind === "gate" && step.linkedKey !== null) {
      const gateTask = ranked.find(
        (item) => item.draft.linkedKind === "gate" && item.draft.linkedKey === step.linkedKey,
      );
      if (gateTask) {
        const first = steps.find(
          (entry) => entry.linkedKind === "gate" && entry.linkedKey === step.linkedKey,
        );
        if (first === step) continue;
        const text = step.question ?? step.title;
        const extra = step.why
          ? say("caseServer.tasks.nextStepWhy", { title: text, why: step.why })
          : say("caseServer.tasks.nextStep", { title: text });
        gateTask.draft.why = clip(`${gateTask.draft.why ?? ""} ${extra}`.trim(), 600);
        continue;
      }
    }
    // A step on a requirement that has no task of its own here (the team answered it, or it is
    // a finance gate the code decides) is keyed on the requirement like the gate task: gates
    // only match by key, so a key from the step's wording would ask an answered requirement again
    // under the same setup version.
    const gateLabel =
      step.linkedKind === "gate" && step.linkedKey !== null
        ? gateInfo.get(step.linkedKey)?.label
        : undefined;
    push(step.priority === 1 ? 3 : step.priority === 2 ? 4 : 6, {
      kind: step.kind,
      title: step.title,
      description: step.question,
      why: step.why || null,
      linkedKind: step.linkedKind,
      linkedKey: step.linkedKey,
      matchText: gateLabel
        ? say("caseServer.tasks.clarify", { text: gateLabel })
        : (step.question ?? step.title),
    });
  }
  // A question the research could not answer publicly. On a gate that already has its
  // task it becomes that task's question when no curated step gave one, else it joins the `why`.
  for (const item of source.researchQuestions ?? []) {
    const known = item.kind === "gate" ? gateInfo.has(item.key) : criterionInfo.has(item.key);
    const note = item.note.trim();
    const why = `${say("caseServer.tasks.researchOpen")}${note ? ` ${note}` : ""}`;
    if (item.kind === "gate" && known) {
      const gateTask = ranked.find(
        (entry) => entry.draft.linkedKind === "gate" && entry.draft.linkedKey === item.key,
      );
      if (gateTask) {
        const stepped = steps.some(
          (step) => step.linkedKind === "gate" && step.linkedKey === item.key && step.question,
        );
        if (stepped) {
          gateTask.draft.why = clip(
            `${gateTask.draft.why ?? ""} ${say("caseServer.tasks.ask", { question: item.question })}`.trim(),
            600,
          );
        } else {
          gateTask.draft.description = clip(item.question, TASK_QUESTION.max);
          gateTask.draft.why = clip(`${gateTask.draft.why ?? ""} ${why}`.trim(), 600);
        }
        continue;
      }
    }
    // The question is the description; the title names who is asked about what.
    const label = known
      ? item.kind === "gate"
        ? gateInfo.get(item.key)?.label
        : criterionLabel.get(item.key)
      : undefined;
    const own = label
      ? titled(say("caseServer.tasks.askFounders", { label }), item.question)
      : titled(item.question);
    push(5, {
      kind: "question",
      title: own.title,
      description: own.description ?? clip(item.question, TASK_QUESTION.max),
      why: clip(why, 600),
      linkedKind: known ? item.kind : null,
      linkedKey: known ? item.key : null,
      matchText: item.question,
    });
  }
  for (const risk of source.risks ?? []) {
    if (curated && risk.level !== "critical") continue;
    if (curated) {
      // The fallback is only for a risk nothing else addresses: no curated step, and no gate or
      // criterion task of this run (an unresolved gate, a criterion without evidence, a step
      // linked to a gate or criterion) about the same topic (a mandate-stage risk is already
      // covered by the stage gate's task).
      const addressed = (title: string) => topicOverlap(risk.label, title);
      const gateOrCriterion = ranked
        .filter((item) => item.draft.linkedKind !== null)
        .flatMap((item) => [item.draft.title, item.draft.matchText])
        .concat(source.missingCriterionKeys.map((key) => criterionLabel.get(key) ?? ""))
        .concat(source.unresolvedGateKeys.map((key) => gateInfo.get(key)?.label ?? ""));
      if (covered(risk.label) || gateOrCriterion.some(addressed)) continue;
    }
    const tier = risk.level === "critical" ? (curated ? 3.5 : 3) : risk.level === "high" ? 4 : 0;
    const plan = risk.mitigation?.replace(/\s+/g, " ").trim();
    if (!tier || !plan || !risk.label.trim()) continue;
    const planStart = firstSentence(plan).replace(/[.!]+$/u, "");
    const label = risk.label.trim();
    // A concrete action with the risk named once: the mitigation's own first sentence when it
    // is an action; the risk name then lives in `why`.
    const actionable = curated && ACTION_START.test(planStart);
    const named = say(
      risk.level === "critical"
        ? "caseServer.tasks.clarifyCriticalRisk"
        : "caseServer.tasks.reduceRisk",
      { label },
    );
    // The plan's own first sentence is the title when it is an action of at most six words,
    // else the risk is named in a few words; the plan is the description. The key stays on the
    // wording earlier runs titled the task with (the plan's first sentence when actionable).
    const action = actionable ? shortTaskTitle(planStart) : null;
    push(tier, {
      kind: classifyTaskKind(plan),
      title: action && !action.cut ? action.title : shortTaskTitle(named).title,
      why: actionable
        ? clip(`${say("caseServer.tasks.risk", { label })} ${firstSentence(risk.rationale)}`, 600)
        : clip(firstSentence(risk.rationale) || risk.rationale, 600),
      description: clip(plan, 1_200),
      linkedKind: null,
      linkedKey: null,
      topic: label,
      matchText: actionable ? planStart : named,
    });
  }
  // The investment condition is a condition, not a task: it stays as `investmentCondition` data
  // and is shown in the conclusion. (Any step needed to meet it is a curated nextStep.)
  for (const key of source.missingCriterionKeys) {
    const label = criterionLabel.get(key);
    if (!label) continue;
    // With a curated list a criterion is only asked for when no step already belongs to it.
    if (
      curated &&
      steps.some((step) => step.linkedKind === "criterion" && step.linkedKey === key)
    ) {
      continue;
    }
    const find = say("caseServer.tasks.findDocumentation", { label });
    push(6, {
      kind: "research",
      title: shortTaskTitle(find).title,
      description: say("caseServer.tasks.findDocumentationQuestion", { label }),
      why: say("caseServer.tasks.stagePrior"),
      linkedKind: "criterion",
      linkedKey: key,
      matchText: find,
    });
  }
  // The raw per-specialist questions, unknowns and open questions stay visible on the analysis,
  // but with a curated list they are not tasks: the synthesis has merged them into the steps.
  for (const specialist of curated ? [] : (source.specialists ?? [])) {
    for (const question of specialist.questions.slice(0, MAX_SPECIALIST_QUESTIONS)) {
      const link = linkCriterion(question, specialist.criterionKeys, criterionInfo);
      push(6.5, {
        kind: classifyTaskKind(question),
        title: question,
        why: say("caseServer.tasks.raisedBySpecialist", { name: specialist.label }),
        linkedKind: link ? "criterion" : null,
        linkedKey: link,
      });
    }
  }
  const unknownsPerCriterion = source.maxUnknownsPerCriterion ?? MAX_UNKNOWNS_PER_CRITERION;
  for (const assessment of curated ? [] : source.assessments) {
    if (!criterionLabel.has(assessment.criterionKey)) continue;
    for (const unknown of assessment.unknowns.slice(0, unknownsPerCriterion)) {
      push(7, {
        kind: "verification",
        title: actionTitle(unknown, language),
        why: say("caseServer.tasks.unknownInCriterion", {
          name: criterionLabel.get(assessment.criterionKey) ?? "",
        }),
        linkedKind: "criterion",
        linkedKey: assessment.criterionKey,
      });
    }
  }
  for (const question of curated ? [] : source.openQuestions) {
    push(8, { kind: "question", title: question, why: null, linkedKind: null, linkedKey: null });
  }
  for (const finding of curated ? [] : (source.findings ?? [])) {
    if (finding.findingType !== "question" && finding.findingType !== "unknown") continue;
    push(8, {
      kind: "research",
      title: finding.statement,
      why: null,
      linkedKind: null,
      linkedKey: null,
    });
  }
  for (const specialist of curated ? [] : (source.specialists ?? [])) {
    for (const unknown of specialist.unknowns.slice(0, MAX_SPECIALIST_UNKNOWNS)) {
      const link = linkCriterion(unknown, specialist.criterionKeys, criterionInfo);
      push(9, {
        kind: "research",
        title: actionTitle(unknown, language),
        why: say("caseServer.tasks.unknownInSpecialist", { name: specialist.label }),
        linkedKind: link ? "criterion" : null,
        linkedKey: link,
      });
    }
  }
  const contrary = source.contraryCase?.replace(/\s+/g, " ").trim();
  if (contrary && contrary.length >= 40) {
    // The counter-reading is what to test, so it is the description.
    push(10, {
      kind: "research",
      title: say("caseServer.tasks.testContrary"),
      description: clip(contrary, 600),
      why: null,
      linkedKind: null,
      linkedKey: null,
    });
  }
  // Stable: Array.prototype.sort keeps the order inside a tier.
  return ranked.sort((a, b) => a.tier - b.tier).map((item) => item.draft);
}

/** The drafts a run writes: the most important ones, at most the run's cap. */
export function buildAiTasks(source: AiTaskSource): AiTaskDraft[] {
  return buildAiTaskDrafts(source).slice(0, source.maxTasks ?? MAX_AI_TASKS_PER_RUN);
}

/**
 * A resolved gate answer that holds a decision about a requirement: "Ikke opfyldt", or an
 * override. Deleting it changes whether the case is stopped, so it needs the same right as an
 * override (Admin/Lead) and is audited (harden F1).
 */
export function isBindingGateAnswer(task: {
  linkedKind: string | null;
  status: string;
  answerValue: { gatePassed?: unknown; override?: unknown } | null;
}): boolean {
  return (
    task.linkedKind === "gate" &&
    task.status === "resolved" &&
    (task.answerValue?.gatePassed === false || task.answerValue?.override === true)
  );
}

// ---------------------------------------------------------------------------
// A new run and the tasks the case already has
// ---------------------------------------------------------------------------

/** A task row as the planner needs it; `sourceRunKind` is read from the run that raised it. */
export interface ExistingTaskRow {
  id: string;
  dedupeKey: string | null;
  title: string;
  /** The question or a risk's plan; compared with a new run's wording as the title is. */
  description: string | null;
  origin: string;
  status: string;
  assigneeId: string | null;
  dueOn: string | null;
  answerText: string | null;
  answerValue: unknown;
  answerDocumentId: string | null;
  answerEvidenceId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  sourceRunId: string | null;
  sourceRunKind: "screening" | "deep" | null;
  linkedKind: string | null;
  linkedKey: string | null;
}

/**
 * An AI task nobody has touched: still open, nothing answered, and the row was never changed
 * after it was written (`updateCaseTask`, answers, delete and restore all set `updated_at`; the
 * system's own retirement and restore deliberately do not). Since an AI task gets its
 * responsible person and deadline when it is written, so those say nothing on their own: a person
 * who changes them also moves `updated_at`.
 */
export function isUntouchedAiTask(row: ExistingTaskRow): boolean {
  return (
    row.origin === "ai" &&
    row.status === "open" &&
    row.answerText === null &&
    row.answerValue === null &&
    row.answerDocumentId === null &&
    row.answerEvidenceId === null &&
    row.resolvedAt === null &&
    row.updatedAt === row.createdAt
  );
}

/** Retired by the system (not by a person): deleted, never touched, nobody recorded as deleting. */
export function isSystemRetired(row: ExistingTaskRow): boolean {
  return row.deletedAt !== null && row.deletedBy === null && isUntouchedAiTask(row);
}

export interface AiTaskPlan {
  /** New gaps: written as new tasks. */
  insert: AiTaskDraft[];
  /** A gap the system had retired that the run raises again: brought back, with the new text. */
  restore: Array<{ id: string; draft: AiTaskDraft }>;
  /** Untouched AI tasks the run no longer raises: retired (soft delete, undo by restore). */
  retire: string[];
}

/**
 * The same gap in other words: the draft's full wording (the question) is compared with
 * the row's title and its description, so a task written with the whole question as its title
 * And a new-style task (short title, question as description) both match. Short
 * titles are never compared with each other: a code template ("Spørg founders om Traction") or
 * two short titles that happen to be alike say nothing about the gap being the same.
 */
function sameWording(row: ExistingTaskRow, draft: AiTaskDraft): boolean {
  const rowTexts = row.description ? [row.title, row.description] : [row.title];
  return rowTexts.some((text) => isNearDuplicateTitle(text, draft.matchText));
}

function sameGap(row: ExistingTaskRow, draft: AiTaskDraft): boolean {
  if (row.dedupeKey !== null && row.dedupeKey === draft.dedupeKey) return true;
  // A gate is only the same under the same setup version (the key carries it): a gate still
  // unresolved under a new version must be asked again (harden S4R2-1).
  if (draft.linkedKind === "gate") return false;
  // Another wording of the same gap, on the same criterion (or both unlinked).
  if (row.linkedKind !== draft.linkedKind || row.linkedKey !== draft.linkedKey) return false;
  return sameWording(row, draft);
}

/**
 * What a finished run does to the case's tasks. `raised` are all drafts the run found, most
 * important first; `cap` is how many tasks the run may add. Rules:
 * - Only gaps that are actually new count against the cap: a draft already covered by an
 *   existing (or a person-deleted) task uses none of it, so the order still decides who is cut.
 * - Never recreate a gap the team resolved or deleted (also not in other words): it is skipped.
 * - A gap the system itself retired and the run raises again comes back (it counts as new). If
 *   the retired task was already used for an earlier draft, the next draft is inserted.
 * - Only untouched AI tasks from earlier runs of the SAME kind are retired (a screening never
 *   retires deep tasks and a deep analysis never retires screening tasks), and only those the
 *   run no longer raises (a gap cut by the cap is still raised). A run that raised nothing
 *   retires nothing. Tasks a person made or changed stay.
 */
export function planAiTaskWrites(input: {
  runId: string;
  runKind: "screening" | "deep";
  raised: readonly AiTaskDraft[];
  cap: number;
  existing: readonly ExistingTaskRow[];
}): AiTaskPlan {
  const plan: AiTaskPlan = { insert: [], restore: [], retire: [] };
  const restored = new Set<string>();
  for (const draft of input.raised) {
    if (plan.insert.length + plan.restore.length >= input.cap) break;
    // The same gap in other words on another task of the case (also one from a screening, or on
    // another criterion) is already covered: the existing task wins, no duplicate is created.
    // Retired-by-system rows do not count (they are handled below), gates match by key only.
    if (
      draft.linkedKind !== "gate" &&
      input.existing.some(
        (row) =>
          row.linkedKind !== "gate" &&
          !isSystemRetired(row) &&
          // An older untouched task of this run's own kind is retired below and replaced.
          !(
            row.deletedAt === null &&
            row.sourceRunKind === input.runKind &&
            isUntouchedAiTask(row)
          ) &&
          sameWording(row, draft),
      )
    ) {
      continue;
    }
    if (
      draft.topic &&
      input.existing.some(
        (row) =>
          row.linkedKind !== null &&
          row.deletedAt === null &&
          (topicOverlap(draft.topic!, row.title) ||
            (row.description !== null && topicOverlap(draft.topic!, row.description))),
      )
    ) {
      continue;
    }
    const matches = input.existing.filter((row) => sameGap(row, draft));
    if (matches.length === 0) {
      plan.insert.push(draft);
      continue;
    }
    // A live task, or one a person deleted or answered, already covers the gap.
    if (matches.some((row) => row.deletedAt === null || !isSystemRetired(row))) continue;
    const row = matches.find((candidate) => !restored.has(candidate.id));
    if (row) {
      restored.add(row.id);
      plan.restore.push({ id: row.id, draft });
    } else {
      plan.insert.push(draft);
    }
  }
  if (input.raised.length === 0) return plan;
  for (const row of input.existing) {
    if (row.deletedAt !== null || row.sourceRunId === input.runId) continue;
    if (row.sourceRunKind !== input.runKind) continue;
    if (!isUntouchedAiTask(row)) continue;
    if (input.raised.some((draft) => sameGap(row, draft))) continue;
    plan.retire.push(row.id);
  }
  return plan;
}

export type TaskRunKind = "screening" | "deep";

/** The run behind an AI task, for the list's "Fra dyb analyse" label. */
export function resolveTaskSource(
  sourceRunId: string | null,
  runKinds: ReadonlyMap<string, TaskRunKind>,
): { sourceRunId: string | null; sourceRunKind: TaskRunKind | null } {
  return {
    sourceRunId,
    sourceRunKind: sourceRunId ? (runKinds.get(sourceRunId) ?? null) : null,
  };
}
