/**
 * "Brain om denne case": a Brain pill in the case's top bar opens a sheet
 * from the right with what Brain knows about the case from the fund's own history: cases of the
 * same company seen before (with decision and reasons), similar cases, and open contradictions;
 * "Spørg Brain" opens the Spørg Interlect panel, which already knows the case. Read only: Brain
 * never changes the case, a score or a decision here. Every section has its own empty state; a
 * section without content (contradictions) is hidden. Shown only when Brain chat works for this
 * fund and role; the data is fetched when the sheet is opened (no AI call, 0 kr.).
 */
import { useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Sheet } from "@/components/ds/Sheet";
import { BrainCardView } from "@/components/brain/BrainCard";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { requestAskOpen } from "@/lib/brain/ask";
import { showBrain } from "@/lib/brain/capabilities";
import { DECISION_LABEL_KEYS, type PanelDecision, type SimilarState } from "@/lib/brain/case-panel";
import { getBrainCasePanel } from "@/lib/brain/case-panel.functions";
import { useBrainCapabilities } from "@/lib/brain/useBrainCapabilities";
import {
  casePhaseLabels,
  caseStatusLabels,
  type CasePhase,
  type CaseStatus,
} from "@/lib/cases/lifecycle";
import type { MessageKey } from "@/lib/i18n/translate";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

const SIMILAR_EMPTY: Record<Exclude<SimilarState, "ok">, MessageKey> = {
  no_profile: "brainChat.casePanel.noProfile",
  too_few: "brainChat.casePanel.tooFew",
};

const dateText = (iso: string, localeTag: string) =>
  new Intl.DateTimeFormat(localeTag, { dateStyle: "medium" }).format(new Date(iso));

export function BrainCaseButton({ fundId, caseId }: { fundId: string; caseId: string }) {
  const t = useT();
  const caps = useBrainCapabilities();
  const [open, setOpen] = useState(false);
  if (!showBrain(caps.data)) return null;
  return (
    <>
      <Button
        variant="secondary"
        size="md"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <InterlectMark size={13} />
        {t("brainChat.casePanel.button")}
      </Button>
      <BrainCaseSheet fundId={fundId} caseId={caseId} open={open} onOpenChange={setOpen} />
    </>
  );
}

function BrainCaseSheet({
  fundId,
  caseId,
  open,
  onOpenChange,
}: {
  fundId: string;
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const phaseLabels = casePhaseLabels(language);
  const statusLabels = caseStatusLabels(language);
  const load = useServerFn(getBrainCasePanel);
  const query = useQuery({
    queryKey: ["brain-case-panel", fundId, caseId],
    queryFn: () => load({ data: { fundId, caseId } }),
    enabled: open,
    retry: false,
    // The read costs nothing and a decision may have been taken a moment ago: never show old data.
    staleTime: 0,
  });
  const panel = query.data;
  // "Spørg Brain" moves focus to the Spørg Interlect panel; Radix must not pull it back to the pill.
  const askRequested = useRef(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("brainChat.casePanel.title")}
      description={panel?.company ?? t("brainChat.casePanel.subtitle")}
      onCloseAutoFocus={(event) => {
        if (askRequested.current) event.preventDefault();
        askRequested.current = false;
      }}
      footer={
        <Button
          variant="primary"
          size="md"
          className="w-full justify-center"
          onClick={() => {
            askRequested.current = true;
            onOpenChange(false);
            requestAskOpen(window);
          }}
        >
          <MessageCircle className="size-4" strokeWidth={1.75} aria-hidden />
          {t("brainChat.casePanel.askAbout")}
        </Button>
      }
    >
      {query.isLoading && (
        <div
          className="flex flex-col gap-3"
          aria-busy="true"
          role="status"
          aria-label={t("brainChat.casePanel.loading")}
        >
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-24 animate-pulse rounded-[16px] bg-canvas" />
          ))}
        </div>
      )}
      {query.isError && (
        <div className="flex flex-col items-start gap-3 rounded-[16px] bg-canvas p-4">
          <p className="m-0 text-list text-ink-2">{t("brainChat.casePanel.loadFailed")}</p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {panel && (
        <>
          <BrainCardView fundId={fundId} source={{ caseId }} />
          <Section
            title={t("brainChat.casePanel.previouslySeen")}
            count={panel.previouslySeen.length}
          >
            {panel.previouslySeen.length === 0 ? (
              <Empty>{t("brainChat.casePanel.firstTime")}</Empty>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {panel.previouslySeen.map((prior) => (
                  <li key={prior.caseId}>
                    <CaseRow
                      caseId={prior.caseId}
                      title={t("brainChat.casePanel.caseFrom", {
                        date: dateText(prior.createdOn, localeTag),
                      })}
                      meta={`${phaseLabels[prior.phase as CasePhase] ?? prior.phase} · ${statusLabels[prior.status as CaseStatus] ?? prior.status}`}
                      decision={prior.decision}
                      onNavigate={() => onOpenChange(false)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t("brainChat.casePanel.similar")} count={panel.similar.cases.length}>
            {panel.similar.state === "ok" && panel.similar.cases.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {panel.similar.cases.map((similar) => (
                  <li key={similar.caseId}>
                    <CaseRow
                      caseId={similar.caseId}
                      title={similar.company}
                      decision={similar.decision}
                      onNavigate={() => onOpenChange(false)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>
                {t(
                  panel.similar.state === "ok"
                    ? SIMILAR_EMPTY.too_few
                    : SIMILAR_EMPTY[panel.similar.state],
                )}
              </Empty>
            )}
          </Section>

          {panel.contradictions.length > 0 && (
            <Section
              title={t("brainChat.casePanel.contradictions")}
              count={panel.contradictions.length}
            >
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {panel.contradictions.map((item) => (
                  <li key={item.id} className="flex items-baseline gap-2 text-list text-ink-1">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-[7px] size-1.5 shrink-0 self-start rounded-full",
                        item.status === "new" ? "bg-ai" : "bg-ink-4",
                      )}
                    />
                    <span className="min-w-0 flex-1 break-words">{item.title}</span>
                    {item.status === "new" && (
                      <span className="shrink-0 text-micro text-ai-ink">
                        {t("brainChat.casePanel.new")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </Sheet>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] bg-canvas p-4">
      <h3 className="m-0 flex items-baseline gap-2 text-list font-semibold">
        {title}
        {count > 0 && <span className="text-meta font-normal text-ink-3">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 text-list text-ink-3">{children}</p>;
}

function CaseRow({
  caseId,
  title,
  meta,
  decision,
  onNavigate,
}: {
  caseId: string;
  /** The sheet closes when the reader goes to another case. */
  onNavigate: () => void;
  title: string;
  meta?: string;
  decision: PanelDecision | null;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  return (
    <div className="flex flex-col gap-1">
      <Link
        to="/cases/$caseId"
        params={{ caseId }}
        search={{ view: "screening" }}
        onClick={onNavigate}
        className="self-start rounded-[6px] text-list font-medium text-ink-1 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-action"
      >
        {title}
      </Link>
      {meta && <span className="text-meta text-ink-3">{meta}</span>}
      {decision ? (
        <span className="text-meta text-ink-2">
          <span className="font-medium">{t(DECISION_LABEL_KEYS[decision.kind])}</span>{" "}
          {dateText(decision.decidedOn, localeTag)}
          {decision.reasons.length > 0 && <> · {decision.reasons.join(", ")}</>}
        </span>
      ) : (
        <span className="text-meta text-ink-4">{t("brainChat.casePanel.noDecision")}</span>
      )}
    </div>
  );
}
