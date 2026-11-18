/**
 * Et AI-forslag til fondsopsætningen ("Ret med AI", "Lad Interlect hjælpe med tesen") er en
 * kort liste af redigeringer (operationer), ikke en ny kladde. Koden anvender dem på en kopi af
 * kladden, regner diffen og viser den; først når et menneske vælger "Læg i kladden", skrives
 * de til kladden, og først ved udgivelse påvirker de analyser. AI'en kan derfor kun foreslå
 * det, som operationerne tillader, og alle faste grænser tjekkes i kode bagefter.
 *
 * Ren fil uden database og uden netværk, så den kan testes med node --test.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { checkConfigLimits, type LimitViolation } from "./config-limits.ts";
import type { SaveFundConfigInput } from "./config.functions.ts";
import {
  DEFAULT_SCREENING_CARDS,
  SCREENING_CARD_IDS,
  SCREENING_INSTRUCTION_MAX,
  type ScreeningCardId,
} from "./screening-setup.ts";

/**
 * Everything a draft holds that the editor saves (the save arguments without the version id),
 * plus the fund's own screening: the instruction and the extra cards, saved apart with
 * save_fund_screening_setup (0078). A draft read from the database always has them.
 */
export type DraftFields = Omit<SaveFundConfigInput, "configId"> & {
  screeningInstruction?: string;
  screeningCards?: ScreeningCardId[];
};

export const OP_LIST_FIELDS = ["stages", "geographies", "sectors", "dealbreakers"] as const;
export type OpListField = (typeof OP_LIST_FIELDS)[number];

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, "En nøgle er små bogstaver, tal og understreg.");
const scoreCategories = [
  "fund_thesis_fit",
  "founder_market_fit",
  "team_market_fit",
  "product_market_fit",
  "product_technology",
  "market_timing",
  "traction_gtm",
  "financial_strength",
  "evidence_quality",
] as const;

export const configOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_thesis"), text: z.string().trim().min(1).max(5000) }),
  z.object({ op: z.literal("set_risk_posture"), text: z.string().trim().min(1).max(3000) }),
  z.object({ op: z.literal("set_threshold"), number: z.number().min(0).max(100) }),
  z.object({
    op: z.literal("set_list"),
    field: z.enum(OP_LIST_FIELDS),
    values: z.array(z.string().trim().min(1).max(500)).max(40),
  }),
  z.object({ op: z.literal("set_weight"), key: keySchema, weight: z.number().positive().max(100) }),
  z.object({
    op: z.literal("set_criterion_text"),
    key: keySchema,
    label: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(1000).optional(),
  }),
  z.object({
    op: z.literal("add_criterion"),
    key: keySchema,
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(1000),
    category: z.enum(scoreCategories),
    weight: z.number().positive().max(100),
  }),
  z.object({ op: z.literal("remove_criterion"), key: keySchema }),
  z.object({
    op: z.literal("set_gate_treatment"),
    key: z.string().trim().min(1).max(80),
    treatment: z.enum(["hard", "review"]),
  }),
  z.object({
    op: z.literal("add_gate"),
    key: keySchema,
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(1000),
    treatment: z.enum(["hard", "review"]),
  }),
  z.object({ op: z.literal("remove_gate"), key: z.string().trim().min(1).max(80) }),
  // The fund's own screening. An empty text removes the instruction.
  z.object({
    op: z.literal("set_screening_instruction"),
    text: z.string().trim().max(SCREENING_INSTRUCTION_MAX),
  }),
  z.object({
    // No longer offered to the model (FLAT_OP_NAMES); kept so older proposals still apply.
    op: z.literal("set_screening_cards"),
    values: z.array(z.enum(SCREENING_CARD_IDS)).max(SCREENING_CARD_IDS.length),
  }),
]);
export type ConfigOp = z.infer<typeof configOpSchema>;

/** The most edits one proposal may hold: a proposal is a review, not a rewrite. */
export const MAX_OPS_PER_PROPOSAL = 12;

export interface ApplyResult {
  draft: DraftFields;
  /** Problems that make the proposal unusable (an edit points at something that does not exist). */
  errors: string[];
  /** What would stop a publish of the result; shown next to the diff, not a reason to refuse it. */
  limitViolations: LimitViolation[];
}

function cloneDraft(draft: DraftFields): DraftFields {
  return JSON.parse(JSON.stringify(draft)) as DraftFields;
}

export function applyConfigOps(
  draft: DraftFields,
  ops: readonly ConfigOp[],
  language: Language = DEFAULT_LANGUAGE,
): ApplyResult {
  const next = cloneDraft(draft);
  const errors: string[] = [];
  const criterion = (key: string) => next.criteria.find((item) => item.key === key);
  const gate = (key: string) => next.gates.find((item) => item.key === key);

  for (const op of ops) {
    switch (op.op) {
      case "set_thesis":
        next.thesis = op.text;
        break;
      case "set_risk_posture":
        next.riskPosture = op.text;
        break;
      case "set_threshold":
        next.analysisThreshold = op.number;
        break;
      case "set_list":
        next[op.field] = [...new Set(op.values)];
        break;
      case "set_weight": {
        const target = criterion(op.key);
        if (!target) errors.push(`Kriteriet ${op.key} findes ikke i kladden.`);
        else target.weight = op.weight;
        break;
      }
      case "set_criterion_text": {
        const target = criterion(op.key);
        if (!target) errors.push(`Kriteriet ${op.key} findes ikke i kladden.`);
        else {
          if (op.label !== undefined) target.label = op.label;
          if (op.description !== undefined) target.description = op.description;
        }
        break;
      }
      case "add_criterion":
        if (criterion(op.key)) errors.push(`Kriteriet ${op.key} findes allerede.`);
        else {
          next.criteria.push({
            key: op.key,
            label: op.label,
            description: op.description,
            category: op.category,
            weight: op.weight,
            codeAnchor: true,
          });
        }
        break;
      case "remove_criterion":
        if (!criterion(op.key)) errors.push(`Kriteriet ${op.key} findes ikke i kladden.`);
        else next.criteria = next.criteria.filter((item) => item.key !== op.key);
        break;
      case "set_gate_treatment": {
        const target = gate(op.key);
        if (!target) errors.push(`Mandatreglen ${op.key} findes ikke i kladden.`);
        else target.treatment = op.treatment;
        break;
      }
      case "add_gate":
        if (gate(op.key)) errors.push(`Mandatreglen ${op.key} findes allerede.`);
        else {
          next.gates.push({
            key: op.key,
            label: op.label,
            description: op.description,
            treatment: op.treatment,
          });
        }
        break;
      case "remove_gate":
        if (!gate(op.key)) errors.push(`Mandatreglen ${op.key} findes ikke i kladden.`);
        else next.gates = next.gates.filter((item) => item.key !== op.key);
        break;
      case "set_screening_instruction":
        next.screeningInstruction = op.text;
        break;
      case "set_screening_cards":
        // Fixed order, each card once, as the database keeps them.
        next.screeningCards = SCREENING_CARD_IDS.filter((id) => op.values.includes(id));
        break;
    }
  }
  return { draft: next, errors, limitViolations: checkConfigLimits(next, language) };
}

/** The draft's screening instruction or cards differ (they are saved apart, 0078). */
export function screeningChanged(before: DraftFields, after: DraftFields): boolean {
  return (
    (before.screeningInstruction ?? "").trim() !== (after.screeningInstruction ?? "").trim() ||
    JSON.stringify(before.screeningCards ?? null) !== JSON.stringify(after.screeningCards ?? null)
  );
}

function withoutScreening(draft: DraftFields): DraftFields {
  const rest = { ...draft };
  delete rest.screeningInstruction;
  delete rest.screeningCards;
  return rest;
}

/** Anything but the screening differs: only then is save_fund_config_draft needed. */
export function mainDraftChanged(before: DraftFields, after: DraftFields): boolean {
  return draftFingerprint(withoutScreening(before)) !== draftFingerprint(withoutScreening(after));
}

/**
 * The flat shape the model returns (every field always present, unused ones null), because
 * OpenAI's strict structured output wants one object shape. It becomes a ConfigOp here, or is
 * refused with a reason; a proposal with a refused edit is never stored.
 */
export interface FlatOp {
  op: string;
  target: string | null;
  text: string | null;
  number: number | null;
  values: string[] | null;
  treatment: "hard" | "review" | null;
  category: string | null;
  label: string | null;
}

export const FLAT_OP_NAMES = [
  "set_thesis",
  "set_risk_posture",
  "set_threshold",
  "set_list",
  "set_weight",
  "set_criterion_text",
  "add_criterion",
  "remove_criterion",
  "set_gate_treatment",
  "add_gate",
  "remove_gate",
  "set_screening_instruction",
] as const;

function orUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

export function parseFlatOp(flat: FlatOp): { op: ConfigOp } | { error: string } {
  const candidate = (() => {
    switch (flat.op) {
      case "set_thesis":
      case "set_risk_posture":
        return { op: flat.op, text: flat.text };
      case "set_screening_instruction":
        // An empty instruction is allowed, so null from the model means "remove it".
        return { op: flat.op, text: flat.text ?? "" };
      case "set_threshold":
        return { op: flat.op, number: flat.number };
      case "set_list":
        return { op: flat.op, field: flat.target, values: flat.values };
      case "set_weight":
        return { op: flat.op, key: flat.target, weight: flat.number };
      case "set_criterion_text":
        return {
          op: flat.op,
          key: flat.target,
          label: orUndefined(flat.label),
          description: orUndefined(flat.text),
        };
      case "add_criterion":
        return {
          op: flat.op,
          key: flat.target,
          label: flat.label,
          description: flat.text,
          category: flat.category,
          weight: flat.number,
        };
      case "remove_criterion":
      case "remove_gate":
        return { op: flat.op, key: flat.target };
      case "set_gate_treatment":
        return { op: flat.op, key: flat.target, treatment: flat.treatment };
      case "add_gate":
        return {
          op: flat.op,
          key: flat.target,
          label: flat.label,
          description: flat.text,
          treatment: flat.treatment,
        };
      default:
        return null;
    }
  })();
  if (!candidate) return { error: `Ukendt redigering: ${flat.op}.` };
  const parsed = configOpSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      error: `Redigeringen ${flat.op} er ugyldig: ${parsed.error.issues[0]?.message ?? ""}`,
    };
  }
  return { op: parsed.data };
}

/**
 * A fingerprint of the draft's content. A proposal is only laid into the draft when the draft
 * still has the fingerprint it was made against, so a proposal can never overwrite a change
 * somebody made in between.
 */
export function draftFingerprint(draft: DraftFields): string {
  // A screening at its defaults leaves the fingerprint as it was before 0078, so the
  // proposals that were open when it shipped stay valid.
  const content = withoutScreening(draft);
  if (draft.screeningInstruction?.trim()) content.screeningInstruction = draft.screeningInstruction;
  if (
    draft.screeningCards &&
    JSON.stringify(draft.screeningCards) !== JSON.stringify(DEFAULT_SCREENING_CARDS)
  ) {
    content.screeningCards = draft.screeningCards;
  }
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, inner]) => [key, sorted(inner)]),
      );
    }
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(sorted(content)))
    .digest("hex")
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// What the model returns
// ---------------------------------------------------------------------------

export const flatOpSchema = z.object({
  op: z.string().min(1).max(40),
  target: z.string().max(200).nullable(),
  text: z.string().max(5000).nullable(),
  number: z.number().nullable(),
  values: z.array(z.string().max(500)).max(40).nullable(),
  treatment: z.enum(["hard", "review"]).nullable(),
  category: z.string().max(60).nullable(),
  label: z.string().max(160).nullable(),
});

export const proposalResponseSchema = z.object({
  summary: z.string().trim().min(1).max(1000),
  ops: z.array(flatOpSchema).min(1).max(MAX_OPS_PER_PROPOSAL),
});
export type ProposalResponse = z.infer<typeof proposalResponseSchema>;

/** The edits of a model response, or the reason the proposal cannot be used. All or nothing. */
export function opsFromResponse(
  response: ProposalResponse,
): { ops: ConfigOp[] } | { error: string } {
  const ops: ConfigOp[] = [];
  for (const flat of response.ops) {
    const parsed = parseFlatOp(flat);
    if ("error" in parsed) return { error: parsed.error };
    ops.push(parsed.op);
  }
  return { ops };
}

const nullable = (schema: Record<string, unknown>) => ({
  ...schema,
  type: [schema["type"], "null"],
});

/** The strict JSON schema for the model's answer (every field present, unused ones null). */
export const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "ops"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 1000 },
    ops: {
      type: "array",
      minItems: 1,
      maxItems: MAX_OPS_PER_PROPOSAL,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "target", "text", "number", "values", "treatment", "category", "label"],
        properties: {
          op: { type: "string", enum: [...FLAT_OP_NAMES] },
          target: nullable({ type: "string", maxLength: 200 }),
          text: nullable({ type: "string", maxLength: 5000 }),
          number: nullable({ type: "number" }),
          values: nullable({
            type: "array",
            maxItems: 40,
            items: { type: "string", maxLength: 500 },
          }),
          treatment: { type: ["string", "null"], enum: ["hard", "review", null] },
          category: nullable({ type: "string", maxLength: 60 }),
          label: nullable({ type: "string", maxLength: 160 }),
        },
      },
    },
  },
} as const;
