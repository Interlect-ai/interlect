/**
 * "Ny investeringstese" (prototypen `Ny investeringstese v3`): svarene fra de syv trin,
 * og hvordan de bliver til en opsætningskladde. Ren fil uden database og uden React, så den kan
 * testes med node --test. Siden bruger `createFund` til at oprette fonden og gemmer derefter
 * kladden med `saveFundConfigDraft` og udgiver den; ingen ny skrivevej.
 */
import {
  WEIGHT_MAX_PERCENT,
  WEIGHT_MIN_PERCENT,
  WEIGHT_TOTAL_PERCENT,
  checkConfigLimits,
  limitViolationsMessage,
} from "./config-limits.ts";
import type { FundConfigTemplate, FundTemplateKey } from "./config-templates.ts";
import type { SpecialistModuleId } from "../analysis/specialist-prompts.ts";
import { STANDARD_SPECIALIST_CARDS } from "./specialist-cards.ts";
import { specialistColor } from "../charts/colors.ts";
import type { THESIS_STEPS } from "./thesis-steps.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import { geographyKeys, stageExpectationKeys } from "./basis-labels.ts";
import { LANGUAGES, LANGUAGE_TAGS, type Language } from "../i18n/language.ts";

/** Kurs til at omregne prototypens kroner til EUR, som opsætningen gemmer ticket i. */
export const DKK_PER_EUR = 7.46;
/** Højst så mange kriterier, at hvert kan nå minimumsvægten. */
export const MAX_CRITERIA = Math.floor(WEIGHT_TOTAL_PERCENT / WEIGHT_MIN_PERCENT);
export const MIN_CRITERIA = 3;

export type ScoreCategory = FundConfigTemplate["criteria"][number]["category"];

export const AREAS: ReadonlyArray<{
  title: MessageKey;
  sub: MessageKey;
  step: (typeof THESIS_STEPS)[number];
}> = [
  { title: "thesis.area.who.title", sub: "thesis.area.who.sub", step: "investor_type" },
  { title: "thesis.area.basis.title", sub: "thesis.area.basis.sub", step: "frames" },
  { title: "thesis.area.thesis.title", sub: "thesis.area.thesis.sub", step: "thesis" },
  { title: "thesis.area.weights.title", sub: "thesis.area.weights.sub", step: "weights" },
  { title: "thesis.area.mandate.title", sub: "thesis.area.mandate.sub", step: "dealbreakers" },
  { title: "thesis.area.specialists.title", sub: "thesis.area.specialists.sub", step: "expertise" },
  { title: "thesis.area.review.title", sub: "thesis.area.review.sub", step: "review" },
];

export const ASK_HINTS: readonly MessageKey[] = [
  "thesis.askHint.who",
  "thesis.askHint.frames",
  "thesis.askHint.thesis",
  "thesis.askHint.weights",
  "thesis.askHint.mandate",
  "thesis.askHint.specialists",
];

export const ASK_PLACEHOLDERS: readonly MessageKey[] = [
  "thesis.askPlaceholder.who",
  "thesis.askPlaceholder.frames",
  "thesis.askPlaceholder.thesis",
  "thesis.askPlaceholder.weights",
  "thesis.askPlaceholder.mandate",
  "thesis.askPlaceholder.specialists",
];

/** Det, "Giv mig et forslag" spørger om, når brugeren ikke selv har skrevet noget. */
export const SUGGESTION_QUESTIONS: readonly MessageKey[] = [
  "thesis.suggestQuestion.who",
  "thesis.suggestQuestion.frames",
  "thesis.suggestQuestion.thesis",
  "thesis.suggestQuestion.weights",
  "thesis.suggestQuestion.mandate",
  "thesis.suggestQuestion.specialists",
];

export interface InvestorType {
  /** The Danish name: it goes to the model as context, the page shows `labelKey`. */
  label: string;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: "rocket" | "building" | "house" | "users" | "pencil";
  seriesVar: string;
  template: FundTemplateKey;
}

export const INVESTOR_TYPES: readonly InvestorType[] = [
  {
    label: "Venturefond",
    labelKey: "thesis.investor.venture.label",
    descriptionKey: "thesis.investor.venture.description",
    icon: "rocket",
    seriesVar: "var(--series-1)",
    template: "venture",
  },
  {
    label: "Corporate venture",
    labelKey: "thesis.investor.corporate.label",
    descriptionKey: "thesis.investor.corporate.description",
    icon: "building",
    seriesVar: "var(--series-7)",
    template: "thematic",
  },
  {
    label: "Family office",
    labelKey: "thesis.investor.family.label",
    descriptionKey: "thesis.investor.family.description",
    icon: "house",
    seriesVar: "var(--series-2)",
    template: "growth",
  },
  {
    label: "Business angels",
    labelKey: "thesis.investor.angels.label",
    descriptionKey: "thesis.investor.angels.description",
    icon: "users",
    seriesVar: "var(--series-5)",
    template: "venture",
  },
  {
    label: "Andet",
    labelKey: "thesis.investor.other.label",
    descriptionKey: "thesis.investor.other.description",
    icon: "pencil",
    seriesVar: "var(--ink-2)",
    template: "blank",
  },
];
export const OTHER_TYPE_INDEX = 4;

/** The phases and geographies as the setup stores them: neutral keys (`basis-labels.ts`). */
export const PHASES = ["pre_seed", "seed", "series_a", "series_b", "growth"] as const;
export const GEOGRAPHIES = ["DK", "nordics", "europe", "global"] as const;
// i18n-keep: saved in the fund's setup as the fund's own text.
export const SECTORS = [
  "Klima",
  "Fødevarer",
  "Software",
  "Sundhed",
  "Industri",
  "Fintech",
] as const;

/** What the page shows for the stored values above, in the same order. */
export const PHASE_LABEL_KEYS: readonly MessageKey[] = [
  "thesis.phase.preSeed",
  "thesis.phase.seed",
  "thesis.phase.seriesA",
  "thesis.phase.seriesB",
  "thesis.phase.growth",
];
export const GEOGRAPHY_LABEL_KEYS: readonly MessageKey[] = [
  "thesis.geography.denmark",
  "thesis.geography.nordics",
  "thesis.geography.europe",
  "thesis.geography.global",
];
export const SECTOR_LABEL_KEYS: readonly MessageKey[] = [
  "thesis.sector.climate",
  "thesis.sector.food",
  "thesis.sector.software",
  "thesis.sector.health",
  "thesis.sector.industry",
  "thesis.sector.fintech",
];

export const TICKET_PRESETS: ReadonlyArray<{ labelKey: MessageKey; kr: number }> = [
  { labelKey: "thesis.ticketPreset.k100", kr: 100_000 },
  { labelKey: "thesis.ticketPreset.k500", kr: 500_000 },
  { labelKey: "thesis.ticketPreset.m1", kr: 1_000_000 },
  { labelKey: "thesis.ticketPreset.m5", kr: 5_000_000 },
  { labelKey: "thesis.ticketPreset.m10", kr: 10_000_000 },
];
/** Ticketskalaens højre ende i kroner (prototypen: 0, 25 og 50 mio. kr.). */
export const TICKET_SCALE_MAX_KR = 50_000_000;

/** The page shows `RISK_LABEL_KEYS`; the Danish names go to the model as context. */
export const RISK_LABEL_KEYS: readonly MessageKey[] = [
  "thesis.risk.veryCautious",
  "thesis.risk.cautious",
  "thesis.risk.balanced",
  "thesis.risk.bold",
  "thesis.risk.veryBold",
];
export const RISK_LABELS = [
  "Meget forsigtig",
  "Forsigtig",
  "Balanceret",
  "Modig",
  "Meget modig",
] as const;
/** Saved in the new fund's setup as its risk profile, in the language of the page. */
const RISK_POSTURE_KEYS: readonly MessageKey[] = [
  "thesis.defaults.risk.veryCautious",
  "thesis.defaults.risk.cautious",
  "thesis.defaults.risk.balanced",
  "thesis.defaults.risk.bold",
  "thesis.defaults.risk.veryBold",
];

export interface WizardCriterion {
  key: string;
  label: string;
  weight: number;
  description: string;
  category: ScoreCategory;
}

const DEFAULT_CRITERION_BASE: ReadonlyArray<Pick<WizardCriterion, "key" | "weight" | "category">> =
  [
    { key: "team", weight: 22, category: "founder_market_fit" },
    { key: "marked", weight: 14, category: "market_timing" },
    { key: "produkt", weight: 14, category: "product_market_fit" },
    { key: "traction", weight: 16, category: "traction_gtm" },
    { key: "timing", weight: 10, category: "market_timing" },
    { key: "teknologi", weight: 12, category: "product_technology" },
    { key: "deal", weight: 12, category: "fund_thesis_fit" },
  ];

/**
 * The starting criteria. Their names and descriptions are saved in the new fund's setup, so they
 * are written in the language of the page; the keys stay the same in every language.
 */
export function defaultCriteria(language: Language = "da"): WizardCriterion[] {
  return DEFAULT_CRITERION_BASE.map((base) => ({
    ...base,
    label: translate(language, `thesis.defaults.criteria.${base.key}.label` as MessageKey),
    description: translate(
      language,
      `thesis.defaults.criteria.${base.key}.description` as MessageKey,
    ),
  }));
}

export const DEFAULT_CRITERIA: readonly WizardCriterion[] = defaultCriteria("da");

/**
 * The starting criteria the team has not touched, in `language`: the wizard starts before
 * the fund's language is known, and a saved draft keeps the language it was made in. A name or a
 * description the team wrote stays as written. Returns the same array when nothing changes.
 */
export function localizeDefaultCriteria(
  criteria: readonly WizardCriterion[],
  language: Language,
): readonly WizardCriterion[] {
  const target = new Map(defaultCriteria(language).map((criterion) => [criterion.key, criterion]));
  const every = LANGUAGES.flatMap((each) => defaultCriteria(each));
  let changed = false;
  const next = criteria.map((criterion) => {
    const wanted = target.get(criterion.key);
    if (!wanted) return criterion;
    const isDefault = (field: "label" | "description") =>
      every.some((d) => d.key === criterion.key && d[field] === criterion[field]);
    const label = isDefault("label") ? wanted.label : criterion.label;
    const description = isDefault("description") ? wanted.description : criterion.description;
    if (label === criterion.label && description === criterion.description) return criterion;
    changed = true;
    return { ...criterion, label, description };
  });
  return changed ? next : criteria;
}

export type GateIcon = "map-pin" | "layers" | "coins" | "ban" | "pencil";
export interface WizardGate {
  key: string;
  label: string;
  icon: GateIcon;
  /** true = "Vurdering" (et menneske tager stilling), false = "Bindende". */
  review: boolean;
}

export interface SpecialistDef {
  /** The standard specialist's module id, as `fund_specialists` knows it. */
  id: SpecialistModuleId;
  label: string;
  role: string;
  focus: readonly [string, string, string];
  seriesVar: string;
}

/** The four real standard specialists of the engine, with the same cards as the fund setup. */
export const SPECIALISTS: readonly SpecialistDef[] = (
  Object.keys(STANDARD_SPECIALIST_CARDS) as SpecialistModuleId[]
).map((id) => ({ id, ...STANDARD_SPECIALIST_CARDS[id], seriesVar: specialistColor(id) }));

export const SETUP_STEPS: readonly MessageKey[] = [
  "thesis.setup.step1",
  "thesis.setup.step2",
  "thesis.setup.step3",
  "thesis.setup.step4",
  "thesis.setup.step5",
];

export interface WizardState {
  name: string;
  /** Indeks i INVESTOR_TYPES, eller null. */
  type: number | null;
  other: string;
  phases: number[];
  geo: number[];
  geoExtra: string[];
  sectors: number[];
  sectorExtra: string[];
  /** Kun cifre, i kroner. */
  ticketMin: string;
  ticketMax: string;
  thesis: string;
  risk: number;
  criteria: WizardCriterion[];
  /** null = udledt af grundlaget (autoGates). */
  gates: WizardGate[] | null;
  /** Hvilke af de fire faste specialister der er slået til; gemmes i kladden. */
  specialists: boolean[];
  /** Antal aktive egne specialister i kladden (kun til oversigten; sandheden står i kladden). */
  customSpecialists: number;
}

export function initialWizardState(language: Language = "da"): WizardState {
  return {
    name: "",
    type: null,
    other: "",
    phases: [],
    geo: [],
    geoExtra: [],
    sectors: [],
    sectorExtra: [],
    ticketMin: "1000000",
    ticketMax: "5000000",
    thesis: "",
    risk: 2,
    criteria: defaultCriteria(language),
    gates: null,
    specialists: SPECIALISTS.map(() => true),
    customSpecialists: 0,
  };
}

/** Digits grouped for the page; the stored texts (gates) keep the Danish "da-DK" form. */
export function fmtKr(value: string | number, localeTag = "da-DK"): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? Number(digits).toLocaleString(localeTag) : "";
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 12);
}

const names = (labels: readonly string[], picked: readonly number[]) =>
  picked.filter((index) => index >= 0 && index < labels.length).map((index) => labels[index]!);

/** The values as the setup stores them: keys, and own geographies as typed. */
export function phaseNames(state: WizardState): string[] {
  return names(PHASES, state.phases);
}
export function geographyNames(state: WizardState): string[] {
  return geographyKeys([...names(GEOGRAPHIES, state.geo), ...state.geoExtra]);
}
export function sectorNames(state: WizardState): string[] {
  return [...names(SECTORS, state.sectors), ...state.sectorExtra];
}

/** The same picks as the page shows them in the fund's language (own additions as typed). */
function shownNames(
  keys: readonly MessageKey[],
  picked: readonly number[],
  extra: readonly string[],
  language: Language,
): string[] {
  return [
    ...picked
      .filter((index) => index >= 0 && index < keys.length)
      .map((index) => translate(language, keys[index]!)),
    ...extra,
  ];
}

/**
 * Gates udledt af grundlaget, som i prototypen (alle bindende, til brugeren retter dem). Navnene
 * gemmes i opsætningen, så de skrives på sidens sprog.
 */
export function autoGates(state: WizardState, language: Language = "da"): WizardGate[] {
  const gates: WizardGate[] = [];
  const geo = shownNames(GEOGRAPHY_LABEL_KEYS, state.geo, state.geoExtra, language);
  const phases = shownNames(PHASE_LABEL_KEYS, state.phases, [], language);
  if (geo.length) {
    gates.push({
      key: "geography_fit",
      label: translate(language, "thesis.defaults.autoGeography", { list: geo.join(", ") }),
      icon: "map-pin",
      review: false,
    });
  }
  if (phases.length) {
    gates.push({
      key: "stage_fit",
      label: translate(language, "thesis.defaults.autoStage", { list: phases.join(", ") }),
      icon: "layers",
      review: false,
    });
  }
  if (state.ticketMin || state.ticketMax) {
    gates.push({
      key: "ticket_fit",
      label: translate(language, "thesis.defaults.autoTicket", {
        min: fmtKr(state.ticketMin, LANGUAGE_TAGS[language]),
        max: fmtKr(state.ticketMax, LANGUAGE_TAGS[language]),
      }),
      icon: "coins",
      review: false,
    });
  }
  return gates;
}

export function currentGates(state: WizardState, language: Language = "da"): WizardGate[] {
  return state.gates ?? autoGates(state, language);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/æ/g, "ae")
      .replace(/ø/g, "oe")
      .replace(/å/g, "aa")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "gate"
  );
}

/** En gate eller et kriterium med en ny, unik nøgle ud fra navnet. */
export function uniqueKey(label: string, taken: readonly string[], prefix: string): string {
  const base = `${prefix}${slug(label)}`;
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
  }
  return `${base}_${taken.length + 1}`;
}

/**
 * Fordeler 100 % over kriterierne, så hvert ligger mellem minimum og maksimum og summen er
 * præcis 100. `lockedIndex` er det kriterium, brugeren trækker i: det bevarer sin værdi (inden
 * for det mulige), og resten skaleres proportionalt.
 */
export function fitWeights(weights: readonly number[], lockedIndex: number | null): number[] {
  const count = weights.length;
  if (count === 0) return [];
  const min = WEIGHT_MIN_PERCENT;
  const max = WEIGHT_MAX_PERCENT;
  const total = WEIGHT_TOTAL_PERCENT;
  const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
  const out = weights.map((weight) => clamp(Math.round(weight) || min, min, max));
  const others = out.map((_, index) => index).filter((index) => index !== lockedIndex);
  if (lockedIndex !== null) {
    // Så meget som de øvrige mindst skal have, og som de højst kan have.
    const lo = Math.max(min, total - others.length * max);
    const hi = Math.min(max, total - others.length * min);
    out[lockedIndex] = clamp(out[lockedIndex]!, lo, hi);
  }
  const fixed = lockedIndex === null ? 0 : out[lockedIndex]!;
  const rest = total - fixed;
  const originalSum = others.reduce((sum, index) => sum + (weights[index] || min), 0) || 1;
  for (const index of others) {
    out[index] = clamp(Math.round(((weights[index] || min) / originalSum) * rest), min, max);
  }
  let diff = total - out.reduce((sum, value) => sum + value, 0);
  let guard = 0;
  while (diff !== 0 && guard < 1000) {
    guard += 1;
    const step = diff > 0 ? 1 : -1;
    const room = others.filter((index) => (step > 0 ? out[index]! < max : out[index]! > min));
    if (room.length === 0) break;
    // Det største område tager forskellen, som i prototypen.
    let pick = room[0]!;
    for (const index of room) if (out[index]! > out[pick]!) pick = index;
    out[pick] = out[pick]! + step;
    diff -= step;
  }
  return out;
}

export function setWeight(
  criteria: readonly WizardCriterion[],
  index: number,
  value: number,
): WizardCriterion[] {
  const next = criteria.map((criterion) => ({ ...criterion }));
  if (!next[index]) return next;
  next[index]!.weight = value;
  const fitted = fitWeights(
    next.map((criterion) => criterion.weight),
    index,
  );
  return next.map((criterion, k) => ({ ...criterion, weight: fitted[k]! }));
}

export function normalizeCriteria(criteria: readonly WizardCriterion[]): WizardCriterion[] {
  const fitted = fitWeights(
    criteria.map((criterion) => criterion.weight),
    null,
  );
  return criteria.map((criterion, k) => ({ ...criterion, weight: fitted[k]! }));
}

export function removeCriterion(criteria: readonly WizardCriterion[], index: number) {
  if (criteria.length <= MIN_CRITERIA) return [...criteria];
  return normalizeCriteria(criteria.filter((_, k) => k !== index));
}

export function addCriterion(
  criteria: readonly WizardCriterion[],
  label: string,
): WizardCriterion[] {
  const trimmed = label.trim();
  if (!trimmed || criteria.length >= MAX_CRITERIA) return [...criteria];
  const key = uniqueKey(
    trimmed,
    criteria.map((criterion) => criterion.key),
    "",
  );
  return normalizeCriteria([
    ...criteria,
    { key, label: trimmed.slice(0, 160), weight: 10, description: "", category: "fund_thesis_fit" },
  ]);
}

export interface SummaryRow {
  title: string;
  value: string;
  icon: string;
  seriesVar: string;
  /** Trinnet, "Ret" fører til. */
  step: number;
}

/** "4 specialister" / "3 specialister + 1 egen". */
export function specialistSummary(
  state: Pick<WizardState, "specialists" | "customSpecialists">,
  language: Language = "da",
) {
  const standard = state.specialists.filter(Boolean).length;
  const own = state.customSpecialists;
  const total = standard + own;
  const text = translate(
    language,
    total === 1 ? "thesis.summary.specialistOne" : "thesis.summary.specialistMany",
    { n: total },
  );
  return own > 0
    ? `${text} ${translate(language, own === 1 ? "thesis.summary.ownOne" : "thesis.summary.ownMany", { n: own })}`
    : text;
}

export function summaryRows(state: WizardState, language: Language = "da"): SummaryRow[] {
  const tag = LANGUAGE_TAGS[language];
  const type =
    state.type === null
      ? ""
      : state.type === OTHER_TYPE_INDEX
        ? state.other.trim() || translate(language, "thesis.summary.otherType")
        : translate(language, INVESTOR_TYPES[state.type]!.labelKey);
  const grundlag = [
    shownNames(PHASE_LABEL_KEYS, state.phases, [], language).join(", "),
    shownNames(GEOGRAPHY_LABEL_KEYS, state.geo, state.geoExtra, language).join(", "),
    shownNames(SECTOR_LABEL_KEYS, state.sectors, state.sectorExtra, language).join(", "),
    state.ticketMin || state.ticketMax
      ? `${fmtKr(state.ticketMin, tag)}–${fmtKr(state.ticketMax, tag)} ${translate(language, "thesis.frames.currency")}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");
  const title = (index: number) => translate(language, AREAS[index]!.title);
  const rows: Array<[string, string, string, string]> = [
    [
      title(0),
      `${state.name.trim() || translate(language, "thesis.summary.noName")}${type ? `, ${type}` : ""}`,
      "landmark",
      "var(--ink-2)",
    ],
    [
      title(1),
      grundlag || translate(language, "thesis.summary.notFilled"),
      "map",
      "var(--series-5)",
    ],
    [
      title(2),
      state.thesis.trim() || translate(language, "thesis.summary.noThesis"),
      "quote",
      "var(--series-3)",
    ],
    [
      title(3),
      state.criteria.map((criterion) => `${criterion.label} ${criterion.weight} %`).join(", "),
      "chart-pie",
      "var(--series-1)",
    ],
    [
      title(4),
      translate(language, "thesis.summary.gates", { n: currentGates(state).length }),
      "shield-check",
      "var(--critical)",
    ],
    [title(5), specialistSummary(state, language), "users", "var(--series-2)"],
  ];
  return rows.map(([title, value, icon, seriesVar], step) => ({
    title,
    value,
    icon,
    seriesVar,
    step,
  }));
}

/** Det udfyldte pr. trin, som AI-hjælpen får som baggrund (kun tekst, brugeren selv har skrevet). */
export function chatContext(state: WizardState): Record<string, string> {
  const type =
    state.type === null
      ? ""
      : state.type === OTHER_TYPE_INDEX
        ? state.other
        : INVESTOR_TYPES[state.type]!.label;
  return {
    investor_type: [state.name, type].filter((part) => part.trim()).join(", "),
    frames: [
      shownNames(PHASE_LABEL_KEYS, state.phases, [], "da").join(", "),
      shownNames(GEOGRAPHY_LABEL_KEYS, state.geo, state.geoExtra, "da").join(", "),
      sectorNames(state).join(", "),
      state.ticketMin || state.ticketMax
        ? `ticket ${fmtKr(state.ticketMin)}-${fmtKr(state.ticketMax)} kr.`
        : "",
    ]
      .filter(Boolean)
      .join("; "),
    thesis: `${state.thesis}${state.thesis.trim() ? " " : ""}Risikovillighed: ${RISK_LABELS[state.risk]}.`,
    weights: state.criteria
      .map((criterion) => `${criterion.label} ${criterion.weight} %`)
      .join(", "),
    dealbreakers: currentGates(state)
      .map((gate) => `${gate.label} (${gate.review ? "vurdering" : "bindende"})`)
      .join(", "),
  };
}

/** The fixed gates' descriptions, saved in the setup in the language of the page. */
const GATE_DESCRIPTION_KEYS: Record<string, MessageKey> = {
  geography_fit: "thesis.defaults.gates.geography_fit",
  stage_fit: "thesis.defaults.gates.stage_fit",
  ticket_fit: "thesis.defaults.gates.ticket_fit",
};

/** Databasen kræver en beskrivelse på hver regel, også de egne. */
function customGateDescription(gate: WizardGate, language: Language): string {
  const label = gate.label.trim();
  return translate(
    language,
    gate.review ? "thesis.defaults.customReview" : "thesis.defaults.customHard",
    { label },
  );
}

function eurFromKr(kr: string): number | null {
  const value = Number(kr);
  return Number.isFinite(value) && value > 0 ? Math.round(value / DKK_PER_EUR) : null;
}

export function templateFor(state: WizardState): FundTemplateKey {
  return state.type === null ? "blank" : INVESTOR_TYPES[state.type]!.template;
}

/** Det, kladden henter fra skabelonen (`fundConfigTemplates[templateFor(state)]`). */
export type TemplateBase = Pick<
  FundConfigTemplate,
  "strategyType" | "analysisThreshold" | "stageExpectations"
>;

/** Felterne til `saveFundConfigDraft` (uden `configId`). */
export function buildDraftFields(
  state: WizardState,
  template: TemplateBase,
  language: Language = "da",
) {
  const stages = phaseNames(state);
  const takenGateKeys: string[] = [];
  const gates = currentGates(state, language).map((gate) => {
    const fixed = gate.key in GATE_DESCRIPTION_KEYS;
    const key =
      fixed && !takenGateKeys.includes(gate.key)
        ? gate.key
        : uniqueKey(gate.label, takenGateKeys, "custom_");
    takenGateKeys.push(key);
    return {
      key,
      label: gate.label.trim().slice(0, 160) || translate(language, "thesis.defaults.gateFallback"),
      description: GATE_DESCRIPTION_KEYS[key]
        ? translate(language, GATE_DESCRIPTION_KEYS[key])
        : customGateDescription(gate, language),
      treatment: gate.review ? ("review" as const) : ("hard" as const),
    };
  });
  // The template names its stages ("Series A"); the setup stores keys ("series_a").
  const templateExpectations = stageExpectationKeys(template.stageExpectations);
  const stageExpectations: Record<string, string> = {};
  for (const stage of stages) {
    const text = templateExpectations[stage];
    if (text) stageExpectations[stage] = text;
  }
  return {
    fundName: state.name.trim(),
    strategyType: template.strategyType,
    thesis: state.thesis.trim().slice(0, 5000),
    stages,
    geographies: geographyNames(state).map((name) => name.slice(0, 120)),
    sectors: sectorNames(state).map((name) => name.slice(0, 120)),
    fundSizeEur: null,
    ticketMinEur: eurFromKr(state.ticketMin),
    ticketMaxEur: eurFromKr(state.ticketMax),
    ticketNote: "",
    analysisThreshold: template.analysisThreshold,
    approvalMode: "partner_approval" as const,
    riskPosture: translate(language, RISK_POSTURE_KEYS[state.risk] ?? RISK_POSTURE_KEYS[2]!),
    stageExpectations,
    dealbreakers: [] as string[],
    gates,
    criteria: state.criteria.map((criterion) => ({
      key: criterion.key,
      label: criterion.label.trim().slice(0, 160),
      // Databasen kræver en beskrivelse; et kriterie uden egen tekst får en kort standard.
      description:
        criterion.description.trim().slice(0, 1000) ||
        translate(language, "thesis.defaults.criterionFallback", {
          label: criterion.label.trim().toLowerCase(),
        }),
      category: criterion.category,
      weight: criterion.weight,
    })),
  };
}

/** Hvad der skal rettes, før opsætningen kan udgives (tom liste = klar). */
export function publishProblems(
  state: WizardState,
  template: TemplateBase,
  language: Language = "da",
): string[] {
  const problems: string[] = [];
  if (state.name.trim().length < 2) problems.push(translate(language, "thesis.problems.name"));
  // Det, databasen kræver, før en opsætning kan udgives (activate_fund_config).
  if (phaseNames(state).length === 0) problems.push(translate(language, "thesis.problems.phase"));
  if (geographyNames(state).length === 0) {
    problems.push(translate(language, "thesis.problems.geography"));
  }
  if (sectorNames(state).length === 0) problems.push(translate(language, "thesis.problems.sector"));
  if (state.thesis.trim().length === 0)
    problems.push(translate(language, "thesis.problems.thesis"));
  if (currentGates(state).length === 0) problems.push(translate(language, "thesis.problems.gate"));
  const fields = buildDraftFields(state, template, language);
  const violations = checkConfigLimits(
    {
      criteria: fields.criteria,
      gates: fields.gates,
      analysisThreshold: fields.analysisThreshold,
    },
    language,
  );
  if (violations.length) problems.push(limitViolationsMessage(violations));
  if (fields.ticketMinEur !== null && fields.ticketMaxEur !== null) {
    if (fields.ticketMinEur > fields.ticketMaxEur) {
      problems.push(translate(language, "thesis.problems.ticket"));
    }
  }
  return problems;
}

/** Ticketskalaens bjælke i procent af 0–50 mio. kr. */
export function ticketBar(state: WizardState): { left: number; width: number } {
  const clamp = (value: number) => Math.max(0, Math.min(TICKET_SCALE_MAX_KR, value));
  const min = clamp(Number(state.ticketMin) || 0);
  const max = Math.max(min, clamp(Number(state.ticketMax) || 0));
  return {
    left: (min / TICKET_SCALE_MAX_KR) * 100,
    width: Math.max(1, ((max - min) / TICKET_SCALE_MAX_KR) * 100),
  };
}

/** Prototypens genveje: sætter først "fra", derefter "til". */
export function applyTicketPreset(
  state: Pick<WizardState, "ticketMin" | "ticketMax">,
  kr: number,
  maxWasSet: boolean,
): { ticketMin: string; ticketMax: string; maxSet: boolean } {
  const min = Number(state.ticketMin) || 0;
  if (state.ticketMin && min <= kr && !maxWasSet) {
    return { ticketMin: state.ticketMin, ticketMax: String(kr), maxSet: true };
  }
  return { ticketMin: String(kr), ticketMax: state.ticketMax, maxSet: false };
}
