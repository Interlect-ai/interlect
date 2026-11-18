/**
 * Fondens årsagskoder (brain_reason_codes): reglerne for at tilføje og rette dem.
 * Ren fil uden database, så den kan testes med node --test. En kode slettes aldrig; den
 * deaktiveres, og gamle rækker beholder den. Selve koden (nøglen) ændres aldrig, fordi
 * overgangsloggen henviser til den.
 */
import { z } from "zod";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

export const REASON_GROUPS = [
  "thesis",
  "team",
  "market",
  "product",
  "traction",
  "economics",
  "timing",
  "portfolio",
  "process",
  "positive",
  "other",
] as const;
export type ReasonGroup = (typeof REASON_GROUPS)[number];

export const REASON_APPLIES_TO = [
  "advance",
  "hold",
  "reject",
  "decline_ic",
  "invest",
  "reopen",
] as const;

// i18n-keep: validators' messages; the page checks first, and a ZodError reaches no one as text.
export const reasonCodeFieldsSchema = z.object({
  label: z.string().trim().min(1, "Skriv en tekst til årsagen.").max(120),
  groupKey: z.enum(REASON_GROUPS),
  appliesTo: z.array(z.enum(REASON_APPLIES_TO)).min(1, "Vælg mindst ét sted, årsagen bruges."),
  revisit: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
});
export type ReasonCodeFields = z.infer<typeof reasonCodeFieldsSchema>;

const FOLD: Record<string, string> = {
  æ: "ae",
  ø: "oe",
  å: "aa",
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

/** A stable key for a new reason from its label: lower case, no accents, underscores. */
export function slugifyReasonCode(label: string): string {
  const folded = label
    .toLowerCase()
    .replace(/[æøåäöüß]/g, (char) => FOLD[char] ?? char)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const slug = folded
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  // The database wants a letter first and at least two characters.
  const prefixed = (/^[a-z]/.test(slug) ? slug : `r_${slug}`).slice(0, 60).replace(/_+$/g, "");
  return prefixed.length >= 2 ? prefixed : "reason";
}

/** A free code for a label: the slug, or the slug with a number when it is taken. */
export function uniqueReasonCode(
  label: string,
  taken: ReadonlySet<string>,
  language: Language = DEFAULT_LANGUAGE,
): string {
  const base = slugifyReasonCode(label);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 60 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(translate(language, "fundServer.reasons.tooManySimilar"));
}
