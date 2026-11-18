/**
 * "Venter på jer" (Overblik v2): the cases that need a person, each with the reason (worked
 * out in code from the real state, see lib/overview/waiting.ts), the case's open tasks as a
 * small number and the split button of the Cases list: the left half does the recommended next
 * step, the arrow opens every action. It is the same machinery as Cases (`useCaseActions`:
 * the reason dialogs, "Fortryd", the paid deep analysis only on this click and only with the
 * role that may start it). Nothing starts by itself. A Læser sees no actions.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, CircleCheck, CircleDot } from "lucide-react";
import { CaseActionMenuItems } from "@/components/cases/CaseActionMenu";
import type { CaseTarget, useCaseActions } from "@/components/cases/useCaseActions";
import { CountUp } from "@/components/ds/CountUp";
import { MenuHeader } from "@/components/ds/Menu";
import { SplitButton } from "@/components/ds/SplitButton";
import { caseActionCopy } from "@/lib/cases/case-action-copy";
import {
  menuGroups,
  primaryAction,
  type CaseActionState,
  type CasePermissions,
} from "@/lib/cases/case-actions";
import { casePhaseLabelKey, caseStatusLabelKey } from "@/lib/cases/lifecycle";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import type { WaitingRowData } from "@/lib/overview/snapshot";
import { waitingReasonText, type WaitingTone } from "@/lib/overview/waiting";
import { cn } from "@/lib/utils";
import { phaseColor } from "./shared";

const REASON_COLOR: Record<WaitingTone, string> = {
  warning: "var(--warning)",
  ai: "var(--ai-ink)",
  positive: "var(--positive)",
};

const stateOf = (row: WaitingRowData): CaseActionState => ({
  phase: row.phase,
  status: row.status,
  hasScreening: row.hasScreening,
  canRunDeep: row.canRunDeep,
  hasDeep: row.hasDeep,
  running: row.running,
});

const targetOf = (row: WaitingRowData): CaseTarget => ({
  id: row.caseId,
  name: row.name,
  phase: row.phase,
  status: row.status,
});

export function WaitingCard({
  rows,
  total,
  permissions,
  accessReady,
  actions,
  tasks,
  noCases,
  showTasks,
  onOpenTasks,
}: {
  rows: readonly WaitingRowData[];
  total: number;
  permissions: CasePermissions & { canAct: boolean };
  /** The viewer's role has loaded; until then no action is shown (no flash of buttons). */
  accessReady: boolean;
  actions: ReturnType<typeof useCaseActions>;
  tasks: { open: number; overdue: number };
  /** The fund has no cases at all yet (first use). */
  noCases: boolean;
  /** The tasks line is a prompt to act: not for a Læser. */
  showTasks: boolean;
  onOpenTasks: () => void;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  return (
    <motion.section
      aria-label={t("overview.waiting.title")}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.56, ease: EASE.out, delay: 0.04 }}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-canvas px-[22px] pt-[22px] pb-3.5"
    >
      <div className="flex items-baseline gap-2.5 pb-3">
        <h2 className="m-0 text-section font-semibold">{t("overview.waiting.title")}</h2>
        <span className="text-list text-ink-4 tabular-nums">{total}</span>
        <div className="flex-1" />
        <Link to="/cases" className="text-meta text-ink-3 transition-colors hover:text-ink-1">
          {t("overview.waiting.allCases")}
        </Link>
      </div>
      <div className="flex flex-col rounded-lg bg-surface shadow-card">
        {rows.map((row, index) => (
          <WaitingRow
            key={row.caseId}
            row={row}
            index={index}
            showAction={accessReady && permissions.canAct}
            permissions={permissions}
            actions={actions}
          />
        ))}
        {rows.length === 0 && (
          <div className="flex items-center justify-center gap-2.5 px-5 py-[34px] text-[15px] font-medium">
            {noCases ? (
              t("overview.page.noCasesYet")
            ) : (
              <>
                <CircleCheck className="size-5 text-positive" strokeWidth={1.75} aria-hidden />
                {t("overview.page.allFollowedUp")}
              </>
            )}
          </div>
        )}
      </div>
      {!showTasks ? null : tasks.open > 0 ? (
        <button
          type="button"
          onClick={onOpenTasks}
          className="mt-2 flex h-[46px] items-center gap-2.5 rounded-md px-2.5 text-left text-list text-ink-2 outline-none transition-colors hover:bg-surface hover:text-ink-1 focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-action"
        >
          <CircleDot className="size-4 text-warning" strokeWidth={1.75} aria-hidden />
          <span>
            {t("overview.waiting.youHave")}{" "}
            <b className="font-semibold text-ink-1">
              <CountUp value={tasks.open} />{" "}
              {tasks.open === 1
                ? t("overview.waiting.openTaskOne")
                : t("overview.waiting.openTaskMany")}
            </b>
            {tasks.overdue > 0 && `, ${t("overview.waiting.overdue", { count: tasks.overdue })}`}
          </span>
          <div className="flex-1" />
          <ArrowUpRight className="size-4 text-ink-4" strokeWidth={1.75} aria-hidden />
        </button>
      ) : (
        <p className="mt-2 flex h-[46px] items-center gap-2.5 px-2.5 text-list text-ink-3">
          <CircleDot className="size-4 text-ink-4" strokeWidth={1.75} aria-hidden />
          {t("overview.waiting.noOpenTasks")}
        </p>
      )}
    </motion.section>
  );
}

function WaitingRow({
  row,
  index,
  showAction,
  permissions,
  actions,
}: {
  row: WaitingRowData;
  index: number;
  showAction: boolean;
  permissions: CasePermissions;
  actions: ReturnType<typeof useCaseActions>;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  const color = phaseColor(row.phase, row.status);
  const score = row.score === null ? null : Math.max(0, Math.min(100, row.score));
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.36, delay: reduced ? 0 : index * 0.05 }}
      className={cn(
        "relative grid min-h-[70px] items-center gap-3.5 rounded-xl py-2.5 pr-3 pl-3.5 transition-colors duration-[180ms] hover:bg-hover focus-within:bg-hover",
        showAction ? "grid-cols-[40px_minmax(0,1fr)_auto]" : "grid-cols-[40px_minmax(0,1fr)]",
        index > 0 && "border-t border-line",
      )}
    >
      <span className="relative size-10" aria-hidden>
        <svg viewBox="0 0 40 40" width="40" height="40" className="-rotate-90">
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="var(--chart-track)"
            strokeWidth="3.5"
          />
          {score !== null && (
            <motion.circle
              cx="20"
              cy="20"
              r="16"
              fill="none"
              stroke={color}
              strokeWidth="3.5"
              strokeLinecap="round"
              initial={{ pathLength: reduced ? score / 100 : 0 }}
              animate={{ pathLength: score / 100 }}
              transition={{ duration: 0.9, ease: EASE.out, delay: 0.1 + index * 0.05 }}
            />
          )}
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[12px] font-semibold tabular-nums">
          {score === null ? "–" : Math.round(score)}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <Link
            to="/cases/$caseId"
            params={{ caseId: row.caseId }}
            search={{ view: row.view }}
            className="line-clamp-2 text-[15px] leading-5 font-semibold outline-none before:absolute before:inset-0 before:rounded-xl focus-visible:before:ring-2 focus-visible:before:ring-action"
          >
            {row.name}
          </Link>
          {row.openTasks > 0 && (
            <span className="inline-flex flex-none items-center gap-[5px] text-micro font-medium text-ink-2">
              <CircleDot className="size-[11px] text-warning" aria-hidden />
              {t(row.openTasks === 1 ? "overview.waiting.taskOne" : "overview.waiting.taskMany", {
                count: row.openTasks,
              })}
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-meta" style={{ color: REASON_COLOR[row.reason.tone] }}>
          {waitingReasonText(row.reason, language)}
        </span>
      </span>
      {showAction && (
        <span className="relative z-10">
          <WaitingAction row={row} permissions={permissions} actions={actions} />
        </span>
      )}
    </motion.div>
  );
}

function WaitingAction({
  row,
  permissions,
  actions,
}: {
  row: WaitingRowData;
  permissions: CasePermissions;
  actions: ReturnType<typeof useCaseActions>;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const language = useLanguage();
  const state = stateOf(row);
  const primary = primaryAction(state, "list");
  if (!primary) return null;
  const copy = caseActionCopy(primary.id, language);
  const groups = menuGroups(state, permissions, "list", language);
  const primaryBlocked = groups
    .flatMap((group) => group.items)
    .find((entry) => entry.id === primary.id)?.blocked;
  const now =
    row.phase === "decided"
      ? t(caseStatusLabelKey[row.status])
      : `${t(casePhaseLabelKey[row.phase])}${row.phase === "committee" ? `, ${t("overview.waiting.awaitingDecision")}` : ""}`;
  return (
    <SplitButton
      size="sm"
      label={primary.id === "reopen" ? t("cases.actions.reopen.label") : copy.label}
      icon={copy.icon}
      pending={actions.busy.has(row.caseId)}
      open={open}
      onOpenChange={setOpen}
      nudgeNote={false}
      {...(row.reason.nudge ? { nudgeDays: row.reason.idleDays } : {})}
      {...(primary.command.kind === "menu" || primaryBlocked
        ? {}
        : { onPrimary: () => actions.perform(primary.command, [targetOf(row)]) })}
    >
      <MenuHeader title={row.name} status={now} dot={phaseColor(row.phase, row.status)} />
      <CaseActionMenuItems
        groups={groups}
        onSelect={(entry) => {
          setOpen(false);
          actions.perform(entry.command, [targetOf(row)]);
        }}
      />
    </SplitButton>
  );
}
