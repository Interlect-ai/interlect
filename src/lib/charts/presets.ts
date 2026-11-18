/**
 * Chart presets: one preset per chart use in the design, so pages
 * never carry loose numbers. Colours are token names, never hex. Values come from
 * "Graf-system (bklit) v1.0" and "Grafer" (wins where they differ: rings rotate in at most 12°, the
 * hovered segment grows 4 px in 160 ms and the rest dims to 55 %).
 *
 * `studioUrl` is filled in when a preset is tuned in bklit Studio. `available`
 * says whether the bklit component is vendored in src/components/charts yet; the others
 * arrive with the page that needs them, as says.
 */
import type { Transition } from "motion/react";
import { EASE } from "@/lib/motion";

export type BklitSlug =
  | "ring-chart"
  | "pie-chart"
  | "bar-chart"
  | "radar-chart"
  | "gauge-chart"
  | "line-chart"
  | "area-chart"
  | "composed-chart"
  | "heatmap-chart"
  | "funnel-chart"
  | "geo-map";

/** A colour token from styles.css, e.g. "--series-1" or "--chart-track". */
export type ColorToken = `--${string}`;

export type ChartEnter =
  | { kind: "spring"; stiffness: number; damping: number }
  | { kind: "ease"; durationMs: number; ease: "out" | "standard" };

export interface ChartPreset {
  id: string;
  /** Where it is used, in Danish (shown on /intern/grafer). */
  name: string;
  chart: BklitSlug;
  /** Pages that use it. */
  pages: readonly string[];
  studioUrl?: string;
  colors: {
    series: readonly ColorToken[];
    track?: ColorToken;
    highlight?: ColorToken;
    /** Opacity of the elements that are not hovered (0–1). */
    muted?: number;
  };
  geometry: {
    radius?: number;
    /** Gap between segments; for rings in percent of the circumference. */
    gap?: number;
    stroke?: number;
    /** Stroke while hovered (rings, gauges). */
    hoverStroke?: number;
    barHeight?: number;
    innerRadius?: number;
    /** Degrees the ring rotates while it draws in (at most 12). */
    enterRotation?: number;
    dash?: readonly [number, number];
  };
  labels: { show: boolean; format?: "pct" | "kr" | "score" | "int" };
  tooltip: { variant: "dark-pill"; delayMs: number };
  motion: {
    enter: ChartEnter;
    delayMs: number;
    staggerMs: number;
    /** Charts animate between values; they are never drawn again from scratch. */
    update: "tween-values";
  };
  hover: { grow?: number; dimOthers?: number };
  reducedMotion: "fade-only";
  /** The bklit component is in src/components/charts (else it comes with its page). */
  available: boolean;
  /** One line on how it should look, shown on /intern/grafer. */
  rule: string;
}

const SERIES: readonly ColorToken[] = [
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
  "--series-7",
  "--series-8",
  "--series-9",
  "--series-10",
];

/** Shared motion ("Motion" + "Grafer"). */
const BARS_GROW: ChartPreset["motion"] = {
  enter: { kind: "ease", durationMs: 800, ease: "out" },
  delayMs: 200,
  staggerMs: 50,
  update: "tween-values",
};
const LINE_DRAW: ChartPreset["motion"] = {
  enter: { kind: "ease", durationMs: 1100, ease: "out" },
  delayMs: 200,
  staggerMs: 0,
  update: "tween-values",
};
const RING_DRAW: ChartPreset["motion"] = {
  enter: { kind: "ease", durationMs: 900, ease: "out" },
  delayMs: 200,
  staggerMs: 40,
  update: "tween-values",
};
const TOOLTIP = { variant: "dark-pill", delayMs: 0 } as const;
const HOVER = { grow: 4, dimOthers: 0.55 } as const;

export const CHART_PRESETS = {
  "profil-ring": {
    id: "profil-ring",
    name: "Profil mod tesen (ring)",
    // 03 names ring-chart, but bklit's ring-chart draws concentric rings; the prototype's
    // ring is one segmented donut, which is bklit's pie-chart with an inner radius.
    chart: "pie-chart",
    pages: ["Screening", "Dyb analyse"],
    colors: { series: SERIES, track: "--chart-track", muted: 0.55 },
    geometry: { gap: 1.3, stroke: 13, hoverStroke: 17, enterRotation: 12 },
    labels: { show: false, format: "score" },
    tooltip: TOOLTIP,
    motion: RING_DRAW,
    hover: HOVER,
    reducedMotion: "fade-only",
    available: true,
    rule: "Segment-afstand 1,2–1,4 %, butt caps, hover gør segmentet tykkere (13 → 17).",
  },
  "profil-rangering": {
    id: "profil-rangering",
    name: "Profil som rangering",
    chart: "bar-chart",
    pages: ["Screening", "Dyb analyse"],
    colors: { series: SERIES, track: "--chart-track", muted: 0.55 },
    geometry: { barHeight: 12, radius: 6 },
    labels: { show: true, format: "score" },
    tooltip: TOOLTIP,
    motion: BARS_GROW,
    hover: HOVER,
    reducedMotion: "fade-only",
    available: true,
    rule: "Vandrette søjler på et hatchet spor, sorteret efter bidrag.",
  },
  "profil-radar": {
    id: "profil-radar",
    name: "Profil som radar",
    chart: "radar-chart",
    pages: ["Screening", "Dyb analyse"],
    colors: { series: ["--ink-1", "--action"], muted: 0.55 },
    geometry: { stroke: 1.5 },
    labels: { show: true, format: "score" },
    tooltip: TOOLTIP,
    motion: { ...RING_DRAW, staggerMs: 0 },
    hover: HOVER,
    reducedMotion: "fade-only",
    available: true,
    rule: "Tesen stiplet i violet, casen fyldt 16 %, skalerer ind fra midten.",
  },
  "profil-bidrag": {
    id: "profil-bidrag",
    name: "Profil som bidrag (vandfald)",
    chart: "composed-chart",
    pages: ["Screening", "Dyb analyse"],
    colors: { series: ["--ink-1", "--ink-4"], highlight: "--action" },
    geometry: { radius: 6 },
    labels: { show: true, format: "score" },
    tooltip: TOOLTIP,
    motion: BARS_GROW,
    hover: HOVER,
    reducedMotion: "fade-only",
    available: false,
    rule: "Vægtede bidrag regnet i kode, negative i neutral, tærskel 70 som linje.",
  },
  "specialist-gauge": {
    id: "specialist-gauge",
    name: "Score pr. specialist",
    chart: "gauge-chart",
    pages: ["Dyb analyse"],
    colors: { series: SERIES, track: "--chart-track" },
    geometry: { stroke: 10 },
    labels: { show: true, format: "score" },
    tooltip: TOOLTIP,
    motion: RING_DRAW,
    hover: {},
    reducedMotion: "fade-only",
    available: false,
    rule: "Halvcirkel, stroke 10, runde ender, specialistens seriefarve.",
  },
  "screening-dyb-slope": {
    id: "screening-dyb-slope",
    name: "Screening → dyb analyse",
    chart: "line-chart",
    pages: ["Dyb analyse"],
    colors: { series: SERIES, muted: 0.25 },
    geometry: { stroke: 2 },
    labels: { show: true, format: "score" },
    tooltip: TOOLTIP,
    motion: LINE_DRAW,
    hover: { dimOthers: 0.25 },
    reducedMotion: "fade-only",
    available: false,
    rule: "Én linje pr. kriterie, delta i grøn/rød, hover dæmper de andre til 25 %.",
  },
  "omsaetning-margin": {
    id: "omsaetning-margin",
    name: "Omsætning og bruttomargin",
    chart: "composed-chart",
    pages: ["Screening", "Dyb analyse"],
    colors: { series: ["--series-1", "--series-8"] },
    geometry: { radius: 8, stroke: 2.5 },
    labels: { show: true, format: "kr" },
    tooltip: TOOLTIP,
    motion: BARS_GROW,
    hover: HOVER,
    reducedMotion: "fade-only",
    available: false,
    rule: "Søjler radius 8 (serie 1) og linje 2,5 px (serie 8) med hule punkter.",
  },
  "likviditet-runway": {
    id: "likviditet-runway",
    name: "Likviditet og runway",
    chart: "area-chart",
    pages: ["Dyb analyse"],
    colors: { series: ["--series-1"], highlight: "--critical" },
    geometry: { stroke: 2, dash: [4, 5] },
    labels: { show: true, format: "kr" },
    tooltip: TOOLTIP,
    motion: LINE_DRAW,
    hover: {},
    reducedMotion: "fade-only",
    available: false,
    rule: "Gradient 32 % → 0, fremskrivning stiplet 4/5, rød markør ved runway-slut.",
  },
  marked: {
    id: "marked",
    name: "Marked",
    chart: "area-chart",
    pages: ["Dyb analyse"],
    colors: { series: ["--series-5"] },
    geometry: { stroke: 2, dash: [4, 5] },
    labels: { show: true, format: "kr" },
    tooltip: TOOLTIP,
    motion: LINE_DRAW,
    hover: {},
    reducedMotion: "fade-only",
    available: false,
    rule: "Vækstkurve med samme gradient som runway.",
  },
  "unit-economics": {
    id: "unit-economics",
    name: "Unit economics",
    chart: "bar-chart",
    pages: ["Dyb analyse"],
    colors: { series: ["--series-1"], track: "--chart-track" },
    geometry: { barHeight: 12, radius: 6 },
    labels: { show: true, format: "kr" },
    tooltip: TOOLTIP,
    motion: BARS_GROW,
    hover: HOVER,
    reducedMotion: "fade-only",
    available: true,
    rule: "Vandret, spor --chart-track, højde 12, radius 6.",
  },
  "team-radar": {
    id: "team-radar",
    name: "Team",
    chart: "radar-chart",
    pages: ["Dyb analyse"],
    colors: { series: ["--series-2"], highlight: "--warning" },
    geometry: { stroke: 0.6 },
    labels: { show: true, format: "score" },
    tooltip: TOOLTIP,
    motion: { ...RING_DRAW, staggerMs: 0 },
    hover: HOVER,
    reducedMotion: "fade-only",
    available: true,
    rule: "5 akser, 3 ringe 0,6 px, fyld 22 %, svag akse i orange.",
  },
  risikomatrix: {
    id: "risikomatrix",
    name: "Risici (5 × 5)",
    chart: "heatmap-chart",
    pages: ["Dyb analyse"],
    colors: { series: ["--chart-track", "--warning-wash", "--warning", "--critical"] },
    geometry: { radius: 6, gap: 4 },
    labels: { show: true, format: "int" },
    tooltip: TOOLTIP,
    motion: { ...BARS_GROW, staggerMs: 20 },
    hover: {},
    reducedMotion: "fade-only",
    available: false,
    rule: "Sandsynlighed × konsekvens, 4 trin fra spor til --critical, kun kritiske felter i rød.",
  },
  resultatbro: {
    id: "resultatbro",
    name: "Resultatbro",
    chart: "composed-chart",
    pages: ["Dyb analyse"],
    colors: { series: ["--positive", "--critical", "--ink-1"] },
    geometry: { radius: 6 },
    labels: { show: true, format: "kr" },
    tooltip: TOOLTIP,
    motion: BARS_GROW,
    hover: HOVER,
    reducedMotion: "fade-only",
    available: false,
    rule: "Vandfald fra omsætning til resultat, som i Dyb analyse v5.",
  },
  "overblik-tragt": {
    id: "overblik-tragt",
    name: "Pipeline-tragt",
    chart: "funnel-chart",
    pages: ["Overblik"],
    colors: { series: ["--ink-1", "--ink-2", "--ink-3", "--positive"], track: "--chart-track" },
    geometry: { radius: 999 },
    labels: { show: true, format: "pct" },
    tooltip: TOOLTIP,
    motion: { ...BARS_GROW, staggerMs: 90 },
    hover: HOVER,
    reducedMotion: "fade-only",
    available: false,
    rule: "Nye → Screenet → Over tærsklen → Dyb analyse → Komité → Investeret, % af nye; hatchet spor.",
  },
  "overblik-geografi": {
    id: "overblik-geografi",
    name: "Hvor casene kommer fra",
    chart: "geo-map",
    pages: ["Overblik"],
    colors: { series: ["--series-1"], track: "--chart-track" },
    geometry: {},
    labels: { show: false },
    tooltip: TOOLTIP,
    motion: {
      enter: { kind: "ease", durationMs: 600, ease: "out" },
      delayMs: 200,
      staggerMs: 0,
      update: "tween-values",
    },
    hover: {},
    reducedMotion: "fade-only",
    available: false,
    rule: "Seriefarve 1 i fire trin på et neutralt kort (GeoMap.jsx: d3-geo og world-atlas).",
  },
  "overblik-sektor-fase": {
    id: "overblik-sektor-fase",
    name: "Sektor og fase",
    chart: "heatmap-chart",
    pages: ["Overblik"],
    colors: { series: ["--chart-track", "--series-9", "--series-1"] },
    geometry: { radius: 6, gap: 3 },
    labels: { show: true, format: "int" },
    tooltip: TOOLTIP,
    motion: { ...BARS_GROW, staggerMs: 20 },
    hover: {},
    reducedMotion: "fade-only",
    available: false,
    rule: "Neutral rampe, tomme felter som spor.",
  },
  "overblik-tilgang": {
    id: "overblik-tilgang",
    name: "Tilgang pr. uge",
    chart: "bar-chart",
    pages: ["Overblik"],
    colors: { series: ["--ink-1", "--ink-4"], track: "--chart-track" },
    geometry: { radius: 6 },
    labels: { show: false, format: "int" },
    tooltip: TOOLTIP,
    motion: { ...BARS_GROW, staggerMs: 40 },
    hover: HOVER,
    reducedMotion: "fade-only",
    available: true,
    rule: "Nye pr. uge som stablede søjler, fyldt med andelen sendt videre.",
  },
  "overblik-scorefordeling": {
    id: "overblik-scorefordeling",
    name: "Scorefordeling",
    chart: "bar-chart",
    pages: ["Overblik"],
    colors: { series: ["--ink-1", "--ink-4"], highlight: "--action" },
    geometry: { radius: 6, dash: [4, 4] },
    labels: { show: false, format: "int" },
    tooltip: TOOLTIP,
    motion: { ...BARS_GROW, staggerMs: 40 },
    hover: HOVER,
    reducedMotion: "fade-only",
    available: true,
    rule: "Histogram med stiplet tærskel; over tærsklen i blæk, resten ink-4.",
  },
  "overblik-stadie": {
    id: "overblik-stadie",
    name: "Stadie",
    chart: "pie-chart",
    pages: ["Overblik"],
    colors: { series: SERIES, muted: 0.55 },
    geometry: { gap: 1.2, innerRadius: 0.72 },
    labels: { show: false, format: "pct" },
    tooltip: TOOLTIP,
    motion: RING_DRAW,
    hover: HOVER,
    reducedMotion: "fade-only",
    available: true,
    rule: "Donut med mellemrum og butt caps.",
  },
  sparkline: {
    id: "sparkline",
    name: "Sparkline i kort",
    chart: "line-chart",
    pages: ["Screening", "Overblik"],
    colors: { series: ["--ink-2"] },
    geometry: { stroke: 1.5 },
    labels: { show: false },
    tooltip: TOOLTIP,
    motion: LINE_DRAW,
    hover: {},
    reducedMotion: "fade-only",
    available: false,
    rule: "Minimal: 2 px linje, estimat stiplet, sidste punkt som ring.",
  },
} as const satisfies Record<string, ChartPreset>;

export type ChartPresetId = keyof typeof CHART_PRESETS;

export function chartPreset(id: ChartPresetId): ChartPreset {
  return CHART_PRESETS[id];
}

/** `var(--series-1)` from a token name, for SVG fills and strokes. */
export function tokenColor(token: ColorToken): string {
  return `var(${token})`;
}

/** The preset's enter animation as a motion transition (reduced motion: a short fade). */
export function presetTransition(preset: ChartPreset, reduced = false): Transition {
  if (reduced) return { duration: 0.12, ease: "linear" };
  const { enter, delayMs } = preset.motion;
  if (enter.kind === "spring") {
    return {
      type: "spring",
      stiffness: enter.stiffness,
      damping: enter.damping,
      delay: delayMs / 1000,
    };
  }
  return {
    duration: enter.durationMs / 1000,
    ease: enter.ease === "out" ? EASE.out : EASE.standard,
    delay: delayMs / 1000,
  };
}

/** Seconds between items (bars, segments) for the stagger. */
export function presetStagger(preset: ChartPreset): number {
  return preset.motion.staggerMs / 1000;
}
