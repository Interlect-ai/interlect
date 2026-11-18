import { useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { EvidenceView } from "@/lib/cases/view-model";
import { useLocaleTag, useT } from "@/lib/i18n/useT";

/**
 * Beviskæden: påstand, dato og kildeuddrag bag hover. Ingen status, sikkerhed eller
 * "foreslået match" (beslutningslog 15. okt).
 */
export function EvidenceChain({ evidence }: { evidence: EvidenceView[] }) {
  const t = useT();
  const localeTag = useLocaleTag();
  const dateFormat = new Intl.DateTimeFormat(localeTag, { dateStyle: "medium" });
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? evidence : evidence.slice(0, 3);

  if (evidence.length === 0) {
    return <p className="text-list text-ink-3">{t("caseView.evidence.empty")}</p>;
  }

  return (
    <div>
      <ol className="divide-y divide-border-subtle">
        {visible.map((item, index) => (
          <li key={item.id} className="flex gap-3 py-3">
            <span data-numeric className="w-6 shrink-0 text-meta text-ink-3">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-list leading-6 text-ink-2">{item.claim}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-4 text-meta text-ink-3">
                {item.date && <span>{dateFormat.format(new Date(item.date))}</span>}
                {item.excerpt && (
                  <HoverCard openDelay={120}>
                    <HoverCardTrigger className="text-action hover:text-action-hover">
                      {t("caseView.evidence.viewExcerpt")}
                    </HoverCardTrigger>
                    <HoverCardContent className="w-80 text-list leading-6 text-ink-2">
                      {item.excerpt}
                    </HoverCardContent>
                  </HoverCard>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {evidence.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-meta text-action hover:text-action-hover"
        >
          {expanded
            ? t("caseView.evidence.showFewer")
            : t("caseView.evidence.showAll", { count: evidence.length })}
        </button>
      )}
    </div>
  );
}
