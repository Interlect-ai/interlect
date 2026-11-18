/**
 * "Hvorfor?" by the recommendation: everything the new surface no longer shows, one click away
 * (ticket "Findes stadig bag klik"): the strongest counter-reading, who the company is and
 * how sure we are, and the path from criteria to score. Never data trust or which data sources
 * were used (beslutningslog 15. okt). Each part sits in its own box ("Sektioner lever i bokse").
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FocusPage } from "@/components/ds/FocusPage";
import { ScorePathway } from "@/components/cases/ScorePathway";
import type { AnalysisView, CaseViewModel } from "@/lib/cases/view-model";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";

export function WhyFocus({
  model,
  analysis,
  recommendation,
  identity,
  onBack,
}: {
  model: CaseViewModel;
  analysis: AnalysisView;
  recommendation: string | null;
  /** Selskabet, Interlect fandt (IdentityCard). */
  identity: ReactNode;
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

  return (
    <FocusPage
      backLabel={model.companyName}
      onBack={onBack}
      title={t("screening.why.title")}
      subtitle={recommendation ?? undefined}
      className="max-w-[1020px]"
    >
      {analysis.contraryCase &&
        box(
          t("screening.why.counter"),
          <p className="m-0 max-w-[720px] text-body leading-[1.65] text-ink-2">
            {analysis.contraryCase}
          </p>,
        )}
      {identity && box(t("screening.why.identity"), identity)}
      {box(t("screening.why.pathway"), <ScorePathway analysis={analysis} />)}
    </FocusPage>
  );
}
