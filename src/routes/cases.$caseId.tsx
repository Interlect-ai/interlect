import { useEffect, useRef } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { AppShell, WORKSPACE_ID } from "@/components/ds/AppShell";
import { buttonClass } from "@/components/ds/Button";
import { useSession } from "@/lib/auth/useSession";
import { casePermissions, useMyAccess } from "@/lib/auth/useMyAccess";
import {
  ScreeningCaseView,
  type CaseTab,
  type ScreeningFocus,
} from "@/components/cases/ScreeningCaseView";
import { IdentityCard } from "@/components/cases/IdentityCard";
import { PendingLabel } from "@/components/ai/AiOrb";
import { CreditTopUpAction } from "@/components/ai/CreditStop";
import { isCreditStop } from "@/lib/ai/credit-meter";
import { DeepCaseView } from "@/components/cases/DeepCaseView";
import { CommitteePack } from "@/components/cases/CommitteePack";
import { ErrorState } from "@/components/states/StateBlocks";
import { CaseSkeleton } from "@/components/cases/CaseSkeleton";
import { casePageState, withTimeout } from "@/lib/cases/case-load";
import { CaseTop } from "@/components/cases/CaseTop";
import { useCasePrefetch } from "@/components/cases/useCasePrefetch";
import { filesKey } from "@/components/cases/screening/case-tab-data";
import { caseTasksKey } from "@/components/cases/screening/useCaseTasks";
import { getCaseDetail } from "@/lib/cases/cases.functions";
import { fromCaseDetail } from "@/lib/cases/view-model";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { runInitialScreening } from "@/lib/analysis/screening.functions";
import { approveAndRunDeepAnalysis } from "@/lib/analysis/deep.functions";
import { canStartDeepRun, parseDeepFocus, parseSpor } from "@/lib/cases/deep-view";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { Language } from "@/lib/i18n/language";
import { userMessage } from "@/lib/errors/user-message";
import { isServerRefusal } from "@/lib/errors/server-refusal";
import type { MessageKey, TranslateVars } from "@/lib/i18n/translate";
import { pageMeta } from "@/lib/i18n/page-head";

const CASE_TABS: readonly CaseTab[] = ["oversigt", "noter", "beskeder", "filer"];
const FOCUS_PAGES: readonly ScreeningFocus[] = ["profil", "mandat", "fund", "finans", "hvorfor"];

export const Route = createFileRoute("/cases/$caseId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    view: "screening" | "deep" | "komite";
    fane?: CaseTab;
    fokus?: string;
    spor?: string;
  } => {
    const view =
      search["view"] === "deep"
        ? ("deep" as const)
        : search["view"] === "komite"
          ? ("komite" as const)
          : ("screening" as const);
    const spor = view === "deep" ? parseSpor(search["spor"]) : undefined;
    // A sub-page: the screening's focus pages, or the deep analysis's ("hvorfor", the Økonomi pages
    // and `analyse-<category>`; the page itself drops one with nothing to show).
    const fokus =
      view === "deep"
        ? parseDeepFocus(search["fokus"])
        : typeof search["fokus"] === "string" &&
            (FOCUS_PAGES as readonly string[]).includes(search["fokus"])
          ? search["fokus"]
          : undefined;
    return {
      view,
      // The screening's and the deep analysis's tab and focus page: in the URL, so
      // Back and a shared link work. `fane` is Noter, Beskeder and Filer; `spor` is the deep
      // analysis's own tab (Konklusion when missing); invalid values are dropped.
      ...(CASE_TABS.includes(search["fane"] as CaseTab) && search["fane"] !== "oversigt"
        ? { fane: search["fane"] as CaseTab }
        : {}),
      ...(fokus ? { fokus } : {}),
      ...(spor ? { spor } : {}),
    };
  },
  head: () => ({
    meta: [...pageMeta("case"), { name: "robots", content: "noindex" }],
  }),
  component: CaseDetailPage,
});

function CaseDetailPage() {
  const t = useT();
  const language = useLanguage();
  const { caseId } = Route.useParams();
  const { view, fane, fokus, spor } = Route.useSearch();
  const navigate = useNavigate();
  const {
    fundId,
    likelyFundId,
    fund,
    isLoading: teamsLoading,
    isError: teamsFailed,
    refreshFunds,
  } = useActiveFund();
  const session = useSession();
  // Everything the page needs is asked for at once, not one step after the other.
  useCasePrefetch(caseId, likelyFundId, language);

  const loadCase = useServerFn(getCaseDetail);
  const screenCase = useServerFn(runInitialScreening);
  const runDeepAnalysis = useServerFn(approveAndRunDeepAnalysis);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["case", caseId, fundId],
    // Never wait for ever; a hanging request becomes an error with "Prøv igen".
    queryFn: () => withTimeout(loadCase({ data: { caseId, fundId: fundId! } })),
    enabled: session.status === "signed_in" && Boolean(fundId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.executionStatus;
      if (
        status &&
        [
          "queued",
          "collecting_evidence",
          "screening_in_progress",
          "deep_analysis_in_progress",
          "quality_audit",
        ].includes(status)
      ) {
        return 2_500;
      }
      // Selv når casen ser "færdig" ud herfra, kan et andet vindue/en anden
      // bruger have startet en ny kørsel eller taget en beslutning i
      // mellemtiden -- uden dette ville denne fane aldrig opdage det uden en
      // manuel genindlæsning.
      return 45_000;
    },
  });
  // The phase and status this page shows. The server refuses a move when the case has moved
  // since, so a stale page cannot overwrite a newer decision (harden F5/G3/G4).
  const seenState = () =>
    query.data ? { phase: query.data.phase, status: query.data.status } : undefined;
  // "Prøv igen" on a stalled screening; the server closes the old run first.
  const screening = useMutation({
    mutationFn: () => screenCase({ data: { caseId, fundId: fundId! } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["case", caseId, fundId] }),
  });
  const deepAnalysis = useMutation({
    mutationFn: () => runDeepAnalysis({ data: { caseId, fundId: fundId!, expected: seenState() } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["case", caseId, fundId] }),
        queryClient.invalidateQueries({ queryKey: ["cases", fundId] }),
      ]);
      await navigate({ to: "/cases/$caseId", params: { caseId }, search: { view: "deep" } });
    },
  });
  const baseModel = query.data ? fromCaseDetail(query.data, language) : null;
  const model = baseModel;
  // The Dyb analyse view needs a deep analysis (finished, running or failed); without one the
  // URL shows the screening instead of a "sættes i gang" state for a run that never started.
  const hasDeepRun = Boolean(model?.history.some((entry) => entry.kind === "deep"));
  const effectiveView = view === "deep" && model && !hasDeepRun ? "screening" : view;
  const hasFinishedScreening = Boolean(
    model?.screening && ["complete", "awaiting_approval"].includes(model.screening.status),
  );
  // A screening made with an older setup version is shown as it was; the server only sends a
  // screening of the active version to a deep analysis, so it is rescreened first.
  const olderSetupScreening = Boolean(model?.screening && model.screening.setupCurrent === false);
  // Same rule as the server (approveAndRunDeepAnalysis): the newest finished screening has not
  // been sent to a deep analysis yet. History is newest first.
  const canRunDeep = Boolean(
    model && hasFinishedScreening && !olderSetupScreening && canStartDeepRun(model.history),
  );
  const latestRun = model?.history[0] ?? null;
  const persistedFailure =
    latestRun?.status === "failed"
      ? friendlyAnalysisError(latestRun.errorMessage, t, language)
      : null;
  const analysisBusy = Boolean(
    model &&
    [
      "queued",
      "collecting_evidence",
      "screening_in_progress",
      "deep_analysis_in_progress",
      "quality_audit",
    ].includes(model.executionStatus),
  );
  // Besked, når en kørsel i baggrunden bliver færdig, mens siden er åben (beslutning 25/9: sonner).
  // Flaget hører til én bestemt case, så et skift af case eller fond aldrig giver en falsk besked.
  const wasBusy = useRef<{ key: string; busy: boolean } | null>(null);
  useEffect(() => {
    const key = `${fundId ?? ""}:${caseId}`;
    if (!model) {
      wasBusy.current = null;
      return;
    }
    const previous = wasBusy.current?.key === key ? wasBusy.current.busy : null;
    if (previous === true && !analysisBusy && latestRun) {
      // A finished run writes its tasks and files; the parts fetched ahead fetch again.
      if (fundId) {
        void queryClient.invalidateQueries({ queryKey: caseTasksKey(caseId, fundId) });
        void queryClient.invalidateQueries({ queryKey: filesKey(caseId, fundId) });
      }
      const what = t(
        latestRun.kind === "deep" ? "caseView.route.whatDeep" : "caseView.route.whatScreening",
      );
      const name = model.companyName;
      if (latestRun.status === "failed") {
        toast.error(t("caseView.route.runFailed", { what, name }), {
          description: t("caseView.route.runFailedHint"),
        });
      } else {
        toast(t("caseView.route.runDone", { what, name }), {
          description: t(
            latestRun.kind === "deep"
              ? "caseView.route.runDoneDeep"
              : "caseView.route.runDoneScreening",
          ),
        });
      }
    }
    wasBusy.current = { key, busy: analysisBusy };
  }, [analysisBusy, latestRun, model, caseId, fundId, t, queryClient]);

  const caseTop =
    model && fundId ? (
      <CaseTop
        fundId={fundId}
        caseId={model.id}
        companyName={model.companyName}
        phase={query.data?.phase ?? "screening"}
        status={query.data?.status ?? "active"}
        hasScreening={hasFinishedScreening}
        canRunDeep={canRunDeep}
        hasDeep={hasDeepRun}
        hasFinishedDeep={Boolean(
          model.history.some((entry) => entry.kind === "deep" && entry.status === "complete"),
        )}
        running={analysisBusy}
        view={effectiveView === "deep" ? "deep" : "screening"}
      />
    ) : null;
  const notices = (
    <>
      <CaseNotices
        fundId={fundId}
        screening={screening}
        deep={deepAnalysis}
        persistedFailure={persistedFailure}
      />
      {olderSetupScreening &&
        hasFinishedScreening &&
        !analysisBusy &&
        query.data?.phase !== "decided" &&
        fundId &&
        model && (
          <OlderSetupNotice
            fundId={fundId}
            screenedVersion={model.screening?.setupVersion ?? null}
            activeVersion={model.profileVersion}
            onRescreen={() => screening.mutate()}
            rescreening={screening.isPending}
          />
        )}
    </>
  );
  const setTab = (tab: CaseTab) =>
    void navigate({
      to: "/cases/$caseId",
      params: { caseId },
      search: (previous) => ({
        view: previous.view ?? "screening",
        ...(previous.spor ? { spor: previous.spor } : {}),
        ...(tab === "oversigt" ? {} : { fane: tab }),
      }),
      replace: true,
    });
  // The deep analysis's own tab; choosing one also leaves Noter, Beskeder and Filer.
  const setSpor = (next: string | undefined, options?: { replace?: boolean }) =>
    void navigate({
      to: "/cases/$caseId",
      params: { caseId },
      search: (previous) => ({
        view: previous.view ?? "deep",
        ...(next ? { spor: next } : {}),
      }),
      replace: options?.replace ?? true,
    });
  // A focus sub-page the app opened is a pushed navigation entry: Back/Esc inside it pops that
  // entry (browser back), so one press leaves the page. Opened by a direct link (nothing of ours
  // to pop) it is replaced away instead, so Back never lands on the same sub-page again.
  const focusPushed = useRef(false);
  useEffect(() => {
    if (!fokus) focusPushed.current = false;
  }, [fokus]);
  const setFocus = (focus: string | null, options?: { replace?: boolean; back?: boolean }) => {
    if (focus === null && options?.back && focusPushed.current) {
      focusPushed.current = false;
      window.history.back();
      return;
    }
    const replace = options?.replace ?? false;
    if (focus && !replace) focusPushed.current = true;
    void navigate({
      to: "/cases/$caseId",
      params: { caseId },
      search: (previous) => ({
        view: previous.view ?? "screening",
        ...(previous.spor ? { spor: previous.spor } : {}),
        ...(previous.fane ? { fane: previous.fane } : {}),
        ...(focus ? { fokus: focus } : {}),
      }),
      replace: focus === null ? true : replace,
    });
  };
  useFocusScroll(fokus ?? null);

  const pageState = casePageState({
    hasCase: Boolean(model),
    sessionLoading: session.status === "loading",
    teamsLoading,
    teamsFailed,
    hasTeam: Boolean(fundId),
    caseLoading: query.isLoading,
    caseError: query.isError ? query.error : null,
    isRefusal: (error) =>
      isServerRefusal(
        error,
        "caseServer.cases.notFoundOrNoAccess",
        "appServer.dbRefusals.caseNotInTeam",
      ),
  });
  const states =
    pageState === "waiting" ? (
      // The case's shape while it loads, not a blank page with "Henter case …".
      <CaseSkeleton />
    ) : (
      <div className="max-w-[1120px] px-4 pt-9 pb-16 md:px-11">
        {pageState === "timeout" && (
          <ErrorState
            title={t("caseView.route.timeoutTitle")}
            body={t("caseView.route.timeoutBody")}
            onRetry={() => void query.refetch()}
          />
        )}
        {pageState === "refused" && (
          <ErrorState
            title={t("caseView.route.notInThesisTitle")}
            body={t("caseView.route.notInThesisBody", {
              fund: fund?.name ?? t("caseView.route.chosenThesis"),
            })}
          />
        )}
        {pageState === "error" && (
          <ErrorState title={t("caseView.route.loadError")} onRetry={() => void query.refetch()} />
        )}
        {pageState === "teamError" && (
          <ErrorState title={t("caseView.route.loadError")} onRetry={() => void refreshFunds()} />
        )}
        {pageState === "notFound" && (
          <ErrorState
            title={t("caseView.route.notFoundTitle")}
            body={t("caseView.route.notFoundBody")}
          />
        )}
      </div>
    );

  return (
    <AppShell
      title={model?.companyName ?? t("caseView.route.fallbackTitle")}
      redesigned
      ask={
        model
          ? {
              kind: "case",
              id: model.id,
              name: model.companyName,
              // Where in the case the reader is, for Spørg Interlect ("Kender Pleo, dyb analyse").
              phase: t(`caseView.route.askPhase.${effectiveView}`),
            }
          : undefined
      }
    >
      {model && effectiveView === "komite" ? (
        <CommitteePack
          model={model}
          fundId={fundId ?? undefined}
          backAction={
            <Link
              to="/cases/$caseId"
              params={{ caseId }}
              search={{ view: model.deep ? "deep" : "screening" }}
              className={buttonClass({ variant: "quiet", size: "md" })}
            >
              <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
              {t("caseView.route.backToAnalysis")}
            </Link>
          }
        />
      ) : model && fundId && effectiveView === "deep" ? (
        <DeepCaseView
          model={model}
          fundId={fundId}
          top={caseTop}
          notices={notices}
          onReload={() => void query.refetch()}
          onRetry={() => {
            // The server only sends a screening of the active setup on.
            if (!olderSetupScreening) deepAnalysis.mutate();
          }}
          retrying={deepAnalysis.isPending}
          retryAction={
            <button
              type="button"
              className="pill-cta"
              disabled={deepAnalysis.isPending || analysisBusy || olderSetupScreening}
              onClick={() => deepAnalysis.mutate()}
            >
              {deepAnalysis.isPending ? (
                <PendingLabel tone="ai" state="breathing" onDark>
                  {t("caseView.route.queueing")}
                </PendingLabel>
              ) : (
                <>
                  <RefreshCw className="size-3.5" aria-hidden />
                  {t("caseView.route.retryDeep")}
                </>
              )}
            </button>
          }
          spor={spor}
          onSpor={setSpor}
          tab={fane ?? "oversigt"}
          onTab={setTab}
          focus={fokus ?? null}
          onFocus={setFocus}
        />
      ) : model && fundId ? (
        <ScreeningCaseView
          model={model}
          fundId={fundId}
          top={caseTop}
          notices={notices}
          onRetry={() => screening.mutate()}
          retrying={screening.isPending}
          identity={
            model.identity ? (
              <IdentityCard identity={model.identity} website={model.website} />
            ) : null
          }
          tab={fane ?? "oversigt"}
          onTab={setTab}
          focus={
            (FOCUS_PAGES as readonly string[]).includes(fokus ?? "")
              ? (fokus as ScreeningFocus)
              : null
          }
          onFocus={setFocus}
        />
      ) : (
        states
      )}
    </AppShell>
  );
}

/**
 * A focus page opens at the top of the work area and Back returns to where the reader was on
 * the case (the sub-page lies over the page, "Kort → underside").
 */
function useFocusScroll(focus: string | null) {
  const saved = useRef<number | null>(null);
  useEffect(() => {
    const area = document.getElementById(WORKSPACE_ID);
    const scroller: { scrollTop: number } | null =
      area && area.scrollHeight > area.clientHeight ? area : document.scrollingElement;
    if (!scroller) return;
    if (focus) {
      if (saved.current === null) saved.current = scroller.scrollTop;
      scroller.scrollTop = 0;
    } else if (saved.current !== null) {
      const top = saved.current;
      saved.current = null;
      requestAnimationFrame(() => {
        scroller.scrollTop = top;
      });
    }
  }, [focus]);
}

function CaseNotices({
  fundId,
  screening,
  deep,
  persistedFailure,
}: {
  fundId: string | null;
  screening: { isError: boolean; error: unknown };
  deep: { isError: boolean; error: unknown };
  persistedFailure?: string | null;
}) {
  const t = useT();
  const language = useLanguage();
  const error = screening.isError ? screening.error : deep.isError ? deep.error : persistedFailure;
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  // The balance is used up: the explanation and "Fyld op" for Admin.
  const creditStop = isCreditStop(message);
  return (
    <div role="alert" className="rounded-sm border border-critical/40 bg-critical/5 px-4 py-3">
      <p className="text-list font-semibold text-critical">
        {t(creditStop ? "shell.credit.stoppedTitle" : "caseView.route.noticeTitle")}
      </p>
      <p className="mt-1 text-list leading-5 text-ink-2">
        {friendlyAnalysisError(message, t, language)}
      </p>
      {creditStop && fundId && (
        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <CreditTopUpAction fundId={fundId} />
        </div>
      )}
    </div>
  );
}

/**
 * The shown screening was made with an older setup version: it stays as it was, and one
 * click rescreens the case against the active version (decision log 25 Sep). Only a member who
 * may start analyses sees the button.
 */
function OlderSetupNotice({
  fundId,
  screenedVersion,
  activeVersion,
  onRescreen,
  rescreening,
}: {
  fundId: string;
  screenedVersion: number | null;
  activeVersion: string;
  onRescreen: () => void;
  rescreening: boolean;
}) {
  const t = useT();
  const access = useMyAccess(fundId);
  const canRun = casePermissions(access.data?.capabilities).canRun;
  return (
    <section
      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-hairline bg-surface p-4"
      aria-label={t("caseView.route.olderSetupTitle")}
    >
      <div className="min-w-0">
        <h2 className="text-section font-semibold text-ink">
          {t("caseView.route.olderSetupTitle")}
        </h2>
        <p className="mt-1 max-w-[68ch] text-list leading-5 text-ink-3">
          {t("caseView.route.olderSetupBody", {
            screened:
              screenedVersion === null
                ? t("caseView.route.olderSetupUnknown")
                : `v${screenedVersion}`,
            active: activeVersion,
          })}
        </p>
      </div>
      {canRun && (
        <button type="button" className="pill-cta" disabled={rescreening} onClick={onRescreen}>
          {rescreening ? (
            <PendingLabel tone="ai" state="breathing" onDark>
              {t("caseView.route.queueing")}
            </PendingLabel>
          ) : (
            <>
              <RefreshCw className="size-3.5" aria-hidden />
              {t("caseView.route.rescreen")}
            </>
          )}
        </button>
      )}
    </section>
  );
}

function friendlyAnalysisError(
  error: string | null | undefined,
  t: (key: MessageKey, vars?: TranslateVars) => string,
  language: Language,
) {
  if (!error) return t("caseView.route.errGeneric");
  // Interlect's own AI account, not the customer's: a neutral line. The gateway's own text
  // stays in the run's error_message and the server log. The customer's credits running out is the
  // credit meter's message (appServer.credits.exhausted) and is shown as it stands below.
  if (error.includes("GatewayRateLimitError") || error.includes("Free tier")) {
    return t("caseView.route.errCredits");
  }
  // Also a run from, whose stored error still names the subcontractor.
  if (error.includes("Invalid API key") || /gateway|vercel/i.test(error)) {
    return t("caseView.route.errApiKey");
  }
  // i18n-keep: matched against the server's error text in both languages, never shown.
  if (
    error.includes("researchspor") ||
    error.includes("søgeresultater") ||
    error.includes("research tracks") ||
    error.includes("search results")
  ) {
    return t("caseView.route.errResearch");
  }
  // Last resort: only the server's own sentences in the team's language reach the page.
  return userMessage(new Error(error), t("caseView.route.errGeneric"), language);
}
