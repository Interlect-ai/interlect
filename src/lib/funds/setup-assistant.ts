/**
 * the Interlect-Assistent in Teamopsætning (prototype `Teamopsaetning v3.dc.html`, "Interlect-
 * Assistant: én samtale. Svarer først, gør kun ting efter godkendelse").
 *
 * - The conversation lives only in the browser session ("Ny chat" empties it; produktejeren 15 Nov,
 * beslutningsloggen). Nothing of it is stored on the server.
 * - The page sends what it shows right now (`AssistantSnapshot`: the setup as edited, unsaved
 *   changes included, for the stage on screen), so the assistant reads what the user has changed
 *   (beslutningsloggen 15 Nov: what the user changed is what counts).
 * - The model answers in words and may propose ONE change (`AssistantChange`). The server checks it
 *   against the snapshot (`normalizeChange`); a change that does not fit is dropped, the answer
 *   stays. The page shows it as Før/Efter with Ja / Nej / Fortryd; nothing changes without a Ja.
 *
 * Pure file without a database, so it can be tested with node --test.
 */
import { z } from "zod";
import { SETUP_STAGES } from "../analysis/setup-stage.ts";
import {
  ECONOMY_POINT_KEYS,
  MAX_OWN_ECONOMY_QUESTIONS,
  OWN_QUESTION_ANSWERS,
  OWN_QUESTION_MAX_CHARS,
  isEconomyPointKey,
  type EconomyPointKey,
  type OwnQuestionAnswer,
} from "./economy-points.ts";
import { FOCUS_MAX, FOCUS_TEXT_MAX, FOCUS_TITLE_MAX } from "./stage-specialists.ts";

/** The places of the page (setup-places.ts) and the sheets that can be open on them. */
export const ASSISTANT_PLACES = ["thesis", "screening", "analysis", "publish"] as const;
export const ASSISTANT_SHEETS = ["crit", "rules", "fin", "instr", "cmp", "spec"] as const;
export type AssistantPlace = (typeof ASSISTANT_PLACES)[number];
export type AssistantSheet = (typeof ASSISTANT_SHEETS)[number];

/** The most criteria a stage can have (the editor's limit, ScreeningSheets `MAX_CRITERIA`). */
export const ASSISTANT_MAX_CRITERIA = 15;
/** The most rules a stage can have before the assistant stops adding (a sane cap). */
export const ASSISTANT_MAX_RULES = 40;
/** How many messages of the session go along (the newest); older ones are left out. */
export const ASSISTANT_MAX_MESSAGES = 16;
export const ASSISTANT_MESSAGE_MAX_CHARS = 2000;

/** The longest text per field, as the editor and the save allow it. */
export const TEXT_LIMITS = {
  thesis: 5000,
  about: 3000,
  expectation: 2000,
  criterion: 1000,
  rule: 1000,
  focus: FOCUS_TEXT_MAX,
} as const;

const line = (max: number) => z.string().max(max);

/** What the page shows right now (built by the page, `assistantSnapshot`). */
export const assistantSnapshotSchema = z.object({
  place: z.enum(ASSISTANT_PLACES),
  sheet: z.enum(ASSISTANT_SHEETS).nullable(),
  /** The stage on screen; null when the team has chosen no stage. */
  stage: z.enum(SETUP_STAGES).nullable(),
  stageLabel: line(80),
  /** The field the person asked from (its "Interlect-Assistant" button), with its text now. */
  field: z.object({ key: line(120), label: line(200), text: line(TEXT_LIMITS.thesis) }).nullable(),
  teamName: line(160),
  thesis: line(TEXT_LIMITS.thesis),
  about: line(TEXT_LIMITS.about),
  stages: z.array(line(80)).max(20),
  geographies: z.array(line(120)).max(40),
  sectors: z.array(line(120)).max(40),
  ticket: line(200),
  criteria: z
    .array(
      z.object({
        key: line(80),
        label: line(160),
        weight: z.number().min(0).max(100),
        description: line(TEXT_LIMITS.criterion),
      }),
    )
    .max(ASSISTANT_MAX_CRITERIA + 5),
  rules: z
    .array(
      z.object({
        key: line(80),
        label: line(160),
        treatment: z.enum(["hard", "review"]),
        description: line(TEXT_LIMITS.rule),
        /** One of the mandate's shared rules (the same for every stage). */
        shared: z.boolean(),
      }),
    )
    .max(ASSISTANT_MAX_RULES + 10),
  economy: z
    .array(
      z.object({
        key: z.enum(ECONOMY_POINT_KEYS as [EconomyPointKey, ...EconomyPointKey[]]),
        label: line(300),
        on: z.boolean(),
        /** The limit now; null for a yes/no point. */
        limit: z.number().nullable(),
        unit: line(30),
      }),
    )
    .max(ECONOMY_POINT_KEYS.length),
  questions: z.array(line(OWN_QUESTION_MAX_CHARS)).max(MAX_OWN_ECONOMY_QUESTIONS),
  /** The stage's "Med jeres egne ord" (key findings); null when there is no stage. */
  expectation: line(TEXT_LIMITS.expectation).nullable(),
  /** The specialist whose sheet is open, with its focus areas as edited. */
  specialist: z
    .object({
      name: line(80),
      foci: z
        .array(z.object({ title: line(FOCUS_TITLE_MAX), text: line(FOCUS_TEXT_MAX) }))
        .max(FOCUS_MAX),
    })
    .nullable(),
});
export type AssistantSnapshot = z.infer<typeof assistantSnapshotSchema>;

export const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX_CHARS),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

/** The request: the newest messages (the last is the person's) and the page as it is. */
export const assistantRequestSchema = z.object({
  fundId: z.guid(),
  messages: z
    .array(assistantMessageSchema)
    .min(1)
    .transform((messages) => messages.slice(-ASSISTANT_MAX_MESSAGES))
    .refine((messages) => messages.at(-1)?.role === "user", "last_message_not_user"),
  snapshot: assistantSnapshotSchema,
});
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

/**
 * One change the assistant can propose. A text target is "thesis", "about", "expectation",
 * "criterion:<key>", "rule:<key>" or "focus:<index>" (a focus area of the open specialist).
 */
export type AssistantChange =
  | { kind: "text"; target: string; text: string }
  | { kind: "add_criterion"; label: string; description: string }
  | { kind: "add_rule"; label: string; description: string }
  | { kind: "rule_treatment"; ruleKey: string; treatment: "hard" | "review" }
  | { kind: "economy_on"; points: EconomyPointKey[]; on: boolean }
  | { kind: "economy_limit"; point: EconomyPointKey; value: number }
  | { kind: "add_questions"; questions: Array<{ text: string; answer: OwnQuestionAnswer }> }
  | { kind: "add_focus"; title: string; text: string };

export type AssistantChangeKind = AssistantChange["kind"];

export interface AssistantReply {
  answer: string;
  change: AssistantChange | null;
}

const CHANGE_KINDS = [
  "none",
  "text",
  "add_criterion",
  "add_rule",
  "rule_treatment",
  "economy_on",
  "economy_limit",
  "add_questions",
  "add_focus",
] as const;

/** The model's answer (strict structured output: every field present, unused ones empty). */
export const ASSISTANT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "change"],
  properties: {
    answer: { type: "string" },
    change: {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "target",
        "label",
        "text",
        "treatment",
        "points",
        "on",
        "value",
        "questions",
      ],
      properties: {
        kind: { type: "string", enum: [...CHANGE_KINDS] },
        target: { type: "string" },
        label: { type: "string" },
        text: { type: "string" },
        treatment: { type: "string", enum: ["hard", "review", "none"] },
        points: { type: "array", items: { type: "string" } },
        on: { type: "boolean" },
        value: { type: "number" },
        questions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "answer"],
            properties: {
              text: { type: "string" },
              answer: { type: "string", enum: [...OWN_QUESTION_ANSWERS] },
            },
          },
        },
      },
    },
  },
} as const;

const rawOutputSchema = z.object({
  answer: z.string(),
  change: z
    .object({
      kind: z.string(),
      target: z.string().default(""),
      label: z.string().default(""),
      text: z.string().default(""),
      treatment: z.string().default("none"),
      points: z.array(z.string()).default([]),
      on: z.boolean().default(true),
      value: z.number().default(0),
      questions: z.array(z.object({ text: z.string(), answer: z.string() })).default([]),
    })
    .nullable()
    .default(null),
});

/** The longest answer shown; a longer one is cut at a sentence (the model is asked for less). */
export const ANSWER_MAX_CHARS = 1800;

function cutAnswer(text: string): string {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (clean.length <= ANSWER_MAX_CHARS) return clean;
  const cut = clean.slice(0, ANSWER_MAX_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return (end > ANSWER_MAX_CHARS / 2 ? cut.slice(0, end + 1) : cut).trim();
}

/** Text from the model: one block, trimmed, inside the field's limit (null when empty). */
function cleanText(value: string, max: number): string | null {
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (!text) return null;
  return text.length > max ? null : text;
}

/** A label: one line, trimmed (null when empty or too long). */
function cleanLabel(value: string, max: number): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > max) return null;
  return text;
}

const sameText = (a: string, b: string) =>
  a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** The current text of a text target, or null when the target does not exist on the page. */
export function targetText(snapshot: AssistantSnapshot, target: string): string | null {
  if (target === "thesis") return snapshot.thesis;
  if (target === "about") return snapshot.about;
  if (target === "expectation") return snapshot.expectation;
  const [kind, ...rest] = target.split(":");
  const id = rest.join(":");
  if (kind === "criterion") {
    return snapshot.criteria.find((criterion) => criterion.key === id)?.description ?? null;
  }
  if (kind === "rule") return snapshot.rules.find((rule) => rule.key === id)?.description ?? null;
  if (kind === "focus") {
    const index = Number(id);
    if (!snapshot.specialist || !Number.isInteger(index) || index < 0) return null;
    return snapshot.specialist.foci[index]?.text ?? null;
  }
  return null;
}

/** The longest text a target takes. */
export function targetLimit(target: string): number {
  if (target === "thesis") return TEXT_LIMITS.thesis;
  if (target === "about") return TEXT_LIMITS.about;
  if (target === "expectation") return TEXT_LIMITS.expectation;
  if (target.startsWith("criterion:")) return TEXT_LIMITS.criterion;
  if (target.startsWith("rule:")) return TEXT_LIMITS.rule;
  return TEXT_LIMITS.focus;
}

type RawChange = NonNullable<z.infer<typeof rawOutputSchema>["change"]>;

/**
 * The model's change checked against the page: it must name something that exists, stay inside
 * the editor's limits and actually change something. Anything else gives null (no proposal).
 */
export function normalizeChange(
  raw: RawChange | null,
  snapshot: AssistantSnapshot,
): AssistantChange | null {
  if (!raw || raw.kind === "none") return null;
  const staged = snapshot.stage !== null;
  switch (raw.kind) {
    case "text": {
      const target = raw.target.trim();
      const now = targetText(snapshot, target);
      if (now === null) return null;
      if (target !== "thesis" && target !== "about" && !staged && !target.startsWith("focus:")) {
        return null;
      }
      const text = cleanText(raw.text, targetLimit(target));
      if (!text || sameText(text, now)) return null;
      return { kind: "text", target, text };
    }
    case "add_criterion": {
      if (!staged || snapshot.criteria.length >= ASSISTANT_MAX_CRITERIA) return null;
      const label = cleanLabel(raw.label, 160);
      const description = cleanText(raw.text, TEXT_LIMITS.criterion);
      if (!label || !description) return null;
      const taken = snapshot.criteria.some(
        (criterion) => criterion.label.trim().toLowerCase() === label.toLowerCase(),
      );
      return taken ? null : { kind: "add_criterion", label, description };
    }
    case "add_rule": {
      if (!staged || snapshot.rules.length >= ASSISTANT_MAX_RULES) return null;
      const label = cleanLabel(raw.label, 160);
      const description = cleanText(raw.text, TEXT_LIMITS.rule);
      if (!label || !description) return null;
      const taken = snapshot.rules.some(
        (rule) => rule.label.trim().toLowerCase() === label.toLowerCase(),
      );
      return taken ? null : { kind: "add_rule", label, description };
    }
    case "rule_treatment": {
      const rule = snapshot.rules.find((entry) => entry.key === raw.target.trim());
      if (!rule || (raw.treatment !== "hard" && raw.treatment !== "review")) return null;
      if (rule.treatment === raw.treatment) return null;
      // A rule of the stage needs a stage; the shared ones are the same everywhere.
      if (!rule.shared && !staged) return null;
      return { kind: "rule_treatment", ruleKey: rule.key, treatment: raw.treatment };
    }
    case "economy_on": {
      if (!staged) return null;
      const points = [...new Set(raw.points.map((point) => point.trim()))].filter(
        (point): point is EconomyPointKey =>
          isEconomyPointKey(point) &&
          snapshot.economy.some((entry) => entry.key === point && entry.on !== raw.on),
      );
      return points.length ? { kind: "economy_on", points, on: raw.on } : null;
    }
    case "economy_limit": {
      if (!staged) return null;
      const point = raw.target.trim();
      const entry = snapshot.economy.find((item) => item.key === point);
      if (!entry || entry.limit === null || !isEconomyPointKey(point)) return null;
      const value = raw.value;
      if (!Number.isFinite(value) || value < 0 || value >= 1_000_000) return null;
      if (value === entry.limit && entry.on) return null;
      return { kind: "economy_limit", point, value };
    }
    case "add_questions": {
      if (!staged) return null;
      const room = MAX_OWN_ECONOMY_QUESTIONS - snapshot.questions.length;
      const known = new Set(snapshot.questions.map((text) => text.trim().toLowerCase()));
      const questions: Array<{ text: string; answer: OwnQuestionAnswer }> = [];
      for (const question of raw.questions) {
        const text = cleanLabel(question.text, OWN_QUESTION_MAX_CHARS);
        if (!text || known.has(text.toLowerCase())) continue;
        const answer = (OWN_QUESTION_ANSWERS as readonly string[]).includes(question.answer)
          ? (question.answer as OwnQuestionAnswer)
          : "txt";
        known.add(text.toLowerCase());
        questions.push({ text, answer });
      }
      const kept = questions.slice(0, Math.max(0, room));
      return kept.length ? { kind: "add_questions", questions: kept } : null;
    }
    case "add_focus": {
      if (!snapshot.specialist || snapshot.specialist.foci.length >= FOCUS_MAX) return null;
      const title = cleanLabel(raw.label, FOCUS_TITLE_MAX);
      const text = cleanText(raw.text, FOCUS_TEXT_MAX);
      return title && text ? { kind: "add_focus", title, text } : null;
    }
    default:
      return null;
  }
}

/**
 * The model's raw answer read into a reply. A broken answer throws (the caller says "try again");
 * a change that does not fit the page is dropped and the words stay.
 */
export function readAssistantOutput(content: string, snapshot: AssistantSnapshot): AssistantReply {
  const parsed = rawOutputSchema.parse(JSON.parse(content));
  const answer = cutAnswer(parsed.answer);
  const change = normalizeChange(parsed.change, snapshot);
  if (!answer && !change) throw new Error("empty_answer");
  return { answer, change };
}

/**
 * The instruction to the model. The team's own texts are the team's (trusted as their wishes for
 * the setup); the conversation is the person's. i18n-keep: prompt to the model, the team's
 * language rule is added last by the gateway.
 */
export const ASSISTANT_SYSTEM = [
  "Du er Interlect-Assistant i Interlect.ai's Teamopsætning: et investeringsteam sætter her op, hvordan Interlect screener og analyserer deres cases. Du taler med en person fra teamet.",
  "Svar først og oprigtigt på det, personen spørger om: om teamets opsætning, om hvordan Interlect bruger den, eller om investering i almindelighed (fx runway, ARR, værdiansættelse, mandat). Skriv kort, venligt og konkret: højst 120 ord, ingen overskrifter, ingen punktlister med mere end fire punkter. Skriv som en kollega, ikke som en manual.",
  'Du kan ændre opsætningen, men kun ved at foreslå ÉN ændring i feltet change, som personen selv godkender. Skriv aldrig, at noget er ændret; skriv fx "Her er et forslag" og hvad ændringen gør. Foreslå kun en ændring, når personen beder om at få noget ændret, skrevet, tilføjet, slået til eller fra eller strammet. Ved et spørgsmål: kind "none".',
  "Mulige ændringer (brug kun nøgler, der står i setup; alt andet i change skal være tomt, false eller 0):",
  '- text: ny tekst til et felt. target er "thesis" (Hvad tror I på?), "about" (Hvem er I, og hvordan tænker I?), "expectation" (stadiets nøglefund med egne ord), "criterion:<key>" (Hvad leder vi efter?), "rule:<key>" (reglens tekst) eller "focus:<nr>" (et fokusområde hos den åbne specialist, nr fra 0). text er hele den nye tekst.',
  "- add_criterion: nyt kriterium i stadiet; label er navnet, text er Hvad leder vi efter?. Vægtene fordeles automatisk.",
  "- add_rule: ny mandatregel i stadiet (starter som op til vurdering); label er navnet, text er hvad casen skal leve op til.",
  '- rule_treatment: target er reglens key, treatment er "hard" (bindende) eller "review" (op til vurdering).',
  "- economy_on: points er økonomipunkternes key, on er true (slå til) eller false (slå fra).",
  "- economy_limit: target er punktets key (kun punkter med limit), value er den nye grænse i punktets enhed.",
  '- add_questions: egne spørgsmål om økonomien; answer er "yn" (ja eller nej), "num" (et tal) eller "txt" (kort tekst).',
  "- add_focus: nyt fokusområde hos den åbne specialist; label er navnet, text er hvad den skal undersøge.",
  "Regler for opsætningen, som altid gælder: Interlect blokerer aldrig en case; en bindende regel, der ikke er opfyldt, bliver vist tydeligt, men casen går altid videre. En manglende oplysning er ukendt og kan blive en opgave, aldrig et minus. Kriteriernes vægte giver 100 %, hver mellem 5 og 40 %.",
  "Tekster, du skriver til opsætningen, er korte og konkrete, i teamets eget sprog, uden tal eller grænser, som personen ikke har nævnt (medmindre de tydeligt er eksempler). Fokusområder er højst 320 tegn.",
  "field fortæller, hvilket felt personen spurgte fra; where fortæller, hvor personen er. Brug det som viden, ikke som en begrænsning. Nævn aldrig modeller, tokens eller hvordan du er lavet.",
].join("\n");

/** The prompt's user part: where the person is, the setup as shown, and the conversation. */
export function assistantUserPrompt(request: AssistantRequest): string {
  const { snapshot, messages } = request;
  return JSON.stringify({
    where: {
      place: snapshot.place,
      sheet: snapshot.sheet,
      stage: snapshot.stage ? snapshot.stageLabel : null,
    },
    field: snapshot.field,
    setup: {
      team: snapshot.teamName,
      thesis: snapshot.thesis,
      about: snapshot.about,
      stages: snapshot.stages,
      geographies: snapshot.geographies,
      sectors: snapshot.sectors,
      ticket: snapshot.ticket,
      criteria: snapshot.criteria,
      rules: snapshot.rules,
      economy: snapshot.economy,
      ownEconomyQuestions: snapshot.questions,
      keyFindingsInOwnWords: snapshot.expectation,
      openSpecialist: snapshot.specialist
        ? {
            name: snapshot.specialist.name,
            focusAreas: snapshot.specialist.foci.map((focus, index) => ({ nr: index, ...focus })),
          }
        : null,
    },
    conversation: messages,
  });
}
