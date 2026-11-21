/**
 * "Genscreen cases mod den nye version". Vises kun, når der findes
 * cases screenet mod en ældre version af tesen. Kræver et klik; screeningerne sættes i kø
 * én ad gangen, så de ikke rammer loftet samtidig.
 */
import { startWithLimitChoice } from "@/lib/analysis/limit-choice";
import type { LimitChoice } from "@/lib/analysis/model-tiers";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, RefreshCw } from "lucide-react";
import { listRescreenCandidates } from "@/lib/funds/rescreen.functions";
import { runInitialScreening } from "@/lib/analysis/screening.functions";
import { PendingLabel } from "@/components/ai/AiOrb";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { userMessage } from "@/lib/errors/user-message";

export function RescreenPanel({ fundId }: { fundId: string }) {
  const t = useT();
  const language = useLanguage();
  const list = useServerFn(listRescreenCandidates);
  const screen = useServerFn(runInitialScreening);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] }>({
    done: 0,
    total: 0,
    failed: [],
  });

  const query = useQuery({
    queryKey: ["rescreen-candidates", fundId],
    queryFn: () => list({ data: { fundId } }),
  });

  const mutation = useMutation({
    mutationFn: async (caseIds: string[]) => {
      const failed: string[] = [];
      // "Spørg mig først": asked once for the batch ("raise once" is asked per case).
      const atLimit: { choice?: LimitChoice | null } = {};
      setProgress({ done: 0, total: caseIds.length, failed });
      for (const [index, caseId] of caseIds.entries()) {
        const name =
          query.data?.candidates.find((candidate) => candidate.caseId === caseId)?.companyName ??
          caseId;
        try {
          const result = await startWithLimitChoice(
            fundId,
            "screening",
            (choice) => screen({ data: { fundId, caseId, atLimit: choice } }),
            atLimit,
          );
          if (!result) failed.push(`${name}: ${t("fundSetup.limitChoice.notStarted")}`);
        } catch (cause) {
          failed.push(
            `${name}: ${userMessage(cause, t("fundSetup.rescreen.unknownError"), language)}`,
          );
        }
        setProgress({ done: index + 1, total: caseIds.length, failed: [...failed] });
      }
      return failed;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["rescreen-candidates", fundId] });
    },
  });

  // The screenings are started one by one from this page: leaving it stops the rest.
  const pending = mutation.isPending;
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const data = query.data;
  if (!data || data.candidates.length === 0) {
    if (mutation.isSuccess && progress.total > 0) {
      return (
        <section className="rounded-md border border-hairline bg-surface p-4 text-list text-ink-2">
          {t("fundSetup.rescreen.queued", { count: progress.total - progress.failed.length })}
        </section>
      );
    }
    return null;
  }

  const count = data.candidates.length;
  const caseIds = data.candidates.map((candidate) => candidate.caseId);

  return (
    <section
      className="rounded-md border border-hairline bg-surface p-4"
      aria-label={t("fundSetup.rescreen.label")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-section font-semibold text-ink">
            {count === 1
              ? t("fundSetup.rescreen.headingOne")
              : t("fundSetup.rescreen.headingMany", { count })}
          </h2>
          <p className="mt-1 max-w-[68ch] text-list leading-5 text-ink-3">
            {t("fundSetup.rescreen.body", { version: data.activeVersion })}
          </p>
        </div>
        <button
          type="button"
          className="pill-cta"
          disabled={mutation.isPending}
          onClick={() => setConfirming(true)}
        >
          {mutation.isPending ? (
            <PendingLabel tone="ai" state="working" onDark>
              {t("fundSetup.rescreen.queueing", { done: progress.done, total: progress.total })}
            </PendingLabel>
          ) : (
            <>
              <RefreshCw className="size-3.5" aria-hidden />
              {count === 1
                ? t("fundSetup.rescreen.buttonOne")
                : t("fundSetup.rescreen.buttonMany", { count })}
            </>
          )}
        </button>
      </div>
      <details className="group mt-2">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-list text-ink-3 hover:text-ink marker:content-none">
          {t("fundSetup.rescreen.seeCases")}
          <ChevronDown
            className="size-3.5 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <ul className="mt-2 grid gap-1 text-list text-ink-2">
          {data.candidates.map((candidate) => (
            <li key={candidate.caseId} className="flex justify-between gap-3">
              <span className="truncate">{candidate.companyName}</span>
              <span className="mono-num shrink-0 text-ink-3">
                {candidate.screenedVersion === null
                  ? t("fundSetup.rescreen.unknownVersion")
                  : `v${candidate.screenedVersion}`}
                {candidate.score === null ? "" : ` · ${Math.round(candidate.score)}`}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          count === 1
            ? t("fundSetup.rescreen.confirmTitleOne")
            : t("fundSetup.rescreen.confirmTitleMany", { count })
        }
        description={t("fundSetup.rescreen.confirmBody")}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setConfirming(false)}>
              {t("fundSetup.rescreen.cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setConfirming(false);
                mutation.mutate(caseIds);
              }}
            >
              {count === 1
                ? t("fundSetup.rescreen.buttonOne")
                : t("fundSetup.rescreen.buttonMany", { count })}
            </Button>
          </>
        }
      />
      {progress.failed.length > 0 && (
        <ul className="mt-2 grid gap-1 text-list text-critical" role="alert">
          {progress.failed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
