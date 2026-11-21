/**
 * The specialists of one stage as "Sådan analyserer vi" shows them (prototype
 * `Teamopsaetning v3.dc.html`, `specCards` / `specSheet`). A specialist has named focus areas; each
 * has a name and the text of what the specialist looks at. They are stored as the specialist's
 * text (`prompt_module_overrides` per stage for a standard specialist, the rows of a fund's own),
 * in the shape `draftSaveParts` (setup-draft.ts) already writes:
 *
 *   mandate        one line per focus area, "Name: text"
 *   evidenceTests  one line per focus area (what counts as evidence); the mandate when there is none
 *   riskAreas named risk areas (names, never keys such as `founder_integrity`)
 *
 * Pure and tested; the page is `components/funds/setup/AnalysisPlace.tsx`.
 */

export interface SpecialistFocus {
  /** The name of the focus area ("Betalende kunder"). */
  title: string;
  /** What the specialist examines, in the team's words. */
  text: string;
  /** What counts as evidence; empty when the stored text has none for this area. */
  evidence: string;
}

export interface SpecialistText {
  mandate: string[];
  evidenceTests: string[];
  riskAreas: string[];
}

export const FOCUS_MAX = 12;
export const FOCUS_TITLE_MAX = 60;
/** The name, ": " and the text must fit one line of the mandate (400 characters). */
export const FOCUS_TEXT_MAX = 320;
const LINE_MAX = 400;
const FOCUS_LABEL_MAX = 48;
const RISK_MAX = 120;

/** Splits "Name: text"; a line without a short name in front has no name. */
function splitLine(line: string): { title: string; text: string } {
  const cut = line.indexOf(": ");
  if (cut > 0 && cut <= FOCUS_TITLE_MAX) {
    return { title: line.slice(0, cut).trim(), text: line.slice(cut + 2).trim() };
  }
  return { title: "", text: line.trim() };
}

/** The focus areas of a stored specialist text; the evidence follows the mandate line by line. */
export function focusAreasOf(text: SpecialistText): SpecialistFocus[] {
  const aligned = text.evidenceTests.length === text.mandate.length;
  return text.mandate.map((line, index) => {
    const { title, text: body } = splitLine(line);
    const own = aligned ? (text.evidenceTests[index] ?? "") : "";
    // Evidence that is the mandate line itself was copied there by an earlier save: it follows the text.
    return { title, text: body, evidence: own.trim() === line.trim() ? "" : own };
  });
}

const clip = (value: string, max: number) => value.trim().slice(0, max);

/** A technical key (`founder_integrity`) is not a name for a risk area. */
const isKey = (value: string) => /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value);

/**
 * The text to save for the focus areas. Evidence is kept per area (an area without its own
 * evidence gets its mandate line). The risk areas are the team's own names (those that are not a
 * technical key and not just an earlier area's name) plus the names of the areas now.
 */
export function specialistTextOf(
  foci: readonly SpecialistFocus[],
  existingRisks: readonly string[] = [],
  previousFoci: readonly SpecialistFocus[] = [],
): SpecialistText {
  const used = foci.filter((focus) => focus.title.trim() || focus.text.trim());
  const mandate = used.map((focus) =>
    clip(focus.title.trim() ? `${focus.title.trim()}: ${focus.text.trim()}` : focus.text, LINE_MAX),
  );
  const evidenceTests = used.map(
    (focus, index) => clip(focus.evidence, LINE_MAX) || mandate[index]!,
  );
  const earlier = new Set(previousFoci.map((focus) => focusLabel(focus)));
  const own = existingRisks
    .map((risk) => risk.trim())
    .filter((risk) => risk && !isKey(risk) && !earlier.has(risk));
  const now = used.map((focus) => focusLabel(focus)).filter(Boolean);
  const riskAreas = [...new Set([...own, ...now])].slice(0, 12).map((risk) => clip(risk, RISK_MAX));
  return { mandate, evidenceTests, riskAreas };
}

/**
 * What a focus area is called on a card or a row: its name, else the start of its text (an older
 * line has no "Name: " in front of it), else "" (nothing written yet).
 */
export function focusLabel(focus: Pick<SpecialistFocus, "title" | "text">): string {
  const title = focus.title.trim();
  if (title) return title;
  const text = focus.text.trim();
  if (text.length <= FOCUS_LABEL_MAX) return text;
  const cut = text.slice(0, FOCUS_LABEL_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

/** A focus area needs its text; a name is optional (an older line has none). */
export type FocusProblem = "none" | "text" | "tooMany" | "long";

/** Why the focus areas cannot be saved yet; empty when they can. */
export function focusProblems(
  foci: readonly SpecialistFocus[],
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): FocusProblem[] {
  const problems: FocusProblem[] = [];
  if (!foci.length && !allowEmpty) problems.push("none");
  if (foci.some((focus) => !focus.text.trim())) problems.push("text");
  if (foci.length > FOCUS_MAX) problems.push("tooMany");
  // A line is "Name: text" in at most 400 characters; it is reported, never cut.
  if (
    foci.some(
      (focus) =>
        (focus.title.trim() ? focus.title.trim().length + 2 : 0) + focus.text.trim().length >
        LINE_MAX,
    )
  )
    problems.push("long");
  return problems;
}

/** The same focus areas (names, texts, evidence) in the same order? */
export function sameFoci(a: readonly SpecialistFocus[], b: readonly SpecialistFocus[]): boolean {
  return (
    a.length === b.length &&
    a.every((focus, index) => {
      const other = b[index]!;
      return (
        focus.title.trim() === other.title.trim() &&
        focus.text.trim() === other.text.trim() &&
        focus.evidence.trim() === other.evidence.trim()
      );
    })
  );
}

/** What a new fund's own specialist is for, when the team has not written it (the schema wants 10+). */
export function purposeOf(name: string, foci: readonly SpecialistFocus[]): string {
  const titles = foci.map((focus) => focus.title.trim()).filter(Boolean);
  const base = clip(`${name.trim()}: ${titles.join(", ")}`, 600);
  if (base.length >= 10) return base;
  const first = foci.find((focus) => focus.text.trim())?.text.trim() ?? "";
  return clip(`${base} ${first}`.trim().padEnd(10, "."), 600);
}
