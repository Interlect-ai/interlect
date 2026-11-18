/**
 * Brain · Lært og Playbook (for): the lessons (brain_playbook_bullets), the insights
 * that ask for a decision (brain_insights) and the reflections over decisions (brain_log,
 * object_kind 'reflection') as view data. Rows are checked, never trusted: a malformed row is
 * dropped, an unknown section or status gets a safe label. Pure, so it is tested without a
 * database; the reads and the review are in `lessons.functions.ts`.
 */

import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

export const LESSON_SECTIONS = [
  { key: "strategies", labelKey: "brainKnowledge.lessons.section.strategies" },
  { key: "red_flags", labelKey: "brainKnowledge.lessons.section.red_flags" },
  { key: "green_flags", labelKey: "brainKnowledge.lessons.section.green_flags" },
  { key: "questions_to_ask", labelKey: "brainKnowledge.lessons.section.questions_to_ask" },
  { key: "sector_notes", labelKey: "brainKnowledge.lessons.section.sector_notes" },
  { key: "process", labelKey: "brainKnowledge.lessons.section.process" },
  { key: "common_mistakes", labelKey: "brainKnowledge.lessons.section.common_mistakes" },
] as const satisfies ReadonlyArray<{ key: string; labelKey: MessageKey }>;
export type LessonSection = (typeof LESSON_SECTIONS)[number]["key"];
const SECTION_KEYS = new Set<string>(LESSON_SECTIONS.map((s) => s.key));
const SECTION_KEY = new Map<string, MessageKey>(LESSON_SECTIONS.map((s) => [s.key, s.labelKey]));

export const LESSON_STATUS_KEY: Record<string, MessageKey> = {
  candidate: "brainKnowledge.lessons.status.candidate",
  active: "brainKnowledge.lessons.status.active",
  retired: "brainKnowledge.lessons.status.retired",
  rejected: "brainKnowledge.lessons.status.rejected",
};

/** The section's name in a language (the first section for a key it does not know). */
export const sectionLabel = (section: string, language: Language = "da"): string =>
  translate(language, SECTION_KEY.get(section) ?? LESSON_SECTIONS[0].labelKey);

/** The status word in a language; a status it does not know is shown as it is. */
export const lessonStatusLabel = (status: string, language: Language = "da"): string =>
  LESSON_STATUS_KEY[status] ? translate(language, LESSON_STATUS_KEY[status]) : status;

export const MAX_LESSON_CHARS = 500;
export const MAX_LESSONS = 500;
export const MAX_INSIGHTS = 100;
export const MAX_REFLECTIONS = 20;

export interface LessonView {
  id: string;
  shortId: string;
  section: string;
  sectionLabel: string;
  text: string;
  helpful: number;
  harmful: number;
  status: string;
  statusLabel: string;
  origin: "brain" | "user";
  /** A short line about where the lesson applies, from its scope ("Sektor: fintech"), or null. */
  scopeText: string | null;
  evidenceCount: number;
  /** The scope as key and value, so the page can word it in the fund's language. */
  scopeParts: Array<{ key: string; value: string }>;
}

export interface InsightView {
  id: string;
  kind: string;
  title: string;
  body: string;
  priority: number;
  status: string;
  createdAt: string;
  /** The lesson a `lesson_candidate` insight is about (when it still exists). */
  lesson: LessonView | null;
}

export interface ReflectionView {
  decisionId: string;
  decision: string | null;
  agreement: string | null;
  keyInsight: string | null;
  createdAt: string;
}

export interface LessonEvent {
  /** The wording in Danish (the reason of a user action, else the event's label). */
  kind: string;
  /** The event's own kind (`create`, `user` …), so the page can word it in the fund's language. */
  sourceKind: string;
  reason: string;
  helpful: number;
  harmful: number;
  createdAt: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** The reflector's scope keys (06 L2 `scope`) as labels; other keys are shown as they are. */
const SCOPE_KEY: Record<string, MessageKey> = {
  sectors: "brainKnowledge.lessons.scope.sectors",
  stages: "brainKnowledge.lessons.scope.stages",
  geographies: "brainKnowledge.lessons.scope.geographies",
};

/**
 * The scope as key and value pairs; values are text, numbers or lists of text (the reflector
 * writes `{ sectors: [...] }`), never nested objects.
 */
export function scopeParts(scope: unknown): Array<{ key: string; value: string }> {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return [];
  return Object.entries(scope as Record<string, unknown>)
    .map(([key, value]) => {
      if (typeof value === "string" || typeof value === "number")
        return { key, value: String(value) };
      if (Array.isArray(value)) {
        return { key, value: value.filter((item) => typeof item === "string" && item).join(", ") };
      }
      return { key, value: "" };
    })
    .filter(({ value }) => value.trim() !== "")
    .slice(0, 4);
}

/** "Sektor: fintech · Fase: seed" from the scope pairs (Danish by default); null without any. */
export function scopeLine(
  parts: ReadonlyArray<{ key: string; value: string }>,
  language: Language = "da",
): string | null {
  if (!parts.length) return null;
  return parts
    .map(
      ({ key, value }) => `${SCOPE_KEY[key] ? translate(language, SCOPE_KEY[key]) : key}: ${value}`,
    )
    .join(" · ")
    .slice(0, 160);
}

export function scopeText(scope: unknown, language: Language = "da"): string | null {
  return scopeLine(scopeParts(scope), language);
}

export function shapeLesson(row: Record<string, unknown>): LessonView | null {
  const id = str(row["id"]);
  const text = str(row["text"]);
  if (!id || !text) return null;
  const section = str(row["section"]);
  const status = str(row["status"]);
  return {
    id,
    shortId: str(row["short_id"]),
    section: SECTION_KEYS.has(section) ? section : "strategies",
    sectionLabel: sectionLabel(section),
    text,
    helpful: Math.max(0, num(row["helpful"])),
    harmful: Math.max(0, num(row["harmful"])),
    status,
    statusLabel: lessonStatusLabel(status),
    origin: row["origin"] === "user" ? "user" : "brain",
    scopeText: scopeText(row["scope"]),
    scopeParts: scopeParts(row["scope"]),
    evidenceCount: Array.isArray(row["evidence"]) ? row["evidence"].length : 0,
  };
}

/** The lessons grouped by section in the plan's order; empty sections are left out. */
export function groupLessons(
  lessons: readonly LessonView[],
  language: Language = "da",
): Array<{ key: string; label: string; lessons: LessonView[] }> {
  return LESSON_SECTIONS.map((section) => ({
    key: section.key,
    label: translate(language, section.labelKey),
    lessons: lessons
      .filter((lesson) => lesson.section === section.key)
      .sort((a, b) => b.helpful - b.harmful - (a.helpful - a.harmful)),
  })).filter((group) => group.lessons.length > 0);
}

/** The id of the lesson a `lesson_candidate` insight points at (its refs, kind 'bullet'). */
export function insightBulletId(refs: unknown): string | null {
  if (!Array.isArray(refs)) return null;
  for (const ref of refs) {
    if (ref && typeof ref === "object" && (ref as { kind?: unknown }).kind === "bullet") {
      const id = (ref as { id?: unknown }).id;
      if (typeof id === "string") return id;
    }
  }
  return null;
}

export function shapeInsight(
  row: Record<string, unknown>,
  lessons: ReadonlyMap<string, LessonView>,
): InsightView | null {
  const id = str(row["id"]);
  if (!id) return null;
  const bulletId = row["kind"] === "lesson_candidate" ? insightBulletId(row["refs"]) : null;
  return {
    id,
    kind: str(row["kind"]),
    title: str(row["title"]) || translate("da", "brainKnowledge.lessons.insightFallback"),
    body: str(row["body_md"]),
    priority: Math.min(3, Math.max(1, num(row["priority"]) || 2)),
    status: str(row["status"]),
    createdAt: str(row["created_at"]),
    lesson: bulletId ? (lessons.get(bulletId) ?? null) : null,
  };
}

export function shapeReflection(row: Record<string, unknown>): ReflectionView | null {
  const decisionId = str(row["object_id"]);
  const after = row["after"];
  if (!decisionId || !after || typeof after !== "object") return null;
  const data = after as Record<string, unknown>;
  const text = (key: string) => {
    const value = str(data[key]).trim();
    return value ? value.slice(0, 600) : null;
  };
  const keyInsight = text("keyInsight");
  const agreement = text("agreement");
  if (!keyInsight && !agreement) return null;
  return {
    decisionId,
    decision: text("decision"),
    agreement,
    keyInsight,
    createdAt: str(row["created_at"]),
  };
}

export const EVENT_KEY: Record<string, MessageKey> = {
  create: "brainKnowledge.lessons.event.create",
  corroborate: "brainKnowledge.lessons.event.corroborate",
  tag_decision: "brainKnowledge.lessons.event.tag_decision",
  tag_outcome: "brainKnowledge.lessons.event.tag_outcome",
  // 0081 logs every user action (approve, reject, edit, retire, add) as 'user'; its reason says
  // which, so `shapeEvent` shows the reason instead of this label when there is one.
  user: "brainKnowledge.lessons.event.user",
  revert: "brainKnowledge.lessons.event.revert",
};

/** The label of an event kind in a language; a kind it does not know is shown as it is. */
export const eventLabel = (kind: string, language: Language = "da"): string =>
  EVENT_KEY[kind] ? translate(language, EVENT_KEY[kind]) : kind;

export function shapeEvent(row: Record<string, unknown>): LessonEvent | null {
  const kind = str(row["source_kind"]);
  if (!kind) return null;
  const reason = str(row["reason"]);
  return {
    kind: kind === "user" && reason ? reason : eventLabel(kind),
    sourceKind: kind,
    reason,
    helpful: Math.max(0, num(row["delta_helpful"])),
    harmful: Math.max(0, num(row["delta_harmful"])),
    createdAt: str(row["created_at"]),
  };
}

export type LessonCheck = { ok: true; text: string } | { ok: false; message: string };

export function checkLessonText(raw: string, language: Language = "da"): LessonCheck {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text)
    return { ok: false, message: translate(language, "brainKnowledge.lessons.writeLesson") };
  if (text.length > MAX_LESSON_CHARS) {
    return {
      ok: false,
      message: translate(language, "brainKnowledge.lessons.tooLongMax", { max: MAX_LESSON_CHARS }),
    };
  }
  return { ok: true, text };
}

/** The bar's share of helpful among all counts, in whole percent; null with no counts yet. */
export function helpfulShare(helpful: number, harmful: number): number | null {
  const total = helpful + harmful;
  return total > 0 ? Math.round((helpful / total) * 100) : null;
}

/** React Query keys for Brain · Lært: the drawer and the count in Brain's left column. */
export const brainLearnedQueryKey = (fundId: string) => ["brain-learned", fundId] as const;
export const brainPlaybookQueryKey = (fundId: string) => ["brain-playbook", fundId] as const;
export const brainLessonWhyQueryKey = (fundId: string, bulletId: string) =>
  ["brain-lesson-why", fundId, bulletId] as const;

/** The insight kinds (0043 `brain_insights.kind`) as the tag on a card in the feed. */
export const INSIGHT_KIND_KEY: Record<string, MessageKey> = {
  lesson_candidate: "brainKnowledge.lessons.insight.lesson_candidate",
  bullet_retire: "brainKnowledge.lessons.insight.bullet_retire",
  contradiction: "brainKnowledge.lessons.insight.contradiction",
  stale_fact: "brainKnowledge.lessons.insight.stale_fact",
  merge_candidate: "brainKnowledge.lessons.insight.merge_candidate",
  pattern: "brainKnowledge.lessons.insight.pattern",
  thesis_drift: "brainKnowledge.lessons.insight.thesis_drift",
  weekly_digest: "brainKnowledge.lessons.insight.weekly_digest",
  watch_signal: "brainKnowledge.lessons.insight.watch_signal",
  budget_reached: "brainKnowledge.lessons.insight.budget_reached",
  eval_regression: "brainKnowledge.lessons.insight.eval_regression",
  job_failed: "brainKnowledge.lessons.insight.job_failed",
};

/** The decision a reflection is about (the movement kinds L2 reflects over, 06 L2). */
export const DECISION_KEY: Record<string, MessageKey> = {
  reject: "brainKnowledge.lessons.decision.reject",
  decline_ic: "brainKnowledge.lessons.decision.decline_ic",
  invest: "brainKnowledge.lessons.decision.invest",
  hold: "brainKnowledge.lessons.decision.hold",
};

/** The reflector's `agreement`: the team's decision held up against the analysis before it. */
export const AGREEMENT_KEY: Record<string, MessageKey> = {
  aligned: "brainKnowledge.lessons.agreement.aligned",
  team_stricter: "brainKnowledge.lessons.agreement.team_stricter",
  team_more_positive: "brainKnowledge.lessons.agreement.team_more_positive",
  different_reason: "brainKnowledge.lessons.agreement.different_reason",
};

const labelOf = (keys: Record<string, MessageKey>, value: string, language: Language) =>
  keys[value] ? translate(language, keys[value]) : undefined;
export const insightKindLabel = (kind: string, language: Language = "da") =>
  labelOf(INSIGHT_KIND_KEY, kind, language);
export const decisionLabel = (decision: string, language: Language = "da") =>
  labelOf(DECISION_KEY, decision, language);
export const agreementLabel = (agreement: string, language: Language = "da") =>
  labelOf(AGREEMENT_KEY, agreement, language);

/** The Danish words (kept for callers that do not know the language). */
export const AGREEMENT_LABEL: Record<string, string> = Object.fromEntries(
  Object.keys(AGREEMENT_KEY).map((key) => [key, agreementLabel(key)!]),
);

const EVIDENCE_NOUN: Record<string, [MessageKey, MessageKey]> = {
  decision: [
    "brainKnowledge.lessons.evidence.decisionOne",
    "brainKnowledge.lessons.evidence.decisionMany",
  ],
  episode: [
    "brainKnowledge.lessons.evidence.episodeOne",
    "brainKnowledge.lessons.evidence.episodeMany",
  ],
  fact: ["brainKnowledge.lessons.evidence.factOne", "brainKnowledge.lessons.evidence.factMany"],
  case: ["brainKnowledge.lessons.evidence.caseOne", "brainKnowledge.lessons.evidence.caseMany"],
};
const OTHER_NOUN: [MessageKey, MessageKey] = [
  "brainKnowledge.lessons.evidence.otherOne",
  "brainKnowledge.lessons.evidence.otherMany",
];

/** "Bygger på 2 beslutninger og 1 kilde" from a lesson's evidence kinds; null without evidence. */
export function evidenceSummary(
  evidence: ReadonlyArray<{ kind: string }>,
  language: Language = "da",
): string | null {
  const counts = new Map<string, number>();
  for (const ref of evidence) {
    const key = EVIDENCE_NOUN[ref.kind] ? ref.kind : "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts].map(([kind, n]) => {
    const [one, many] = EVIDENCE_NOUN[kind] ?? OTHER_NOUN;
    return translate(language, n === 1 ? one : many, { count: n });
  });
  if (parts.length === 0) return null;
  const last = parts.pop()!;
  return translate(language, "brainKnowledge.lessons.basedOn", {
    list: parts.length
      ? translate(language, "brainKnowledge.lessons.listAnd", { head: parts.join(", "), last })
      : last,
  });
}

/** "2026-10-07T…" → "7. okt 2026" (the day in UTC, as stored); "" for anything that is not a date. */
export function lessonDate(value: string, language: Language = "da"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) return "";
  return translate(language, "brainKnowledge.lessons.date", {
    day: Number(match[3]),
    month: translate(
      language,
      `brainKnowledge.lessons.month.m${String(month).padStart(2, "0")}` as MessageKey,
    ),
    year: match[1]!,
  });
}
