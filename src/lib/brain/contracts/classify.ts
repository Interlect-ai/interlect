/**
 * The "classify" step of INGEST: from the first ~3.000 tokens of a source the model names
 * its document type, period, main company and language and writes a short summary. Pure: the
 * prompt text, the strict JSON schema and the validation of the answer live here (tested in
 * classify.test.ts); the call itself is made by loops/ingest.ts with a budget reservation.
 */
import { z } from "zod";
import { countTokens } from "../ingest/chunk.ts";

/** = brain_sources.doc_type (0041). */
export const DOC_TYPES = [
  "fund_report",
  "status_report",
  "investment_memo",
  "lp_letter",
  "thesis",
  "website_page",
  "portfolio_list",
  "decision_history",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** The most text sent for classification (the first 3.000 tokens). */
export const CLASSIFY_INPUT_TOKENS = 3_000;
export const CLASSIFY_MAX_OUTPUT_TOKENS = 700;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(value)));

export const classifyOutputSchema = z.object({
  docType: z.enum(DOC_TYPES),
  title: z.string().trim().min(1).max(200).nullable(),
  periodStart: isoDate.nullable(),
  periodEnd: isoDate.nullable(),
  mainCompany: z
    .object({
      name: z.string().trim().min(1).max(200),
      domain: z.string().trim().max(200).nullable(),
      cvr: z
        .string()
        .trim()
        .regex(/^\d{8}$/)
        .nullable(),
    })
    .nullable(),
  language: z.enum(["da", "en", "other"]),
  summary: z.string().trim().min(1).max(900),
});
export type ClassifyOutput = z.infer<typeof classifyOutputSchema>;

/** The strict JSON schema the model must answer in (every field present, unknown ones null). */
export const classifyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["docType", "title", "periodStart", "periodEnd", "mainCompany", "language", "summary"],
  properties: {
    docType: { type: "string", enum: [...DOC_TYPES] },
    title: { type: ["string", "null"], maxLength: 200 },
    periodStart: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    periodEnd: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    mainCompany: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["name", "domain", "cvr"],
      properties: {
        name: { type: "string", maxLength: 200 },
        domain: { type: ["string", "null"], maxLength: 200 },
        cvr: { type: ["string", "null"], pattern: "^\\d{8}$" },
      },
    },
    language: { type: "string", enum: ["da", "en", "other"] },
    summary: { type: "string", maxLength: 900 },
  },
} as const;

/**
 * The text sent: the beginning of the document up to the token limit, inside a source tag that
 * marks it as data. The tag carries the file's name and the trust the uploader gave it, never
 * an instruction.
 */
export function classifyPromptText(input: {
  fileName: string | null;
  trustTier: string;
  pageCount: number | null;
  text: string;
}): string {
  // Nothing in the document may close the tag it is wrapped in.
  let text = input.text.replace(/<\/\s*source/gi, "<\\/source");
  if (countTokens(text) > CLASSIFY_INPUT_TOKENS) {
    // Cut by characters first, then trim until it fits (Danish is about 3,5 characters a token).
    text = text.slice(0, CLASSIFY_INPUT_TOKENS * 4);
    while (countTokens(text) > CLASSIFY_INPUT_TOKENS)
      text = text.slice(0, Math.floor(text.length * 0.9));
  }
  const attributes = [
    input.fileName ? `file="${input.fileName.replace(/["<>]/g, "")}"` : "",
    `trust="${input.trustTier}"`,
    input.pageCount !== null ? `pages="${input.pageCount}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<source ${attributes}>\n${text}\n</source>`;
}

/** The validated answer, or null when it cannot be used (the step then fails with a clear text). */
export function parseClassification(raw: unknown): ClassifyOutput | null {
  const parsed = classifyOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  // A period that ends before it starts is a model slip: the dates are dropped, never guessed.
  if (value.periodStart && value.periodEnd && value.periodEnd < value.periodStart) {
    return { ...value, periodStart: null, periodEnd: null };
  }
  return value;
}
