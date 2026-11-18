/**
 * The short texts the surface shows, made safe in code: trimmed, on one line,
 * within their limits, never cut mid-word. The model is asked for them; code never trusts the
 * length it gets. Pure and tested.
 */
import { COMPANY_LABEL, SPECIALIST_HEADLINE } from "./deep-text-rules.ts";
import type { CompanyLabel } from "./contracts.ts";

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** At most `max` characters, cut at a word and marked with an ellipsis when cut. */
export function clipAtWord(text: string, max: number): string {
  const flat = oneLine(text);
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,;:.-]+$/, "")}…`;
}

/** The label beside the name, or null when it says nothing. */
export function cleanCompanyLabel(label: CompanyLabel | null | undefined): CompanyLabel | null {
  if (!label) return null;
  const sector = oneLine(label.sector)
    .split(" ")
    .filter(Boolean)
    .slice(0, COMPANY_LABEL.sectorWords)
    .join(" ")
    .replace(/[,;:.]+$/, "");
  const clean = {
    stage: clipAtWord(label.stage, COMPANY_LABEL.stageMax),
    sector: clipAtWord(sector, COMPANY_LABEL.sectorMax),
    country: clipAtWord(label.country, COMPANY_LABEL.countryMax),
  };
  return clean.stage || clean.sector || clean.country ? clean : null;
}

/** The label as one line: "Seed, Aquatech, Danmark" (empty parts left out). */
export function companyLabelText(label: CompanyLabel | null): string | null {
  if (!label) return null;
  return [label.stage, label.sector, label.country].filter(Boolean).join(", ") || null;
}

/** A specialist's short point for its card, or null when there is none. */
export function cleanSpecialistHeadline(headline: string | null | undefined): string | null {
  const clean = clipAtWord(headline ?? "", SPECIALIST_HEADLINE.max);
  return clean || null;
}
