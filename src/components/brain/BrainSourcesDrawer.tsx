/**
 * Brain · Kilder (slank): what Brain has read, next to the conversation (`/brain?vis=kilder`,
 * opened from "Kilder" in Brain's left column). One row per source with its state, "Prøv igen" on a
 * failed reading and "Glem" (after a confirmation) on every source. Giving Brain new material stays
 * in the composer's "+"; this is not a page of its own (ticket "ingen ny side"). No prices (P13).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Globe, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { showToast } from "@/components/ds/Toast";
import {
  listBrainSources,
  retryBrainIngest,
  type BrainSourceRow,
} from "@/lib/brain/ingest.functions";
import { forgetBrainSource } from "@/lib/brain/forget.functions";
import { kindLabel } from "@/lib/brain/ingest/labels";
import { phaseLabel, stepLabel as stepLabelOf } from "@/lib/brain/ingest/phase";
import { SPRING } from "@/lib/motion";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { userMessage } from "@/lib/errors/user-message";

const sourcesKey = (fundId: string) => ["brain-sources", fundId] as const;

export function BrainSourcesDrawer({ fundId, onClose }: { fundId: string; onClose: () => void }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const headingId = useId();
  const drawer = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const list = useServerFn(listBrainSources);
  const retry = useServerFn(retryBrainIngest);
  const forget = useServerFn(forgetBrainSource);
  const [forgetTarget, setForgetTarget] = useState<BrainSourceRow | null>(null);

  useEffect(() => {
    drawer.current?.focus();
  }, []);

  const sources = useQuery({
    queryKey: sourcesKey(fundId),
    queryFn: () => list({ data: { fundId } }),
    // Poll while anything is being read or waits in the queue.
    refetchInterval: (query) =>
      query.state.data?.sources.some((source) =>
        ["working", "queued", "uploading"].includes(source.phase),
      )
        ? 3000
        : false,
  });
  // The row that held the focus can disappear (Glem): focus goes back to the drawer, so that
  // Escape still closes it. After the re-render and a closing dialog's own focus return.
  const refocus = () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) drawer.current?.focus();
    }, 150);
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: sourcesKey(fundId) });
  const fail = (cause: unknown) =>
    showToast({
      message: userMessage(cause, t("brainKnowledge.sources.failed"), language),
      tone: "error",
    });

  const retryMutation = useMutation({
    mutationFn: (sourceId: string) => retry({ data: { fundId, sourceId } }),
    onSuccess: () => {
      showToast({ message: t("brainKnowledge.sources.retrying") });
      void refresh();
      refocus();
    },
    onError: fail,
  });
  const forgetMutation = useMutation({
    mutationFn: (sourceId: string) => forget({ data: { fundId, sourceId } }),
    onSuccess: (result) => {
      setForgetTarget(null);
      showToast({
        message: t("brainKnowledge.sources.forgotten", {
          episodes: result.episodes,
          facts: result.factsDeleted,
        }),
      });
      void refresh();
      // What was forgotten is also gone from the map (cached for 5 minutes).
      void queryClient.invalidateQueries({ queryKey: ["brain-graph", fundId] });
      refocus();
    },
    onError: fail,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A dialog inside handles its own Escape first (and stops it).
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  };

  const rows = sources.data?.sources ?? [];
  const canEdit = sources.data?.canEdit ?? false;
  const canForget = sources.data?.canForget ?? false;

  return (
    <motion.div
      ref={drawer}
      role="dialog"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={reduced ? { duration: 0.16 } : SPRING.gentle}
      className={cn(
        "absolute top-[60px] right-3.5 bottom-3.5 z-20 flex w-[min(440px,calc(100%-28px))] flex-col rounded-[22px] bg-surface outline-none",
        "shadow-[0_0_0_1px_var(--line),0_30px_80px_-24px_rgba(23,21,28,.36)]",
      )}
    >
      <div className="flex shrink-0 items-center gap-2.5 px-[18px] pt-[18px] pb-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={headingId} className="m-0 text-[17px] font-semibold">
            {t("brainKnowledge.sourcesPanel.title")}
          </h2>
          <span className="text-meta text-ink-3">{t("brainKnowledge.sourcesPanel.subtitle")}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("brainKnowledge.sourcesPanel.close")}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-sunken text-ink-2 outline-none transition-colors hover:bg-hover hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-4">
        {sources.isLoading ? (
          <LoadingState title={t("brainKnowledge.sources.loading")} />
        ) : sources.isError && !sources.data ? (
          <ErrorState onRetry={() => void sources.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t("brainKnowledge.sources.emptyTitle")}
            body={t("brainKnowledge.sources.emptyBody")}
          />
        ) : (
          <ul
            aria-label={t("brainKnowledge.sourcesPanel.listLabel")}
            className="m-0 flex list-none flex-col p-0"
          >
            {rows.map((source) => {
              const step = source.step ? stepLabelOf(source.step, language) : null;
              const failedStep = source.failedStep
                ? stepLabelOf(source.failedStep, language)
                : undefined;
              return (
                <li
                  key={source.id}
                  className="group flex flex-col gap-1.5 border-b border-line py-3 first:pt-1 last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[10px] bg-sunken text-ink-3">
                      {source.kind === "website" ? (
                        <Globe className="size-4" aria-hidden />
                      ) : (
                        <FileText className="size-4" aria-hidden />
                      )}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-list font-medium text-ink-1">
                        {source.title}
                      </span>
                      <span
                        role={source.phase === "failed" ? "alert" : undefined}
                        className={cn(
                          "text-meta",
                          source.phase === "failed"
                            ? "text-critical"
                            : source.phase === "ready"
                              ? "text-positive"
                              : "text-ink-3",
                        )}
                      >
                        {kindLabel(source.kind, language) ?? source.kind} ·{" "}
                        {phaseLabel(source.phase, language)}
                        {source.phase === "working" && step ? ` · ${step}` : ""}
                      </span>
                    </div>
                    {/* Secondary actions fade in on hover or focus (never repeated on every row). */}
                    <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                      {canForget && (
                        <button
                          type="button"
                          onClick={() => setForgetTarget(source)}
                          aria-label={t("brainKnowledge.sourcesPanel.forgetLabel", {
                            title: source.title,
                          })}
                          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill border-0 bg-transparent px-2.5 text-meta font-medium text-ink-2 outline-none transition-colors hover:bg-hover hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          {t("brainKnowledge.sources.forget")}
                        </button>
                      )}
                    </div>
                  </div>
                  {source.phase === "failed" && (
                    <div className="flex flex-wrap items-center gap-2 pl-11">
                      {source.errorMessage && (
                        <p className="m-0 min-w-0 flex-1 text-meta text-critical">
                          {source.errorMessage}
                          {failedStep
                            ? ` ${t("brainKnowledge.sources.atStep", { step: failedStep })}`
                            : ""}
                        </p>
                      )}
                      {canEdit && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={retryMutation.isPending}
                          onClick={() => retryMutation.mutate(source.id)}
                        >
                          <RotateCcw className="size-3.5" aria-hidden />
                          {failedStep
                            ? t("brainKnowledge.sources.retryFrom", { step: failedStep })
                            : t("brainKnowledge.sources.retry")}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={forgetTarget !== null}
        onOpenChange={(open) => !open && !forgetMutation.isPending && setForgetTarget(null)}
        title={t("brainKnowledge.sources.forgetTitle", { title: forgetTarget?.title ?? "" })}
        description={t("brainKnowledge.sources.forgetBody")}
        icon={Trash2}
        footer={
          <>
            <Button
              variant="quiet"
              size="md"
              disabled={forgetMutation.isPending}
              onClick={() => setForgetTarget(null)}
            >
              {t("brainKnowledge.sources.cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              pending={forgetMutation.isPending}
              onClick={() => forgetTarget && forgetMutation.mutate(forgetTarget.id)}
            >
              {t("brainKnowledge.sources.forgetConfirm")}
            </Button>
          </>
        }
      />
    </motion.div>
  );
}
