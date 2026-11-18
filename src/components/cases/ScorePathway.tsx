/**
 * F7 (masterplan, research 04 T12): "Sådan kom vi frem til scoren" som stablet visning
 * (kriterier → score). Pr. kriterium: vægt, delscore og bidraget til den samlede score (vægt ×
 * score, regnet i kode). Ingen kildetyper (beslutningslog 15. okt: ingen steder står, hvilke
 * datakilder der blev brugt).
 */
import type { AnalysisView } from "@/lib/cases/view-model";
import { useLocaleTag, useT } from "@/lib/i18n/useT";

export function ScorePathway({ analysis }: { analysis: AnalysisView }) {
  const t = useT();
  const localeTag = useLocaleTag();
  const rows = analysis.criteria.map((criterion) => ({
    criterion,
    contribution: criterion.score === null ? null : (criterion.score * criterion.weight) / 100,
  }));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_40px_76px] gap-x-3 text-meta text-ink-4">
        <span>{t("caseView.pathway.criterion")}</span>
        <span className="text-right">{t("caseView.pathway.score")}</span>
        <span className="text-right">{t("caseView.pathway.contribution")}</span>
      </div>
      <ol className="divide-y divide-hairline">
        {rows.map(({ criterion, contribution }) => (
          <li
            key={criterion.criterionKey}
            className="grid grid-cols-[minmax(0,1fr)_40px_76px] items-center gap-x-3 py-2 text-list"
          >
            <span className="truncate text-ink-2" title={criterion.label}>
              {criterion.label}
              <span className="ml-1.5 text-meta text-ink-4">{criterion.weight} %</span>
            </span>
            <span className="text-right text-ink tabular-nums">
              {criterion.score === null ? "–" : Math.round(criterion.score)}
            </span>
            <span className="text-right font-semibold tabular-nums text-ink">
              {contribution === null
                ? "–"
                : contribution.toLocaleString(localeTag, { maximumFractionDigits: 1 })}
            </span>
          </li>
        ))}
      </ol>
      <p className="flex items-baseline justify-between border-t border-hairline pt-2 text-list">
        <span className="text-ink-3">{t("caseView.pathway.total")}</span>
        <strong className="tabular-nums text-ink">
          {analysis.score === null
            ? "–"
            : analysis.score.toLocaleString(localeTag, { maximumFractionDigits: 1 })}
        </strong>
      </p>
    </div>
  );
}
