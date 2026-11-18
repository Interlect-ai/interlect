/**
 * "Hvorfor?" on the Dyb analyse (pattern; gap/ choice 5): the reasoning only, one click
 * away. The overall findings (what speaks for, against and what is open), the path from
 * criteria to score, the evidence with its citations and similar past decisions. Never how the
 * analysis was made, by what, data trust or which data sources were used (beslutningslog 15. okt).
 * Each part sits in its own box ("Sektioner lever i bokse").
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FocusPage } from "@/components/ds/FocusPage";
import { EvidenceChain } from "@/components/cases/EvidenceChain";
import { FundMemoryPanel } from "@/components/cases/FundMemoryPanel";
import { KeyFindings } from "@/components/cases/KeyFindings";
import { ScorePathway } from "@/components/cases/ScorePathway";
import type { AnalysisView, CaseViewModel } from "@/lib/cases/view-model";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";

export function DeepWhyFocus({
  model,
  analysis,
  recommendation,
  onBack,
}: {
  model: CaseViewModel;
  analysis: AnalysisView;
  recommendation: string | null;
  onBack: () => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  let order = 0;
  const box = (title: string, children: ReactNode, note?: string) => {
    const delay = 0.08 + order++ * 0.05;
    return (
      <motion.section
        className="flex flex-col gap-3 rounded-xl bg-canvas px-5 py-5 md:px-[26px] md:py-6"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.56, ease: EASE.out, delay }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="m-0 text-section font-semibold">{title}</h3>
          {note && <span className="text-meta text-ink-4">{note}</span>}
        </div>
        {children}
      </motion.section>
    );
  };
  const hasFindings =
    analysis.strengths.length > 0 ||
    analysis.weaknesses.length > 0 ||
    analysis.questions.length > 0;

  return (
    <FocusPage
      backLabel={model.companyName}
      onBack={onBack}
      title={t("deep.why.title")}
      subtitle={recommendation ?? undefined}
      className="max-w-[1020px]"
    >
      {hasFindings &&
        box(
          t("deep.why.overall"),
          <KeyFindings
            labels={{ up: t("deep.why.labelUp"), down: t("deep.why.labelDown") }}
            strengths={analysis.strengths}
            weaknesses={analysis.weaknesses}
            questions={analysis.questions}
          />,
        )}
      {analysis.investmentCondition &&
        box(
          t("deep.why.condition"),
          <p className="m-0 max-w-[68ch] text-[15px] leading-[1.6] text-ink-2">
            {analysis.investmentCondition}
          </p>,
        )}
      {box(t("deep.why.pathway"), <ScorePathway analysis={analysis} />)}
      {box(t("deep.why.evidence"), <EvidenceChain evidence={model.evidence} />)}
      {model.relatedMemory.length > 0 &&
        box(
          t("deep.why.similar"),
          <FundMemoryPanel matches={model.relatedMemory} />,
          t("deep.why.similarNote", { count: model.relatedMemory.length }),
        )}
    </FocusPage>
  );
}
