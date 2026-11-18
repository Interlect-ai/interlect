/**
 * One place for how a risk looks as a marker and in the 5 x 5 matrix, shared by the Risici tab,
 * the Konklusion card and the committee pack. Critical is red with `--on-critical` on top (white
 * in light, the dark ink in dark, so the number stays readable); everything else is ink.
 */
import type { HeatBand } from "@/lib/cases/deep-view";

type Level = "critical" | "high" | "medium" | "low";

export const riskMarkerColor = (level: Level) =>
  level === "critical" ? "var(--critical)" : "var(--ink-1)";

export const riskMarkerInk = (level: Level) =>
  level === "critical" ? "var(--on-critical)" : "var(--ink-inverse)";

export const HEAT_BACKGROUND: Record<HeatBand, string> = {
  critical: "color-mix(in srgb, var(--critical) 18%, transparent)",
  high: "color-mix(in srgb, var(--warning) 20%, transparent)",
  medium: "color-mix(in srgb, var(--warning) 8%, transparent)",
  none: "var(--bg-surface)",
};
