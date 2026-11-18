/**
 * The orb catalogue: every wait state and AI signal uses
 * `AiOrb` with the states, size, tone and text of its occasion. No home-made dots,
 * pulses or spinners anywhere.
 *
 * States are thinking-orbs' own names (0.3.2): working, searching, solving, listening,
 * connecting, weaving, composing, breathing, shaping. When an occasion has several states
 * they follow the phases in order (e.g. research → analysis), and the change is crossfaded
 * ("AI"). Only one orb moves at a time on a screen.
 *
 * Coral (`tone: "ai"`) means AI is working; neutral ink is ordinary waiting.
 * Step-by-step runs (RunSteps) keep their per-step states in src/lib/cases/run-steps.ts.
 */
import type { OrbState, OrbTone } from "@/components/ai/AiOrb";

export type OrbSize = 20 | 32 | 64;

export type OrbOccasionId =
  | "screening"
  | "deepAnalysis"
  | "identityLookup"
  | "deckReading"
  | "brainThinking"
  | "askInterlect"
  | "aiComposing"
  | "publishFundConfig"
  | "waiting"
  | "buttonPending";

/** Where the orb sits; each occasion names the size for the places it appears. */
export type OrbPlacement = "inline" | "card" | "thread" | "specialist" | "page" | "empty";

export interface OrbOccasion {
  id: OrbOccasionId;
  /** What the occasion is, in Danish (shown on /intern/orbs). */
  name: string;
  /** States in phase order; a single state is used throughout. */
  states: readonly [OrbState, ...OrbState[]];
  /** Size per placement; the first entry is the default. */
  sizes: Partial<Record<OrbPlacement, OrbSize>>;
  defaultPlacement: OrbPlacement;
  tone: OrbTone;
  /** On an inverted primary button the orb is drawn in the theme's opposite ink. */
  onDark?: boolean;
  /** Fixed text next to the orb (exactly as in the design), if any. */
  text?: string;
  /** Where the text comes from when it is not fixed. */
  textSource?: "run-steps" | "specialist-name" | "visible-steps";
}

export const ORB_OCCASIONS = {
  screening: {
    id: "screening",
    name: "Screening kører",
    states: ["searching", "solving"],
    sizes: { card: 32, page: 64 },
    defaultPlacement: "card",
    tone: "ai",
    textSource: "run-steps",
  },
  deepAnalysis: {
    id: "deepAnalysis",
    name: "Dyb analyse",
    states: ["working"],
    sizes: { specialist: 20, page: 64 },
    defaultPlacement: "specialist",
    tone: "ai",
    textSource: "specialist-name",
  },
  identityLookup: {
    id: "identityLookup",
    name: "Identitetsopslag (Opret case)",
    states: ["searching"],
    sizes: { card: 32 },
    defaultPlacement: "card",
    tone: "ai",
    text: "Finder selskabet …",
  },
  deckReading: {
    id: "deckReading",
    name: "Pitch deck læses",
    states: ["working"],
    sizes: { card: 32 },
    defaultPlacement: "card",
    tone: "ai",
    text: "Læser pitch decket …",
  },
  brainThinking: {
    id: "brainThinking",
    name: "Brain tænker",
    states: ["searching", "solving", "composing"],
    sizes: { thread: 32, empty: 64 },
    defaultPlacement: "thread",
    tone: "ai",
    textSource: "visible-steps",
  },
  askInterlect: {
    id: "askInterlect",
    name: "Spørg Interlect (pillen og panelets top)",
    states: ["breathing"],
    sizes: { card: 32, inline: 20 },
    defaultPlacement: "card",
    tone: "ai",
  },
  aiComposing: {
    id: "aiComposing",
    name: "Ret med AI, tese-forslag, composer",
    states: ["composing"],
    sizes: { inline: 20 },
    defaultPlacement: "inline",
    tone: "ai",
  },
  publishFundConfig: {
    id: "publishFundConfig",
    name: "Udgiv teamopsætning",
    states: ["working", "shaping"],
    sizes: { page: 64 },
    defaultPlacement: "page",
    tone: "ai",
    text: "Interlect sætter jeres investeringstese op …",
  },
  waiting: {
    id: "waiting",
    name: "Almindelig ventetid (gem, hent, send invitation)",
    states: ["working"],
    sizes: { inline: 20 },
    defaultPlacement: "inline",
    tone: "neutral",
  },
  buttonPending: {
    id: "buttonPending",
    name: "Knap med loading",
    states: ["working"],
    sizes: { inline: 20 },
    defaultPlacement: "inline",
    tone: "neutral",
    onDark: true,
  },
} as const satisfies Record<OrbOccasionId, OrbOccasion>;

/** The state for phase `phase` (0-based); later phases stay on the last state. */
export function orbStateFor(occasion: OrbOccasionId, phase = 0): OrbState {
  const states: readonly OrbState[] = ORB_OCCASIONS[occasion].states;
  const index = Math.min(Math.max(0, Math.floor(phase)), states.length - 1);
  return states[index] ?? "working";
}

/** The size for a placement, falling back to the occasion's default placement. */
export function orbSizeFor(occasion: OrbOccasionId, placement?: OrbPlacement): OrbSize {
  const entry: OrbOccasion = ORB_OCCASIONS[occasion];
  return (
    (placement ? entry.sizes[placement] : undefined) ?? entry.sizes[entry.defaultPlacement] ?? 20
  );
}
