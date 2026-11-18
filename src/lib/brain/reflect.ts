/**
 * L2 · Reflektér over beslutningen (L2, ACE): what the reflector and the
 * curator get and may answer, the evidence rule, and how their answers become the delta
 * operations that brain_apply_reflection (0075) merges. A language model never rewrites the
 * playbook: it names candidates and existing lessons by label, and the code decides what is
 * written. No I/O here, so it is tested with node --test; the loop is loops/reflect.ts.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

/** The job key of one reflection: "decision:<case_transition_events.id>". */
export const REFLECT_KEY_PREFIX = "decision:";
/** L0 queues the reflection this late, so an undo ("Fortryd") right after a move wins. */
export const REFLECT_DELAY_SECONDS = 15 * 60;
/** Only decisions this recent are reflected on by L0; older ones are history (no surprise cost). */
export const REFLECT_WINDOW_DAYS = 14;
/** 06 L2: the same lesson exists when the cosine is at least this. */
export const CORROBORATE_MIN_COSINE = 0.88;
/** Existing lessons shown to the curator per candidate. */
export const NEIGHBORS_PER_CANDIDATE = 3;
/** 06 L2 "Loft: 0,50 kr. pr. beslutning"; the rate itself is ai_settings.brain_dkk_per_decision. */
export const DEFAULT_DKK_PER_DECISION = 0.5;
export const DEFAULT_USD_TO_DKK = 6.9;

export const REFLECTED_KINDS = ["reject", "decline_ic", "invest", "hold"] as const;
export type ReflectedKind = (typeof REFLECTED_KINDS)[number];

export const BULLET_SECTIONS = [
  "strategies",
  "red_flags",
  "green_flags",
  "questions_to_ask",
  "sector_notes",
  "process",
  "common_mistakes",
] as const;
export type BulletSection = (typeof BULLET_SECTIONS)[number];

export const AGREEMENTS = [
  "aligned",
  "team_stricter",
  "team_more_positive",
  "different_reason",
] as const;
export type Agreement = (typeof AGREEMENTS)[number];

/** 06 L2 evidence rule step 2: a company's claim, the open web or a user's note proves nothing. */
const UNTRUSTED_TIERS = new Set(["company_claim", "public_web", "user_note"]);

const MAX_CANDIDATES = 3;
const MAX_FEEDBACK = 15;
const MAX_OPS = 12;
const MAX_LESSON_CHARS = 500;
const MAX_INSIGHT_CHARS = 600;
const MAX_WHY_CHARS = 300;
const MAX_SCOPE_VALUES = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function reflectKey(eventId: string): string {
  if (!UUID.test(eventId)) throw new Error("reflectKey: event id must be a uuid");
  return `${REFLECT_KEY_PREFIX}${eventId.toLowerCase()}`;
}

export function parseReflectKey(key: string): string | null {
  if (!key.startsWith(REFLECT_KEY_PREFIX)) return null;
  const id = key.slice(REFLECT_KEY_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

/** The most one reflection may cost (both calls and the embeddings), in USD. */
export function reflectionCapUsd(
  settings: { dkkPerDecision: number | null; usdToDkk: number | null } | null,
): number {
  const dkk = settings?.dkkPerDecision ?? DEFAULT_DKK_PER_DECISION;
  const rate = settings?.usdToDkk ?? DEFAULT_USD_TO_DKK;
  if (!Number.isFinite(dkk) || dkk <= 0 || !Number.isFinite(rate) || rate <= 0) return 0;
  return dkk / rate;
}

// ---------------------------------------------------------------------------------------------
// Input (brain_reflection_input, 0075)
// ---------------------------------------------------------------------------------------------

export type InputLesson = {
  id: string;
  shortId: string;
  section: string;
  text: string;
  status: string;
  helpful: number;
  harmful: number;
};

export type InputEpisode = { episodeId: string; content: string; trust: string };

export type InputDecision = {
  id: string;
  caseId: string | null;
  kind: string;
  occurredAt: string | null;
  actorType: string | null;
  actorId: string | null;
  reasonCodes: string[];
  reasons: string[];
  reasonText: string | null;
};

export type ReflectionInput = {
  decision: InputDecision & { standing: boolean; fromPhase: string | null };
  company: {
    name: string;
    sector: string | null;
    stage: string | null;
    geography: string | null;
  } | null;
  analysis: {
    runId: string;
    kind: string | null;
    episodeId: string | null;
    content: string | null;
    trust: string | null;
  } | null;
  findings: InputEpisode[];
  risks: InputEpisode[];
  contextLessons: InputLesson[];
  relevantLessons: InputLesson[];
  similarDecisions: Array<InputDecision & { company: string | null; cosine: number | null }>;
};

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];

function parseDecision(row: Record<string, unknown>): InputDecision | null {
  const id = str(row["id"]);
  const kind = str(row["kind"]);
  if (!id || !kind) return null;
  return {
    id,
    caseId: str(row["caseId"]),
    kind,
    occurredAt: str(row["occurredAt"]) ?? str(row["decidedAt"]),
    actorType: str(row["actorType"]),
    actorId: str(row["actorId"]),
    reasonCodes: strings(row["reasonCodes"]),
    reasons: strings(row["reasons"]),
    reasonText: str(row["reasonText"]),
  };
}

function parseLessons(value: unknown): InputLesson[] {
  return rows(value).flatMap((row) => {
    const id = str(row["id"]);
    const shortId = str(row["shortId"]);
    const text = str(row["text"]);
    if (!id || !shortId || !text) return [];
    return [
      {
        id,
        shortId,
        section: str(row["section"]) ?? "",
        text,
        status: str(row["status"]) ?? "",
        helpful: Number(row["helpful"] ?? 0) || 0,
        harmful: Number(row["harmful"] ?? 0) || 0,
      },
    ];
  });
}

function parseEpisodes(value: unknown): InputEpisode[] {
  return rows(value).flatMap((row) => {
    const episodeId = str(row["episodeId"]);
    const content = str(row["content"]);
    if (!episodeId || !content) return [];
    return [{ episodeId, content, trust: str(row["trust"]) ?? "analysis" }];
  });
}

export function parseReflectionInput(raw: unknown): ReflectionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const decisionRow = (data["decision"] ?? null) as Record<string, unknown> | null;
  const decision = decisionRow ? parseDecision(decisionRow) : null;
  if (!decision || !decisionRow) return null;
  const company = (data["company"] ?? null) as Record<string, unknown> | null;
  const analysis = (data["analysis"] ?? null) as Record<string, unknown> | null;
  return {
    decision: {
      ...decision,
      standing: decisionRow["standing"] === true,
      fromPhase: str(decisionRow["fromPhase"]),
    },
    company:
      company && str(company["name"])
        ? {
            name: str(company["name"])!,
            sector: str(company["sector"]),
            stage: str(company["stage"]),
            geography: str(company["geography"]),
          }
        : null,
    analysis:
      analysis && str(analysis["runId"])
        ? {
            runId: str(analysis["runId"])!,
            kind: str(analysis["kind"]),
            episodeId: str(analysis["episodeId"]),
            content: str(analysis["content"]),
            trust: str(analysis["trust"]),
          }
        : null,
    findings: parseEpisodes(data["findings"]),
    risks: parseEpisodes(data["risks"]),
    contextLessons: parseLessons(data["contextLessons"]),
    relevantLessons: parseLessons(data["relevantLessons"]),
    similarDecisions: rows(data["similarDecisions"]).flatMap((row) => {
      const parsed = parseDecision(row);
      if (!parsed) return [];
      const cosine =
        row["cosine"] === null || row["cosine"] === undefined ? null : Number(row["cosine"]);
      return [
        {
          ...parsed,
          company: str(row["company"]),
          cosine: Number.isFinite(cosine) ? cosine : null,
        },
      ];
    }),
  };
}

/** Made by a person (not an automatic move) and with the team's own reason codes. */
export function isAnchorDecision(decision: InputDecision): boolean {
  return decision.actorType === "user" && !!decision.actorId && decision.reasonCodes.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Labels: the models see D1, E3, pb-00042 and C1, never a uuid
// ---------------------------------------------------------------------------------------------

export type EvidenceRef = { kind: "decision" | "episode"; id: string };

type RefTarget = EvidenceRef & { trust: string | null; anchor: boolean; current: boolean };

export type ReflectionRefs = {
  /** D1 (this decision), D2 … (similar decisions), E1 … (the analysis' episodes). */
  refs: ReadonlyMap<string, RefTarget>;
  /** pb-00042 → the lesson; only the lessons the reflector was shown. */
  lessons: ReadonlyMap<string, InputLesson>;
  episodeLabels: ReadonlyMap<string, string>;
};

export function reflectionRefs(input: ReflectionInput): ReflectionRefs {
  const refs = new Map<string, RefTarget>();
  refs.set("D1", {
    kind: "decision",
    id: input.decision.id,
    trust: "partner",
    anchor: isAnchorDecision(input.decision),
    current: true,
  });
  input.similarDecisions.forEach((decision, index) => {
    refs.set(`D${index + 2}`, {
      kind: "decision",
      id: decision.id,
      trust: "partner",
      anchor: isAnchorDecision(decision),
      current: false,
    });
  });
  const episodeLabels = new Map<string, string>();
  const episodes = [
    ...(input.analysis?.episodeId
      ? [{ episodeId: input.analysis.episodeId, trust: input.analysis.trust ?? "analysis" }]
      : []),
    ...input.findings,
    ...input.risks,
  ];
  for (const episode of episodes) {
    if (episodeLabels.has(episode.episodeId)) continue;
    const label = `E${episodeLabels.size + 1}`;
    episodeLabels.set(episode.episodeId, label);
    refs.set(label, {
      kind: "episode",
      id: episode.episodeId,
      trust: episode.trust,
      anchor: false,
      current: false,
    });
  }
  const lessons = new Map<string, InputLesson>();
  for (const lesson of [...input.contextLessons, ...input.relevantLessons]) {
    if (!lessons.has(lesson.shortId)) lessons.set(lesson.shortId, lesson);
  }
  return { refs, lessons, episodeLabels };
}

/** "D1", "[D1]", "d1 " → "D1"; "pb-42" stays as written. */
export function normalizeRef(ref: string): string {
  return ref
    .trim()
    .replace(/^\[|\]$/g, "")
    .trim()
    .toUpperCase();
}

export type EvidenceCheck =
  | { ok: true; evidence: EvidenceRef[]; dropped: string[] }
  | { ok: false; reason: "no_anchor"; dropped: string[] };

/**
 * The evidence rule (06 L2), before every ADD and CORROBORATE:
 *   1. every ref must be one L2 gave the model; others are dropped;
 *   2. refs to episodes with trust company_claim, public_web or user_note are dropped;
 *   3. this decision (D1) must be among the rest and be a person's with reason codes: the lesson
 *      rests on the team's own reasons, and the confirmation it gives is counted for this
 *      decision's user and case;
 *   4. otherwise the operation is rejected.
 */
export function checkEvidence(refStrings: readonly string[], refs: ReflectionRefs): EvidenceCheck {
  const dropped: string[] = [];
  const kept = new Map<string, RefTarget>();
  for (const raw of refStrings) {
    const label = normalizeRef(raw);
    const target = refs.refs.get(label);
    if (!target) {
      dropped.push(raw);
      continue;
    }
    if (target.trust && UNTRUSTED_TIERS.has(target.trust)) {
      dropped.push(label);
      continue;
    }
    kept.set(label, target);
  }
  const current = [...kept.values()].find((target) => target.current);
  if (!current || !current.anchor) return { ok: false, reason: "no_anchor", dropped };
  // The current decision first: it is what the lesson rests on.
  const evidence = [...kept.values()]
    .sort((a, b) => Number(b.current) - Number(a.current))
    .map(({ kind, id }) => ({ kind, id }));
  return { ok: true, evidence, dropped };
}

// ---------------------------------------------------------------------------------------------
// Reflector
// ---------------------------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  reject: "Kasseret",
  decline_ic: "Afvist i komitéen",
  invest: "Investeret",
  hold: "Sat på hold",
};
const PHASE_LABEL: Record<string, string> = {
  screening: "screening",
  deep_analysis: "dyb analyse",
  committee: "komité",
  decided: "besluttet",
};
const TRUST_LABEL: Record<string, string> = {
  company_claim: "selskabets påstand",
  analysis: "analyse",
  official: "officiel kilde",
  third_party: "tredjepart",
  partner: "teamet",
  customer_doc: "investeringsteamets dokument",
  user_note: "brugernote",
  public_web: "nettet",
};
const SECTION_LABEL: Record<string, string> = {
  strategies: "strategi",
  red_flags: "rødt flag",
  green_flags: "grønt flag",
  questions_to_ask: "spørgsmål at stille",
  sector_notes: "sektornote",
  process: "proces",
  common_mistakes: "typisk fejl",
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "ukendt dato");
const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

function decisionLine(decision: InputDecision): string {
  const reasons = decision.reasons.length > 0 ? decision.reasons.join(", ") : "ingen angivet";
  const who = decision.actorType === "user" ? "truffet af en bruger" : "automatisk flytning";
  return [
    `${KIND_LABEL[decision.kind] ?? decision.kind} ${day(decision.occurredAt)} (${who}).`,
    `Årsager: ${reasons}.`,
    decision.reasonText ? `Begrundelse: ${oneLine(decision.reasonText, 600)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function lessonLine(lesson: InputLesson): string {
  const status = lesson.status === "active" ? "aktiv" : "kandidat";
  return `${lesson.shortId} (${status}, ${SECTION_LABEL[lesson.section] ?? lesson.section}, for ${lesson.helpful}/imod ${lesson.harmful}): ${oneLine(lesson.text, 500)}`;
}

/** The reflector's task text (the system prompt is prompts/reflector.ts). */
export function reflectorPrompt(input: ReflectionInput, refs: ReflectionRefs): string {
  const { decision, company } = input;
  const lines: string[] = [];
  const phase = decision.fromPhase
    ? ` i ${PHASE_LABEL[decision.fromPhase] ?? decision.fromPhase}`
    : "";
  lines.push(`Beslutning D1${phase}: ${decisionLine(decision)}`);
  if (company) {
    lines.push(
      `Selskab: ${company.name} · sektor ${company.sector ?? "ukendt"} · stadie ${company.stage ?? "ukendt"} · geografi ${company.geography ?? "ukendt"}`,
    );
  }
  lines.push("");
  const episode = (item: { episodeId: string; content: string; trust: string }) =>
    `${refs.episodeLabels.get(item.episodeId)} [${TRUST_LABEL[item.trust] ?? item.trust}]: ${oneLine(item.content, 900)}`;
  if (input.analysis) {
    const kind = input.analysis.kind === "deep" ? "dyb analyse" : "screening";
    lines.push(`Analysen før beslutningen (${kind}):`);
    if (input.analysis.episodeId && input.analysis.content) {
      lines.push(
        episode({
          episodeId: input.analysis.episodeId,
          content: input.analysis.content,
          trust: input.analysis.trust ?? "analysis",
        }),
      );
    }
    if (input.findings.length > 0) lines.push("Fund:", ...input.findings.map(episode));
    if (input.risks.length > 0) lines.push("Risici:", ...input.risks.map(episode));
  } else {
    lines.push("Ingen færdig analyse før beslutningen.");
  }
  lines.push("");
  lines.push("Lektioner, analysen havde med:");
  lines.push(
    ...(input.contextLessons.length > 0 ? input.contextLessons.map(lessonLine) : ["(ingen)"]),
  );
  lines.push("Andre relevante lektioner i teamets playbook:");
  lines.push(
    ...(input.relevantLessons.length > 0 ? input.relevantLessons.map(lessonLine) : ["(ingen)"]),
  );
  lines.push("");
  lines.push("Lignende tidligere beslutninger:");
  if (input.similarDecisions.length === 0) lines.push("(ingen)");
  input.similarDecisions.forEach((similar, index) => {
    lines.push(`D${index + 2} ${similar.company ?? "Ukendt selskab"}: ${decisionLine(similar)}`);
  });
  return lines.join("\n");
}

/** Flat and strict, like the other Brain contracts (structured outputs). */
export const reflectionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    agreement: { type: "string", enum: [...AGREEMENTS] },
    keyInsight: { type: "string" },
    bulletFeedback: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          lesson: { type: "string" },
          tag: { type: "string", enum: ["helpful", "harmful", "neutral"] },
          why: { type: "string" },
        },
        required: ["lesson", "tag", "why"],
      },
    },
    candidateLessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          section: { type: "string", enum: [...BULLET_SECTIONS] },
          text: { type: "string" },
          sectors: { type: "array", items: { type: "string" } },
          stages: { type: "array", items: { type: "string" } },
          geographies: { type: "array", items: { type: "string" } },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: ["section", "text", "sectors", "stages", "geographies", "evidence"],
      },
    },
  },
  required: ["agreement", "keyInsight", "bulletFeedback", "candidateLessons"],
} as const;

export type Scope = { sectors?: string[]; stages?: string[]; geographies?: string[] };

export type CandidateLesson = {
  section: BulletSection;
  text: string;
  scope: Scope;
  evidence: string[];
};

export type Reflection = {
  agreement: Agreement;
  keyInsight: string;
  bulletFeedback: Array<{ lesson: string; tag: "helpful" | "harmful" | "neutral"; why: string }>;
  candidateLessons: CandidateLesson[];
};

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

function scopeList(values: readonly string[]): string[] | undefined {
  const out = [
    ...new Set(values.map((value) => clip(value, 60)).filter((value) => value.length > 0)),
  ].slice(0, MAX_SCOPE_VALUES);
  return out.length > 0 ? out : undefined;
}

export function normalizeScope(scope: {
  sectors?: readonly string[];
  stages?: readonly string[];
  geographies?: readonly string[];
}): Scope {
  const out: Scope = {};
  const sectors = scopeList(scope.sectors ?? []);
  const stages = scopeList(scope.stages ?? []);
  const geographies = scopeList(scope.geographies ?? []);
  if (sectors) out.sectors = sectors;
  if (stages) out.stages = stages;
  if (geographies) out.geographies = geographies;
  return out;
}

const feedbackItem = z.object({
  lesson: z.string(),
  tag: z.enum(["helpful", "harmful", "neutral"]),
  why: z.string(),
});
const scopeValues = z.array(z.string()).default([]);
const candidateItem = z.object({
  section: z.enum(BULLET_SECTIONS),
  text: z.string(),
  sectors: scopeValues,
  stages: scopeValues,
  geographies: scopeValues,
  // A parsed reflection read back from its job step holds the scope as one object.
  scope: z
    .object({ sectors: scopeValues, stages: scopeValues, geographies: scopeValues })
    .partial()
    .optional(),
  evidence: z.array(z.string()).default([]),
});

/** The reflector's answer; invalid items are dropped, texts clipped, counts capped. */
export function parseReflection(raw: unknown): Reflection | null {
  const base = z
    .object({
      agreement: z.enum(AGREEMENTS),
      keyInsight: z.string(),
      bulletFeedback: z.array(z.unknown()).default([]),
      candidateLessons: z.array(z.unknown()).default([]),
    })
    .safeParse(raw);
  if (!base.success) return null;
  const bulletFeedback = base.data.bulletFeedback.flatMap((item) => {
    const parsed = feedbackItem.safeParse(item);
    return parsed.success
      ? [
          {
            lesson: parsed.data.lesson.trim().toLowerCase(),
            tag: parsed.data.tag,
            why: clip(parsed.data.why, MAX_WHY_CHARS),
          },
        ]
      : [];
  });
  const candidateLessons = base.data.candidateLessons.flatMap((item) => {
    const parsed = candidateItem.safeParse(item);
    if (!parsed.success) return [];
    const text = clip(parsed.data.text, MAX_LESSON_CHARS);
    if (text.length < 10) return [];
    return [
      {
        section: parsed.data.section,
        text,
        scope: normalizeScope({
          sectors: [...parsed.data.sectors, ...(parsed.data.scope?.sectors ?? [])],
          stages: [...parsed.data.stages, ...(parsed.data.scope?.stages ?? [])],
          geographies: [...parsed.data.geographies, ...(parsed.data.scope?.geographies ?? [])],
        }),
        evidence: parsed.data.evidence.slice(0, 10),
      },
    ];
  });
  return {
    agreement: base.data.agreement,
    keyInsight: clip(base.data.keyInsight, MAX_INSIGHT_CHARS),
    bulletFeedback: bulletFeedback.slice(0, MAX_FEEDBACK),
    candidateLessons: candidateLessons.slice(0, MAX_CANDIDATES),
  };
}

// ---------------------------------------------------------------------------------------------
// Curator
// ---------------------------------------------------------------------------------------------

export type Neighbor = {
  id: string;
  shortId: string;
  section: string;
  text: string;
  status: string;
  cosine: number;
};

export function parseNeighbors(raw: unknown, candidates: number): Neighbor[][] {
  const lists = Array.isArray(raw) ? raw : [];
  return Array.from({ length: candidates }, (_, index) =>
    rows(lists[index]).flatMap((row) => {
      const id = str(row["id"]);
      const shortId = str(row["shortId"]);
      const text = str(row["text"]);
      const cosine = Number(row["cosine"]);
      if (!id || !shortId || !text || !Number.isFinite(cosine)) return [];
      return [
        {
          id,
          shortId,
          section: str(row["section"]) ?? "",
          text,
          status: str(row["status"]) ?? "",
          cosine,
        },
      ];
    }),
  );
}

/** The curator's task text (the system prompt is prompts/curator.ts). */
export function curatorPrompt(input: {
  decision: InputDecision;
  candidates: readonly CandidateLesson[];
  neighbors: readonly Neighbor[][];
  feedback: Reflection["bulletFeedback"];
  lessons: ReadonlyMap<string, InputLesson>;
}): string {
  const lines: string[] = [`Beslutning D1: ${decisionLine(input.decision)}`, "", "Kandidater:"];
  input.candidates.forEach((candidate, index) => {
    const scope = [
      candidate.scope.sectors ? `sektor ${candidate.scope.sectors.join("/")}` : null,
      candidate.scope.stages ? `stadie ${candidate.scope.stages.join("/")}` : null,
      candidate.scope.geographies ? `geografi ${candidate.scope.geographies.join("/")}` : null,
    ].filter(Boolean);
    lines.push(
      `C${index + 1} (${SECTION_LABEL[candidate.section] ?? candidate.section}${scope.length ? `; ${scope.join(", ")}` : ""}): ${oneLine(candidate.text, MAX_LESSON_CHARS)}`,
    );
    const near = input.neighbors[index] ?? [];
    if (near.length === 0) lines.push("  Ingen eksisterende lektion ligner.");
    for (const neighbor of near) {
      const status = neighbor.status === "active" ? "aktiv" : "kandidat";
      lines.push(
        `  Ligner ${neighbor.shortId} (${status}, lighed ${neighbor.cosine.toFixed(2).replace(".", ",")}): ${oneLine(neighbor.text, MAX_LESSON_CHARS)}`,
      );
    }
  });
  const judged = input.feedback.filter(
    (item) => item.tag !== "neutral" && input.lessons.has(item.lesson),
  );
  lines.push("", "Reflectorens vurdering af lektionerne i konteksten:");
  if (judged.length === 0) lines.push("(ingen)");
  for (const item of judged) {
    const lesson = input.lessons.get(item.lesson)!;
    lines.push(
      `${item.lesson} ${item.tag === "helpful" ? "pegede mod beslutningen" : "pegede den anden vej"}: ${oneLine(lesson.text, 300)} (${oneLine(item.why, MAX_WHY_CHARS)})`,
    );
  }
  return lines.join("\n");
}

export const CURATOR_OP_KINDS = ["ADD", "CORROBORATE", "TAG"] as const;

export const curatorJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          op: { type: "string", enum: [...CURATOR_OP_KINDS] },
          candidate: { type: "string" },
          lesson: { type: "string" },
          tag: { type: "string", enum: ["helpful", "harmful", ""] },
          text: { type: "string" },
          why: { type: "string" },
        },
        required: ["op", "candidate", "lesson", "tag", "text", "why"],
      },
    },
  },
  required: ["ops"],
} as const;

export type CuratorOp = {
  op: (typeof CURATOR_OP_KINDS)[number];
  candidate: string;
  lesson: string;
  tag: "helpful" | "harmful" | "";
  text: string;
  why: string;
};

const curatorItem = z.object({
  op: z.enum(CURATOR_OP_KINDS),
  candidate: z.string().default(""),
  lesson: z.string().default(""),
  tag: z.enum(["helpful", "harmful", ""]).default(""),
  text: z.string().default(""),
  why: z.string().default(""),
});

export function parseCuratorOps(raw: unknown): { ops: CuratorOp[]; invalid: number } {
  const list = z.object({ ops: z.array(z.unknown()) }).safeParse(raw);
  if (!list.success) return { ops: [], invalid: 1 };
  const ops: CuratorOp[] = [];
  let invalid = 0;
  for (const item of list.data.ops) {
    const parsed = curatorItem.safeParse(item);
    if (parsed.success && ops.length < MAX_OPS) {
      ops.push({
        ...parsed.data,
        candidate: normalizeRef(parsed.data.candidate),
        lesson: parsed.data.lesson.trim().toLowerCase(),
      });
    } else invalid += 1;
  }
  return { ops, invalid };
}

// ---------------------------------------------------------------------------------------------
// Plan: from the models' answers to the operations the database merges
// ---------------------------------------------------------------------------------------------

export type PlannedOp =
  | {
      op: "ADD";
      id: string;
      section: BulletSection;
      text: string;
      scope: Scope;
      evidence: EvidenceRef[];
      embedding: number[] | null;
    }
  | { op: "CORROBORATE"; bulletId: string; evidence: EvidenceRef[] }
  | { op: "TAG"; bulletId: string; tag: "helpful" | "harmful"; why: string };

export type RejectedOp = { op: string; ref: string; reason: string };

/** The same decision and text always give the same lesson id, so a retry adds nothing new. */
export function lessonId(eventId: string, text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const hex = createHash("sha256")
    .update(`L2:${eventId.toLowerCase()}:${normalized}`)
    .digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Without a curator answer, the reflector's helpful/harmful verdicts are the only operations. */
export function tagsFromFeedback(
  feedback: Reflection["bulletFeedback"],
  lessons: ReadonlyMap<string, InputLesson>,
): PlannedOp[] {
  const seen = new Set<string>();
  const out: PlannedOp[] = [];
  for (const item of feedback) {
    const lesson = lessons.get(item.lesson);
    if (!lesson || item.tag === "neutral" || seen.has(lesson.id)) continue;
    seen.add(lesson.id);
    out.push({ op: "TAG", bulletId: lesson.id, tag: item.tag, why: item.why || "Beslutningen" });
    if (out.length >= MAX_OPS) break;
  }
  return out;
}

/**
 * The curator's operations, checked in code: a candidate is used once (ADD or CORROBORATE), a
 * CORROBORATE names one of the existing lessons shown for that candidate (cos ≥ 0,88), a TAG names
 * a lesson the reflector was shown, and every ADD and CORROBORATE passes the evidence rule with the
 * candidate's own refs (the curator cannot add refs). Everything else is rejected with a reason.
 */
export function planReflectionOps(input: {
  eventId: string;
  candidates: readonly CandidateLesson[];
  embeddings: readonly (number[] | null)[];
  neighbors: readonly Neighbor[][];
  curatorOps: readonly CuratorOp[];
  refs: ReflectionRefs;
}): { ops: PlannedOp[]; rejected: RejectedOp[] } {
  const ops: PlannedOp[] = [];
  const rejected: RejectedOp[] = [];
  const usedCandidates = new Set<number>();
  const tagged = new Set<string>();
  const lessonsById = new Set<string>();
  for (const op of input.curatorOps) {
    if (ops.length >= MAX_OPS) break;
    if (op.op === "TAG") {
      const lesson = input.refs.lessons.get(op.lesson);
      if (!lesson) {
        rejected.push({ op: op.op, ref: op.lesson, reason: "unknown_lesson" });
        continue;
      }
      if (op.tag === "" || tagged.has(lesson.id)) {
        rejected.push({ op: op.op, ref: op.lesson, reason: op.tag === "" ? "no_tag" : "repeated" });
        continue;
      }
      tagged.add(lesson.id);
      ops.push({
        op: "TAG",
        bulletId: lesson.id,
        tag: op.tag,
        why: clip(op.why, MAX_WHY_CHARS) || "Beslutningen",
      });
      continue;
    }
    const index = /^C(\d+)$/.exec(op.candidate)?.[1];
    const candidateIndex = index ? Number(index) - 1 : -1;
    const candidate = input.candidates[candidateIndex];
    if (!candidate) {
      rejected.push({ op: op.op, ref: op.candidate, reason: "unknown_candidate" });
      continue;
    }
    if (usedCandidates.has(candidateIndex)) {
      rejected.push({ op: op.op, ref: op.candidate, reason: "repeated" });
      continue;
    }
    const evidence = checkEvidence(candidate.evidence, input.refs);
    if (!evidence.ok) {
      rejected.push({ op: op.op, ref: op.candidate, reason: evidence.reason });
      continue;
    }
    if (op.op === "CORROBORATE") {
      const neighbor = (input.neighbors[candidateIndex] ?? []).find(
        (item) => item.shortId.toLowerCase() === op.lesson && item.cosine >= CORROBORATE_MIN_COSINE,
      );
      if (!neighbor) {
        rejected.push({ op: op.op, ref: `${op.candidate}→${op.lesson}`, reason: "not_a_neighbor" });
        continue;
      }
      if (lessonsById.has(neighbor.id)) {
        rejected.push({ op: op.op, ref: `${op.candidate}→${op.lesson}`, reason: "repeated" });
        continue;
      }
      usedCandidates.add(candidateIndex);
      lessonsById.add(neighbor.id);
      ops.push({ op: "CORROBORATE", bulletId: neighbor.id, evidence: evidence.evidence });
      continue;
    }
    // ADD: the curator may sharpen the wording, never change what it rests on.
    const sharpened = clip(op.text, MAX_LESSON_CHARS);
    const text = sharpened.length >= 10 ? sharpened : candidate.text;
    usedCandidates.add(candidateIndex);
    ops.push({
      op: "ADD",
      id: lessonId(input.eventId, text),
      section: candidate.section,
      text,
      scope: candidate.scope,
      evidence: evidence.evidence,
      embedding: input.embeddings[candidateIndex] ?? null,
    });
  }
  return { ops, rejected };
}
