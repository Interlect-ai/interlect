/**
 * The place "Sådan screener vi", ported 1:1 from the prototype `Teamopsaetning v3.dc.html`
 * (`screenOverview`, `docCore`, `cardSheet`). One stage at a time (the pills on top):
 *
 *   Stage pills + "Sammenlign stadier"
 *   "Sådan screener I i <stadie>"
 *   Score og anbefaling                the stage's own threshold for deep analysis (slider)
 *   Profil · Mandat · Nøglefund · Økonomi   four cards, each opens its sheet
 *   Det læser Interlect ved hver case  the 29 fixed rules (9 editable, "Nulstil"), "Jeres valg"
 *
 * What is edited lives in stage-editor.ts (criteria and rules with a stage, `setup.stages`,
 * `setup.fixedRules`); the sheets are in ScreeningSheets.tsx. The fixed rules are the team's own
 * rules of play (beslutningsloggen 15. nov 2026): shown and editable in the team's language.
 */
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  ChartColumn,
  ChevronDown,
  ChevronUp,
  Coins,
  Eye,
  FileText,
  List,
  ListChecks,
  Lock,
  Pencil,
  Rocket,
  Shield,
  SlidersHorizontal,
} from "lucide-react";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { Sheet } from "@/components/ds/Sheet";
import { weightColor } from "@/components/funds/editor/WeightDonut";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import { stageText } from "@/lib/funds/basis-labels";
import {
  FIXED_RULES,
  FIXED_RULE_GROUPS,
  FIXED_RULE_MAX_CHARS,
  fixedRuleGroupTitle,
  type FixedRuleGroup,
} from "@/lib/funds/fixed-rules";
import {
  criteriaOf,
  economyOf,
  fixedRuleChanged,
  fixedRuleNow,
  gatesOf,
  stageTabs,
  thresholdOf,
  withFixedRule,
  withThreshold,
} from "@/lib/funds/stage-editor";
import { useStageSpecialistCounts } from "@/components/funds/editor/use-fund-specialists";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  CompareTable,
  CriteriaEditor,
  EconomyEditor,
  ExpectationsEditor,
  FinanceDots,
  GetsBox,
  MandateEditor,
  PromptBox,
  RANGE_OVER_BAR,
  SeriesTile,
  criteriaPrompt,
  expectationsPrompt,
  financePrompt,
  framePrompt,
  mandatePrompt,
  ruleStyle,
  seriesPill,
  series,
  seriesWash,
  ticketLine,
  treatmentOf,
  type PromptBuilder,
} from "./ScreeningSheets";
import { StagePills } from "./StagePills";
import { AiBox, useAssistantSheet } from "./SetupAssistant";

type EditorState = SaveFundConfigInput;
type SheetKey = "cmp" | "crit" | "rules" | "fin" | "instr";

const THRESHOLD_MIN = 40;
const THRESHOLD_MAX = 95;

const GROUP_ICON = {
  evidence: Shield,
  score: ChartColumn,
  form: List,
  safety: Lock,
} as const;

/** One of the four cards under the score (prototype `mc`). */
function MapCard({
  title,
  hint,
  delay,
  onOpen,
  visual,
  number,
}: {
  title: string;
  hint: string;
  delay: number;
  /** Left out for Member and Reader: the card only shows. */
  onOpen: (() => void) | undefined;
  visual: ReactNode;
  number: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      title={hint}
      onClick={onOpen}
      disabled={!onOpen}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.64, ease: EASE.out, delay }}
      className="flex min-h-[240px] w-full cursor-pointer disabled:cursor-default flex-col gap-3.5 rounded-[24px] border-0 bg-canvas p-[22px] text-left font-[inherit] outline-none transition-[transform,background-color,box-shadow] duration-[350ms] ease-standard hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-action active:scale-[.98] disabled:hover:translate-y-0 disabled:active:scale-100"
    >
      <span className="flex w-full items-center justify-between">
        <b className="text-[14px] font-semibold">{title}</b>
        {onOpen && <ArrowUpRight className="size-3.5 text-ink-4" strokeWidth={1.75} aria-hidden />}
      </span>
      <span className="flex min-h-[108px] flex-1 items-center justify-center">{visual}</span>
      <span className="text-[22px] leading-[1.2] font-semibold tracking-title">{number}</span>
    </motion.button>
  );
}

/** One of the 29 fixed rules, editable ones with "Nulstil" (prototype `fxl`). */
function FixedRuleItem({
  id,
  locked,
  index,
  group,
  value,
  onChange,
  readOnly,
}: {
  id: string;
  locked: boolean;
  readOnly?: boolean | undefined;
  index: number;
  group: string;
  value: EditorState;
  onChange: (value: EditorState) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const [typing, setTyping] = useState<string | null>(null);
  const text = fixedRuleNow(value, id, language);
  if (locked || readOnly)
    return (
      <li
        title={locked ? t("fundSetup.screen.locked") : undefined}
        className="flex items-start gap-2.5 leading-[1.5]"
      >
        <i
          aria-hidden
          className="inline-flex h-[34px] w-[22px] items-center justify-center text-ink-3"
        >
          {locked && <Lock className="size-[13px]" strokeWidth={1.75} />}
        </i>
        <span className="py-[7px] text-ink-2">{text}</span>
      </li>
    );
  return (
    <li className="flex items-start gap-2.5 leading-[1.5]">
      <i
        aria-hidden
        className="inline-flex h-[34px] w-[22px] items-center justify-center text-ink-3"
      >
        <Pencil className="size-[13px]" strokeWidth={1.75} />
      </i>
      <span className="flex flex-1 items-start gap-2">
        <textarea
          rows={1}
          value={typing ?? text}
          maxLength={FIXED_RULE_MAX_CHARS}
          aria-label={t("fundSetup.screen.ruleAria", { n: index + 1, group })}
          onChange={(event) => {
            setTyping(event.target.value);
            // An empty text is not saved (the standard stays); the field keeps what is typed.
            if (event.target.value.trim())
              onChange(withFixedRule(value, id, event.target.value, language));
          }}
          onBlur={() => {
            if (typing !== null && !typing.trim())
              onChange(withFixedRule(value, id, null, language));
            setTyping(null);
          }}
          className="min-h-[34px] flex-1 resize-none rounded-[12px] border-0 bg-surface px-3 py-[7px] font-[inherit] text-[14px] leading-[1.45] text-ink-1 outline-none [field-sizing:content] focus-visible:shadow-[0_0_0_2px_var(--action)]"
        />
        {fixedRuleChanged(value, id) && (
          <Button
            size="sm"
            variant="quiet"
            aria-label={t("fundSetup.screen.resetAria", { n: index + 1, group })}
            onClick={() => {
              setTyping(null);
              onChange(withFixedRule(value, id, null, language));
            }}
          >
            {t("fundSetup.screen.reset")}
          </Button>
        )}
      </span>
    </li>
  );
}

/** The four groups of fixed rules (prototype `docCore` → `fixed`). */
function FixedRules({
  value,
  onChange,
  readOnly,
}: {
  value: EditorState;
  onChange: (value: EditorState) => void;
  readOnly?: boolean | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const [openGroup, setOpenGroup] = useState<FixedRuleGroup | null>(null);
  return (
    <div className="flex flex-col gap-2.5">
      {FIXED_RULE_GROUPS.map((group) => {
        const rules = FIXED_RULES.filter((rule) => rule.group === group);
        const changed = rules.filter((rule) => fixedRuleChanged(value, rule.id)).length;
        const open = openGroup === group;
        const Icon = GROUP_ICON[group];
        const title = fixedRuleGroupTitle(group, language);
        return (
          <div key={group} className="flex flex-col gap-3 rounded-[22px] bg-canvas px-[18px] py-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface text-ink-2"
              >
                <Icon className="size-[17px]" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <b className="block text-[15px] font-semibold">{title}</b>
                <span className="block text-[12px] text-ink-3">
                  {changed
                    ? t(
                        changed === 1
                          ? "fundSetup.screen.groupCountOne"
                          : "fundSetup.screen.groupCountMany",
                        {
                          count: rules.length,
                          changed,
                        },
                      )
                    : t("fundSetup.screen.groupCount", { count: rules.length })}
                </span>
              </div>
              <Button
                size="sm"
                variant="quiet"
                aria-expanded={open}
                onClick={() => setOpenGroup(open ? null : group)}
              >
                {open
                  ? t("fundSetup.screen.hide")
                  : rules.some((rule) => !rule.locked) && !readOnly
                    ? t("fundSetup.screen.seeAndEdit")
                    : t("fundSetup.screen.seeRules")}
                {open ? (
                  <ChevronUp className="size-3.5" aria-hidden />
                ) : (
                  <ChevronDown className="size-3.5" aria-hidden />
                )}
              </Button>
            </div>
            <Collapse open={open}>
              <ol className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] text-ink-2">
                {rules.map((rule, index) => (
                  <FixedRuleItem
                    key={rule.id}
                    id={rule.id}
                    locked={rule.locked}
                    index={index}
                    group={title}
                    value={value}
                    onChange={onChange}
                    readOnly={readOnly}
                  />
                ))}
              </ol>
            </Collapse>
          </div>
        );
      })}
    </div>
  );
}

/** "Det læser Interlect ved hver case" (prototype `docCore`). */
function WhatInterlectReads({
  value,
  stage,
  onChange,
  onOpen,
  onGoThesis,
  readOnly,
}: {
  value: EditorState;
  stage: SetupStage;
  onChange: (value: EditorState) => void;
  onOpen: (sheet: SheetKey) => void;
  onGoThesis: () => void;
  readOnly?: boolean | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const [textOpen, setTextOpen] = useState(false);
  const criteria = criteriaOf(value, stage);
  const rules = gatesOf(value, stage);
  const economy = economyOf(value, stage);
  const context = { value, stage, language, localeTag };
  const sum = criteria.reduce((total, criterion) => total + criterion.weight, 0);
  const sections: Array<{
    title: string;
    summary: string;
    icon: typeof Rocket;
    n: number;
    prompt: PromptBuilder;
    go: () => void;
  }> = [
    {
      title: t("fundSetup.screen.secFrame"),
      summary: t("fundSetup.screen.secFrameSum", {
        stages: value.stages.length,
        geos: value.geographies.length,
        sectors: value.sectors.length,
        ticket: ticketLine(value, localeTag),
      }),
      icon: Rocket,
      n: 1,
      prompt: framePrompt,
      go: onGoThesis,
    },
    {
      title: t("fundSetup.screen.secCriteria"),
      summary: t("fundSetup.screen.secCriteriaSum", {
        count: criteria.length,
        sum: Math.round(sum * 10) / 10,
      }),
      icon: ListChecks,
      n: 5,
      prompt: criteriaPrompt,
      go: () => onOpen("crit"),
    },
    {
      title: t("fundSetup.screen.secMandate"),
      summary: t("fundSetup.screen.secMandateSum", {
        count: rules.length,
        hard: rules.filter((rule) => treatmentOf(rule) === "hard").length,
      }),
      icon: Shield,
      n: 2,
      prompt: mandatePrompt,
      go: () => onOpen("rules"),
    },
    {
      title: t("fundSetup.screen.secFinance"),
      summary: t("fundSetup.screen.secFinanceSum", {
        count: economy.points.filter((point) => point.on).length,
        missing:
          economy.missing === "task"
            ? t("fundSetup.screen.missingTask")
            : t("fundSetup.screen.missingUnknown"),
      }),
      icon: Coins,
      n: 7,
      prompt: financePrompt,
      go: () => onOpen("fin"),
    },
  ];
  const flow = (icon: typeof Lock, label: string, color: string, wash: string) => {
    const Icon = icon;
    return (
      <div
        className="flex min-w-[200px] flex-1 items-center gap-3 rounded-[20px] bg-canvas px-4 py-3.5"
        style={{ color }}
      >
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-[11px]"
          style={{ background: wash, color }}
        >
          <Icon className="size-[17px]" strokeWidth={1.75} />
        </span>
        <b className="text-[14px] font-semibold text-ink-1">{label}</b>
      </div>
    );
  };
  const arrow = <ArrowRight className="size-[18px] text-ink-4" aria-hidden />;
  return (
    <div className="flex flex-col gap-[26px]">
      <div className="flex flex-wrap items-center gap-2.5">
        {flow(Lock, t("fundSetup.screen.flowRules"), "var(--ink-2)", "var(--bg-sunken)")}
        {arrow}
        {flow(SlidersHorizontal, t("fundSetup.screen.flowChoices"), series(1), seriesWash(1))}
        {arrow}
        {flow(FileText, t("fundSetup.screen.flowCase"), series(8), seriesWash(8))}
      </div>
      <h3 className="m-0 text-section font-semibold">{t("fundSetup.screen.alwaysTitle")}</h3>
      <FixedRules value={value} onChange={onChange} readOnly={readOnly} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 text-section font-semibold">{t("fundSetup.screen.choicesTitle")}</h3>
        <Button
          size="md"
          variant="secondary"
          icon={textOpen ? ChevronUp : Eye}
          aria-expanded={textOpen}
          onClick={() => setTextOpen((shown) => !shown)}
        >
          {textOpen ? t("fundSetup.screen.hideText") : t("fundSetup.screen.showText")}
        </Button>
      </div>
      <div className="flex flex-col gap-2.5">
        {sections.map((section) => (
          <div
            key={section.title}
            className="flex flex-col gap-3 rounded-[22px] bg-canvas px-[18px] py-4"
          >
            <div className="flex items-center gap-3">
              <SeriesTile icon={section.icon} n={section.n} size={38} />
              <div className="min-w-0 flex-1">
                <b className="block text-[15px] font-semibold">{section.title}</b>
                <span className="block text-[12px] text-ink-3">{section.summary}</span>
              </div>
              {!readOnly && (
                <Button size="sm" variant="secondary" onClick={section.go}>
                  {t("fundSetup.screen.edit")}
                </Button>
              )}
            </div>
            <Collapse open={textOpen}>
              <PromptBox lines={section.prompt(t, context)} small />
            </Collapse>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-[22px] bg-canvas px-[18px] py-4">
        <SeriesTile icon={FileText} n={8} size={38} />
        <b className="text-[15px] font-semibold">{t("fundSetup.screen.tail")}</b>
      </div>
    </div>
  );
}

export function ScreeningPlace({
  fundId,
  value,
  onChange,
  stage,
  onStageChange,
  onGoThesis,
  heading,
  readOnly,
  disabled,
}: {
  fundId: string;
  value: EditorState;
  onChange: (value: EditorState) => void;
  /** The shell holds the fields still (a proposal is applying, or the draft is out of date). */
  disabled?: boolean | undefined;
  /** Member and Reader: the same page without the means to change it. */
  readOnly?: boolean | undefined;
  /** The stage on show (the shell keeps it, so the next place opens on the same stage). */
  stage: SetupStage | null;
  onStageChange: (stage: SetupStage) => void;
  onGoThesis: () => void;
  /** The page title, drawn by the shell so every place has the same one. */
  heading: (title: string) => ReactNode;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const reduced = useReducedMotion();
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  // The Interlect-Assistent knows which sheet is open (and closes when one opens).
  useAssistantSheet(sheet ? { sheet } : null);
  const tabs = stageTabs(value.stages);
  const specialistCounts = useStageSpecialistCounts(
    fundId,
    value.configId,
    tabs.map((tab) => tab.stage),
  );
  const current = tabs.find((tab) => tab.stage === stage) ?? tabs[0];
  if (!current) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="m-0 max-w-[520px] text-[15px] text-ink-3">{t("fundSetup.screen.noStages")}</p>
        <Button variant="secondary" size="md" onClick={onGoThesis}>
          {t("fundSetup.screen.goThesis")}
        </Button>
      </div>
    );
  }
  const active = current.stage;
  const label = stageText(current.raw, language);
  const criteria = criteriaOf(value, active);
  const rules = gatesOf(value, active);
  const economy = economyOf(value, active);
  // The real threshold is shown; only the slider's position is kept within its range.
  const threshold = thresholdOf(value, active);
  const sliderAt = Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, threshold));
  const context = { value, stage: active, language, localeTag };
  const sheetTitle: Record<SheetKey, string> = {
    cmp: t("fundSetup.screen.sheetCompare"),
    crit: t("fundSetup.screen.sheetCriteria", { stage: label }),
    rules: t("fundSetup.screen.sheetMandate", { stage: label }),
    fin: t("fundSetup.screen.sheetFinance", { stage: label }),
    instr: t("fundSetup.screen.sheetFindings", { stage: label }),
  };
  const sheetBody = (key: SheetKey): ReactNode => {
    switch (key) {
      case "cmp":
        return (
          <CompareTable
            value={value}
            specialistCounts={specialistCounts}
            onPick={(next) => {
              onStageChange(next);
              setSheet(null);
            }}
          />
        );
      case "crit":
        return (
          <>
            <AiBox
              field="box:crit"
              title={t("fundSetup.assistant.box.critTitle")}
              placeholder={t("fundSetup.assistant.box.critPh")}
            />
            <CriteriaEditor value={value} onChange={onChange} stage={active} />
            <GetsBox
              id="gets-crit"
              pills={[
                { label: t("fundSetup.screen.pillCriteria"), icon: List, ...seriesPill(5) },
                { label: t("fundSetup.screen.pillWeights"), icon: ChartColumn, ...seriesPill(1) },
              ]}
              lines={criteriaPrompt(t, context)}
            />
          </>
        );
      case "rules":
        return (
          <>
            <MandateEditor
              value={value}
              onChange={onChange}
              stage={active}
              onGoThesis={onGoThesis}
            />
            <GetsBox
              id="gets-rules"
              pills={[
                {
                  label: t("fundSetup.screen.pillRules", { count: rules.length }),
                  icon: Shield,
                  ...seriesPill(2),
                },
                {
                  label: t("fundSetup.screen.pillBinding", {
                    count: rules.filter((rule) => treatmentOf(rule) === "hard").length,
                  }),
                  icon: Lock,
                  bg: "var(--action-wash)",
                  fg: "var(--action)",
                },
              ]}
              lines={mandatePrompt(t, context)}
            />
          </>
        );
      case "fin":
        return (
          <>
            <EconomyEditor value={value} onChange={onChange} stage={active} />
            <GetsBox
              id="gets-fin"
              pills={[
                {
                  label: t("fundSetup.screen.pillFigures", {
                    count: economy.points.filter((point) => point.on).length,
                  }),
                  icon: Coins,
                  ...seriesPill(2),
                },
              ]}
              lines={financePrompt(t, context)}
            />
          </>
        );
      case "instr":
        return (
          <>
            <ExpectationsEditor
              value={value}
              onChange={onChange}
              stage={active}
              stageLabel={label}
              rawStage={current.raw}
            />
            <GetsBox
              id="gets-instr"
              pills={[
                {
                  label: t("fundSetup.screen.pillInstruction"),
                  icon: Pencil,
                  bg: "var(--warning-wash)",
                  fg: "var(--warning)",
                },
              ]}
              lines={expectationsPrompt(t, context)}
            />
          </>
        );
    }
  };
  return (
    <>
      <StagePills
        tabs={tabs}
        active={active}
        onPick={onStageChange}
        onCompare={() => setSheet("cmp")}
      />

      {heading(t("fundSetup.screen.title", { stage: label }))}

      <div className="grid gap-[30px] rounded-[24px] bg-canvas px-7 py-6 min-[1101px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-2.5">
          <span className="text-[15px] font-semibold">{t("fundSetup.screen.heroTitle")}</span>
          <span className="max-w-[520px] text-[13px] leading-[1.6] text-ink-3 italic">
            {t("fundSetup.screen.heroExample")}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <b className="text-[48px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
            {threshold}
          </b>
          <div className="relative mt-3.5 h-1.5 w-full rounded-[3px] bg-sunken">
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-[3px]"
              style={{
                width: `${((sliderAt - THRESHOLD_MIN) / (THRESHOLD_MAX - THRESHOLD_MIN)) * 100}%`,
                background: "var(--series-1)",
                transition: reduced ? "none" : "width 200ms ease-out",
              }}
            />
            <input
              type="range"
              min={THRESHOLD_MIN}
              max={THRESHOLD_MAX}
              step={1}
              value={sliderAt}
              disabled={readOnly}
              aria-label={t("fundSetup.screen.thresholdAria")}
              onChange={(event) =>
                onChange(withThreshold(value, active, Number(event.target.value)))
              }
              className={cn("absolute top-[-9px] left-0", RANGE_OVER_BAR)}
            />
          </div>
          <span className="mt-2.5 text-[12px] text-ink-3 tabular-nums">
            {t("fundSetup.screen.threshold", { threshold })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5 min-[1101px]:grid-cols-4 max-sm:grid-cols-1">
        <MapCard
          title={t("fundSetup.screen.cardProfile")}
          hint={t("fundSetup.screen.profileCaption")}
          delay={0.06}
          onOpen={readOnly ? undefined : () => setSheet("crit")}
          visual={
            <span className="flex w-full items-center justify-center" aria-hidden>
              <PieChart
                data={criteria.map((criterion, index) => ({
                  label: criterion.label,
                  value: Math.max(criterion.weight, 0.0001),
                  color: weightColor(index),
                }))}
                size={125}
                innerRadius={42}
                padAngle={(1.4 / 100) * Math.PI * 2}
                cornerRadius={0}
              >
                {criteria.map((criterion, index) => (
                  <PieSlice key={criterion.key} index={index} hoverEffect="none" />
                ))}
              </PieChart>
            </span>
          }
          number={t("fundSetup.screen.profileCount", { count: criteria.length })}
        />
        <MapCard
          title={t("fundSetup.screen.cardMandate")}
          hint={t("fundSetup.screen.mandateCaption")}
          delay={0.12}
          onOpen={readOnly ? undefined : () => setSheet("rules")}
          visual={
            <span className="flex flex-wrap items-center justify-center gap-2" aria-hidden>
              {rules.map((rule) => {
                const style = ruleStyle(rule.key);
                const Icon = style.icon;
                return (
                  <span
                    key={`${rule.stage ?? "all"}:${rule.key}`}
                    className="relative grid size-[38px] place-items-center rounded-full"
                    style={{ background: seriesWash(style.n), color: series(style.n) }}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                    {treatmentOf(rule) === "hard" && (
                      <i className="absolute -top-px -right-px size-[9px] rounded-full bg-action shadow-[0_0_0_2px_var(--bg-canvas)]" />
                    )}
                  </span>
                );
              })}
            </span>
          }
          number={t("fundSetup.screen.mandateCount", { count: rules.length })}
        />
        <MapCard
          title={t("fundSetup.screen.cardFindings")}
          hint={t("fundSetup.screen.findingsCaption")}
          delay={0.18}
          onOpen={readOnly ? undefined : () => setSheet("instr")}
          visual={
            <span className="flex w-full flex-col gap-3" aria-hidden>
              <span className="flex h-3 gap-0.5 overflow-hidden rounded-[6px]">
                <i className="flex-[3] rounded-[6px_2px_2px_6px] bg-positive" />
                <i className="flex-[2] rounded-[2px_6px_6px_2px] bg-warning" />
              </span>
              <span className="flex justify-between text-meta text-ink-3">
                <span>{t("fundSetup.screen.strengths")}</span>
                <span>{t("fundSetup.screen.weaknesses")}</span>
              </span>
            </span>
          }
          number={t("fundSetup.screen.findingsCount")}
        />
        <MapCard
          title={t("fundSetup.screen.cardFinance")}
          hint={t("fundSetup.screen.financeCaption")}
          delay={0.24}
          onOpen={readOnly ? undefined : () => setSheet("fin")}
          visual={<FinanceDots value={value} stage={active} compact />}
          number={t("fundSetup.screen.financeCount", {
            count: economy.points.filter((point) => point.on).length,
          })}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-4 rounded-[24px] bg-canvas px-6 py-[22px]">
        <h2 className="m-0 text-section font-semibold">{t("fundSetup.screen.reads")}</h2>
        <WhatInterlectReads
          value={value}
          stage={active}
          onChange={onChange}
          onOpen={setSheet}
          onGoThesis={onGoThesis}
          readOnly={readOnly}
        />
      </div>

      <Sheet
        open={sheet !== null}
        onOpenChange={(next) => {
          if (!next) setSheet(null);
        }}
        title={sheet ? sheetTitle[sheet] : ""}
        className={sheet === "cmp" ? "w-[min(860px,100vw)]" : "w-[min(760px,calc(100vw-24px))]"}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setSheet(null)}>{t("fundSetup.screen.done")}</Button>
          </div>
        }
      >
        <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-[22px] border-0 p-0">
          {sheet && sheetBody(sheet)}
        </fieldset>
      </Sheet>
    </>
  );
}
