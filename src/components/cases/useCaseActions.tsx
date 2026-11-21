/**
 * Runs a case action from the Cases list, the bulk bar or the case's status button:
 * phase and status moves through transitionCases (with the reason dialog where it is asked
 * for), "Fortryd" for 5 s, and the paid runs (screening, dyb analyse). One place, so the
 * list, the bulk bar and the case top say and do the same ("Handlingsnavne").
 */
import { startWithLimitChoice } from "@/lib/analysis/limit-choice";
import type { LimitChoice } from "@/lib/analysis/model-tiers";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Dialog, ReasonDialog } from "@/components/ds/Dialog";
import { CreditTopUpAction } from "@/components/ai/CreditStop";
import { isCreditStop } from "@/lib/ai/credit-meter";
import { showToast } from "@/components/ds/Toast";
import { CASE_ACTIONS } from "@/lib/copy/actions";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { MessageKey, TranslateVars } from "@/lib/i18n/translate";
import {
  listReasonCodes,
  transitionCases,
  undoCaseTransitions,
} from "@/lib/cases/transitions.functions";
import { runInitialScreening } from "@/lib/analysis/screening.functions";
import { approveAndRunDeepAnalysis } from "@/lib/analysis/deep.functions";
import {
  actionMovementKind,
  reasonRequired,
  type CasePhase,
  type CaseStatus,
  type CaseTransitionAction,
} from "@/lib/cases/lifecycle";
import {
  undoToastDuration,
  type CaseCommand,
  type ReasonDialogKind,
} from "@/lib/cases/case-actions";
import { MAX_REASONS, reasonCodesToSend, reasonOptions } from "@/lib/cases/reason-options";
import type { MovementKind } from "@/lib/brain/movement";
import { userMessage } from "@/lib/errors/user-message";

export interface CaseTarget {
  id: string;
  name: string;
  phase: CasePhase;
  status: CaseStatus;
}

type ToastKey =
  | "screen"
  | "deep"
  | "committee"
  | "hold"
  | "resume"
  | "reopen"
  | "close"
  | "invest"
  | "backToScreening";

type Translate = (key: MessageKey, vars?: TranslateVars) => string;

/** Icon and colours of each reason dialog; its words are `cases.confirm.<kind>.*`. */
const DIALOG_COPY: Record<ReasonDialogKind, (typeof CASE_ACTIONS)[keyof typeof CASE_ACTIONS]> = {
  hold: CASE_ACTIONS.hold,
  close: CASE_ACTIONS.close,
  invest: CASE_ACTIONS.markInvested,
  committee: CASE_ACTIONS.sendToCommittee,
  resume: CASE_ACTIONS.resume,
  reopen: CASE_ACTIONS.reopen,
};

function toastKey(action: CaseTransitionAction, from: CaseTarget): ToastKey {
  switch (action) {
    case "send_to_committee":
      return "committee";
    case "hold":
      return "hold";
    case "close":
      return "close";
    case "invest":
      return "invest";
    case "reopen":
      return from.status === "on_hold" ? "resume" : "reopen";
    case "back_to_screening":
      return from.phase === "decided" ? "reopen" : "backToScreening";
    case "reopen_in_deep_analysis":
      return "reopen";
  }
}

const subjectOf = (targets: readonly CaseTarget[], t: Translate) =>
  targets.length === 1
    ? (targets[0]?.name ?? t("cases.run.subjectOne"))
    : t("cases.run.subjectMany", { count: targets.length });

/**
 * After an action: `remaining` are the cases that were not moved or started (the list keeps
 * them selected, so the user sees which), `skipped` is a line for cases left out beforehand.
 */
export interface PerformOptions {
  onDone?: (remaining: string[]) => void;
  skipped?: string;
  /** From the bulk bar: a deep analysis is confirmed even when only one case is eligible. */
  bulk?: boolean;
}

interface PendingDialog {
  kind: ReasonDialogKind;
  action: CaseTransitionAction;
  targets: CaseTarget[];
  options: PerformOptions;
}

/** transitionCases takes at most 100 cases per call. */
const MAX_CASES = 100;

/** " (2 kunne ikke flyttes: Casen er ændret af en anden …)" */
function refusedLine(
  t: Translate,
  count: number,
  verb: "move" | "start",
  firstError: string | null | undefined,
): string {
  if (count === 0) return "";
  if (firstError) {
    return t(verb === "move" ? "cases.run.refusedMoveError" : "cases.run.refusedStartError", {
      count,
      error: firstError,
    });
  }
  return t(verb === "move" ? "cases.run.refusedMove" : "cases.run.refusedStart", { count });
}

export function useCaseActions(fundId: string | null) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const transition = useServerFn(transitionCases);
  const undo = useServerFn(undoCaseTransitions);
  const screen = useServerFn(runInitialScreening);
  const deep = useServerFn(approveAndRunDeepAnalysis);
  const loadReasons = useServerFn(listReasonCodes);

  // Its own key: the reasons editor in Team setup caches another shape under
  // ["reason-codes", fundId, "editor"]; the texts here follow the team's language.
  const reasonsQuery = useQuery({
    queryKey: ["reason-codes", fundId, "dialog", language],
    queryFn: () => loadReasons({ data: { fundId: fundId! } }),
    enabled: Boolean(fundId),
    staleTime: 5 * 60_000,
  });

  const [dialog, setDialog] = useState<PendingDialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // The dialog's own save state: a run starting on the same case must not lock it (harden N2).
  const [dialogSaving, setDialogSaving] = useState(false);
  const [bulkDeep, setBulkDeep] = useState<{
    targets: CaseTarget[];
    options: PerformOptions;
  } | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  // A run that stopped on the balance: the reason and "Fyld op" instead of a toast.
  const [creditStop, setCreditStop] = useState<string | null>(null);

  const refresh = useCallback(
    async (caseIds: readonly string[]) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cases", fundId] }),
        queryClient.invalidateQueries({ queryKey: ["overview", fundId] }),
        queryClient.invalidateQueries({ queryKey: ["overview-running", fundId] }),
        queryClient.invalidateQueries({ queryKey: ["overview-tasks", fundId] }),
        ...caseIds.flatMap((id) => [
          queryClient.invalidateQueries({ queryKey: ["case", id, fundId] }),
          queryClient.invalidateQueries({ queryKey: ["case-status-line", id, fundId] }),
        ]),
      ]);
    },
    [fundId, queryClient],
  );

  const markBusy = (ids: readonly string[], on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  /**
   * Moves the cases. Returns false when nothing moved; the error goes to the dialog it came
   * from (which stays open) or to a toast.
   */
  const move = useCallback(
    async (
      action: CaseTransitionAction,
      targets: CaseTarget[],
      reasonCodes: string[],
      note: string,
      fromDialog: boolean,
      options: PerformOptions = {},
    ): Promise<boolean> => {
      const fail = (message: string) => {
        if (fromDialog) setDialogError(message);
        else showToast({ message, tone: "error" });
        return false;
      };
      if (!fundId) return fail(t("cases.run.chooseThesis"));
      if (targets.length === 0) return false;
      if (targets.length > MAX_CASES) return fail(t("cases.run.tooMany", { max: MAX_CASES }));
      const ids = targets.map((target) => target.id);
      markBusy(ids, true);
      const sentAt = performance.now();
      try {
        const { results, undoToken } = await transition({
          data: {
            fundId,
            caseIds: ids,
            action,
            reasonCodes,
            note,
            expected: targets.map((target) => ({
              caseId: target.id,
              phase: target.phase,
              status: target.status,
            })),
          },
        });
        const moved = targets.filter((target) =>
          results.some((result) => result.caseId === target.id && result.ok && result.changed),
        );
        const refused = results.filter((result) => !result.ok);
        // The list and the case reload in the background: the toast (and its 5 s Fortryd)
        // shows as soon as the server has answered, inside the server's undo window (harden F);
        // a slow answer shortens it (harden E1).
        void refresh(ids);
        const undoMs = undoToken ? undoToastDuration(performance.now() - sentAt) : null;
        if (moved.length === 0) {
          return fail(refused[0]?.error ?? t("cases.run.nothingToChange"));
        }
        const first = moved[0]!;
        showToast({
          message: `${t(`cases.toast.${toastKey(action, first)}`, {
            subject: subjectOf(moved, t),
          })}${refusedLine(t, refused.length, "move", refused[0]?.error)}${options.skipped ?? ""}`,
          ...(undoToken && undoMs !== null
            ? {
                duration: undoMs,
                onUndo: () => {
                  void (async () => {
                    try {
                      const outcome = await undo({ data: { fundId, undoToken } });
                      showToast({
                        message:
                          outcome.notUndone.length > 0
                            ? t("cases.run.undonePartly", {
                                undone: outcome.undone.length,
                                notUndone: outcome.notUndone.length,
                              })
                            : t("cases.run.undone"),
                      });
                    } catch (cause) {
                      showToast({
                        message: userMessage(cause, t("cases.run.undoFailed"), language),
                        tone: "error",
                      });
                    } finally {
                      void refresh(ids);
                    }
                  })();
                },
              }
            : {}),
        });
        options.onDone?.(refused.map((result) => result.caseId));
        return true;
      } catch (cause) {
        return fail(userMessage(cause, t("cases.run.actionFailed"), language));
      } finally {
        markBusy(ids, false);
      }
    },
    [fundId, refresh, t, transition, undo],
  );

  const runAnalysis = useCallback(
    async (run: "screening" | "deep", targets: CaseTarget[], options: PerformOptions = {}) => {
      if (!fundId) {
        showToast({ message: t("cases.run.chooseThesis"), tone: "error" });
        return;
      }
      const ids = targets.map((target) => target.id);
      markBusy(ids, true);
      const started: CaseTarget[] = [];
      let firstError: string | null = null;
      // "Spørg mig først": asked once per batch, the answer is used for the rest.
      const atLimit: { choice?: LimitChoice | null } = {};
      const cancelled: CaseTarget[] = [];
      // One after the other: the runs queue on the server anyway, and a refusal (no finished
      // screening, already analysed) stays attached to its own case.
      for (const target of targets) {
        try {
          const result = await startWithLimitChoice<{ status: string }>(
            fundId,
            run,
            (choice) =>
              run === "screening"
                ? screen({ data: { caseId: target.id, fundId, atLimit: choice } })
                : deep({
                    data: {
                      caseId: target.id,
                      fundId,
                      expected: { phase: target.phase, status: target.status },
                      atLimit: choice,
                    },
                  }),
            atLimit,
          );
          // Cancelled at the limit: nothing started, and that is not an error.
          if (!result) {
            cancelled.push(target);
            continue;
          }
          started.push(target);
        } catch (cause) {
          // The balance refusal comes in the page's language and is kept as it is.
          const raw = cause instanceof Error ? cause.message.trim() : "";
          firstError ??= isCreditStop(raw)
            ? raw
            : userMessage(cause, t("cases.run.runFailed"), language);
        }
      }
      // Busy until the list shows the run, so a second click can't start it again.
      await refresh(ids);
      markBusy(ids, false);
      if (started.length > 0) {
        showToast({
          message: `${t(run === "screening" ? "cases.toast.screen" : "cases.toast.deep", {
            subject: subjectOf(started, t),
          })}${refusedLine(
            t,
            targets.length - started.length - cancelled.length,
            "start",
            firstError,
          )}${options.skipped ?? ""}`,
        });
        options.onDone?.(
          targets.filter((target) => !started.includes(target)).map((target) => target.id),
        );
        // Some started, the rest stopped on the balance: "Fyld op" for the rest too.
        if (firstError && isCreditStop(firstError)) setCreditStop(firstError);
      } else if (firstError && isCreditStop(firstError)) {
        setCreditStop(firstError);
      } else if (firstError) {
        showToast({ message: firstError, tone: "error" });
      }
    },
    [deep, fundId, refresh, screen, t],
  );

  /** Runs a command for one or more cases. "menu" is handled by the caller. */
  const perform = useCallback(
    (command: CaseCommand, targets: CaseTarget[], options: PerformOptions = {}) => {
      if (targets.length === 0) return;
      if (command.kind === "menu") return;
      if (targets.length > MAX_CASES) {
        showToast({ message: t("cases.run.tooMany", { max: MAX_CASES }), tone: "error" });
        return;
      }
      if (command.kind === "run") {
        // A deep analysis from the bulk bar is always confirmed, also when only one of the
        // selected cases can run it (harden E7).
        if (command.run === "deep" && (targets.length > 1 || options.bulk)) {
          setBulkDeep({ targets, options });
          return;
        }
        void runAnalysis(command.run, targets, options);
        return;
      }
      if (command.dialog) {
        setDialogError(null);
        setDialogSaving(false);
        setDialog({ kind: command.dialog, action: command.action, targets, options });
        return;
      }
      void move(command.action, targets, [], "", false, options);
    },
    [move, runAnalysis, t],
  );

  const kinds: MovementKind[] = useMemo(() => {
    if (!dialog) return [];
    const set = new Set<MovementKind>();
    for (const target of dialog.targets) {
      const kind = actionMovementKind(dialog.action, target.phase, target.status);
      if (kind) set.add(kind);
    }
    return [...set];
  }, [dialog]);

  const codes = reasonsQuery.data ?? [];
  const options = reasonOptions(codes, kinds);
  const copy = dialog ? DIALOG_COPY[dialog.kind] : null;
  const confirm = copy && "confirm" in copy ? copy.confirm : null;
  const confirmKey = dialog ? (`cases.confirm.${dialog.kind}` as const) : null;
  const dialogPending = dialog !== null && dialogSaving;

  const element: ReactNode = (
    <>
      {copy && confirm && dialog && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            // Closing while saving would hide the outcome; the move can't be stopped (harden E).
            if (!open && !dialogPending) setDialog(null);
          }}
          question={t(`${confirmKey!}.question`)}
          confirmLabel={t(`${confirmKey!}.confirm`)}
          reasons={options.primary}
          moreReasons={options.more}
          notePlaceholder={t(`${confirmKey!}.notePlaceholder`)}
          icon={copy.icon}
          tone={copy.tone}
          pending={dialogPending}
          error={dialogError}
          maxReasons={MAX_REASONS}
          footnote={
            reasonsQuery.isError
              ? t("cases.run.reasonsError")
              : reasonsQuery.isLoading
                ? t("cases.run.reasonsLoading")
                : dialog.targets.length > 1
                  ? t("cases.run.appliesTo", { count: dialog.targets.length })
                  : null
          }
          onConfirm={({ reasons, note }) => {
            const send = reasonCodesToSend(reasons, note, kinds, codes, reasonRequired);
            if (send === null) {
              setDialogError(t("cases.run.pickReason"));
              return;
            }
            setDialogError(null);
            setDialogSaving(true);
            const current = dialog;
            void move(current.action, current.targets, send, note, true, current.options).then(
              (ok) => {
                setDialogSaving(false);
                if (ok) setDialog((open) => (open === current ? null : open));
              },
            );
          }}
        />
      )}
      <Dialog
        open={bulkDeep !== null}
        onOpenChange={(open) => {
          if (!open) setBulkDeep(null);
        }}
        title={t(
          bulkDeep?.targets.length === 1
            ? "cases.run.bulkDeepTitleOne"
            : "cases.run.bulkDeepTitleMany",
          { count: bulkDeep?.targets.length ?? 0 },
        )}
        description={
          bulkDeep?.targets.length === 1
            ? t("cases.run.bulkDeepBodyOne")
            : t("cases.run.bulkDeepBodyMany")
        }
        icon={Sparkles}
        tone={CASE_ACTIONS.runDeepAnalysis.tone}
        footer={
          <>
            <Button
              variant="quiet"
              size="md"
              className="h-[42px]"
              onClick={() => setBulkDeep(null)}
            >
              {t("cases.run.cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              className="h-[42px] px-5 text-[14px]"
              onClick={() => {
                const pending = bulkDeep;
                setBulkDeep(null);
                if (pending) void runAnalysis("deep", pending.targets, pending.options);
              }}
            >
              {t("cases.actions.runDeepAnalysis.label")}
            </Button>
          </>
        }
      />
      {fundId && (
        <Dialog
          open={creditStop !== null}
          onOpenChange={(open) => {
            if (!open) setCreditStop(null);
          }}
          title={t("shell.credit.stoppedTitle")}
          description={creditStop}
          icon={Wallet}
          tone={{ color: "critical", wash: "critical-wash" }}
          footer={
            <>
              <Button variant="quiet" size="md" onClick={() => setCreditStop(null)}>
                {t("common.close")}
              </Button>
              <CreditTopUpAction fundId={fundId} />
            </>
          }
        />
      )}
    </>
  );

  return { perform, element, busy };
}
