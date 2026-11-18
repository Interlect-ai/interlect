/**
 * What the case page reads from a deep run's stored specialist outputs: each specialist's
 * own conclusion (`summary`, prompt v10+) and its strengths, weaknesses, questions and unknowns.
 * Tolerant on purpose: runs stored before v10 have no summary, and a stored packet that does not
 * look right is skipped rather than failing the case page. Pure and tested.
 */
import { cleanSpecialistHeadline } from "../analysis/short-texts.ts";

export interface SpecialistView {
  /** The specialist module's id (`people_team`, `product_market_gtm` …). */
  moduleId: string;
  /** 2–3 Danish sentences; null for runs before prompt v10 (the page falls back to verdicts). */
  summary: string | null;
  /** The short point for its card on Konklusion; null before deep prompt v15. */
  headline: string | null;
  strengths: string[];
  weaknesses: string[];
  questions: string[];
  unknowns: string[];
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** `raw_response.specialists` of a deep run (an array of stored specialist packets). */
export function parseSpecialistViews(specialists: unknown): SpecialistView[] {
  if (!Array.isArray(specialists)) return [];
  const views: SpecialistView[] = [];
  for (const packet of specialists) {
    if (!packet || typeof packet !== "object") continue;
    const record = packet as Record<string, unknown>;
    if (typeof record["moduleId"] !== "string" || !record["moduleId"]) continue;
    const summary = typeof record["summary"] === "string" ? record["summary"].trim() : "";
    views.push({
      moduleId: record["moduleId"],
      summary: summary || null,
      headline: cleanSpecialistHeadline(
        typeof record["headline"] === "string" ? record["headline"] : null,
      ),
      strengths: strings(record["strengths"]),
      weaknesses: strings(record["weaknesses"]),
      questions: strings(record["questions"]),
      unknowns: strings(record["unknowns"]),
    });
  }
  return views;
}

/** One specialist of a deep run as stored on the run (`raw_response.specialistSet`). */
export interface SpecialistSetEntry {
  id: string;
  kind: "standard" | "custom";
  title: string;
  categories: string[];
}

/**
 * The run's own set of specialists, or null for runs from (the page then uses the
 * four standard modules, which is what those runs ran). Tolerant like `parseSpecialistViews`.
 */
export function parseSpecialistSet(value: unknown): SpecialistSetEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: SpecialistSetEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record["id"] !== "string" || !record["id"]) continue;
    if (typeof record["title"] !== "string" || !record["title"].trim()) continue;
    entries.push({
      id: record["id"],
      kind: record["kind"] === "custom" ? "custom" : "standard",
      title: record["title"].trim(),
      categories: strings(record["categories"]),
    });
  }
  return entries.length ? entries : null;
}
