/**
 * The chosen chart type for a criteria chart (`ChartTypeSwitcher`, and the cards on Konklusion that
 * put the buttons in their own header).
 *
 * Brugerens valg pr. instans huskes i localStorage som en ren bekvemmelighed;
 * intet afhænger af den gemte værdi, så læs/skriv fejler stille.
 */
import { useEffect, useState } from "react";

export type ChartType = "bar" | "column" | "pie" | "ring" | "radar";

export interface ChartCriterionDatum {
  key: string;
  label: string;
  score: number | null;
  weight?: number;
  /** Valgfri sammenligningsværdi, fx screeningens score ved siden af den dybe analyse. */
  compare?: number | null;
  /** The criterion's own colour (pie and rings); else the palette by place. */
  color?: string;
}

const STORAGE_PREFIX = "interlect-chart-type:";
export const ALL_TYPES: ChartType[] = ["bar", "column", "pie", "ring", "radar"];
/** Ringe bliver ulæselige med mange kriterier; radar kræver mindst tre akser. */
const MAX_RINGS = 6;
const MIN_RADAR_AXES = 3;

function readStored(id: string): string | null {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${id}`);
  } catch {
    return null;
  }
}

function writeStored(id: string, type: string) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${id}`, type);
  } catch {
    /* privat visning eller blokeret storage -- valget huskes blot ikke */
  }
}

/**
 * The chosen type and the types this data can show (the card on Konklusion puts the buttons in its
 * own header, so state, buttons and chart are separate pieces).
 */
export function useChartType({
  id,
  data,
  defaultType = "bar",
  types = ALL_TYPES,
}: {
  id: string;
  data: readonly ChartCriterionDatum[];
  defaultType?: ChartType;
  types?: readonly ChartType[];
}) {
  const scoredCount = data.filter((item) => item.score !== null).length;
  const available = types.filter((type) => {
    if (type === "ring") return data.length > 0 && data.length <= MAX_RINGS;
    // Radar tegner kun scorede kriterier som akser (et manglende punkt i centrum ville ligne 0).
    if (type === "radar") return scoredCount >= MIN_RADAR_AXES;
    if (type === "pie") return data.some((item) => (item.weight ?? 0) > 0);
    return true;
  });
  const { choice, choose } = useStoredChoice(id, available, defaultType, "bar");
  return { type: choice, available, choose };
}

/**
 * A choice among `available`, remembered under `id`; a stored value that is no longer available
 * falls back to `preferred`, else the first available (the cards on Konklusion).
 */
export function useStoredChoice<T extends string>(
  id: string,
  available: readonly T[],
  preferred: T,
  empty: T,
) {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    setPicked(readStored(id));
  }, [id]);
  const isAvailable = (value: string | null): value is T =>
    value !== null && (available as readonly string[]).includes(value);
  const choice: T = isAvailable(picked)
    ? picked
    : available.includes(preferred)
      ? preferred
      : (available[0] ?? empty);

  function choose(next: T) {
    setPicked(next);
    writeStored(id, next);
  }

  return { choice, choose };
}
