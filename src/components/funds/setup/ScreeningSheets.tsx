/**
 * What opens from the cards of "Sådan screener vi", ported 1:1 from the prototype
 * `Teamopsaetning v3.dc.html` (`critEditor`, `mandEditor`, `finEditor`, `compareTable`, `gets`):
 * the criteria with weights (sum 100, 5-40 % each), the mandate rules, the 15 economy points with
 * their own questions, the expectations in words, and the comparison of the stages. Everything
 * is for ONE stage (stage-editor.ts); the shared rules say "Alle stadier".
 *
 * Left for (the Interlect-Assistent): the AI boxes ("Tilpas med Interlect") and the
 * "Interlect-Assistant" button at each text field.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Coins,
  FileText,
  Lock,
  ListChecks,
  MapPin,
  Percent,
  Plus,
  Scale,
  Shield,
  Target,
  Trash2,
  TrendingUp,
  Wallet,
  ChartColumn,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { Toggle } from "@/components/ds/Toggle";
import { WeightDonut, weightColor } from "@/components/funds/editor/WeightDonut";
import { ModeSeg, SharedListPick } from "./ThesisFrame";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import { financeGateTreatment, isFinanceGate } from "@/lib/analysis/financial-gates";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import { WEIGHT_MAX_PERCENT, WEIGHT_MIN_PERCENT } from "@/lib/funds/config-limits";
import { isCustomCriterion } from "@/lib/funds/criterion-defaults";
import { fundConfigTemplatesIn } from "@/lib/funds/config-templates";
import { normalizeWeights, weightTotal, weightsWithNewCriterion } from "@/lib/funds/editor-rules";
import { sharedBasisGate } from "@/lib/funds/gate-suggestions";
import { stageText, geographyText, sectorText } from "@/lib/funds/basis-labels";
import {
  ECONOMY_GROUPS,
  ECONOMY_POINTS,
  OWN_QUESTION_ANSWERS,
  MAX_OWN_ECONOMY_QUESTIONS,
  OWN_QUESTION_MAX_CHARS,
  economyGroupTitle,
  economyPointQuestion,
  economyPointSource,
  economyPointUnit,
  type EconomyGroup,
  type MissingMode,
  type OwnQuestionAnswer,
} from "@/lib/funds/economy-points";
import {
  SHARED_RULE_KEYS,
  STAGE_SERIES,
  criteriaOf,
  economyOf,
  freeKey,
  gatesOf,
  patchGate,
  stageTabs,
  withEconomyMissing,
  withEconomyPoint,
  withEconomyQuestions,
  withGateAt,
  withStageCriteria,
  withStageGate,
  withoutGate,
  type StageCriterion,
  type StageGate,
} from "@/lib/funds/stage-editor";
import { decimalSeparatorOf, parseTypedNumber } from "@/lib/funds/typed-number";
import type { Language } from "@/lib/i18n/language";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { AskButton, AskRow, CRITERION_ADDED_EVENT } from "./SetupAssistant";

type EditorState = SaveFundConfigInput;

const TEMPLATES = {
  da: [...fundConfigTemplatesIn("da"), ...fundConfigTemplatesIn("en")],
  en: [...fundConfigTemplatesIn("en"), ...fundConfigTemplatesIn("da")],
};

/** The prototype's series colour `--sN` and its wash (`--sNw`). */
export const series = (n: number) => `var(--series-${n})`;
export const seriesWash = (n: number) => `color-mix(in srgb, var(--series-${n}) 17%, transparent)`;

/** A pill's colours from a series number. */
export const seriesPill = (n: number) => ({ bg: seriesWash(n), fg: series(n) });

/** The icon tile of a card or row (prototype `.tile`). */
export function SeriesTile({
  icon: Icon,
  n,
  size = 38,
}: {
  icon: LucideIcon;
  n: number;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center"
      style={{
        width: size,
        height: size,
        borderRadius: size >= 40 ? 13 : 12,
        background: seriesWash(n),
        color: series(n),
      }}
    >
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </span>
  );
}

/** The prototype's range input (global CSS): a 5 px track and a 14 px ink thumb with a surface ring. */
const THUMB =
  "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-ink-1 [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_var(--bg-surface)] [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink-1 [&::-moz-range-thumb]:shadow-[0_0_0_3px_var(--bg-surface)]";
export const RANGE_CLASS = `m-0 h-[5px] w-full cursor-pointer appearance-none rounded-[3px] bg-line-strong outline-none focus-visible:shadow-[0_0_0_2px_var(--action)] ${THUMB}`;
/** The score's slider: the track is the filled bar under it, so the input itself is see-through. */
export const RANGE_OVER_BAR = `m-0 h-6 w-full cursor-pointer appearance-none bg-transparent outline-none [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent ${THUMB}`;

const FIELD_AREA =
  "w-full resize-none rounded-[12px] border-0 bg-sunken px-3.5 py-3 font-[inherit] text-[14px] leading-[1.5] text-ink-1 outline-none [field-sizing:content] placeholder:text-ink-4 focus-visible:shadow-[0_0_0_2px_var(--action)]";
const LABEL = "text-[13px] font-medium text-ink-1";
const ICON_BUTTON =
  "grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-ink-3 transition-colors hover:bg-hover hover:text-ink-1 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-ink-3";
const DELETE_BUTTON = cn(
  ICON_BUTTON,
  "hover:bg-critical-wash hover:text-critical disabled:hover:bg-transparent disabled:hover:text-ink-3",
);

/** "A, B eller C" (prototype `orList`). */
export function orList(items: readonly string[], empty: string, or: string): string {
  if (items.length === 0) return empty;
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} ${or} ${items[items.length - 1]}`;
}

/** The ticket as one line ("200.000 – 5.200.000 EUR"). */
export function ticketLine(value: EditorState, localeTag: string): string {
  const { ticketMinEur: min, ticketMaxEur: max } = value;
  const fmt = (n: number) => n.toLocaleString(localeTag);
  if (min !== null && max !== null)
    return `${fmt(Math.min(min, max))} – ${fmt(Math.max(min, max))} EUR`;
  if (min !== null) return `${fmt(min)} EUR`;
  if (max !== null) return `${fmt(max)} EUR`;
  return "–";
}

// ---------------------------------------------------------------------------
// Rules: how they look (icon and colour by key)
// ---------------------------------------------------------------------------

const RULE_STYLE: Record<string, { icon: LucideIcon; n: number }> = {
  geography_fit: { icon: MapPin, n: 5 },
  stage_fit: { icon: ChartColumn, n: 1 },
  ticket_fit: { icon: Coins, n: 2 },
  liquidity_ticket: { icon: Coins, n: 2 },
  sector_fit: { icon: Target, n: 7 },
};
export function ruleStyle(key: string): { icon: LucideIcon; n: number } {
  return RULE_STYLE[key] ?? { icon: Shield, n: 8 };
}
const SHARED_LIST: Record<string, "stages" | "geographies" | "sectors"> = {
  stage_fit: "stages",
  geography_fit: "geographies",
  sector_fit: "sectors",
};
const DELT_KEYS = SHARED_RULE_KEYS;
const TICKET_KEYS = new Set(["ticket_fit", "liquidity_ticket"]);

/** What a rule says in one line (prototype `ruleSum`). */
export function ruleSummary(
  gate: StageGate,
  value: EditorState,
  language: Language,
  localeTag: string,
  t: ReturnType<typeof useT>,
): string {
  const none = t("fundSetup.screen.noneChosen");
  const or = t("fundSetup.screen.or");
  if (gate.key === "stage_fit")
    return orList(
      value.stages.map((stage) => stageText(stage, language)),
      none,
      or,
    );
  if (gate.key === "geography_fit")
    return orList(
      value.geographies.map((entry) => geographyText(entry, language)),
      none,
      or,
    );
  if (gate.key === "sector_fit")
    return orList(
      value.sectors.map((entry) => sectorText(entry, language)),
      none,
      or,
    );
  if (TICKET_KEYS.has(gate.key)) return ticketLine(value, localeTag);
  const text = gate.description.trim();
  if (!text) return t("fundSetup.screen.writeRule");
  return text.length > 70 ? `${text.slice(0, 68)}…` : text;
}

/** The rule's weight as the screening treats it (a finance rule's is fixed by code). */
export function treatmentOf(gate: StageGate): StageGate["treatment"] {
  return isFinanceGate(gate.key) ? financeGateTreatment(gate.key) : gate.treatment;
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

/** A typed percentage: kept as typed until Enter or leaving the field (5-40 %). */
function PercentField({
  weight,
  label,
  onCommit,
}: {
  weight: number;
  label: string;
  onCommit: (typed: number) => void;
}) {
  const localeTag = useLocaleTag();
  const shown = weight.toLocaleString(localeTag, { maximumFractionDigits: 1 });
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const typed = Number(draft.replace(",", "."));
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(typed) && typed !== weight) onCommit(typed);
  };
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? shown}
        onFocus={(event) => {
          setDraft(shown);
          event.target.select();
        }}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d,.]/g, ""))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") setDraft(null);
        }}
        aria-label={label}
        className="h-[38px] w-14 rounded-[10px] border-0 bg-surface px-2.5 text-right font-[inherit] text-[14px] font-medium text-ink-1 tabular-nums shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink-1)]"
      />
      <span className="text-[13px]" aria-hidden>
        %
      </span>
    </span>
  );
}

const MAX_CRITERIA = 15;

/** Prototype `critEditor`: the sum box, a row per criterion, "Tilføj kriterium". */
export function CriteriaEditor({
  value,
  onChange,
  stage,
}: {
  value: EditorState;
  onChange: (value: EditorState) => void;
  stage: SetupStage;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  const language = useLanguage();
  const templates = TEMPLATES[language];
  const criteria = criteriaOf(value, stage);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // A criterion the Interlect-Assistent added opens, scrolls into view and gets the focus.
  useEffect(() => {
    const onAdded = (event: Event) => {
      const { stage: at, key } = (event as CustomEvent<{ stage: string; key: string }>).detail;
      if (at !== stage) return;
      setOpen((current) => new Set(current).add(key));
      window.setTimeout(() => {
        const field = document.getElementById(`crit-${stage}-${key}`);
        field?.scrollIntoView({ block: "center", behavior: "smooth" });
        field?.focus({ preventScroll: true });
      }, 120);
    };
    window.addEventListener(CRITERION_ADDED_EVENT, onAdded);
    return () => window.removeEventListener(CRITERION_ADDED_EVENT, onAdded);
  }, [stage]);
  const sum = weightTotal(criteria.map((criterion) => criterion.weight));
  const ok = Math.abs(sum - 100) < 0.05;
  const set = (next: StageCriterion[]) => onChange(withStageCriteria(value, stage, next));
  const patch = (index: number, change: Partial<StageCriterion>) =>
    set(criteria.map((item, i) => (i === index ? { ...item, ...change } : item)));
  const setWeight = (index: number, weight: number) =>
    patch(index, {
      weight: Math.min(
        WEIGHT_MAX_PERCENT,
        Math.max(WEIGHT_MIN_PERCENT, Math.round(weight * 10) / 10),
      ),
    });
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const add = () => {
    const weights = weightsWithNewCriterion(criteria.map((criterion) => criterion.weight));
    const key = freeKey("criterion", value.criteria, stage);
    setOpen((current) => new Set(current).add(key));
    set([
      ...criteria.map((item, i) => ({ ...item, weight: weights[i] ?? item.weight })),
      {
        key,
        label: t("fundSetup.screen.newCriterion"),
        description: "",
        category: "fund_thesis_fit",
        weight: weights[criteria.length] ?? WEIGHT_MIN_PERCENT,
      },
    ]);
  };
  const remove = (index: number) => {
    const weights = normalizeWeights(
      criteria.filter((_, i) => i !== index).map((criterion) => criterion.weight),
    );
    set(
      criteria
        .filter((_, i) => i !== index)
        .map((item, i) => ({ ...item, weight: weights[i] ?? item.weight })),
    );
  };
  return (
    <div className="flex flex-col gap-[26px]">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-[26px] gap-y-4 rounded-[20px] px-[22px] py-[18px] transition-colors duration-300",
          ok ? "bg-positive-wash" : "bg-warning-wash",
        )}
      >
        <WeightDonut
          items={criteria.map((criterion) => ({
            label: criterion.label,
            weight: criterion.weight,
          }))}
          hovered={null}
          onHover={() => {}}
          size={130}
          center={() => (
            <b className="text-[22px] font-semibold tracking-title tabular-nums">
              {ok ? "100" : sum.toLocaleString(localeTag, { maximumFractionDigits: 1 })} %
            </b>
          )}
        />
        <div
          className="flex min-w-0 flex-1 flex-col items-start gap-2.5 text-[14px] text-ink-2"
          aria-live="polite"
        >
          <span>
            {ok
              ? t("fundSetup.screen.sumOk")
              : t("fundSetup.screen.sumBad", {
                  sum: sum.toLocaleString(localeTag, { maximumFractionDigits: 1 }),
                })}
          </span>
          {!ok && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                set(
                  criteria.map((item, i) => ({
                    ...item,
                    weight: normalizeWeights(criteria.map((c) => c.weight))[i] ?? item.weight,
                  })),
                )
              }
            >
              {t("fundSetup.screen.distribute")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col">
          {criteria.map((criterion, index) => {
            const expanded = open.has(criterion.key);
            const custom = isCustomCriterion(templates, criterion, value.strategyType);
            const name = criterion.label || t("fundSetup.screen.newCriterion");
            return (
              <div key={criterion.key} className={cn(index > 0 && "border-t border-line")}>
                <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto_auto_auto] items-center gap-3.5 px-[18px] py-3.5 max-md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: weightColor(index) }}
                    />
                    <input
                      type="text"
                      value={criterion.label}
                      maxLength={160}
                      aria-label={t("fundSetup.screen.name")}
                      onChange={(event) => patch(index, { label: event.target.value })}
                      className="w-full min-w-0 rounded-[6px] border-0 bg-transparent py-1.5 font-[inherit] text-[14px] font-medium text-ink-1 outline-none hover:bg-hover focus-visible:bg-hover"
                    />
                    {custom && (
                      <span className="inline-flex shrink-0 items-center gap-[5px] text-[11px] font-medium whitespace-nowrap text-ink-3">
                        <span aria-hidden className="size-[7px] rounded-full bg-action" />
                        {t("fundSetup.screen.own")}
                      </span>
                    )}
                  </div>
                  <input
                    type="range"
                    min={WEIGHT_MIN_PERCENT}
                    max={WEIGHT_MAX_PERCENT}
                    step={1}
                    value={Math.min(
                      WEIGHT_MAX_PERCENT,
                      Math.max(WEIGHT_MIN_PERCENT, Math.round(criterion.weight)),
                    )}
                    onChange={(event) => setWeight(index, Number(event.target.value))}
                    aria-label={t("fundSetup.screen.weightFor", { name })}
                    className={cn(RANGE_CLASS, "max-md:col-span-4 max-md:row-start-2")}
                  />
                  <PercentField
                    weight={criterion.weight}
                    label={t("fundSetup.screen.percent")}
                    onCommit={(typed) => setWeight(index, typed)}
                  />
                  <button
                    type="button"
                    className={DELETE_BUTTON}
                    aria-label={t("fundSetup.screen.removeNamed", { name })}
                    disabled={criteria.length <= 3}
                    title={criteria.length <= 3 ? t("fundSetup.screen.minThree") : undefined}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    aria-label={t("fundSetup.screen.showDescription")}
                    aria-expanded={expanded}
                    onClick={() => toggle(criterion.key)}
                  >
                    {expanded ? (
                      <ChevronUp className="size-[17px]" aria-hidden />
                    ) : (
                      <ChevronDown className="size-[17px]" aria-hidden />
                    )}
                  </button>
                </div>
                <Collapse open={expanded}>
                  <div className="flex flex-col gap-2.5 px-[18px] pt-1 pb-3.5 pl-[38px]">
                    <label className={LABEL} htmlFor={`crit-${stage}-${criterion.key}`}>
                      {t("fundSetup.screen.lookFor")}
                    </label>
                    <textarea
                      id={`crit-${stage}-${criterion.key}`}
                      rows={3}
                      value={criterion.description}
                      maxLength={1000}
                      onChange={(event) => patch(index, { description: event.target.value })}
                      className={FIELD_AREA}
                    />
                    <AskRow field={`crit:${criterion.key}`} />
                  </div>
                </Collapse>
              </div>
            );
          })}
        </div>
        {criteria.length >= MAX_CRITERIA ? (
          <span className="text-meta text-ink-3">{t("fundSetup.screen.maxCriteria")}</span>
        ) : (
          <Button size="md" variant="secondary" icon={Plus} className="self-start" onClick={add}>
            {t("fundSetup.screen.addCriterion")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mandate rules
// ---------------------------------------------------------------------------

function RuleRow({
  gate,
  stage,
  open,
  onToggle,
  value,
  onChange,
  onRemove,
  onGoThesis,
}: {
  gate: StageGate;
  stage: SetupStage;
  open: boolean;
  onToggle: () => void;
  value: EditorState;
  onChange: (value: EditorState) => void;
  onRemove: () => void;
  onGoThesis: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const style = ruleStyle(gate.key);
  const Icon = style.icon;
  const treatment = treatmentOf(gate);
  const binding = treatment === "hard";
  const shared = !gate.stage;
  const own = Boolean(gate.stage);
  const list = SHARED_LIST[gate.key];
  const standard = list
    ? sharedBasisGate(gate.key as "stage_fit", gate.treatment, language).description
    : null;
  const followsStandard = standard !== null && gate.description.trim() === standard.trim();
  const name = gate.label || t("fundSetup.screen.newRule");
  return (
    <div
      className="overflow-hidden rounded-[22px] bg-canvas"
      style={
        open
          ? { boxShadow: `0 0 0 2px color-mix(in srgb, ${series(style.n)} 40%, transparent)` }
          : undefined
      }
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3.5 border-0 bg-transparent px-[18px] py-4 text-left font-[inherit] text-inherit hover:bg-hover"
      >
        <SeriesTile icon={Icon} n={style.n} size={40} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="text-[16px] font-semibold tracking-[-0.01em]">{name}</b>
          <span className="truncate text-[13px] text-ink-3">
            {ruleSummary(gate, value, language, localeTag, t)}
          </span>
        </span>
        {shared && (
          <span className="inline-flex h-[26px] shrink-0 items-center rounded-pill bg-surface px-2.5 text-[12px] font-medium whitespace-nowrap text-ink-3">
            {t("fundSetup.screen.allStages")}
          </span>
        )}
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap",
            binding ? "bg-action-wash text-action" : "bg-sunken text-ink-2",
          )}
        >
          {binding && <Lock className="size-3" strokeWidth={2.2} aria-hidden />}
          {binding ? t("fundSetup.frame.binding") : t("fundSetup.frame.review")}
        </span>
        <span className="text-ink-3" aria-hidden>
          {open ? <ChevronUp className="size-[18px]" /> : <ChevronDown className="size-[18px]" />}
        </span>
      </button>
      <Collapse open={open}>
        <div className="mx-2 mb-2 flex flex-col gap-[18px] rounded-[16px] border-t border-line bg-surface px-[18px] pt-4 pb-5">
          {own && !list && (
            <label className="flex flex-col gap-2">
              <span className={LABEL}>{t("fundSetup.screen.ruleName")}</span>
              <input
                type="text"
                value={gate.label}
                maxLength={160}
                placeholder={t("fundSetup.screen.ruleNamePh")}
                onChange={(event) =>
                  onChange(patchGate(value, gate, { label: event.target.value }, stage))
                }
                className={cn(FIELD_AREA, "h-11 resize-none py-0")}
              />
            </label>
          )}
          <div className="flex flex-col gap-2">
            <label className={LABEL} htmlFor={`rule-${gate.stage ?? "all"}-${gate.key}`}>
              {t("fundSetup.screen.mustMeet")}
            </label>
            <textarea
              id={`rule-${gate.stage ?? "all"}-${gate.key}`}
              rows={2}
              value={gate.description}
              maxLength={1000}
              placeholder={t("fundSetup.screen.writeRule")}
              aria-label={t("fundSetup.screen.ruleTextAria", { name })}
              onChange={(event) =>
                onChange(patchGate(value, gate, { description: event.target.value }, stage))
              }
              className={FIELD_AREA}
            />
            <AskRow
              field={`rule:${gate.key}`}
              hint={
                !list ? null : followsStandard ? (
                  t("fundSetup.screen.hintFollows")
                ) : (
                  <>
                    {t("fundSetup.screen.hintOwn")}{" "}
                    <button
                      type="button"
                      onClick={() =>
                        onChange(patchGate(value, gate, { description: standard! }, stage))
                      }
                      className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-meta text-action underline"
                    >
                      {t("fundSetup.screen.hintOwnReset")}
                    </button>
                  </>
                )
              }
            />
          </div>
          {(list || TICKET_KEYS.has(gate.key)) && (
            <div className="flex flex-col gap-2">
              <span className={LABEL}>{t("fundSetup.screen.choices")}</span>
              {list ? (
                <SharedListPick list={list} value={value} onChange={onChange} />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-9 items-center rounded-pill bg-canvas px-3.5 text-list font-medium text-ink-2">
                    {ticketLine(value, localeTag)}
                  </span>
                  <Button size="sm" variant="quiet" className="text-action" onClick={onGoThesis}>
                    {t("fundSetup.screen.editTicket")}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <span className={LABEL}>{t("fundSetup.screen.howHeavy")}</span>
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <ModeSeg
                value={treatment}
                disabled={isFinanceGate(gate.key)}
                onChange={(next) => onChange(patchGate(value, gate, { treatment: next }, stage))}
              />
              {!DELT_KEYS.has(gate.key) && (
                <Button
                  size="sm"
                  variant="danger"
                  icon={Trash2}
                  aria-label={t("fundSetup.screen.removeRuleAria", { name })}
                  onClick={onRemove}
                >
                  {t("fundSetup.screen.removeRule")}
                </Button>
              )}
            </div>
            <span className="text-[13px] text-ink-3">
              {binding ? t("fundSetup.screen.modeHard") : t("fundSetup.screen.modeSoft")}
            </span>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

/** Prototype `mandEditor`: a row per rule and "Tilføj regel". */
export function MandateEditor({
  value,
  onChange,
  stage,
  onGoThesis,
}: {
  value: EditorState;
  onChange: (value: EditorState) => void;
  stage: SetupStage;
  onGoThesis: () => void;
}) {
  const t = useT();
  const rules = gatesOf(value, stage);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [removed, setRemoved] = useState<{ gate: StageGate; index: number } | null>(null);
  const idOf = (gate: StageGate) => `${gate.stage ?? "all"}:${gate.key}`;
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const add = () => {
    const key = freeKey("rule", value.gates, stage);
    // A new rule ends the undo of an earlier removal (its key could be taken again).
    setRemoved(null);
    setOpen((current) => new Set(current).add(`${stage}:${key}`));
    onChange(
      withStageGate(value, stage, {
        key,
        label: t("fundSetup.screen.newRule"),
        description: "",
        treatment: "review",
      }),
    );
  };
  return (
    <div className="flex flex-col gap-[26px]">
      {removed && (
        <div className="flex items-center justify-between gap-2.5 rounded-[12px] bg-ai-wash px-3.5 py-2.5 text-[12px] text-ai-ink">
          <span>
            {t("fundSetup.screen.ruleRemoved", {
              name: removed.gate.label || t("fundSetup.screen.newRule"),
            })}
          </span>
          <Button
            size="sm"
            variant="quiet"
            className="text-ai-ink"
            onClick={() => {
              onChange(withGateAt(value, removed.gate, removed.index));
              setRemoved(null);
            }}
          >
            {t("fundSetup.screen.undo")}
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {rules.map((gate) => (
          <RuleRow
            key={idOf(gate)}
            gate={gate}
            stage={stage}
            open={open.has(idOf(gate))}
            onToggle={() => toggle(idOf(gate))}
            value={value}
            onChange={onChange}
            onGoThesis={onGoThesis}
            onRemove={() => {
              setRemoved({ gate, index: value.gates.indexOf(gate) });
              onChange(withoutGate(value, gate));
            }}
          />
        ))}
      </div>
      <Button size="md" variant="secondary" icon={Plus} className="self-start" onClick={add}>
        {t("fundSetup.screen.addRule")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export const GROUP_STYLE: Record<EconomyGroup, { icon: LucideIcon; n: number }> = {
  growth: { icon: TrendingUp, n: 1 },
  margins: { icon: Percent, n: 5 },
  cash: { icon: Wallet, n: 2 },
  round: { icon: Scale, n: 7 },
  accounts: { icon: FileText, n: 8 },
};

/** The dots of the 15 points per group, filled where a point is on (prototype `finDots`). */
export function FinanceDots({
  value,
  stage,
  compact,
}: {
  value: EditorState;
  stage: SetupStage;
  compact?: boolean;
}) {
  const t = useT();
  const economy = economyOf(value, stage);
  return (
    <div className={cn("flex items-end", compact ? "gap-3.5" : "gap-5")} aria-hidden>
      {ECONOMY_GROUPS.map((group) => {
        const points = ECONOMY_POINTS.filter((point) => point.group === group);
        return (
          <div key={group} className="flex flex-col items-start gap-[9px]">
            <span className={cn("flex flex-wrap gap-1", compact ? "max-w-[44px]" : "max-w-[70px]")}>
              {points.map((point) => {
                const on = economy.points.find((item) => item.key === point.key)?.on;
                return (
                  <i
                    key={point.key}
                    className={cn(
                      "rounded-full transition-colors duration-[250ms]",
                      compact ? "size-[9px]" : "size-[13px]",
                      !on && "bg-surface shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
                    )}
                    style={on ? { background: series(GROUP_STYLE[group].n) } : undefined}
                  />
                );
              })}
            </span>
            {!compact && (
              <span className="text-meta text-ink-3">
                {t(`fundSetup.screen.groupShort.${group}` as never)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A limit typed as a number; kept as typed until Enter or leaving the field. */
function LimitField({
  limit,
  label,
  onCommit,
}: {
  limit: number;
  label: string;
  onCommit: (value: number) => void;
}) {
  const localeTag = useLocaleTag();
  const shown = limit.toLocaleString(localeTag, { maximumFractionDigits: 2 });
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    // Both formats in either language: "1.000" is never read as 1 in Danish.
    const typed = parseTypedNumber(draft, decimalSeparatorOf(localeTag));
    setDraft(null);
    if (typed !== null && typed >= 0 && typed !== limit) onCommit(typed);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? shown}
      onFocus={(event) => {
        setDraft(shown);
        event.target.select();
      }}
      onChange={(event) => setDraft(event.target.value.replace(/[^\d,.]/g, ""))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") setDraft(null);
      }}
      aria-label={label}
      className="h-[30px] w-[62px] rounded-[9px] border-0 bg-surface px-[9px] text-right font-[inherit] text-[13px] font-medium text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink-1)]"
    />
  );
}

const ANSWER_PREVIEW: Record<OwnQuestionAnswer, "pvYn" | "pvNum" | "pvTxt"> = {
  yn: "pvYn",
  num: "pvNum",
  txt: "pvTxt",
};
const ANSWER_LABEL: Record<OwnQuestionAnswer, "yn" | "num" | "txt"> = {
  yn: "yn",
  num: "num",
  txt: "txt",
};

/** The team's own questions; a blank row lives here until it has text (the server refuses blanks). */
function OwnQuestions({
  value,
  onChange,
  stage,
}: {
  value: EditorState;
  onChange: (value: EditorState) => void;
  stage: SetupStage;
}) {
  const t = useT();
  const stored = economyOf(value, stage).questions;
  const [rows, setRows] = useState<Array<{ text: string; answer: OwnQuestionAnswer }>>(() =>
    stored.map((question) => ({ text: question.text, answer: question.answer })),
  );
  // The saved list changed under the sheet (a proposal applied, a reload): show it, never write
  // the old list back over it. A blank row waiting for text is not part of the saved list.
  const savedKey = JSON.stringify(stored.map((question) => [question.text, question.answer]));
  const shownKey = JSON.stringify(
    rows.filter((row) => row.text.trim()).map((row) => [row.text.trim(), row.answer]),
  );
  if (savedKey !== shownKey) {
    setRows(stored.map((question) => ({ text: question.text, answer: question.answer })));
  }
  const write = (next: typeof rows) => {
    setRows(next);
    onChange(withEconomyQuestions(value, stage, next));
  };
  return (
    <div className="flex flex-col gap-3.5 rounded-[20px] bg-surface px-5 py-[18px] shadow-[inset_0_0_0_1px_var(--line-strong)]">
      <b className="text-[15px] font-medium text-ink-1">{t("fundSetup.screen.ownTitle")}</b>
      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 rounded-[18px] bg-surface p-3.5 shadow-pill"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={row.text}
                maxLength={OWN_QUESTION_MAX_CHARS}
                placeholder={t("fundSetup.screen.questionPh")}
                aria-label={t("fundSetup.screen.questionAria", { n: index + 1 })}
                onChange={(event) =>
                  write(
                    rows.map((item, i) =>
                      i === index ? { ...item, text: event.target.value } : item,
                    ),
                  )
                }
                className={cn(FIELD_AREA, "h-11 min-w-0 flex-1 resize-none py-0")}
              />
              <button
                type="button"
                className={DELETE_BUTTON}
                aria-label={t("fundSetup.screen.removeQuestion", { n: index + 1 })}
                onClick={() => write(rows.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-meta text-ink-3">{t("fundSetup.screen.answerAs")}</span>
              <div
                role="group"
                aria-label={t("fundSetup.screen.answerAs")}
                className="inline-flex rounded-pill bg-sunken p-[3px]"
              >
                {OWN_QUESTION_ANSWERS.map((answer) => (
                  <button
                    key={answer}
                    type="button"
                    aria-pressed={row.answer === answer}
                    onClick={() =>
                      write(rows.map((item, i) => (i === index ? { ...item, answer } : item)))
                    }
                    className={cn(
                      "cursor-pointer rounded-pill border-0 px-3.5 py-1.5 font-[inherit] text-meta font-medium transition-[background,color,box-shadow] duration-200",
                      row.answer === answer
                        ? "bg-surface text-ink-1 shadow-pill"
                        : "bg-transparent text-ink-3",
                    )}
                  >
                    {t(`fundSetup.economy.answerKinds.${ANSWER_LABEL[answer]}` as never)}
                  </button>
                ))}
              </div>
            </div>
            <div
              role="group"
              aria-label={t("fundSetup.screen.previewLabel")}
              className="flex flex-wrap items-center gap-3 rounded-[14px] bg-canvas px-3.5 py-2.5"
            >
              <span className="text-meta text-ink-3">{t("fundSetup.screen.preview")}</span>
              {row.answer === "yn" ? (
                <span className="rounded-pill bg-positive-wash px-3 py-[3px] text-[13px] font-semibold text-positive">
                  {t("fundSetup.screen.pvYn")}
                </span>
              ) : row.answer === "num" ? (
                <span className="text-[24px] leading-[1.1] font-semibold tracking-title tabular-nums">
                  {t("fundSetup.screen.pvNum")}
                </span>
              ) : (
                <span className="text-[14px] text-ink-1">{t("fundSetup.screen.pvTxt")}</span>
              )}
              <span className="text-meta text-ink-3">{t("fundSetup.screen.pvSource")}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {rows.length < MAX_OWN_ECONOMY_QUESTIONS && (
          <Button
            size="md"
            variant="secondary"
            icon={Plus}
            onClick={() => setRows([...rows, { text: "", answer: "yn" }])}
          >
            {t("fundSetup.screen.addQuestion")}
          </Button>
        )}
        <AskButton field="finown" className="ml-auto" />
      </div>
    </div>
  );
}

const MISSING_CHOICES: Array<{ mode: MissingMode; icon: LucideIcon; n: number }> = [
  { mode: "task", icon: ListChecks, n: 2 },
  { mode: "unknown", icon: CircleHelp, n: 5 },
];

/** Prototype `finEditor`: the summary, five groups of points, what happens when a figure is missing, own questions. */
export function EconomyEditor({
  value,
  onChange,
  stage,
}: {
  value: EditorState;
  onChange: (value: EditorState) => void;
  stage: SetupStage;
}) {
  const t = useT();
  const language = useLanguage();
  const economy = economyOf(value, stage);
  const [open, setOpen] = useState<ReadonlySet<EconomyGroup>>(new Set());
  const total = ECONOMY_POINTS.length;
  const on = economy.points.filter((point) => point.on).length;
  return (
    <div className="flex flex-col gap-[26px]">
      <div className="flex flex-wrap items-center justify-between gap-6 rounded-[24px] bg-canvas px-6 py-5">
        <span className="text-[22px] leading-[1.2] font-semibold tracking-title">
          {t("fundSetup.screen.figuresOf", { on, total })}
        </span>
        <FinanceDots value={value} stage={stage} />
      </div>
      <div className="flex flex-col gap-3">
        {ECONOMY_GROUPS.map((group) => {
          const points = ECONOMY_POINTS.filter((point) => point.group === group);
          const style = GROUP_STYLE[group];
          const count = points.filter(
            (point) => economy.points.find((item) => item.key === point.key)?.on,
          ).length;
          const isOpen = open.has(group);
          return (
            <div key={group} className="overflow-hidden rounded-[22px] bg-canvas">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((current) => {
                    const next = new Set(current);
                    if (next.has(group)) next.delete(group);
                    else next.add(group);
                    return next;
                  })
                }
                className="flex w-full cursor-pointer items-center gap-3.5 border-0 bg-transparent px-[18px] py-[15px] text-left font-[inherit] text-inherit"
              >
                <SeriesTile icon={style.icon} n={style.n} size={38} />
                <span className="flex-1">
                  <b className="text-[15px] font-semibold">{economyGroupTitle(group, language)}</b>
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-pill px-[11px] py-[5px] text-[12px] whitespace-nowrap",
                    count ? "font-medium text-ink-1" : "bg-surface text-ink-3",
                  )}
                  style={count ? { background: seriesWash(style.n) } : undefined}
                >
                  {count > 0 && (
                    <span
                      aria-hidden
                      className="size-[7px] rounded-full"
                      style={{ background: series(style.n) }}
                    />
                  )}
                  {count
                    ? t("fundSetup.screen.groupOn", { on: count, total: points.length })
                    : t("fundSetup.screen.groupOff")}
                </span>
                <span className="text-ink-3" aria-hidden>
                  {isOpen ? (
                    <ChevronUp className="size-[18px]" />
                  ) : (
                    <ChevronDown className="size-[18px]" />
                  )}
                </span>
              </button>
              <Collapse open={isOpen}>
                <div className="flex flex-col px-[18px] pb-2">
                  {points.map((point) => {
                    const setup = economy.points.find((item) => item.key === point.key)!;
                    const question = economyPointQuestion(point.key, language);
                    const unit = economyPointUnit(point.key, language);
                    return (
                      <div
                        key={point.key}
                        className="flex items-start gap-3.5 border-t border-line py-[13px]"
                      >
                        <Toggle
                          checked={setup.on}
                          label={question}
                          onCheckedChange={(next) =>
                            onChange(withEconomyPoint(value, stage, point.key, { on: next }))
                          }
                          className="mt-px"
                        />
                        <div className="min-w-0 flex-1">
                          <b
                            className={cn(
                              "block text-[14px] leading-[1.4]",
                              setup.on ? "font-semibold" : "font-medium text-ink-2",
                            )}
                          >
                            {question}
                          </b>
                          <span className="mt-0.5 block text-[12px] text-ink-3">
                            {t("fundSetup.screen.source", {
                              source: economyPointSource(point.key, language),
                            })}
                          </span>
                          {setup.on && setup.limit && (
                            <span className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
                              {t("fundSetup.screen.markIf")}{" "}
                              {setup.limit.direction === "min"
                                ? t("fundSetup.screen.under")
                                : t("fundSetup.screen.over")}
                              <LimitField
                                limit={setup.limit.value}
                                label={t("fundSetup.screen.limitAria", { question })}
                                onCommit={(typed) =>
                                  onChange(
                                    withEconomyPoint(value, stage, point.key, { threshold: typed }),
                                  )
                                }
                              />
                              {unit}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Collapse>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2.5">
        <h3 className="m-0 text-section font-semibold">{t("fundSetup.screen.ifMissing")}</h3>
        <div className="grid grid-cols-2 gap-3">
          {MISSING_CHOICES.map((choice) => {
            const Icon = choice.icon;
            const pressed = economy.missing === choice.mode;
            return (
              <button
                key={choice.mode}
                type="button"
                aria-pressed={pressed}
                onClick={() => onChange(withEconomyMissing(value, stage, choice.mode))}
                className={cn(
                  "flex cursor-pointer flex-col items-start gap-2.5 rounded-[20px] border-0 p-4 text-left font-[inherit] transition-transform duration-[250ms] hover:-translate-y-0.5",
                  pressed ? "bg-surface shadow-[inset_0_0_0_2px_var(--ink-1)]" : "bg-canvas",
                )}
              >
                <SeriesTile icon={Icon} n={choice.n} size={36} />
                <b className="text-[15px] font-semibold">
                  {t(`fundSetup.economy.missing.${choice.mode}` as never)}
                </b>
              </button>
            );
          })}
        </div>
      </div>
      <OwnQuestions
        key={`${value.configId}-${stage}`}
        value={value}
        onChange={onChange}
        stage={stage}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// What the prompt says (the team's own text, as it reaches the screening)
// ---------------------------------------------------------------------------

type PromptLine = string | { b: string } | { em: string };

/** The text box of "Sådan bliver der screenet" (prototype `.prompt`). */
export function PromptBox({ lines, small }: { lines: PromptLine[]; small?: boolean }) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-[14px] bg-surface px-[18px] py-4 font-mono leading-[1.75] whitespace-pre-wrap text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] text-[12px]",
        small && "text-[12px]",
      )}
    >
      {lines.map((line, index) => (
        <span key={index}>
          {typeof line === "string" ? (
            line
          ) : "b" in line ? (
            <b className="font-medium text-ink-1">{line.b}</b>
          ) : (
            <em className="text-ink-3 not-italic">{line.em}</em>
          )}
          {index < lines.length - 1 ? "\n" : ""}
        </span>
      ))}
    </div>
  );
}

export type PromptBuilder = (
  t: ReturnType<typeof useT>,
  context: { value: EditorState; stage: SetupStage; language: Language; localeTag: string },
) => PromptLine[];

export const framePrompt: PromptBuilder = (t, { value, language, localeTag }) => {
  const or = ", ";
  return [
    { b: t("fundSetup.screen.prompt.frame") },
    `${t("fundSetup.screen.prompt.thesis")}: ${value.thesis}`,
    `${t("fundSetup.screen.prompt.stages")}: ${value.stages.map((stage) => stageText(stage, language)).join(or)}`,
    `${t("fundSetup.screen.prompt.geographies")}: ${value.geographies.map((entry) => geographyText(entry, language)).join(or)}`,
    `${t("fundSetup.screen.prompt.sectors")}: ${value.sectors.map((entry) => sectorText(entry, language)).join(or)}`,
    `${t("fundSetup.screen.prompt.ticket")}: ${ticketLine(value, localeTag)}`,
    `${t("fundSetup.screen.prompt.about")}: ${value.setup?.about ?? ""}`,
  ];
};

export const criteriaPrompt: PromptBuilder = (t, { value, stage }) => [
  { b: t("fundSetup.screen.prompt.criteria") },
  ...criteriaOf(value, stage).map(
    (criterion) => `- ${criterion.label} (${criterion.weight} %): ${criterion.description}`,
  ),
];

export const mandatePrompt: PromptBuilder = (t, { value, stage }) => [
  { b: t("fundSetup.screen.prompt.mandate") },
  t("fundSetup.screen.prompt.mandateLead"),
  ...gatesOf(value, stage).map(
    (gate) =>
      `- [${treatmentOf(gate) === "hard" ? t("fundSetup.screen.prompt.binding") : t("fundSetup.screen.prompt.review")}] ${gate.label}: ${gate.description}`,
  ),
];

export const financePrompt: PromptBuilder = (t, { value, stage, language }) => {
  const economy = economyOf(value, stage);
  const on = economy.points.filter((point) => point.on);
  const lines: PromptLine[] = [{ b: t("fundSetup.screen.prompt.finance") }];
  if (!on.length) lines.push(t("fundSetup.screen.prompt.nothingChosen"));
  for (const point of on) {
    const unit = economyPointUnit(point.key, language);
    const mark = point.limit
      ? ` (${t(
          point.limit.direction === "min"
            ? "fundSetup.screen.prompt.markIfUnder"
            : "fundSetup.screen.prompt.markIfOver",
          { value: point.limit.value, unit },
        )})`
      : "";
    lines.push(
      `- ${economyPointQuestion(point.key, language)}${mark} · ${t("fundSetup.screen.prompt.sourceLine", { source: economyPointSource(point.key, language) })}`,
    );
  }
  lines.push(
    "",
    { b: t("fundSetup.screen.prompt.missing") },
    economy.missing === "task"
      ? t("fundSetup.screen.prompt.missingTask")
      : t("fundSetup.screen.prompt.missingUnknown"),
  );
  if (economy.questions.length) {
    lines.push(
      "",
      { b: `${t("fundSetup.screen.prompt.ownQuestions")}` },
      t("fundSetup.screen.prompt.ownQuestionsNote"),
      ...economy.questions.map(
        (question) =>
          `- ${question.text} [${t(`fundSetup.screen.prompt.kind${question.answer === "yn" ? "Yn" : question.answer === "num" ? "Num" : "Txt"}` as never)}]`,
      ),
    );
  }
  lines.push("", { em: t("fundSetup.screen.prompt.closing") });
  return lines;
};

export const expectationsPrompt: PromptBuilder = (t, { value, stage, language }) => {
  const tab = stageTabs(value.stages).find((entry) => entry.stage === stage);
  const label = tab ? stageText(tab.raw, language) : stage;
  const text = (tab ? value.stageExpectations[tab.raw] : "")?.trim();
  return [
    { b: t("fundSetup.screen.prompt.expectations", { stage: label }) },
    text || t("fundSetup.screen.prompt.none"),
  ];
};

/** Prototype `gets`: what is sent, behind "Se teksten". */
export function GetsBox({
  pills,
  lines,
  id,
  title,
}: {
  pills: Array<{ label: string; icon: LucideIcon; bg: string; fg: string }>;
  lines: PromptLine[];
  id: string;
  /** The specialist sheet says "Sådan bliver der analyseret" here. */
  title?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-[20px] bg-canvas px-[18px] py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[13px] font-semibold">{title ?? t("fundSetup.screen.getsTitle")}</b>
          {pills.map((pill) => {
            const Icon = pill.icon;
            return (
              <span
                key={pill.label}
                className="inline-flex items-center gap-1.5 rounded-pill bg-surface py-1 pr-2.5 pl-1 text-[12px] font-medium text-ink-2 shadow-pill"
              >
                <i
                  aria-hidden
                  className="grid size-[18px] place-items-center rounded-full not-italic"
                  style={{ background: pill.bg, color: pill.fg }}
                >
                  <Icon className="size-3" strokeWidth={2} />
                </i>
                {pill.label}
              </span>
            );
          })}
        </div>
        <Button
          size="sm"
          variant="quiet"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((shown) => !shown)}
        >
          {open ? t("fundSetup.screen.hideTextShort") : t("fundSetup.screen.seeText")}
          {open ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
        </Button>
      </div>
      <Collapse open={open} id={id}>
        <PromptBox lines={lines} />
      </Collapse>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expectations ("Nøglefund")
// ---------------------------------------------------------------------------

const EXPECT_MAX = 2000;

/** The example of a key finding and "Hvad forventer I?" in words (prototype `instr`, `instrEditor`). */
export function ExpectationsEditor({
  value,
  onChange,
  stage,
  stageLabel,
  rawStage,
}: {
  value: EditorState;
  onChange: (value: EditorState) => void;
  stage: SetupStage;
  stageLabel: string;
  rawStage: string | undefined;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  const text = rawStage ? (value.stageExpectations[rawStage] ?? "") : "";
  const id = useRef(`expect-${stage}`);
  const example = (kind: "positive" | "warning", label: string, body: string): ReactNode => (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="inline-flex h-[34px] items-center rounded-pill px-3.5 text-[13px] font-medium"
        style={{
          background: `var(--${kind}-wash)`,
          color: `var(--${kind})`,
        }}
      >
        {label}
      </span>
      <span className="text-[13px]">{body}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-[26px]">
      <div className="flex flex-col gap-2 rounded-[24px] bg-canvas px-6 py-[22px]">
        {example(
          "positive",
          t("fundSetup.screen.exStrength"),
          t("fundSetup.screen.exStrengthText"),
        )}
        {example("warning", t("fundSetup.screen.exWeak"), t("fundSetup.screen.exWeakText"))}
      </div>
      {rawStage && (
        <div className="flex flex-col gap-2.5 rounded-[20px] bg-surface px-5 py-[18px] shadow-[inset_0_0_0_1px_var(--line-strong)]">
          <h3 className="m-0 text-section font-semibold">
            {t("fundSetup.screen.expectTitle", { stage: stageLabel })}
          </h3>
          <label className={LABEL} htmlFor={id.current}>
            {t("fundSetup.screen.expectLabel")}
          </label>
          <textarea
            id={id.current}
            rows={6}
            value={text}
            maxLength={EXPECT_MAX}
            onChange={(event) =>
              onChange({
                ...value,
                stageExpectations: { ...value.stageExpectations, [rawStage]: event.target.value },
              })
            }
            className={cn(FIELD_AREA, "min-h-[140px]")}
          />
          <span className="self-end text-[12px] text-ink-3 tabular-nums">
            {t("fundSetup.screen.expectCount", {
              count: text.length.toLocaleString(localeTag),
              max: EXPECT_MAX.toLocaleString(localeTag),
            })}
          </span>
          <AskRow field="instr" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

/** Prototype `compareTable`: the criteria's weights per stage, then counts. */
export function CompareTable({
  value,
  onPick,
  specialistCounts,
}: {
  value: EditorState;
  onPick: (stage: SetupStage) => void;
  /** The specialists on in each stage; the row shows once they are loaded. */
  specialistCounts?: Partial<Record<SetupStage, number>>;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  const language = useLanguage();
  const tabs = stageTabs(value.stages);
  const lists = tabs.map((tab) => ({ tab, criteria: criteriaOf(value, tab.stage) }));
  const names: string[] = [];
  for (const entry of lists)
    for (const criterion of entry.criteria)
      if (!names.includes(criterion.label)) names.push(criterion.label);
  const weight = (index: number, name: string) =>
    lists[index]!.criteria.find((criterion) => criterion.label === name)?.weight ?? 0;
  const best = (name: string) => Math.max(...lists.map((_, index) => weight(index, name)));
  names.sort((a, b) => best(b) - best(a));
  const th = "px-2.5 py-[11px] text-left align-middle";
  return (
    <div className="overflow-x-auto rounded-[16px] bg-sunken px-[18px] pt-2 pb-3.5">
      <table className="w-full min-w-[520px] border-collapse text-[14px]">
        <thead>
          <tr>
            <th scope="col" className={cn(th, "text-[13px] font-medium text-ink-3")}>
              {t("fundSetup.screen.cmpCriterion")}
            </th>
            {tabs.map((tab) => (
              <th
                key={tab.stage}
                scope="col"
                className={cn(th, "text-[13px] font-medium text-ink-3")}
              >
                <button
                  type="button"
                  onClick={() => onPick(tab.stage)}
                  className="inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent py-1 font-[inherit] text-[14px] font-semibold text-ink-1 hover:underline"
                >
                  <span
                    aria-hidden
                    className="size-[7px] rounded-full"
                    style={{ background: series(STAGE_SERIES[tab.stage]) }}
                  />
                  {stageText(tab.raw, language)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((name) => (
            <tr key={name}>
              <th scope="row" className={cn(th, "font-medium whitespace-nowrap text-ink-1")}>
                {name}
              </th>
              {tabs.map((tab, index) => {
                const w = weight(index, name);
                return (
                  <td key={tab.stage} className={cn(th, "whitespace-nowrap")}>
                    {w ? (
                      <>
                        <span className="mr-2.5 inline-block h-2 w-[88px] overflow-hidden rounded-[4px] bg-surface align-middle">
                          <i
                            className="block h-full rounded-[4px]"
                            style={{
                              width: `${(w / WEIGHT_MAX_PERCENT) * 100}%`,
                              background: series(STAGE_SERIES[tab.stage]),
                            }}
                          />
                        </span>
                        <b className="font-semibold tabular-nums">
                          {w.toLocaleString(localeTag, { maximumFractionDigits: 1 })} %
                        </b>
                      </>
                    ) : (
                      <span className="text-[13px] text-ink-3">
                        {t("fundSetup.screen.cmpNone")}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th
              scope="row"
              className={cn(th, "border-t border-line pt-4 font-medium whitespace-nowrap")}
            >
              {t("fundSetup.screen.cmpBinding")}
            </th>
            {tabs.map((tab) => {
              const rules = gatesOf(value, tab.stage);
              return (
                <td
                  key={tab.stage}
                  className={cn(th, "border-t border-line pt-4 whitespace-nowrap")}
                >
                  <b className="font-semibold tabular-nums">
                    {t("fundSetup.screen.cmpOf", {
                      hard: rules.filter((rule) => treatmentOf(rule) === "hard").length,
                      total: rules.length,
                    })}
                  </b>
                </td>
              );
            })}
          </tr>
          <tr>
            <th scope="row" className={cn(th, "font-medium whitespace-nowrap")}>
              {t("fundSetup.screen.cmpFigures")}
            </th>
            {tabs.map((tab) => (
              <td key={tab.stage} className={cn(th, "whitespace-nowrap")}>
                <b className="font-semibold tabular-nums">
                  {economyOf(value, tab.stage).points.filter((point) => point.on).length}
                </b>
              </td>
            ))}
          </tr>
          {specialistCounts && (
            <tr>
              <th scope="row" className={cn(th, "font-medium whitespace-nowrap")}>
                {t("fundSetup.screen.cmpSpecialists")}
              </th>
              {tabs.map((tab) => (
                <td key={tab.stage} className={cn(th, "whitespace-nowrap")}>
                  <b className="font-semibold tabular-nums">{specialistCounts[tab.stage] ?? "…"}</b>
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
