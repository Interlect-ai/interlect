/**
 * The case's top row, the same in Screening and Dyb analyse (Case Screening v5 line 50,
 * CaseStatus.dc.html, "Case-status" and "Split-knap"): the phase switcher, the
 * status chip and one split button with the next step. The arrow opens the status menu
 * (360 px) with the current status, the history line and every action. Status changes ask
 * why (reason chips + note) and can be undone for 5 s.
 */
import { BrainCaseButton } from "@/components/brain/BrainCasePanel";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RotateCcw } from "lucide-react";
import { MenuHeader, type MenuTone } from "@/components/ds/Menu";
import { AiMetal } from "@/components/ai/AiMetal";
import { SplitButton } from "@/components/ds/SplitButton";
import { CASE_STATUS, StatusChip } from "@/components/ds/StatusChip";
import { CaseActionMenuItems } from "@/components/cases/CaseActionMenu";
import { useCaseActions } from "@/components/cases/useCaseActions";
import { caseActionCopy } from "@/lib/cases/case-action-copy";
import {
  menuGroups,
  primaryAction,
  statusChipKey,
  type CaseActionState,
} from "@/lib/cases/case-actions";
import { getCaseStatusLine } from "@/lib/cases/transitions.functions";
import { historyText } from "@/lib/cases/status-line";
import type { CasePhase, CaseStatus } from "@/lib/cases/lifecycle";
import { casePermissions, useMyAccess } from "@/lib/auth/useMyAccess";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<ReturnType<typeof statusChipKey>, MenuTone> = {
  active: { color: "positive", wash: "positive-wash" },
  on_hold: { color: "warning", wash: "warning-wash" },
  closed: { color: "ink-3", wash: "bg-sunken" },
  invested: { color: "positive", wash: "positive-wash" },
  awaiting_decision: { color: "warning", wash: "warning-wash" },
};

export function CaseTop({
  fundId,
  caseId,
  companyName,
  phase,
  status,
  hasScreening,
  canRunDeep,
  hasDeep,
  hasFinishedDeep,
  running,
  view,
}: {
  fundId: string;
  caseId: string;
  companyName: string;
  phase: CasePhase;
  status: CaseStatus;
  hasScreening: boolean;
  /** The latest screening can be sent to a deep analysis (the server's rule). */
  canRunDeep: boolean;
  /** A deep analysis exists or is running (the Dyb analyse view has something to show). */
  hasDeep: boolean;
  /** A finished deep analysis exists (Genåbn i dyb analyse; same rule as the list). */
  hasFinishedDeep: boolean;
  running: boolean;
  view: "screening" | "deep";
}) {
  const t = useT();
  const language = useLanguage();
  const access = useMyAccess(fundId);
  const permissions = casePermissions(access.data?.capabilities);
  const actions = useCaseActions(fundId);
  const loadLine = useServerFn(getCaseStatusLine);
  const line = useQuery({
    queryKey: ["case-status-line", caseId, fundId],
    queryFn: () => loadLine({ data: { fundId, caseId } }),
    staleTime: 30_000,
  });
  const [open, setOpen] = useState(false);

  const state: CaseActionState = {
    phase,
    status,
    hasScreening,
    canRunDeep,
    hasDeep: hasFinishedDeep,
    running,
  };
  const chip = statusChipKey(phase, status);
  const primary = primaryAction(state, "top");
  const groups = menuGroups(state, permissions, "top", language);
  const primaryBlocked = primary
    ? groups.flatMap((group) => group.items).find((item) => item.id === primary.id)?.blocked
    : null;
  const copy = primary ? caseActionCopy(primary.id, language) : null;
  const target = { id: caseId, name: companyName, phase, status };
  const head =
    chip === "awaiting_decision"
      ? t("caseView.top.awaitingCommittee")
      : t(CASE_STATUS[chip].labelKey);

  return (
    <div className="flex flex-wrap items-center gap-2.5 self-start">
      <nav
        aria-label={t("caseView.top.viewLabel")}
        className="flex shrink-0 gap-0.5 rounded-pill bg-sunken p-[3px]"
      >
        <PhaseTab
          active={view === "screening"}
          caseId={caseId}
          view="screening"
          label={t("cases.phase.screening")}
        />
        <PhaseTab
          active={view === "deep"}
          caseId={caseId}
          view="deep"
          label={t("cases.phase.deep_analysis")}
          dot
          disabled={!hasDeep}
        />
      </nav>
      <StatusChip status={chip} size="md" />
      {permissions.canAct && primary && copy && (
        <AiMetal on={primary.id === "runDeepAnalysis"}>
          <SplitButton
            label={primary.id === "reopen" ? caseActionCopy("reopen", language).label : copy.label}
            icon={primary.id === "reopen" ? RotateCcw : copy.icon}
            iconColor={primary.id === "reopen" ? "var(--ink-2)" : `var(--${copy.tone.color})`}
            pending={[...actions.busy].includes(caseId)}
            menuSize="status"
            open={open}
            onOpenChange={setOpen}
            {...(primary.command.kind === "menu" || primaryBlocked
              ? {}
              : { onPrimary: () => actions.perform(primary.command, [target]) })}
          >
            <MenuHeader
              title={head}
              status={
                historyText(line.data, language) ??
                (line.isError ? t("caseView.top.historyError") : " ")
              }
              icon={CASE_STATUS[chip].icon}
              tone={STATUS_TONE[chip]}
            />
            <CaseActionMenuItems
              groups={groups}
              onSelect={(item) => {
                setOpen(false);
                actions.perform(item.command, [target]);
              }}
            />
          </SplitButton>
        </AiMetal>
      )}
      {access.isError && (
        <span role="alert" className="text-meta text-critical">
          {t("cases.list.accessError")}
        </span>
      )}
      <BrainCaseButton fundId={fundId} caseId={caseId} />
      {actions.element}
    </div>
  );
}

function PhaseTab({
  active,
  caseId,
  view,
  label,
  dot = false,
  disabled = false,
}: {
  active: boolean;
  caseId: string;
  view: "screening" | "deep";
  label: string;
  dot?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const className = cn(
    "inline-flex h-[30px] shrink-0 items-center gap-[7px] rounded-pill px-3.5 text-meta font-medium whitespace-nowrap transition-colors duration-200",
    active ? "bg-surface text-ink-1 shadow-pill" : "text-ink-3 hover:text-ink-1",
    disabled && "pointer-events-none text-ink-4",
  );
  const content = (
    <>
      {dot && !active && (
        <span
          className="size-[7px] rounded-full"
          style={{ background: disabled ? "var(--ink-4)" : "var(--ai)" }}
        />
      )}
      {label}
    </>
  );
  if (active) {
    return (
      <span className={className} aria-current="page">
        {content}
      </span>
    );
  }
  if (disabled) {
    return (
      <span className={className} aria-disabled title={t("cases.blocked.noDeepYet")}>
        {content}
      </span>
    );
  }
  return (
    <Link to="/cases/$caseId" params={{ caseId }} search={{ view }} className={className}>
      {content}
    </Link>
  );
}
