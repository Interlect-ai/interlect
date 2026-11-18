/**
 * Visning af mandatets regler på teamets sprog. Opsætningen gemmer reglernes navne og
 * forklaringer som tekst, skrevet på det sprog, guiden havde, da reglen blev lavet ("Based in
 * Norden, Europa", "Stage: Seed, Serie A"). Navne og forklaringer, som opsætningen selv har lavet
 * (geografi, fase, ticket og forklaringerne fra guiden), genkendes på alle sprog og skrives igen
 * på teamets sprog med grundlagets navne. Brugerens egen tekst står, som den blev skrevet.
 */
import { LANGUAGES, LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import { geographyText, stageText } from "./basis-labels.ts";

/** The automatic names, by the rule's key. */
const AUTO_LABEL: Readonly<Record<string, MessageKey>> = {
  geography_fit: "thesis.defaults.autoGeography",
  stage_fit: "thesis.defaults.autoStage",
  ticket_fit: "thesis.defaults.autoTicket",
};

/** The guide's explanations of the automatic rules, by the rule's key. */
const AUTO_DESCRIPTION: Readonly<Record<string, MessageKey>> = {
  geography_fit: "thesis.defaults.gates.geography_fit",
  stage_fit: "thesis.defaults.gates.stage_fit",
  ticket_fit: "thesis.defaults.gates.ticket_fit",
};

/** The guide's explanations of the team's own rules, with the rule's name inside. */
const CUSTOM_DESCRIPTIONS: readonly MessageKey[] = [
  "thesis.defaults.customReview",
  "thesis.defaults.customHard",
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const patterns = new Map<string, RegExp>();
/** The text as a pattern in the language: each {placeholder} catches what was written in it. */
function pattern(language: Language, key: MessageKey): RegExp {
  const id = `${language}:${key}`;
  let found = patterns.get(id);
  if (!found) {
    const parts = translate(language, key).split(/\{\w+\}/);
    found = new RegExp(`^${parts.map(escape).join("(.+?)")}$`, "s");
    patterns.set(id, found);
  }
  return found;
}

/** What was written in the text's placeholders, in whichever language the text is in. */
function match(text: string, key: MessageKey): string[] | null {
  const trimmed = text.trim();
  for (const language of LANGUAGES) {
    const found = pattern(language, key).exec(trimmed);
    if (found) return found.slice(1);
  }
  return null;
}

const listText = (list: string, show: (value: string) => string) =>
  list
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(show)
    .join(", ");

const amountText = (amount: string, language: Language) => {
  const digits = amount.replace(/\D/g, "");
  return digits ? Number(digits).toLocaleString(LANGUAGE_TAGS[language]) : amount.trim();
};

/** A rule's name in the language; a name the team wrote itself stays as written. */
export function gateLabelText(key: string, label: string, language: Language): string {
  const template = Object.hasOwn(AUTO_LABEL, key) ? AUTO_LABEL[key]! : null;
  if (!template) return label;
  const parts = match(label, template);
  if (!parts) return label;
  if (key === "ticket_fit") {
    const [min = "", max = ""] = parts;
    return translate(language, template, {
      min: amountText(min, language),
      max: amountText(max, language),
    });
  }
  const show = key === "stage_fit" ? stageText : geographyText;
  return translate(language, template, {
    list: listText(parts[0] ?? "", (value) => show(value, language)),
  });
}

/** A rule's explanation in the language, when it is the guide's own text; otherwise as written. */
export function gateDescriptionText(key: string, description: string, language: Language): string {
  const own = Object.hasOwn(AUTO_DESCRIPTION, key) ? AUTO_DESCRIPTION[key]! : null;
  if (own && LANGUAGES.some((other) => translate(other, own) === description.trim())) {
    return translate(language, own);
  }
  for (const template of CUSTOM_DESCRIPTIONS) {
    const parts = match(description, template);
    if (parts) return translate(language, template, { label: parts[0] ?? "" });
  }
  return description;
}

/** A rule with its name and explanation in the language. */
export function gateInLanguage<T extends { key: string; label: string; description?: string }>(
  gate: T,
  language: Language,
): T {
  return {
    ...gate,
    label: gateLabelText(gate.key, gate.label, language),
    ...(gate.description === undefined
      ? {}
      : { description: gateDescriptionText(gate.key, gate.description, language) }),
  };
}
