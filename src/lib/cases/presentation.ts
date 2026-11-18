import { translate, type MessageKey } from "../i18n/translate.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";

export interface ScorePoint {
  category: string;
  score: number | null;
  weight?: number;
  verdict?: string | null;
  rationale?: string;
  positiveDrivers?: string[];
  negativeDrivers?: string[];
  unknowns?: string[];
  confidence?: number | null;
  evidenceIds?: string[];
}

export interface ScoreGroup {
  key: string;
  label: string;
  description: string;
  score: number | null;
  verdict: string | null;
  rationale: string;
  positiveDrivers: string[];
  negativeDrivers: string[];
  unknowns: string[];
  confidence: number | null;
  weight: number;
  evidenceIds: string[];
}

/**
 * Eneste kilde til hvilken af de 5 oversigtsgrupper et scorekategori ruller
 * op i -- brugt både her (case-visning) og i fondsopsætningens
 * kriterie-editor, så de to aldrig kan gå ud af sync med hinanden.
 */
export const SCORE_CATEGORY_GROUPS = [
  {
    key: "market",
    label: translate("da", "cases.score.market.label"),
    description: translate("da", "cases.score.market.description"),
    labelKey: "cases.score.market.label",
    descriptionKey: "cases.score.market.description",
    categories: ["product_market_fit", "market_timing"],
  },
  {
    key: "team",
    label: translate("da", "cases.score.team.label"),
    description: translate("da", "cases.score.team.description"),
    labelKey: "cases.score.team.label",
    descriptionKey: "cases.score.team.description",
    categories: ["founder_market_fit", "team_market_fit", "team_execution"],
  },
  {
    key: "traction",
    label: translate("da", "cases.score.traction.label"),
    description: translate("da", "cases.score.traction.description"),
    labelKey: "cases.score.traction.label",
    descriptionKey: "cases.score.traction.description",
    categories: ["traction_gtm", "financial_strength", "traction"],
  },
  {
    key: "technology",
    label: translate("da", "cases.score.technology.label"),
    description: translate("da", "cases.score.technology.description"),
    labelKey: "cases.score.technology.label",
    descriptionKey: "cases.score.technology.description",
    categories: ["product_technology", "technology_risk", "technology", "evidence_quality"],
  },
  {
    key: "mandate",
    label: translate("da", "cases.score.mandate.label"),
    description: translate("da", "cases.score.mandate.description"),
    labelKey: "cases.score.mandate.label",
    descriptionKey: "cases.score.mandate.description",
    categories: ["fund_thesis_fit", "mandate_fit"],
  },
] as const;
const groups = SCORE_CATEGORY_GROUPS;

/** Score med dansk decimalkomma og højst én decimal ("61,3"); tom værdi giver `fallback`. */
export function formatScore(
  value: number | null | undefined,
  fallback = "–",
  language: Language = "da",
) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? fallback
    : value.toLocaleString(LANGUAGE_TAGS[language], { maximumFractionDigits: 1 });
}

/** Ét punkt pr. af fondens egne kriterier, i fondens rækkefølge -- så casen
 * vises mod præcis de kriterier, fonden har sat op, og ikke mod faste grupper. */
export function criterionScores(
  points: Array<ScorePoint & { criterionKey: string; label: string; description?: string }>,
): ScoreGroup[] {
  return points.map((point) => ({
    key: point.criterionKey,
    label: point.label,
    description: point.description?.trim() || "",
    score: point.score,
    verdict: point.verdict ?? null,
    rationale: point.rationale ?? "",
    positiveDrivers: point.positiveDrivers ?? [],
    negativeDrivers: point.negativeDrivers ?? [],
    unknowns: point.unknowns ?? [],
    confidence: point.confidence ?? null,
    weight: point.weight ?? 0,
    evidenceIds: point.evidenceIds ?? [],
  }));
}

/** Samler fondens rå kriterier i fem stabile visuelle grupper uden at opfinde scores. */
export function groupScores(points: ScorePoint[], language: Language = "da"): ScoreGroup[] {
  return groups.map((group) => {
    const matches = points.filter((point) => group.categories.includes(point.category as never));
    const scored = matches.filter(
      (point): point is ScorePoint & { score: number } => point.score !== null,
    );
    const totalWeight = scored.reduce((sum, point) => sum + (point.weight ?? 1), 0);
    const score =
      scored.length === 0
        ? null
        : Math.round(
            scored.reduce((sum, point) => sum + point.score * (point.weight ?? 1), 0) /
              Math.max(totalWeight, 1),
          );
    const confidences = matches
      .map((point) => point.confidence)
      .filter((value): value is number => value !== null && value !== undefined);
    return {
      key: group.key,
      label: translate(language, group.labelKey),
      description: translate(language, group.descriptionKey),
      score,
      verdict: matches.map((point) => point.verdict).find(Boolean) ?? null,
      rationale: matches
        .map((point) => point.rationale)
        .filter(Boolean)
        .join(" "),
      positiveDrivers: uniqueText(matches.flatMap((point) => point.positiveDrivers ?? [])).slice(
        0,
        3,
      ),
      negativeDrivers: uniqueText(matches.flatMap((point) => point.negativeDrivers ?? [])).slice(
        0,
        3,
      ),
      unknowns: uniqueText(matches.flatMap((point) => point.unknowns ?? [])).slice(0, 3),
      confidence:
        confidences.length === 0
          ? null
          : confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
      weight: matches.reduce((sum, point) => sum + (point.weight ?? 0), 0),
      evidenceIds: [...new Set(matches.flatMap((point) => point.evidenceIds ?? []))],
    };
  });
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export type SignalTone = "positive" | "warning" | "critical" | "neutral";

export const signalTextClass: Record<SignalTone, string> = {
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
  neutral: "text-ink-4",
};

/**
 * Forklarer HVORFOR scoren flyttede sig mellem screening og dyb analyse --
 * udledt af den kategori med størst faktisk delta, aldrig en opdigtet grund.
 * Returnerer `null` når der ikke er nok sammenlignelige data.
 */
export function scoreDeltaReason(
  screenGroups: ScoreGroup[],
  deepGroups: ScoreGroup[],
  delta: number | null,
  language: Language = "da",
): string | null {
  if (delta === null || delta === 0) return null;
  const groupDeltas = deepGroups
    .map((group, index) => {
      const before = screenGroups[index]?.score;
      if (before == null || group.score == null) return null;
      return { label: group.label, delta: group.score - before };
    })
    .filter((item): item is { label: string; delta: number } => item !== null && item.delta !== 0);
  if (groupDeltas.length === 0) return null;
  const driver = groupDeltas.reduce((max, item) =>
    Math.abs(item.delta) > Math.abs(max.delta) ? item : max,
  );
  const key: MessageKey =
    delta >= 0
      ? driver.delta >= 0
        ? "cases.score.deltaUpUp"
        : "cases.score.deltaUpDown"
      : driver.delta >= 0
        ? "cases.score.deltaDownUp"
        : "cases.score.deltaDownDown";
  return translate(language, key, {
    points: Math.abs(delta).toLocaleString(LANGUAGE_TAGS[language], { maximumFractionDigits: 1 }),
    group: driver.label.toLowerCase(),
  });
}

export function shortConclusion(value: string | null, fallback: string) {
  if (!value?.trim()) return fallback;
  // Kræver et stort bogstav/tal efter punktummet, så en forkortelse som
  // "mio. kr." (meget almindelig i danske analysetekster) ikke fejlagtigt
  // læses som sætningsslut.
  const sentence = value.trim().split(/(?<=[.!?])\s+(?=[A-ZÆØÅ0-9])/u)[0] ?? value;
  return sentence.length > 150 ? `${sentence.slice(0, 147).trim()}...` : sentence;
}

/** Teksten efter konklusionens første sætning (samme deling som shortConclusion). */
export function detailAfterFirstSentence(value: string | null) {
  if (!value?.trim()) return null;
  // Kræver et stort bogstav/tal efter punktummet, så en forkortelse som
  // "mio. kr." ikke splitter midt i den første sætning (ellers ville denne
  // funktion og shortConclusion() dele teksten op to forskellige steder).
  const sentences = value.trim().split(/(?<=[.!?])\s+(?=[A-ZÆØÅ0-9])/u);
  if (sentences.length < 2) return null;
  return sentences.slice(1).join(" ").trim();
}

/**
 * D-7: den evidens, AI'en har citeret i en analyse, unik og i citeringsrækkefølge, med
 * kildens titel og adresse til kildemarkørerne. Kun gemt evidens (princip 9).
 */
export function citedSources(
  criteria: Array<{ evidenceIds: string[] }>,
  evidence: Array<{
    id: string;
    claim: string;
    sourceId: string | null;
    documentId: string | null;
    sourceTitle: string | null;
    sourceUrl: string | null;
  }>,
) {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const out: Array<{ id: string; label: string; url: string | null }> = [];
  for (const id of criteria.flatMap((criterion) => criterion.evidenceIds)) {
    const item = byId.get(id);
    if (!item) continue;
    // Én kilde kan bære flere evidensrækker; tælles og vises én gang (som "Grundlag").
    const key = item.sourceId ?? item.documentId ?? item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, label: item.sourceTitle ?? item.claim, url: safeHttpUrl(item.sourceUrl) });
  }
  return out;
}

/** Kun http(s)-adresser må blive til links (kilder kommer fra research og websites). */
export function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
