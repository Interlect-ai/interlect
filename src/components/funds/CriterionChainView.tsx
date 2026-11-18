import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { AnalysisMethodDetail } from "@/lib/analysis/method-detail.functions";
import {
  directDataSourcesIn,
  researchCategoriesForScoreCategory,
  researchCategoryLabelIn,
  researchModuleFeedsCategory,
} from "@/lib/analysis/method-chain";
import { scoreCategoryLabelIn } from "@/lib/domain/labels";
import type { ScoreCategory } from "@/lib/domain/types";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { Disclosure } from "./FundConfigWorkspace";
import { researchModuleLabelIn } from "./editor/SpecialistEditors";

/**
 * "Følg kæden": for én scorekategori (fx product-market fit) vises hele vejen
 * fra fondens egne ord, over de søgespørgsmål der sendes til Perplexity og de
 * data der indgår, til hvor vurderingen sker og hvordan scoren regnes. Alle
 * tekster kommer fra getAnalysisMethodDetail, som bygger dem med de samme
 * funktioner som selve analysen.
 */
export function CriterionChainView({ detail }: { detail: AnalysisMethodDetail }) {
  const t = useT();
  const language = useLanguage();
  const { profile } = detail;
  const categories = useMemo(() => {
    const seen: ScoreCategory[] = [];
    for (const criterion of profile.criteria) {
      if (!seen.includes(criterion.category)) seen.push(criterion.category);
    }
    return seen;
  }, [profile.criteria]);
  const [picked, setSelected] = useState<ScoreCategory | null>(null);
  // Afledt ved hver render, så et valg der forsvinder efter en ny version
  // falder tilbage til en kategori, fonden faktisk har.
  const selected =
    picked && categories.includes(picked)
      ? picked
      : categories.includes("product_market_fit")
        ? "product_market_fit"
        : (categories[0] ?? null);

  if (!selected) {
    return (
      <section className="panel space-y-2 p-[19px_21px]">
        <h2 className="text-section font-semibold text-ink">{t("fundSetup.chain.title")}</h2>
        <p className="text-list leading-5 text-ink-3">{t("fundSetup.chain.noCriteria")}</p>
      </section>
    );
  }

  const criteria = profile.criteria.filter((criterion) => criterion.category === selected);
  const feeding = detail.researchModules.filter((module) =>
    researchModuleFeedsCategory(module.categories, selected),
  );
  const screeningFeeding = feeding.filter((module) => module.mode === "screening");
  const deepFeeding = feeding.filter((module) => module.mode === "deep");
  const specialist = detail.specialistModules.find((module) =>
    module.categories.includes(selected),
  );
  const categoryWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);

  return (
    <section className="panel space-y-4 p-[19px_21px]">
      <div>
        <h2 className="text-section font-semibold text-ink">{t("fundSetup.chain.title")}</h2>
        <p className="mt-1 max-w-prose text-list leading-5 text-ink-3">
          {t("fundSetup.chain.intro")}
        </p>
      </div>

      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={t("fundSetup.chain.categoryLabel")}
      >
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            aria-pressed={category === selected}
            onClick={() => setSelected(category)}
            className={cn(
              "rounded-sm border px-2.5 py-1 text-list transition-colors",
              category === selected
                ? "border-ink bg-ink text-surface"
                : "border-hairline text-ink-2 hover:border-hairline-strong",
            )}
          >
            {scoreCategoryLabelIn(category, language)}
          </button>
        ))}
      </div>

      <ol className="relative space-y-5 border-l border-hairline pl-5">
        <ChainStep number={1} title={t("fundSetup.chain.stepWords")}>
          <p className="text-list leading-5 text-ink-3">
            {criteria.length === 1
              ? t("fundSetup.chain.weightLeadOne")
              : t("fundSetup.chain.weightLeadMany", { count: criteria.length })}{" "}
            <span data-numeric>{categoryWeight}%</span> {t("fundSetup.chain.weightTail")}
          </p>
          <ul className="mt-2 space-y-2">
            {criteria.map((criterion) => (
              <li key={criterion.key} className="rounded-sm border border-hairline p-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-list font-medium text-ink">{criterion.label}</span>
                  <span data-numeric className="text-meta text-ink-3">
                    {criterion.weight}%
                  </span>
                </div>
                {criterion.description ? (
                  <p className="mt-1 whitespace-pre-line text-list leading-5 text-ink-3">
                    {criterion.description}
                  </p>
                ) : (
                  <p className="mt-1 text-list leading-5 text-warning">
                    {t("fundSetup.chain.noDescriptionLead")}{" "}
                    <Link to="/fond" className="underline">
                      {t("fundSetup.header.tabSetup")}
                    </Link>{" "}
                    {t("fundSetup.chain.noDescriptionTail")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </ChainStep>

        <ChainStep number={2} title={t("fundSetup.chain.stepResearch")}>
          <p className="text-list leading-5 text-ink-3">
            {t("fundSetup.chain.researchIntro", {
              category: (scoreCategoryLabelIn(selected, language) ?? selected).toLowerCase(),
            })}
          </p>
          <ResearchModuleGroup
            title={t("fundSetup.chain.groupScreening", { model: detail.researchModel.screening })}
            modules={screeningFeeding}
          />
          <ResearchModuleGroup
            title={t("fundSetup.chain.groupDeep", { model: detail.researchModel.deep })}
            modules={deepFeeding}
          />
        </ChainStep>

        <ChainStep number={3} title={t("fundSetup.chain.stepData")}>
          <ul className="space-y-1 text-list leading-5 text-ink-3">
            <li>
              {t("fundSetup.chain.evidenceTypes", {
                list: researchCategoriesForScoreCategory[selected]
                  .map((category) => researchCategoryLabelIn(category, language))
                  .join(", "),
              })}
            </li>
            {directDataSourcesIn(selected, language).map((source) => (
              <li key={source}>{source}.</li>
            ))}
            <li>{t("fundSetup.chain.ownMaterial")}</li>
            <li>{t("fundSetup.chain.sourceStored")}</li>
          </ul>
        </ChainStep>

        <ChainStep number={4} title={t("fundSetup.chain.stepAssessment")}>
          <ul className="space-y-1 text-list leading-5 text-ink-3">
            <li>
              <strong className="font-medium text-ink-2">
                {t("fundSetup.chain.screeningLabel")}
              </strong>{" "}
              {t("fundSetup.chain.screeningText", { model: detail.assessmentModel.screening })}
            </li>
            {specialist && (
              <li>
                <strong className="font-medium text-ink-2">{t("fundSetup.chain.deepLabel")}</strong>{" "}
                {t("fundSetup.chain.deepText", {
                  title: specialist.title,
                  model: detail.assessmentModel.deep,
                  custom: specialist.isCustomized ? t("fundSetup.chain.deepCustom") : "",
                })}
              </li>
            )}
            <li>
              <strong className="font-medium text-ink-2">{t("fundSetup.chain.scoreLabel")}</strong>{" "}
              {t("fundSetup.chain.scoreText")}
            </li>
          </ul>
          {specialist && (
            <Disclosure
              title={t("fundSetup.chain.showInstruction", { title: specialist.title })}
              description={t("fundSetup.chain.instructionDescription")}
            >
              <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap text-meta leading-5 text-ink-2">
                {specialist.system}
              </pre>
            </Disclosure>
          )}
        </ChainStep>
      </ol>
    </section>
  );
}

function ChainStep({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative">
      <span
        data-numeric
        className="absolute -left-[31px] top-0 flex size-5 items-center justify-center rounded-full border border-hairline-strong bg-surface text-meta text-ink-2"
        aria-hidden
      >
        {number}
      </span>
      <h3 className="text-list font-semibold text-ink">{title}</h3>
      <div className="mt-1.5 space-y-2">{children}</div>
    </li>
  );
}

function ResearchModuleGroup({
  title,
  modules,
}: {
  title: string;
  modules: AnalysisMethodDetail["researchModules"];
}) {
  if (modules.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-meta font-medium text-ink-2">{title}</p>
      {modules.map((module) => (
        <ResearchModuleMessages key={`${module.mode}:${module.moduleId}`} module={module} />
      ))}
    </div>
  );
}

export function ResearchModuleMessages({
  module,
}: {
  module: AnalysisMethodDetail["researchModules"][number];
}) {
  const t = useT();
  const language = useLanguage();
  const meta = researchModuleLabelIn(module.moduleId, language);
  return (
    <Disclosure
      title={`${meta?.title ?? module.moduleId}${module.isCustomized ? t("fundSetup.chain.customised") : ""}`}
      description={
        module.questions.length === 1
          ? t("fundSetup.chain.questionOne")
          : t("fundSetup.chain.questions", { count: module.questions.length })
      }
    >
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-4 text-list leading-5 text-ink-3">
          {module.questions.map((question, index) => (
            <li key={index}>{question}</li>
          ))}
        </ul>
        <MessageBlock label={t("fundSetup.chain.systemMessage")} text={module.system} />
        <MessageBlock label={t("fundSetup.chain.userMessage")} text={module.user} />
      </div>
    </Disclosure>
  );
}

export function MessageBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-meta font-medium text-ink-2">{label}</p>
      <pre className="mt-1 max-h-[320px] overflow-y-auto rounded-sm border border-hairline bg-surface-neutral/40 p-2.5 whitespace-pre-wrap text-meta leading-[1.6] text-ink-2">
        {text}
      </pre>
    </div>
  );
}
