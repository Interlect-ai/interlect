import { CircleCheck, XCircle } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { MemoryMatchView } from "@/lib/cases/view-model";
import { cn } from "@/lib/utils";
import { useLocaleTag, useT } from "@/lib/i18n/useT";

/**
 * Fondens egen retrospektive hukommelse: de mest lignende sager, fonden
 * selv tidligere har taget stilling til, fundet ved deterministisk
 * lighedssøgning -- ikke af AI'en. Vises kun når fonden faktisk har
 * historik; en ny fond har pr. konstruktion ingen rækker her.
 */
export function FundMemoryPanel({ matches }: { matches: MemoryMatchView[] }) {
  const t = useT();
  const localeTag = useLocaleTag();
  const dateFormat = new Intl.DateTimeFormat(localeTag, { dateStyle: "medium" });
  if (matches.length === 0) return null;

  return (
    <ol className="divide-y divide-border-subtle">
      {matches.map((match, index) => (
        <li key={`${match.companyName}-${index}`} className="flex gap-3 py-3">
          <span data-numeric className="w-6 shrink-0 text-meta text-ink-3">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-list leading-6 text-ink-2">
              {match.companyName}
              {match.sector && <span className="text-ink-3"> · {match.sector}</span>}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-ink-3">
              <DecisionTag decision={match.decision} />
              <span data-numeric>
                {t("caseView.memory.similarity", { percent: Math.round(match.similarity * 100) })}
              </span>
              {match.decidedAt && <span>{dateFormat.format(new Date(match.decidedAt))}</span>}
              <HoverCard openDelay={120}>
                <HoverCardTrigger className="text-action hover:text-action-hover">
                  {t("caseView.memory.why")}
                </HoverCardTrigger>
                <HoverCardContent className="w-80 text-list leading-6 text-ink-2">
                  {match.summary}
                </HoverCardContent>
              </HoverCard>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function DecisionTag({ decision }: { decision: MemoryMatchView["decision"] }) {
  const t = useT();
  const isInvested = decision === "invested";
  const Icon = isInvested ? CircleCheck : XCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border border-border-subtle px-1.5 py-0.5",
        isInvested ? "text-positive" : "text-ink-3",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {isInvested ? t("cases.status.invested") : t("caseView.memory.closedWithoutInvestment")}
    </span>
  );
}
