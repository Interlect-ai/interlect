/**
 * "Find med Brain" on a missing figure: Brain looks for
 * exactly one raw figure (a metric in a year) in the case's own material and then on the web
 * (`findFieldWithBrain`), and shows what it found as a proposal with the quote, the source and how
 * certain it is. "Sæt ind på casen" saves exactly the stored proposal (`acceptFieldProposal`; the
 * value never comes from the browser) with the source "Brain, bekræftet af <navn>"; "Afvis"
 * leaves it unused (`dismissFieldProposal`). Nothing is guessed: no proposal is "Ikke fundet"
 * again. A search uses credits; no amount is shown.
 *
 * Two places use it: under the key figures on Økonomi (`EconomyFindPanel`, opened by "Find med
 * Brain" on a key figure that was not found) and under a Brain answer that asks for a figure on
 * the case (`AnswerFindField`). Only the search button's orb moves while Brain looks.
 *
 * Measured from the "Udfyld" form (EconomyInputs.tsx): canvas card, radius xl, padding 20 22; a
 * proposal sits in a surface box with a hairline (MissingInfo's field box), actions right-aligned.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, CircleCheck, Search, SearchX } from "lucide-react";
import { PendingLabel } from "@/components/ai/AiOrb";
import { Button } from "@/components/ds/Button";
import { showToast } from "@/components/ds/Toast";
import type { ManualFinancialMetric } from "@/lib/analysis/manual-financials";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import type { FieldQuestion } from "@/lib/brain/field-question";
import { defaultInputYear, missingFigures } from "@/lib/cases/economy-inputs";
import {
  acceptFieldProposal,
  dismissFieldProposal,
  findFieldWithBrain,
  listFinancialStatements,
  type FieldProposalView,
} from "@/lib/cases/financials.functions";
import { userMessage } from "@/lib/errors/user-message";
import { LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { CASE_PANEL_STALE_MS } from "../screening/case-tab-data";

type Searched = ReadonlyArray<"case_material" | "web">;

type FindState =
  | { status: "searching" }
  | {
      status: "found";
      proposal: FieldProposalView;
      busy: "accept" | "dismiss" | null;
      error: string | null;
    }
  | { status: "not_found"; searched: Searched }
  | { status: "error"; message: string }
  | { status: "accepted"; proposal: FieldProposalView }
  | { status: "dismissed" };

type FindStates = Partial<Record<ManualFinancialMetric, FindState>>;

/** A figure that can be looked for (again): never searched, not found, failed or dismissed. */
function searchable(state: FindState | undefined): boolean {
  return (
    !state ||
    state.status === "not_found" ||
    state.status === "error" ||
    state.status === "dismissed"
  );
}

function amountText(value: number, currency: string, language: Language): string {
  const amount = new Intl.NumberFormat(LANGUAGE_TAGS[language], {
    maximumFractionDigits: 2,
  }).format(value);
  return `${amount} ${currency}`;
}

/** "omsætning og bruttofortjeneste" in the team's language. */
function fieldList(labels: readonly string[], language: Language): string {
  return new Intl.ListFormat(LANGUAGE_TAGS[language], { type: "conjunction" }).format(
    labels.map((label) => label.toLowerCase()),
  );
}

function useFieldFinder(fundId: string, caseId: string, fiscalYear: number) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const find = useServerFn(findFieldWithBrain);
  const accept = useServerFn(acceptFieldProposal);
  const dismiss = useServerFn(dismissFieldProposal);
  const [states, setStates] = useState<FindStates>({});
  const patch = (metric: ManualFinancialMetric, next: FindState) =>
    setStates((previous) => ({ ...previous, [metric]: next }));
  // The figures on the case changed (Økonomi and the key figures read them again).
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["financial-statements", caseId] });

  async function search(metrics: readonly ManualFinancialMetric[]) {
    const todo = metrics.filter((metric) => searchable(states[metric]));
    for (const metric of todo) patch(metric, { status: "searching" });
    await Promise.all(
      todo.map(async (metric) => {
        try {
          const result = await find({ data: { fundId, caseId, metric, fiscalYear } });
          patch(
            metric,
            result.status === "found"
              ? { status: "found", proposal: result.proposal, busy: null, error: null }
              : { status: "not_found", searched: result.searched },
          );
        } catch (cause) {
          patch(metric, {
            status: "error",
            message: userMessage(cause, t("caseServer.financials.findFailed"), language),
          });
        }
      }),
    );
  }

  async function onAccept(metric: ManualFinancialMetric) {
    const state = states[metric];
    if (state?.status !== "found" || state.busy) return;
    patch(metric, { ...state, busy: "accept", error: null });
    try {
      await accept({ data: { fundId, caseId, proposalId: state.proposal.id } });
      patch(metric, { status: "accepted", proposal: state.proposal });
      showToast({
        message: t("finance.economy.find.acceptedToast", {
          label: t(`finance.economy.find.metric.${metric}`),
          year: fiscalYear,
        }),
        tone: "success",
      });
    } catch (cause) {
      patch(metric, {
        ...state,
        busy: null,
        error: userMessage(cause, t("caseServer.financials.proposalNotSaved"), language),
      });
    } finally {
      // Also after a refusal: another tab may have used the proposal already.
      await refresh();
    }
  }

  async function onDismiss(metric: ManualFinancialMetric) {
    const state = states[metric];
    if (state?.status !== "found" || state.busy) return;
    patch(metric, { ...state, busy: "dismiss", error: null });
    try {
      await dismiss({ data: { fundId, caseId, proposalId: state.proposal.id } });
      patch(metric, { status: "dismissed" });
    } catch (cause) {
      patch(metric, {
        ...state,
        busy: null,
        error: userMessage(cause, t("caseServer.financials.proposalNotDismissed"), language),
      });
    }
  }

  const searching = Object.values(states).some((state) => state?.status === "searching");
  const deciding = Object.values(states).some(
    (state) => state?.status === "found" && state.busy !== null,
  );
  // One thing at a time (only one orb moves): no decision while Brain searches, and one row at
  // a time.
  const busy = searching || deciding;
  return { states, search, searching, busy, onAccept, onDismiss };
}

/** One figure: what Brain is doing, found, did not find, or what was decided. */
function FieldResult({
  metric,
  fiscalYear,
  state,
  locked,
  onAccept,
  onDismiss,
}: {
  metric: ManualFinancialMetric;
  fiscalYear: number;
  state: FindState;
  /** Brain is still searching, or another figure is being decided. */
  locked: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const label = t(`finance.economy.find.metric.${metric}`);
  const proposal = state.status === "found" || state.status === "accepted" ? state.proposal : null;
  // After "Sæt ind" or "Afvis" the buttons are gone: focus stays in the result, not on <body>.
  const rowRef = useRef<HTMLDivElement>(null);
  const decided = state.status === "accepted" || state.status === "dismissed";
  useEffect(() => {
    const active = document.activeElement;
    if (decided && (!active || active === document.body)) rowRef.current?.focus();
  }, [decided]);
  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      className="flex flex-col gap-2.5 rounded-lg bg-surface px-4 py-3.5 shadow-[0_0_0_1px_var(--line)] outline-none focus-visible:ring-2 focus-visible:ring-action"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-list font-medium text-ink-1">
          {label} · {fiscalYear}
        </span>
      </div>
      {state.status === "searching" && (
        <span className="text-meta text-ink-3">{t("finance.economy.find.rowSearching")}</span>
      )}
      {state.status === "not_found" && (
        <span className="flex items-center gap-1.5 text-meta text-ink-3">
          <SearchX className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} aria-hidden />
          {t(
            state.searched.includes("web")
              ? "finance.economy.find.notFoundBoth"
              : "finance.economy.find.notFoundMaterial",
          )}
        </span>
      )}
      {state.status === "error" && (
        <p role="alert" className="m-0 text-meta text-critical">
          {state.message}
        </p>
      )}
      {state.status === "dismissed" && (
        <span className="text-meta text-ink-3">{t("finance.economy.find.dismissed")}</span>
      )}
      {proposal && (
        <>
          <span className="text-[22px] leading-[1.1] font-semibold tracking-display tabular-nums text-ink-1">
            {amountText(proposal.value, proposal.currency, language)}
          </span>
          <blockquote className="m-0 border-l-2 border-line pl-3 text-[14px] leading-[1.5] text-ink-2">
            “{proposal.quote}”
          </blockquote>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
            <span className="min-w-0 truncate">
              {t("finance.economy.find.source")}:{" "}
              {proposal.sourceTitle ??
                t(
                  proposal.sourceKind === "web"
                    ? "finance.economy.find.sourceWeb"
                    : "finance.economy.find.sourceMaterial",
                )}
            </span>
            {proposal.sourceUrl && (
              <a
                href={proposal.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
              >
                {t("finance.economy.find.openSource")}
                <ArrowUpRight className="size-3" strokeWidth={1.75} aria-hidden />
              </a>
            )}
          </span>
        </>
      )}
      {state.status === "found" && state.error && (
        <p role="alert" className="m-0 text-meta text-critical">
          {state.error}
        </p>
      )}
      {state.status === "found" && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
          <Button
            variant="quiet"
            size="sm"
            onClick={onDismiss}
            disabled={locked && state.busy !== "dismiss"}
            pending={state.busy === "dismiss"}
          >
            {t("finance.economy.find.dismiss")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onAccept}
            disabled={locked && state.busy !== "accept"}
            pending={state.busy === "accept"}
            pendingLabel={t("finance.economy.find.accepting")}
          >
            {t("finance.economy.find.accept")}
          </Button>
        </div>
      )}
      {state.status === "accepted" && (
        <span className="flex items-center gap-1.5 text-meta font-medium text-positive">
          <CircleCheck className="size-3.5" strokeWidth={1.75} aria-hidden />
          {t("finance.economy.find.accepted")}
        </span>
      )}
    </div>
  );
}

/**
 * Under the key figures on Økonomi: what Brain will look for, "Søg med Brain", and one result
 * per figure. The figures to look for are fixed when the panel opens, so a figure that has just
 * been added stays in the list as "Sat ind på casen".
 */
export function EconomyFindPanel({
  fundId,
  caseId,
  label,
  metrics,
  fiscalYear,
  onFill,
  onClose,
  onBusyChange,
}: {
  fundId: string;
  caseId: string;
  /** The key figure's name ("Bruttomargin"). */
  label: string;
  /** The raw figures the key figure lacks for the year (`missingFigures`). */
  metrics: readonly ManualFinancialMetric[];
  fiscalYear: number;
  /** "Udfyld selv": the key figure's own form instead. */
  onFill: () => void;
  onClose: () => void;
  /**
   * Brain is searching or a figure is being decided: the page keeps the panel open meanwhile (a
   * search that is cut off has used credits and its proposal would never be shown).
   */
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const titleId = useId();
  const [fields] = useState(metrics);
  const finder = useFieldFinder(fundId, caseId, fiscalYear);
  const searched = fields.some((metric) => finder.states[metric] !== undefined);
  const canSearch = fields.some((metric) => searchable(finder.states[metric]));
  const busy = finder.busy;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  // A panel that goes away (a search cannot run without it) frees the page again.
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const fieldsText = fieldList(
    fields.map((metric) => t(`finance.economy.find.metric.${metric}`)),
    language,
  );

  return (
    <motion.section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-xl bg-canvas px-5 py-5 md:px-[22px]"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.42, ease: EASE.out }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <span id={titleId} className="text-section font-semibold">
          {t("finance.economy.find.title", { label: label.toLowerCase() })}
        </span>
        <span className="max-w-[720px] text-meta leading-[1.5] text-ink-3">
          {t("finance.economy.find.hint", { fields: fieldsText, year: fiscalYear })}
        </span>
      </div>
      {searched && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-3">
          {fields.map((metric) => {
            const state = finder.states[metric];
            return state ? (
              <FieldResult
                key={metric}
                metric={metric}
                fiscalYear={fiscalYear}
                state={state}
                locked={finder.busy}
                onAccept={() => void finder.onAccept(metric)}
                onDismiss={() => void finder.onDismiss(metric)}
              />
            ) : null;
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="quiet" size="md" onClick={onFill} disabled={busy}>
          {t("finance.economy.find.fillYourself")}
        </Button>
        <div className="flex-1" />
        <Button variant="quiet" size="md" onClick={onClose} disabled={busy}>
          {t("finance.economy.find.close")}
        </Button>
        {(canSearch || finder.searching) && (
          <Button
            variant="primary"
            size="md"
            icon={Search}
            autoFocus
            onClick={() => void finder.search(fields)}
            disabled={busy && !finder.searching}
            pending={finder.searching ? "ai" : false}
            pendingLabel={t("finance.economy.find.searching")}
          >
            {t(searched ? "finance.economy.find.searchAgain" : "finance.economy.find.search")}
          </Button>
        )}
      </div>
    </motion.section>
  );
}

/**
 * Under a Brain answer that asks for a figure on the case (Spørg Interlect, Brain): "Find … med
 * Brain" for the figures the case still lacks in the asked year (else the newest report's year).
 * Shown only to people who may fill in figures (correct_evidence), and only for a year a figure
 * can be added for; a figure the case already has gets no button.
 */
export function AnswerFindField({
  fundId,
  caseId,
  asked,
}: {
  fundId: string;
  caseId: string;
  asked: FieldQuestion;
}) {
  const access = useMyAccess(fundId);
  const canFill = access.data?.capabilities.includes("correct_evidence") ?? false;
  if (!canFill) return null;
  return <AnswerFindFieldReady fundId={fundId} caseId={caseId} asked={asked} />;
}

function AnswerFindFieldReady({
  fundId,
  caseId,
  asked,
}: {
  fundId: string;
  caseId: string;
  asked: FieldQuestion;
}) {
  const language = useLanguage();
  const loadFinancials = useServerFn(listFinancialStatements);
  // The same query as the case's Økonomi, so the page and the panel share one answer.
  const financials = useQuery({
    queryKey: ["financial-statements", caseId, language],
    queryFn: () => loadFinancials({ data: { fundId, caseId } }),
    staleTime: CASE_PANEL_STALE_MS,
  });
  const plan = useMemo(() => {
    const data = financials.data;
    if (!data || data.manualInputsError) return null;
    const now = Date.now();
    const maxYear = data.maxInputYear ?? defaultInputYear([], now);
    const fiscalYear =
      asked.fiscalYear ?? Math.min(defaultInputYear(data.metrics.years, now), maxYear);
    if (fiscalYear < 1990 || fiscalYear > maxYear) return null;
    const metrics = missingFigures(
      asked.metrics,
      fiscalYear,
      data.statements,
      data.manualInputs ?? [],
    );
    return metrics.length > 0 ? { metrics, fiscalYear } : null;
  }, [asked, financials.data]);
  // Fixed once known, so a figure that has just been added keeps its "Sat ind på casen".
  const [fixed, setFixed] = useState<{
    metrics: readonly ManualFinancialMetric[];
    fiscalYear: number;
  } | null>(null);
  const shown = fixed ?? plan;
  if (!shown) return null;
  return (
    <AnswerFinder fundId={fundId} caseId={caseId} plan={shown} onStart={() => setFixed(shown)} />
  );
}

function AnswerFinder({
  fundId,
  caseId,
  plan,
  onStart,
}: {
  fundId: string;
  caseId: string;
  plan: { metrics: readonly ManualFinancialMetric[]; fiscalYear: number };
  onStart: () => void;
}) {
  const t = useT();
  const finder = useFieldFinder(fundId, caseId, plan.fiscalYear);
  const canSearch = plan.metrics.some((metric) => searchable(finder.states[metric]));
  const searched = plan.metrics.some((metric) => finder.states[metric] !== undefined);
  const firstMetric = plan.metrics[0]!;
  const label =
    plan.metrics.length === 1
      ? t("finance.economy.find.chatOne", {
          label: t(`finance.economy.find.metric.${firstMetric}`).toLowerCase(),
          year: plan.fiscalYear,
        })
      : t("finance.economy.find.chatMany", { year: plan.fiscalYear });
  return (
    <div className="flex flex-col gap-2.5 pt-1">
      {(canSearch || finder.searching) && (
        // An action under the answer, like "Afklar med Brain" on the cards: a link-style button
        // that wraps in the narrow Spørg Interlect panel; the coral orb while Brain looks.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {finder.searching ? (
            <span role="status" className="text-meta font-medium text-ink-2">
              <PendingLabel tone="ai" state="searching">
                {t("finance.economy.find.searching")}
              </PendingLabel>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                onStart();
                void finder.search(plan.metrics);
              }}
              className="inline-flex items-start gap-1.5 text-left text-meta font-medium text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
            >
              <Search className="mt-[3px] size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {searched ? t("finance.economy.find.searchAgain") : label}
            </button>
          )}
          <span className="text-meta text-ink-4">{t("finance.economy.find.credits")}</span>
        </div>
      )}
      {plan.metrics.map((metric) => {
        const state = finder.states[metric];
        return state ? (
          <FieldResult
            key={metric}
            metric={metric}
            fiscalYear={plan.fiscalYear}
            state={state}
            locked={finder.busy}
            onAccept={() => void finder.onAccept(metric)}
            onDismiss={() => void finder.onDismiss(metric)}
          />
        ) : null;
      })}
    </div>
  );
}
