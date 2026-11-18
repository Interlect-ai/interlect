/**
 * Brain pages (06 L4 step 5): which sections a page has, the computed
 * sections drawn from the database (no model), and the rules for the written sections the
 * page writer keeps up to date: fact references, section operations, locks. No I/O here,
 * so it is tested with node --test; the loop is loops/pages.ts and the data comes from 0064.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { da } from "../i18n/dictionaries/da.ts";
import { LANGUAGE_TAGS } from "../i18n/language.ts";
import { requestLanguage, serverText } from "../i18n/server-text.ts";
import { geographyText, stageText } from "../funds/basis-labels.ts";
import { DICTIONARIES, type MessageKey } from "../i18n/translate.ts";

export type PageKind =
  | "company"
  | "person"
  | "case"
  | "sector"
  | "market"
  | "theme"
  | "investor"
  | "thesis"
  | "fund_overview";

/** A stored section (brain_pages.sections[]). */
export type PageSection = {
  key: string;
  heading: string;
  body_md: string;
  fact_ids: string[];
  updated_at: string;
  locked_by_user: boolean;
  /** Drawn from the database; the page writer never touches it. */
  computed?: boolean;
};

type SectionSpec = { key: string; readonly heading: string; computed: boolean };
type HeadingKey = keyof (typeof da)["brainServer"]["pages"]["headings"];
/** The heading is read when it is used, so it follows the fund's language. */
const spec = (key: HeadingKey, computed: boolean): SectionSpec => ({
  key,
  get heading() {
    return serverText(`brainServer.pages.headings.${key}`);
  },
  computed,
});
const S = (key: HeadingKey): SectionSpec => spec(key, false);
const B = (key: HeadingKey): SectionSpec => spec(key, true);

/** Sections per page kind, in order. funding is B+S there; it is computed only for now. */
export const PAGE_SECTIONS: Record<PageKind, SectionSpec[]> = {
  company: [
    S("overview"),
    B("our_history"),
    B("key_metrics"),
    S("team"),
    S("product_market"),
    B("funding"),
    S("risks_open_questions"),
    B("contradictions"),
    B("timeline"),
  ],
  person: [S("overview"), B("roles"), B("connections"), S("notes")],
  case: [
    S("summary"),
    B("status_history"),
    B("analysis"),
    S("anticipated_qa"),
    S("open_questions"),
  ],
  sector: [S("overview"), B("our_cases"), S("what_we_learned"), B("players")],
  market: [S("overview"), B("our_cases"), S("what_we_learned"), B("players")],
  theme: [S("overview"), B("our_cases"), S("what_we_learned"), B("players")],
  investor: [S("overview"), B("co_investments")],
  thesis: [B("stated"), B("in_practice"), S("drift"), B("lessons")],
  fund_overview: [B("brain_stats"), S("this_week")],
};

/**
 * What the page writer writes: only pages of active or recently opened cases (the case and
 * its company), so the paid writer follows the work. anticipated_qa comes with, drift and
 * this_week with L5; other kinds show their computed sections until then.
 */
export const WRITER_KEYS: Partial<Record<PageKind, readonly string[]>> = {
  company: ["overview", "team", "product_market", "risks_open_questions"],
  case: ["summary", "open_questions"],
};

export function headingFor(kind: PageKind, key: string): string {
  return PAGE_SECTIONS[kind].find((spec) => spec.key === key)?.heading ?? key;
}

// --- Data from brain_page_data (0064) --------------------------------------------------------

export type PageFact = {
  id: string;
  predicate: string;
  statement: string;
  subjectId: string;
  subjectName: string;
  objectId: string | null;
  objectName: string | null;
  valueText: string | null;
  valueNum: number | null;
  unit: string | null;
  validFrom: string | null;
  validTo: string | null;
  trust: string;
  recordedAt: string;
};

type Decision = { decision?: string | null; decidedAt?: string | null; reasons?: string[] | null };

export type PageData = {
  entity?: { id: string; type: string; name: string };
  facts?: PageFact[];
  cases?: Array<
    Decision & {
      caseId: string;
      createdAt: string;
      phase?: string | null;
      company?: string;
      note?: string | null;
    }
  >;
  historical?: Array<{
    decidedOn: string | null;
    kind: string;
    reasons?: string[] | null;
    note?: string | null;
  }>;
  contradictions?: Array<{ id: string; title: string; createdAt: string }>;
  case?: { id: string; createdAt: string; phase?: string | null };
  moves?: Array<{
    at: string;
    kind: string;
    fromPhase?: string | null;
    toPhase?: string | null;
    reasons?: string[] | null;
    note?: string | null;
  }>;
  analyses?: Array<{
    kind: string;
    at: string;
    score: number | null;
    recommendation: string | null;
  }>;
  players?: Array<{ id: string; name: string }>;
  config?: {
    version: number;
    thesis: string | null;
    sectors: string[] | null;
    stages: string[] | null;
    geographies: string[] | null;
  } | null;
  decisions?: Array<{ kind: string; total: number; lastYear: number }>;
  lessons?: Array<{ shortId: string; section: string; text: string }>;
  stats?: Record<string, number>;
};

// --- Formatting -------------------------------------------------------------------------------

// The pages are written by the worker in the fund's language; Danish is unchanged.
type Pages = (typeof da)["brainServer"]["pages"];

/** A code's label from one of the page dictionary's groups, or the code itself when it has none. */
function label<G extends "decisions" | "phases" | "trust" | "recommendations" | "lessonSections">(
  group: G,
  code: string,
): string {
  const labels = DICTIONARIES.da.brainServer.pages[group] as Record<string, string>;
  if (!Object.hasOwn(labels, code)) return code;
  return serverText(`brainServer.pages.${group}.${code as keyof Pages[G] & string}` as MessageKey);
}

/** The fact's trust as a word, or undefined for a tier without one (it is then left out). */
function trustLabel(trust: string): string | undefined {
  return Object.hasOwn(DICTIONARIES.da.brainServer.pages.trust, trust)
    ? label("trust", trust)
    : undefined;
}

/** "2026-03-12…" → "12. mar 2026" ("12 Mar 2026" in English); null for anything that is not a date. */
export function pageDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const month = serverText("brainServer.pages.months").split(",")[Number(match[2]) - 1];
  return month
    ? serverText("brainServer.pages.date", { day: Number(match[3]), month, year: match[1]! })
    : null;
}

/** A fact's period: a whole calendar year is "2025"; otherwise from–to. */
export function periodLabel(from: string | null, to: string | null): string | null {
  if (from && to && from.slice(5, 10) === "01-01" && to.slice(5, 10) === "12-31") {
    return from.slice(0, 4) === to.slice(0, 4)
      ? from.slice(0, 4)
      : `${from.slice(0, 4)}–${to.slice(0, 4)}`;
  }
  const a = pageDate(from);
  const b = pageDate(to);
  if (a && b) return a === b ? a : `${a}–${b}`;
  if (a) return serverText("brainServer.pages.from", { date: a });
  if (b) return serverText("brainServer.pages.to", { date: b });
  return null;
}

function number(value: number): string {
  return new Intl.NumberFormat(LANGUAGE_TAGS[requestLanguage()], {
    maximumFractionDigits: 2,
  }).format(value);
}

const ref = (fact: { id: string }) => `[f:${fact.id}]`;
const bullets = (lines: string[]) => lines.map((line) => `- ${line}`).join("\n");
const reasonText = (reasons: string[] | null | undefined) =>
  reasons && reasons.length > 0 ? ` · ${reasons.join(", ")}` : "";

// --- Computed sections ----------------------------------------------------------------

function companyHistory(data: PageData): string {
  const lines: string[] = [];
  for (const item of data.cases ?? []) {
    const year = item.createdAt.slice(0, 4);
    const state = item.decision
      ? `${label("decisions", item.decision)} ${pageDate(item.decidedAt) ?? ""}`.trim()
      : serverText("brainServer.pages.open", {
          phase: label(
            "phases",
            item.phase && Object.hasOwn(DICTIONARIES.da.brainServer.pages.phases, item.phase)
              ? item.phase
              : "ongoing",
          ),
        });
    let line = `${year} · ${state}${reasonText(item.reasons)}`;
    if (item.note) {
      line += `\n  ${serverText("brainServer.pages.latestNote", { note: item.note.replace(/\s+/g, " ") })}`;
    }
    lines.push(line);
  }
  for (const item of data.historical ?? []) {
    const when = item.decidedOn?.slice(0, 4) ?? serverText("brainServer.pages.unknownYear");
    lines.push(
      `${when} · ${label("decisions", item.kind)} ${serverText("brainServer.pages.beforeInterlect")}${reasonText(item.reasons)}`,
    );
  }
  return bullets(lines);
}

function metrics(facts: PageFact[]): string {
  const rows = facts
    .filter((fact) => fact.predicate === "metric" && fact.valueNum !== null)
    .sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""))
    .slice(0, 15)
    .map((fact) => {
      const name = fact.valueText ?? fact.objectName ?? serverText("brainServer.pages.metric");
      const value = `${number(Number(fact.valueNum))}${fact.unit ? ` ${fact.unit}` : ""}`;
      const meta = [periodLabel(fact.validFrom, fact.validTo), trustLabel(fact.trust)]
        .filter(Boolean)
        .join(", ");
      return `${name}: ${value}${meta ? ` (${meta})` : ""} ${ref(fact)}`;
    });
  return bullets(rows);
}

function factLines(facts: PageFact[], predicates: readonly string[], limit: number): string {
  return bullets(
    facts
      .filter((fact) => predicates.includes(fact.predicate))
      .slice(0, limit)
      .map((fact) => `${fact.statement} ${ref(fact)}`),
  );
}

function timeline(facts: PageFact[]): string {
  return bullets(
    facts
      .filter((fact) => fact.validFrom && fact.predicate !== "has_case")
      .sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""))
      .slice(0, 20)
      .map((fact) => `${pageDate(fact.validFrom)} · ${fact.statement} ${ref(fact)}`),
  );
}

function connections(data: PageData): string {
  const self = data.entity?.id;
  const names = new Map<string, string>();
  for (const fact of data.facts ?? []) {
    if (fact.subjectId !== self) names.set(fact.subjectId, fact.subjectName);
    if (fact.objectId && fact.objectId !== self && fact.objectName) {
      names.set(fact.objectId, fact.objectName);
    }
  }
  return bullets(
    [...names.values()]
      .sort((a, b) => a.localeCompare(b, LANGUAGE_TAGS[requestLanguage()]))
      .slice(0, 20),
  );
}

function statusHistory(data: PageData): string {
  return bullets(
    (data.moves ?? []).map((move) => {
      const phase = move.kind === "advance" ? move.toPhase : move.fromPhase;
      const where = phase ? ` (${label("phases", phase)})` : "";
      const note = move.note ? ` · "${move.note.replace(/\s+/g, " ")}"` : "";
      return `${pageDate(move.at)} · ${label("decisions", move.kind)}${where}${reasonText(move.reasons)}${note}`;
    }),
  );
}

function analysis(data: PageData): string {
  return bullets(
    (data.analyses ?? []).map((run) => {
      const name = serverText(
        run.kind === "screening" ? "brainServer.pages.screening" : "brainServer.pages.deep",
      );
      const parts = [
        run.score !== null
          ? serverText("brainServer.pages.totalScore", { score: number(Number(run.score)) })
          : null,
        run.recommendation
          ? serverText("brainServer.pages.recommendation", {
              recommendation: label("recommendations", run.recommendation),
            })
          : null,
      ].filter(Boolean);
      return `${name} ${pageDate(run.at) ?? ""}${parts.length ? `: ${parts.join(", ")}` : ""}`;
    }),
  );
}

function ourCases(data: PageData): string {
  return bullets(
    (data.cases ?? []).map((item) => {
      const state = item.decision
        ? `${label("decisions", item.decision)} ${pageDate(item.decidedAt) ?? ""}`.trim()
        : serverText("brainServer.pages.openShort");
      return `${item.company ?? serverText("brainServer.pages.company")} · ${state}`;
    }),
  );
}

function stated(data: PageData): string {
  const config = data.config;
  if (!config) return "";
  const lines: string[] = [];
  if (config.thesis?.trim()) lines.push(config.thesis.trim());
  const language = requestLanguage();
  const list = (label: string, values: string[] | null, show = (value: string) => value) =>
    values && values.length > 0 ? `- ${label}: ${values.map(show).join(", ")}` : null;
  const facts = [
    list(serverText("brainServer.pages.sectors"), config.sectors),
    // Stages and geographies are stored as keys; the page shows their names.
    list(serverText("brainServer.pages.stages"), config.stages, (stage) =>
      stageText(stage, language),
    ),
    list(serverText("brainServer.pages.geographies"), config.geographies, (geography) =>
      geographyText(geography, language),
    ),
  ].filter((line): line is string => line !== null);
  if (facts.length) lines.push(facts.join("\n"));
  lines.push(serverText("brainServer.pages.version", { version: config.version }));
  return lines.join("\n\n");
}

function inPractice(data: PageData): string {
  return bullets(
    (data.decisions ?? []).map((row) =>
      serverText("brainServer.pages.inPractice", {
        label: label("decisions", row.kind),
        total: row.total,
        lastYear: row.lastYear,
      }),
    ),
  );
}

function lessons(data: PageData): string {
  const groups = new Map<string, string[]>();
  for (const lesson of data.lessons ?? []) {
    const list = groups.get(lesson.section) ?? [];
    list.push(`- ${lesson.shortId}: ${lesson.text}`);
    groups.set(lesson.section, list);
  }
  return [...groups.entries()]
    .map(([section, lines]) => `**${label("lessonSections", section)}**\n${lines.join("\n")}`)
    .join("\n\n");
}

function brainStats(data: PageData): string {
  const stats = data.stats ?? {};
  const rows = [
    "episodes",
    "facts",
    "companies",
    "people",
    "cases",
    "decisions",
    "pages",
    "lessons",
    "openInsights",
  ] as const;
  return bullets(
    rows
      .filter((key) => typeof stats[key] === "number")
      .map((key) => `${serverText(`brainServer.pages.stats.${key}`)}: ${number(stats[key]!)}`),
  );
}

const COMPUTED: Partial<Record<string, (data: PageData, facts: PageFact[]) => string>> = {
  our_history: (data) => companyHistory(data),
  key_metrics: (_, facts) => metrics(facts),
  funding: (_, facts) => factLines(facts, ["raised_round", "valued_at", "invested_in"], 10),
  contradictions: (data) => bullets((data.contradictions ?? []).map((item) => item.title)),
  timeline: (_, facts) => timeline(facts),
  roles: (_, facts) =>
    factLines(
      facts,
      ["has_role", "works_at", "previously_at", "founded_by", "board_member_of"],
      15,
    ),
  connections: (data) => connections(data),
  status_history: (data) => statusHistory(data),
  analysis: (data) => analysis(data),
  our_cases: (data) => ourCases(data),
  players: (data) => bullets((data.players ?? []).map((player) => player.name)),
  co_investments: (_, facts) => factLines(facts, ["co_invested_with", "invested_in"], 20),
  stated: (data) => stated(data),
  in_practice: (data) => inPractice(data),
  lessons: (data) => lessons(data),
  brain_stats: (data) => brainStats(data),
};

/** The computed sections of a page that have something to show, in page order. */
export function computedSections(
  kind: PageKind,
  data: PageData,
): Array<{ key: string; heading: string; body_md: string }> {
  const facts = data.facts ?? [];
  const out: Array<{ key: string; heading: string; body_md: string }> = [];
  for (const spec of PAGE_SECTIONS[kind]) {
    if (!spec.computed) continue;
    const body = COMPUTED[spec.key]?.(data, facts).trim() ?? "";
    if (body) out.push({ key: spec.key, heading: spec.heading, body_md: body });
  }
  return out;
}

// --- Fact references and the page writer ---------------------------------------------

const REF = /\[f:([^\]\s]+)\]/g;

/** The fact ids a text cites. */
export function citedIds(body: string): string[] {
  return [...new Set([...body.matchAll(REF)].map((match) => match[1]!))];
}

/** Abbreviations a full stop does not end a sentence after (Danish and English). */
const ABBREVIATIONS = new Set([
  "mio",
  "mia",
  "mill",
  "ca",
  "bl.a",
  "f.eks",
  "fx",
  "dr",
  "jf",
  "kr",
  "nr",
  "inkl",
  "ekskl",
  "evt",
  "osv",
  "mht",
  "pga",
  "vedr",
  "hr",
  "fr",
  "st",
  "tlf",
  "dvs",
  "ift",
  "iht",
  "mr",
  "mrs",
  "ms",
  "inc",
  "ltd",
  "co",
  "vs",
  "e.g",
  "i.e",
  "etc",
  "aps",
  "a/s",
]);

/** Splits one line into sentences, keeping a reference written after the full stop with it. */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  const end = /[.!?](?:\s*\[f:[^\]\s]+\])*\s+(?=[A-ZÆØÅ0-9"*(])/g;
  let from = 0;
  for (const match of text.matchAll(end)) {
    const stop = match.index!;
    const word = /([\p{L}./]+)$/u.exec(text.slice(from, stop))?.[1]?.toLowerCase() ?? "";
    // "2,1 mio. EUR" or "bl.a. Novo": an abbreviation, not the end of a sentence.
    if (text[stop] === "." && ABBREVIATIONS.has(word.replace(/^\./, ""))) continue;
    const cut = stop + match[0].trimEnd().length;
    out.push(text.slice(from, cut));
    from = cut + (match[0].length - match[0].trimEnd().length);
  }
  out.push(text.slice(from));
  return out.filter((sentence) => sentence.trim() !== "");
}

/** A line that only names what follows (a heading, "Kunder:"), allowed without a reference. */
function headingLike(text: string): boolean {
  const line = text.trim();
  return (
    /^#{1,6}\s/.test(line) ||
    /^\*\*[^*]+\*\*:?$/.test(line) ||
    (line.length <= 60 && line.endsWith(":"))
  );
}

/**
 * The writer's way of writing a reference, made exact: "[f: F3]", "[F3]" and "[f:F3, F7]" become
 * "[f:F3]" and "[f:F3] [f:F7]", so every reference is checked.
 */
export function normalizeRefs(text: string): string {
  return text
    .replace(/\[(F\d+(?:\s*,\s*F\d+)*)\]/g, (_, list: string) => `[f:${list}]`)
    .replace(/\[f:\s*([^\]]*?)\s*\]/g, (_, list: string) =>
      list
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map((ref) => `[f:${ref.replace(/^f:/, "")}]`)
        .join(" "),
    );
}

/**
 * Removes every sentence that cites a reference `map` rejects, and rewrites the ones it maps.
 * With `requireRef` (the writer's output) a sentence without any reference goes too, unless the
 * line only names what follows. A list marker ("- ", "1. ") stays with its line's first sentence.
 * Returns the text and how many sentences went.
 */
export function rewriteRefs(
  body: string,
  map: (ref: string) => string | null,
  options: { requireRef?: boolean } = {},
): { body: string; removed: number } {
  let removed = 0;
  const original = body.split("\n");
  const lines = original.map((line) => {
    const marker = /^(\s*(?:[-*]|\d+[.)])\s+)/.exec(line)?.[1] ?? "";
    const rest = line.slice(marker.length);
    if (options.requireRef && headingLike(rest) && !rest.includes("[f:")) return line;
    const kept = sentencesOf(rest).filter((sentence) => {
      const refs = [...sentence.matchAll(REF)];
      const ok =
        refs.every((match) => map(match[1]!) !== null) && (!options.requireRef || refs.length > 0);
      if (!ok) removed += 1;
      return ok;
    });
    if (kept.length === 0) return "";
    return (
      marker +
      kept.map((sentence) => sentence.replace(REF, (_, id: string) => `[f:${map(id)}]`)).join(" ")
    );
  });
  // A line emptied by the removal goes; empty lines (paragraph breaks) stay.
  const text = lines
    .filter((line, index) => line.trim() !== "" || original[index]!.trim() === "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body: text, removed };
}

/** Short references F1, F2 … for the facts the writer sees, so it never copies a uuid. */
export function factRefs(facts: readonly { id: string }[]): {
  refOf: Map<string, string>;
  idOf: Map<string, string>;
} {
  const refOf = new Map<string, string>();
  const idOf = new Map<string, string>();
  for (const fact of facts) {
    if (refOf.has(fact.id)) continue;
    const label = `F${refOf.size + 1}`;
    refOf.set(fact.id, label);
    idOf.set(label, fact.id);
  }
  return { refOf, idOf };
}

export const PAGE_OP_KINDS = ["upsert_section", "append_line", "mark_outdated"] as const;
export const MAX_PAGE_OPS = 8;
/** A written section's length (06 L4: body_md up to 2500 characters; the prompt asks for 1200). */
export const MAX_SECTION_CHARS = 2_500;
const MAX_LINE_CHARS = 400;

/** 06 L4 PageOps, flattened for structured output: text is body_md or line_md. */
export const pageOpsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          op: { type: "string", enum: [...PAGE_OP_KINDS] },
          key: { type: "string" },
          heading: { type: "string" },
          text: { type: "string" },
          factRefs: { type: "array", items: { type: "string" } },
        },
        required: ["op", "key", "heading", "text", "factRefs"],
      },
    },
  },
  required: ["ops"],
} as const;

/** Text over the limit is cut at the last full sentence before it, never dropped whole. */
export function clipText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const head = trimmed.slice(0, max);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("]."), head.lastIndexOf("\n"));
  return (cut > 0 ? head.slice(0, cut + 1) : head).trim();
}

const pageOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert_section"),
    key: z.string(),
    text: z.string().transform((text) => clipText(text, MAX_SECTION_CHARS)),
  }),
  z.object({
    op: z.literal("append_line"),
    key: z.string(),
    text: z
      .string()
      .transform((text) => clipText(text, MAX_LINE_CHARS))
      .refine((text) => text.length > 0),
  }),
  z.object({
    op: z.literal("mark_outdated"),
    key: z.string(),
    // "F3", "[f:F3]" or "f:F3" all name F3.
    factRefs: z
      .array(z.string())
      .transform((refs) => refs.map((ref) => ref.replace(/^\[?(?:f:)?\s*|\s*\]$/g, ""))),
  }),
]);
export type PageOp = z.infer<typeof pageOp>;

/** The writer's operations, at most MAX_PAGE_OPS; invalid ones are dropped and counted. */
export function parsePageOps(raw: unknown): { ops: PageOp[]; invalid: number } {
  const rows = z.object({ ops: z.array(z.unknown()) }).safeParse(raw);
  if (!rows.success) return { ops: [], invalid: 1 };
  const ops: PageOp[] = [];
  let invalid = 0;
  for (const row of rows.data.ops) {
    const parsed = pageOp.safeParse(row);
    if (parsed.success && ops.length < MAX_PAGE_OPS) ops.push(parsed.data);
    else invalid += 1;
  }
  return { ops, invalid };
}

export type WrittenSection = { heading: string; body: string };

/**
 * Applies the writer's operations to the written sections (in reference space F1 …). Only the
 * writable keys change; a locked section is never touched (the database refuses it too, 0062).
 * The heading is always the section's own; an empty rewrite is ignored (the text stays).
 */
export function applyPageOps(
  sections: ReadonlyMap<string, WrittenSection>,
  ops: readonly PageOp[],
  writable: ReadonlySet<string>,
  locked: ReadonlySet<string>,
  headingOf: (key: string) => string,
): { sections: Map<string, WrittenSection>; applied: number; ignored: number } {
  const next = new Map(sections);
  let applied = 0;
  let ignored = 0;
  for (const op of ops) {
    if (!writable.has(op.key) || locked.has(op.key)) {
      ignored += 1;
      continue;
    }
    const current = next.get(op.key);
    const heading = headingOf(op.key);
    if (op.op === "upsert_section") {
      if (!op.text) {
        ignored += 1;
        continue;
      }
      next.set(op.key, { heading, body: op.text });
    } else if (op.op === "append_line") {
      next.set(op.key, { heading, body: current?.body ? `${current.body}\n${op.text}` : op.text });
    } else {
      const outdated = new Set(op.factRefs);
      if (!current || ![...current.body.matchAll(REF)].some((m) => outdated.has(m[1]!))) {
        ignored += 1;
        continue;
      }
      next.set(op.key, {
        heading,
        body: rewriteRefs(current.body, (id) => (outdated.has(id) ? null : id)).body,
      });
    }
    applied += 1;
  }
  return { sections: next, applied, ignored };
}

/**
 * The writer's sections back in fact ids: references are made exact, a sentence whose reference
 * is not in the list or that has none goes, and a section the check would empty keeps its text
 * from before the writer (so a bad rewrite never deletes good text).
 */
export function writerSectionsToIds(
  before: ReadonlyMap<string, WrittenSection>,
  after: ReadonlyMap<string, WrittenSection>,
  idOf: ReadonlyMap<string, string>,
): { sections: Map<string, WrittenSection>; removed: number } {
  const out = new Map(before);
  let removed = 0;
  for (const [key, section] of after) {
    if (before.get(key) === section) continue;
    const checked = rewriteRefs(normalizeRefs(section.body), (ref) => idOf.get(ref) ?? null, {
      requireRef: true,
    });
    removed += checked.removed;
    if (checked.body) out.set(key, { heading: section.heading, body: checked.body });
  }
  return { sections: out, removed };
}

/**
 * The page as it is stored: the kind's sections in order, a locked section exactly as it was,
 * and updated_at kept where nothing changed (so an unchanged night writes no new version).
 */
export function assemblePage(
  kind: PageKind,
  current: readonly PageSection[],
  computed: ReadonlyArray<{ key: string; heading: string; body_md: string }>,
  written: ReadonlyMap<string, WrittenSection>,
  now: string,
): PageSection[] {
  // A repeated key keeps the locked copy, so a lock is never lost.
  const byKey = new Map<string, PageSection>();
  for (const section of current) {
    if (!byKey.get(section.key)?.locked_by_user) byKey.set(section.key, section);
  }
  const computedByKey = new Map(computed.map((section) => [section.key, section]));
  const out: PageSection[] = [];
  const build = (key: string, heading: string, body: string, isComputed: boolean): PageSection => {
    const old = byKey.get(key);
    const same = old && old.body_md === body && old.heading === heading;
    return {
      key,
      heading,
      body_md: body,
      fact_ids: citedIds(body),
      updated_at: same ? old.updated_at : now,
      locked_by_user: false,
      ...(isComputed ? { computed: true } : {}),
    };
  };
  for (const spec of PAGE_SECTIONS[kind]) {
    const old = byKey.get(spec.key);
    if (old?.locked_by_user) {
      out.push(old);
      continue;
    }
    if (spec.computed) {
      const section = computedByKey.get(spec.key);
      if (section) out.push(build(spec.key, section.heading, section.body_md, true));
    } else {
      const section = written.get(spec.key);
      if (section && section.body.trim()) {
        out.push(build(spec.key, spec.heading, section.body.trim(), false));
      }
    }
  }
  // A locked section under a key the kind no longer has stays, so the page never loses it.
  for (const section of byKey.values()) {
    if (section.locked_by_user && !out.some((item) => item.key === section.key)) out.push(section);
  }
  return out;
}

/**
 * What the writer would be asked, as a hash: model, prompt, writable sections and the facts with
 * their ids, times and statements. The same hash as the page's stored one means nothing new for
 * the writer, so the paid call is skipped (06 L4 "input-hash"). The section texts are left out:
 * only the writer or a user changes them, and a user's change locks the section (a writable key
 * less).
 */
export function writerInputHash(input: {
  model: string;
  system: string;
  writable: readonly string[];
  facts: ReadonlyArray<Pick<PageFact, "id" | "recordedAt" | "statement">>;
}): string {
  const hash = createHash("sha256");
  hash.update(`${input.model}\n${input.system}\n${input.writable.join(",")}\n`);
  for (const fact of input.facts) hash.update(`${fact.id}|${fact.recordedAt}|${fact.statement}\n`);
  return hash.digest("hex");
}

/** The page's text for search_fts: headings and bodies without fact references. */
export function pageSearchText(sections: readonly PageSection[]): string {
  return sections
    .map((section) => `${section.heading}\n${section.body_md.replace(REF, "")}`)
    .join("\n\n")
    .slice(0, 200_000);
}

/**
 * The facts the page writer gets. `has_case` ("X har en case hos teamet") is left out: the
 * page says so by itself, and the writer only repeated it. A sentence that already cites it
 * stays until the writer rewrites its section.
 */
export function writerFacts<T extends Pick<PageFact, "predicate">>(facts: readonly T[]): T[] {
  return facts.filter((fact) => fact.predicate !== "has_case");
}

/** The page writer's input: the page, its writable sections and the facts with references. */
export function pageWriterPrompt(input: {
  kind: PageKind;
  title: string;
  writable: readonly string[];
  sections: ReadonlyMap<string, WrittenSection>;
  facts: ReadonlyArray<PageFact & { ref: string; isNew: boolean }>;
}): string {
  const writable = input.writable
    .map((key) => `${key} (${headingFor(input.kind, key)})`)
    .join(", ");
  const sections = input.writable
    .map((key) => {
      const section = input.sections.get(key);
      return `## ${key} · ${section?.heading ?? headingFor(input.kind, key)}\n${section?.body.trim() || "(tom)"}`;
    })
    .join("\n\n");
  const facts = input.facts
    .map((fact) => {
      const meta = [periodLabel(fact.validFrom, fact.validTo), label("trust", fact.trust)]
        .filter(Boolean)
        .join(", ");
      const decision = fact.predicate === "decided" ? " BESLUTNING:" : "";
      return `${fact.ref}${fact.isNew ? " [NY]" : ""}${decision} ${fact.statement}${meta ? ` (${meta})` : ""}`;
    })
    .join("\n");
  // i18n-keep: prompt to the page writer; an English fund gets the language rule.
  return `Side: ${input.kind} "${input.title}"
Skrivbare sektioner: ${writable}

Nuværende sektioner:
${sections}

Fakta (nyeste først; NY = kommet til, siden siden sidst blev skrevet):
${facts || "(ingen)"}`;
}
