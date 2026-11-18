/**
 * "Se" (prototype Fondsopsaetning v2, area cards, "Effekt af den aktive version" and
 * "Versioner"): the active version of the thesis as six cards in the guide's order with a few
 * numbers and one chart on the surface. A click folds the details out below; "Redigér" opens the
 * editing flow at the same step. Everything is read from the fund's real active version.
 */
import { CreditMeter } from "@/components/ai/CreditMeter";
import { LanguageBox } from "@/components/funds/LanguageBox";
import { AiLevelBox } from "@/components/funds/AiLevelBox";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { ChartPie, CircleCheck, Scale, type LucideIcon } from "lucide-react";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { Collapse } from "@/components/ds/Collapse";
import { CountUp } from "@/components/ds/CountUp";
import { Reveal } from "@/components/ds/Reveal";
import { financeGateTreatment, isFinanceGate } from "@/lib/analysis/financial-gates";
import { isCodeAnchored } from "@/lib/analysis/code-anchor";
import { SpecialistBot } from "@/components/ai/SpecialistBot";
import {
  ownSpecialistKind,
  specialistKind,
  type SpecialistKind,
} from "@/components/ai/specialist-kind";
import { useFundSpecialists } from "@/components/funds/editor/use-fund-specialists";
import { categoryToModule, specialistCatalog } from "@/lib/analysis/specialist-catalog";
import { listCases } from "@/lib/cases/cases.functions";
import { formatScore } from "@/lib/cases/presentation";
import { geographyText, sectorText, stageText } from "@/lib/funds/basis-labels";
import { gateInLanguage } from "@/lib/funds/gate-labels";
import { listFundConfigVersions, type EditableFundConfig } from "@/lib/funds/config.functions";
import type { FundSpecialistsView } from "@/lib/funds/specialists.functions";
import { STANDARD_SPECIALIST_CARDS, standardSpecialistCardIn } from "@/lib/funds/specialist-cards";
import type { Language } from "@/lib/i18n/language";
import {
  aboveThreshold,
  dotPosition,
  firstSentence,
  gateCounts,
  plural,
  scoreDomain,
  ticketLine,
  versionRow,
} from "@/lib/funds/overview-summary";
import { ticketShareOfFund, ticketShareText } from "@/lib/funds/fund-size";
import { CHART_PRESETS, presetTransition, tokenColor } from "@/lib/charts/presets";
import { SPRING } from "@/lib/motion";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";
import { strategyTypeLabel, formatEur, ticketText } from "./config-format";
import type { GuideStepKey } from "./editor/guide-steps";

type AreaKey = "basis" | "thesis" | "weights" | "mandate" | "screening" | "specialists";

type T = ReturnType<typeof useT>;

const AREA_TITLE: Record<AreaKey, MessageKey> = {
  basis: "fundSetup.overview.areaBasis",
  thesis: "fundSetup.overview.areaThesis",
  weights: "fundSetup.overview.areaWeights",
  mandate: "fundSetup.overview.areaMandate",
  screening: "fundSetup.overview.areaScreening",
  specialists: "fundSetup.overview.areaSpecialists",
};

/** The editing flow's step for each area; Screening has its own step. */
const AREA_STEP: Partial<Record<AreaKey, GuideStepKey>> = {
  basis: "basis",
  thesis: "thesis",
  weights: "weights",
  mandate: "mandate",
  screening: "screening",
  specialists: "specialists",
};

const AREAS: AreaKey[] = ["basis", "thesis", "weights", "mandate", "screening", "specialists"];

/** The three cards every screening shows (the extra cards are no longer a choice). */
const FIXED_SCREENING_CARDS: Array<{ label: MessageKey; icon: LucideIcon; color: string }> = [
  { label: "fundSetup.overview.cardProfile", icon: ChartPie, color: "var(--series-1)" },
  { label: "fundSetup.overview.cardMandateFit", icon: CircleCheck, color: "var(--positive)" },
  { label: "fundSetup.overview.cardKeyFindings", icon: Scale, color: "var(--warning)" },
];

function screeningCardsOf(t: T) {
  return FIXED_SCREENING_CARDS.map((card) => ({ ...card, label: t(card.label) }));
}

/** "3 faste kort". */
function screeningCardsText(t: T): string {
  return t("fundSetup.overview.fixedCards", { count: FIXED_SCREENING_CARDS.length });
}

function effectiveTreatment(gate: EditableFundConfig["gates"][number]) {
  return isFinanceGate(gate.key) ? financeGateTreatment(gate.key) : gate.treatment;
}

/** The version's set of specialists, or what to say while it is read or when it failed. */
type SpecialistsState = { view: FundSpecialistsView; note: null } | { view: null; note: string };

/**
 * The specialists a deep run with this version runs: the active standard ones and the
 * fund's own, each with its figure.
 */
function activeSpecialists(
  view: FundSpecialistsView,
): Array<{ id: string; title: string; kind: SpecialistKind }> {
  return [
    ...view.standard
      .filter((module) => module.enabled)
      .map((module) => ({ id: module.id, title: module.title, kind: specialistKind(module.id) })),
    // The figure follows the specialist's place among all the fund's own, as in the editor.
    ...view.custom.flatMap((item, index) =>
      item.enabled ? [{ id: item.key, title: item.name, kind: ownSpecialistKind(index) }] : [],
    ),
  ];
}

/** The standard specialists carry their Danish module title; show them in the team's language. */
function inTeamLanguage(view: FundSpecialistsView, language: Language): FundSpecialistsView {
  if (language === "da") return view;
  const name = (id: string, fallback: string) =>
    id in STANDARD_SPECIALIST_CARDS
      ? standardSpecialistCardIn(id as keyof typeof STANDARD_SPECIALIST_CARDS, language).role
      : fallback;
  return {
    ...view,
    standard: view.standard.map((module) => ({ ...module, title: name(module.id, module.title) })),
    assignment: view.assignment.map((item) =>
      item.kind === "standard" ? { ...item, title: name(item.id, item.title) } : item,
    ),
  };
}

function joinMax(items: string[], max: number): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} +${items.length - max}`;
}

export function FundOverview({
  fundId,
  active,
  onEdit,
}: {
  fundId: string;
  active: EditableFundConfig;
  onEdit?: ((step: GuideStepKey) => void) | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const [open, setOpen] = useState<AreaKey | null>(null);
  const specialistsQuery = useFundSpecialists(fundId, active.id);
  const specialists: SpecialistsState = specialistsQuery.data
    ? { view: inTeamLanguage(specialistsQuery.data, language), note: null }
    : {
        view: null,
        note: specialistsQuery.isError ? t("fundSetup.overview.loadFailed") : t("common.loading"),
      };
  // The mandate's rules in the team's language, also those saved in another.
  const config = useMemo(
    () => ({ ...active, gates: active.gates.map((gate) => gateInLanguage(gate, language)) }),
    [active, language],
  );
  const hardGates = config.gates.filter((gate) => effectiveTreatment(gate) === "hard");
  const reviewGates = config.gates.filter((gate) => effectiveTreatment(gate) === "review");
  const counts = gateCounts(config.gates.map((gate) => ({ treatment: effectiveTreatment(gate) })));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {AREAS.map((area, index) => (
          <AreaCard
            key={area}
            index={index}
            title={t(AREA_TITLE[area])}
            expanded={open === area}
            onToggle={() => setOpen((current) => (current === area ? null : area))}
            onEdit={onEdit && AREA_STEP[area] ? () => onEdit(AREA_STEP[area]!) : undefined}
            value={areaValue(area, active, counts.hard + counts.review, specialists, t, language)}
          >
            <AreaSurface
              area={area}
              config={config}
              gates={[...hardGates, ...reviewGates]}
              specialists={specialists}
            />
          </AreaCard>
        ))}
      </div>

      <Collapse open={open !== null}>
        {open && (
          <div className="mt-0 rounded-lg bg-canvas p-[22px]">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="m-0 text-section font-semibold">{t(AREA_TITLE[open])}</h2>
              {onEdit && AREA_STEP[open] && (
                <button
                  type="button"
                  onClick={() => onEdit(AREA_STEP[open]!)}
                  className="ml-auto h-[34px] cursor-pointer rounded-pill border-0 bg-surface px-3.5 font-[inherit] text-meta font-medium text-ink-1 shadow-pill"
                >
                  {t("fundSetup.overview.editArea", {
                    area: t(AREA_TITLE[open]).toLocaleLowerCase(language),
                  })}
                </button>
              )}
            </div>
            <AreaDetail area={open} config={config} specialists={specialists} />
          </div>
        )}
      </Collapse>

      <LanguageBox fundId={fundId} />

      <AiLevelBox fundId={fundId} />

      <CreditMeter fundId={fundId} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3">
        <EffectCard fundId={fundId} threshold={active.analysisThreshold} />
        <VersionsCard fundId={fundId} />
      </div>
    </div>
  );
}

function areaValue(
  area: AreaKey,
  config: EditableFundConfig,
  gateTotal: number,
  specialists: SpecialistsState,
  t: T,
  language: Language,
): string {
  const noun = (count: number, one: MessageKey, many: MessageKey) => plural(count, t(one), t(many));
  switch (area) {
    case "basis":
      return config.stages.length
        ? joinMax(
            config.stages.map((value) => stageText(value, language)),
            2,
          )
        : t("fundSetup.overview.notSet");
    case "thesis":
      return config.riskPosture.trim()
        ? t("fundSetup.overview.riskSet")
        : t("fundSetup.overview.notSet");
    case "weights":
      return noun(
        config.criteria.length,
        "fundSetup.overview.criterionOne",
        "fundSetup.overview.criterionMany",
      );
    case "mandate":
      return noun(gateTotal, "fundSetup.overview.gateOne", "fundSetup.overview.gateMany");
    case "screening":
      return screeningCardsText(t);
    case "specialists":
      return specialists.view
        ? noun(
            activeSpecialists(specialists.view).length,
            "fundSetup.overview.specialistOne",
            "fundSetup.overview.specialistMany",
          )
        : specialists.note;
  }
}

function AreaCard({
  index,
  title,
  expanded,
  onToggle,
  onEdit,
  value,
  children,
}: {
  index: number;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  onEdit?: (() => void) | undefined;
  value: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  return (
    <Reveal delay={0.06 + index * 0.06} className="h-full">
      <motion.div
        whileHover={reduced ? {} : { y: -3 }}
        whileTap={reduced ? {} : { scale: 0.98 }}
        transition={SPRING.smooth}
        className={cn(
          "relative flex h-full min-h-[210px] flex-col gap-4 rounded-lg p-[22px] transition-[background,box-shadow] duration-[420ms] ease-standard hover:bg-surface hover:shadow-raised",
          expanded ? "bg-surface shadow-raised" : "bg-canvas",
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={t("fundSetup.overview.showDetails", { title })}
          onClick={onToggle}
          className="absolute inset-0 cursor-pointer rounded-lg border-0 bg-transparent"
        />
        <div className="pointer-events-none flex items-center justify-between">
          <span className="text-list font-semibold">{title}</span>
          {/* Placeholder keeps the title row's height when there is no Redigér. */}
          <span aria-hidden className="text-meta text-transparent">
            {t("fundSetup.overview.edit")}
          </span>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={t("fundSetup.overview.editArea", {
              area: title.toLocaleLowerCase(language),
            })}
            className="absolute top-[22px] right-[22px] z-10 cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-meta text-action hover:underline"
          >
            {t("fundSetup.overview.edit")}
          </button>
        )}
        <div className="pointer-events-none flex flex-1 items-center">{children}</div>
        <span className="pointer-events-none text-[22px] font-semibold tracking-title">
          {value}
        </span>
      </motion.div>
    </Reveal>
  );
}

function AreaSurface({
  area,
  config,
  gates,
  specialists,
}: {
  area: AreaKey;
  config: EditableFundConfig;
  gates: EditableFundConfig["gates"];
  specialists: SpecialistsState;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  switch (area) {
    case "basis": {
      const lines = [
        joinMax(
          config.geographies.map((value) => geographyText(value, language)),
          3,
        ),
        ticketLine(config.ticketMinEur, config.ticketMaxEur, language),
        joinMax(
          config.sectors.map((value) => sectorText(value, language)),
          3,
        ),
      ].filter((line): line is string => Boolean(line));
      return (
        <div className="flex flex-col gap-1.5">
          {lines.length ? (
            lines.map((line) => (
              <span key={line} className="text-[15px]">
                {line}
              </span>
            ))
          ) : (
            <span className="text-[15px] text-ink-4">{t("fundSetup.overview.notSet")}</span>
          )}
        </div>
      );
    }
    case "thesis": {
      const quote = firstSentence(config.thesis);
      return (
        <p className="m-0 text-[15px] leading-[1.55] text-ink-2">
          {quote || t("fundSetup.overview.noThesisYet")}
        </p>
      );
    }
    case "weights": {
      const preset = CHART_PRESETS["profil-ring"];
      const series = preset.colors.series.map(tokenColor);
      const data = config.criteria.map((criterion, i) => ({
        label: criterion.label,
        value: criterion.weight,
        color: series[i % series.length]!,
      }));
      if (!data.length)
        return <span className="text-[15px] text-ink-4">{t("fundSetup.overview.noCriteria")}</span>;
      return (
        <div aria-hidden className="pointer-events-none w-[104px]">
          <PieChart
            data={data}
            size={104}
            innerRadius={34}
            hoverOffset={0}
            padAngle={((preset.geometry.gap ?? 1.4) / 100) * Math.PI * 2}
            cornerRadius={0}
            enterTransition={presetTransition(preset, Boolean(reduced))}
          >
            {data.map((slice, i) => (
              <PieSlice key={slice.label} index={i} hoverEffect="grow" />
            ))}
          </PieChart>
        </div>
      );
    }
    case "mandate":
      return gates.length ? (
        <div className="flex flex-wrap gap-[7px]">
          {gates.map((gate, i) => {
            const review = effectiveTreatment(gate) === "review";
            return (
              <motion.span
                key={gate.key}
                title={gate.label}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...SPRING.snappy, delay: i * 0.045 }}
                className="size-6 rounded-full"
                style={{
                  background: review ? "transparent" : "var(--positive)",
                  boxShadow: review ? "inset 0 0 0 2px var(--warning)" : "none",
                }}
              />
            );
          })}
        </div>
      ) : (
        <span className="text-[15px] text-ink-4">{t("fundSetup.overview.noGates")}</span>
      );
    case "screening":
      return (
        <div className="flex flex-wrap gap-2">
          {screeningCardsOf(t).map((card) => (
            <span
              key={card.label}
              title={card.label}
              className="grid h-16 w-[52px] place-items-center rounded-[12px] bg-surface shadow-pill"
              style={{ color: card.color }}
            >
              <card.icon aria-hidden className="size-[18px]" />
            </span>
          ))}
        </div>
      );
    case "specialists":
      return (
        <div className="flex flex-col gap-1.5">
          {(specialists.view ? activeSpecialists(specialists.view) : []).map((specialist) => (
            <span key={specialist.id} className="flex items-center gap-2.5 text-[15px]">
              <SpecialistBot kind={specialist.kind} size={28} />
              {specialist.title}
            </span>
          ))}
        </div>
      );
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
      <span className="text-list text-ink-3">{label}</span>
      <span className="text-list leading-5 text-ink-1">{children}</span>
    </div>
  );
}

function AreaDetail({
  area,
  config,
  specialists,
}: {
  area: AreaKey;
  config: EditableFundConfig;
  specialists: SpecialistsState;
}) {
  const t = useT();
  const language = useLanguage();
  switch (area) {
    case "basis": {
      const share = ticketShareText(
        ticketShareOfFund(config.fundSizeEur, config.ticketMinEur, config.ticketMaxEur),
        language,
      );
      const approval =
        config.approvalMode === "partner_approval"
          ? t("fundSetup.overview.approvalPartner")
          : t("fundSetup.overview.approvalAuto");
      const notSet = t("fundSetup.overview.notSet");
      return (
        <div className="divide-y divide-line">
          <Row label={t("fundSetup.overview.rowStrategy")}>
            {strategyTypeLabel(config.strategyType, language)}
          </Row>
          <Row label={t("fundSetup.overview.rowStages")}>
            {config.stages.map((value) => stageText(value, language)).join(", ") || notSet}
          </Row>
          <Row label={t("fundSetup.overview.rowGeography")}>
            {config.geographies.map((value) => geographyText(value, language)).join(", ") || notSet}
          </Row>
          <Row label={t("fundSetup.overview.rowSectors")}>
            {config.sectors.map((value) => sectorText(value, language)).join(", ") || notSet}
          </Row>
          <Row label={t("fundSetup.overview.rowFundSize")}>
            {config.fundSizeEur === null ? notSet : formatEur(config.fundSizeEur, language)}
          </Row>
          <Row label={t("fundSetup.overview.rowTicket")}>
            {ticketText(config, language)}
            {share && <span className="block text-ink-3">{share}</span>}
            {config.ticketNote && <span className="block text-ink-3">{config.ticketNote}</span>}
          </Row>
          <Row label={t("fundSetup.overview.rowThreshold")}>
            <span className="tabular-nums">{config.analysisThreshold}</span>{" "}
            {t("fundSetup.overview.thresholdTo", { approval })}
          </Row>
        </div>
      );
    }
    case "thesis": {
      const expectations = Object.entries(config.stageExpectations).filter(([, text]) =>
        text.trim(),
      );
      return (
        <div className="grid gap-4">
          <TextBlock
            title={t("fundSetup.overview.blockThesis")}
            text={config.thesis || t("fundSetup.overview.noThesisText")}
          />
          <TextBlock
            title={t("fundSetup.overview.blockRisk")}
            text={config.riskPosture || t("fundSetup.overview.notSet")}
          />
          <div>
            <h3 className="m-0 text-list font-semibold">
              {t("fundSetup.overview.blockDealbreakers")}
            </h3>
            {config.dealbreakers.length ? (
              <ul className="m-0 mt-1 grid list-none gap-1 p-0 text-list leading-5 text-ink-2">
                {config.dealbreakers.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-1 text-list text-ink-3">
                {t("fundSetup.overview.noneSpecified")}
              </p>
            )}
          </div>
          <div>
            <h3 className="m-0 text-list font-semibold">
              {t("fundSetup.overview.blockExpectations")}
            </h3>
            {expectations.length ? (
              <dl className="m-0 mt-1 grid gap-1.5 text-list leading-5">
                {expectations.map(([stage, text]) => (
                  <div key={stage}>
                    <dt className="inline font-medium">{stageText(stage, language)}: </dt>
                    <dd className="m-0 inline text-ink-2">{text}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="m-0 mt-1 text-list text-ink-3">
                {t("fundSetup.overview.noneSpecified")}
              </p>
            )}
          </div>
        </div>
      );
    }
    case "weights": {
      const total = config.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
      return (
        <div>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {config.criteria.map((criterion) => (
              <li key={criterion.key} className="grid gap-1 py-2.5">
                <span className="flex items-baseline justify-between gap-3 text-list">
                  <strong className="font-semibold">{criterion.label}</strong>
                  <span className="tabular-nums">
                    {formatScore(criterion.weight, "–", language)} %
                  </span>
                </span>
                <span className="text-meta text-ink-3">
                  {isCodeAnchored(criterion) ? t("fundSetup.overview.scoredInCode") : ""}
                  {t("fundSetup.overview.assessedBy")}{" "}
                  {specialists.view?.assignment.find((item) =>
                    item.categories.includes(criterion.category),
                  )?.title ??
                    specialistCatalog.find(
                      (module) => module.id === categoryToModule[criterion.category],
                    )?.title ??
                    t("fundSetup.overview.theSpecialists")}
                </span>
                {criterion.description && (
                  <span className="text-list leading-5 text-ink-2">{criterion.description}</span>
                )}
              </li>
            ))}
          </ul>
          {Math.abs(total - 100) >= 0.0001 && (
            <p className="m-0 mt-2 text-list text-warning">
              {t("fundSetup.overview.weightSum", {
                total: formatScore(total, "–", language),
              })}
            </p>
          )}
          <p className="m-0 mt-2 text-meta text-ink-3">{t("fundSetup.overview.scoreNote")}</p>
        </div>
      );
    }
    case "mandate": {
      const hard = config.gates.filter((gate) => effectiveTreatment(gate) === "hard");
      const review = config.gates.filter((gate) => effectiveTreatment(gate) === "review");
      return config.gates.length ? (
        <div>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {[...hard, ...review].map((gate) => {
              const isHard = effectiveTreatment(gate) === "hard";
              return (
                <li key={gate.key} className="grid gap-0.5 py-2.5">
                  <span className="flex items-baseline justify-between gap-3 text-list">
                    <strong className="font-semibold">{gate.label}</strong>
                    <span
                      className={cn("shrink-0 text-meta", isHard ? "text-ink-2" : "text-warning")}
                    >
                      {isHard
                        ? t("fundSetup.overview.binding")
                        : t("fundSetup.overview.assessment")}
                    </span>
                  </span>
                  {gate.description && (
                    <span className="text-list leading-5 text-ink-2">{gate.description}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="m-0 mt-2 text-meta text-ink-3">{t("fundSetup.overview.gateNote")}</p>
        </div>
      ) : (
        <p className="m-0 text-list text-ink-3">{t("fundSetup.overview.noGatesDetail")}</p>
      );
    }
    case "screening": {
      return (
        <div className="divide-y divide-line">
          <Row label={t("fundSetup.overview.rowCards")}>
            {[
              t("fundSetup.overview.cardProfile"),
              t("fundSetup.overview.cardMandateFit"),
              t("fundSetup.overview.cardKeyFindings"),
            ].join(", ")}
          </Row>
          <Row label={t("fundSetup.overview.rowHowWeScreen")}>
            {config.screeningInstruction.trim()
              ? t("fundSetup.overview.ownInstruction")
              : t("fundSetup.overview.noOwnInstruction")}
          </Row>
          <p className="m-0 pt-2 text-meta text-ink-3">{t("fundSetup.overview.cardsNote")}</p>
        </div>
      );
    }
    case "specialists": {
      const off = [
        ...(specialists.view?.standard ?? []).filter((module) => !module.enabled),
        ...(specialists.view?.custom ?? [])
          .filter((item) => !item.enabled)
          .map((item) => ({ title: item.name })),
      ].map((item) => item.title);
      const customized = Object.keys(config.moduleOverrides).length;
      const research = Object.keys(config.researchModuleOverrides).length;
      return (
        <div className="divide-y divide-line">
          <Row label={t("fundSetup.overview.rowSpecialists")}>
            {specialists.view
              ? activeSpecialists(specialists.view)
                  .map((specialist) => specialist.title)
                  .join(", ")
              : specialists.note}
          </Row>
          {off.length > 0 && (
            <Row label={t("fundSetup.overview.rowTurnedOff")}>{off.join(", ")}</Row>
          )}
          <Row label={t("fundSetup.overview.rowInstructions")}>
            {customized === 0
              ? t("fundSetup.overview.standard")
              : t("fundSetup.overview.customised", {
                  what: plural(
                    customized,
                    t("fundSetup.overview.specialistOne"),
                    t("fundSetup.overview.specialistMany"),
                  ),
                })}
          </Row>
          <Row label={t("fundSetup.overview.rowResearch")}>
            {research === 0
              ? t("fundSetup.overview.standard")
              : t("fundSetup.overview.customised", {
                  what: plural(
                    research,
                    t("fundSetup.overview.moduleOne"),
                    t("fundSetup.overview.moduleMany"),
                  ),
                })}
          </Row>
        </div>
      );
    }
  }
}

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="m-0 text-list font-semibold">{title}</h3>
      <p className="m-0 mt-1 text-list leading-5 whitespace-pre-line text-ink-2">{text}</p>
    </div>
  );
}

function EffectCard({ fundId, threshold }: { fundId: string; threshold: number }) {
  const t = useT();
  const loadCases = useServerFn(listCases);
  const reduced = useReducedMotion();
  const query = useQuery({
    queryKey: ["cases", fundId],
    queryFn: () => loadCases({ data: { fundId } }),
    retry: false,
  });
  // The active setup's screenings only (put older ones in the list).
  const scores = (query.data ?? [])
    .filter((item) => !item.olderSetup)
    .map((item) => item.screeningScore ?? item.fitScore)
    .filter((score): score is number => score !== null && score !== undefined);
  const { above, total } = aboveThreshold(scores, threshold);
  const domain = scoreDomain(scores, threshold);

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-canvas p-[22px]">
      <span className="text-list font-semibold">{t("fundSetup.overview.effectTitle")}</span>
      {total === 0 ? (
        <p className="m-0 text-list text-ink-3">
          {query.isLoading
            ? t("fundSetup.overview.loadingCases")
            : query.isError
              ? t("fundSetup.overview.casesError")
              : t("fundSetup.overview.noScreened")}
        </p>
      ) : (
        <>
          <div
            role="img"
            aria-label={t("fundSetup.overview.effectAria", { above, total, threshold })}
            className="relative my-1.5 h-[90px]"
          >
            <div className="absolute inset-x-0 top-[45px] h-px bg-line-strong" />
            <div
              className="absolute top-2.5 bottom-2.5 w-0.5 rounded-[1px] bg-ink-1"
              style={{ left: `${dotPosition(threshold, domain)}%` }}
            />
            {scores.map((score, i) => (
              <motion.span
                key={i}
                aria-hidden
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...SPRING.snappy, delay: Math.min(i, 12) * 0.05 }}
                className="absolute -mt-1.5 -ml-1.5 size-3 rounded-full"
                style={{
                  left: `${dotPosition(score, domain)}%`,
                  top: i % 2 ? 36 : 54,
                  background: score >= threshold ? "var(--ink-1)" : "var(--ink-4)",
                }}
              />
            ))}
            <span className="absolute bottom-0 left-0 text-micro text-ink-4 tabular-nums">
              {domain.lo}
            </span>
            <span className="absolute right-0 bottom-0 text-micro text-ink-4 tabular-nums">
              {domain.hi}
            </span>
          </div>
          <span className="text-[22px] font-semibold tracking-title tabular-nums">
            <CountUp value={above} /> {t("fundSetup.overview.ofTotalOver", { total })}
          </span>
        </>
      )}
    </div>
  );
}

function VersionsCard({ fundId }: { fundId: string }) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const loadVersions = useServerFn(listFundConfigVersions);
  const query = useQuery({
    queryKey: ["fund-config-versions", fundId],
    queryFn: () => loadVersions({ data: { fundId } }),
    retry: false,
  });
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(localeTag, { dateStyle: "medium" }).format(new Date(iso));
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-canvas p-[22px]">
      <span className="text-list font-semibold">{t("fundSetup.overview.versionsTitle")}</span>
      {query.isLoading && (
        <p className="m-0 text-list text-ink-3">{t("fundSetup.overview.versionsLoading")}</p>
      )}
      {query.isError && (
        <p className="m-0 text-list text-ink-3">{t("fundSetup.overview.versionsError")}</p>
      )}
      {query.data?.length === 0 && (
        <p className="m-0 text-list text-ink-3">{t("fundSetup.overview.versionsEmpty")}</p>
      )}
      {query.data?.map((version) => {
        const row = versionRow(version, formatDate, language);
        return (
          <div
            key={version.id}
            className="grid grid-cols-[36px_minmax(0,1fr)] items-baseline gap-2.5"
          >
            <span className="text-[15px] font-semibold tabular-nums">{row.label}</span>
            <span className="flex flex-col">
              <span className="text-[14px]">{row.title}</span>
              <span className="text-meta text-ink-3">{row.meta}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
