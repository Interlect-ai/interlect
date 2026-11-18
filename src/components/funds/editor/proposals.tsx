/**
 * AI proposals for a draft ("Ret med AI", "Lad Interlect hjælpe med tesen") shown the way the
 * prototype does: the summary, one row per change with the old value struck through and the new
 * one in bold, and "Læg i kladden" / "Afvis". The changes are worked out in code from the draft
 * before and after the proposal's edits (`fieldChanges`), never written by the model. Nothing
 * reaches the draft before a human lays it in, and nothing reaches an analysis before the draft
 * is published. Only Admin and Lead can decide (the server checks it too).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { showToast } from "@/components/ds/Toast";
import {
  applyConfigProposal,
  listConfigProposals,
  rejectConfigProposal,
  type ConfigProposalView,
} from "@/lib/funds/config-proposals.functions";
import type { FieldChange } from "@/lib/funds/proposal-changes";
import { translate } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { userMessage } from "@/lib/errors/user-message";

export const proposalsKey = (configId: string) => ["config-proposals", configId] as const;
/** Matches every running "Læg i kladden", whatever the draft (the buttons that open the editor). */
export const anyProposalApplyKey = ["config-proposal-apply"] as const;
/** Marks a running "Læg i kladden", so the editor can hold its fields still until the reload. */
export const proposalApplyKey = (configId: string) => [...anyProposalApplyKey, configId] as const;

/** The proposals against a draft; every role may read them. */
export function useConfigProposals(configId: string | null | undefined) {
  const list = useServerFn(listConfigProposals);
  return useQuery({
    queryKey: proposalsKey(configId ?? "none"),
    queryFn: () => list({ data: { configId: configId! } }),
    enabled: Boolean(configId),
    staleTime: 10_000,
  });
}

/** Lays a proposal into the draft or rejects it; both refresh the list and report to the caller. */
export function useProposalDecision(
  configId: string,
  onApplied?: () => void | Promise<void>,
  /** Runs before a proposal is laid in (the editor saves its unsaved changes first); false stops it. */
  beforeApply?: (() => Promise<boolean>) | undefined,
) {
  const language = useLanguage();
  const queryClient = useQueryClient();
  const apply = useServerFn(applyConfigProposal);
  const reject = useServerFn(rejectConfigProposal);
  const refresh = () => queryClient.invalidateQueries({ queryKey: proposalsKey(configId) });
  const applyMutation = useMutation({
    mutationKey: proposalApplyKey(configId),
    mutationFn: async (proposalId: string) => {
      if (beforeApply && !(await beforeApply())) {
        throw new Error(translate(language, "fundEditor.proposals.notAppliedSaveFirst"));
      }
      return apply({ data: { proposalId } });
    },
    onSuccess: async () => {
      await refresh();
      showToast({ message: translate(language, "fundEditor.proposals.applied") });
      await onApplied?.();
    },
    onError: async (cause: Error) => {
      await refresh();
      showToast({
        message: userMessage(cause, translate(language, "system.actionFailed"), language),
        tone: "error",
        duration: 6000,
      });
    },
  });
  const rejectMutation = useMutation({
    mutationFn: (proposalId: string) => reject({ data: { proposalId } }),
    onSuccess: async () => {
      await refresh();
      showToast({ message: translate(language, "fundEditor.proposals.rejected") });
    },
    onError: async (cause: Error) => {
      await refresh();
      showToast({
        message: userMessage(cause, translate(language, "system.actionFailed"), language),
        tone: "error",
        duration: 6000,
      });
    },
  });
  return {
    apply: (proposalId: string) => applyMutation.mutate(proposalId),
    reject: (proposalId: string) => rejectMutation.mutate(proposalId),
    busy: applyMutation.isPending || rejectMutation.isPending,
    applying: applyMutation.isPending ? applyMutation.variables : null,
  };
}

/** One row of the diff: label, the old value struck through, the new one in bold. */
export function ChangeRow({ change, first }: { change: FieldChange; first: boolean }) {
  const t = useT();
  const removed = change.after === null;
  const added = change.before === null;
  const dot = added ? "var(--positive)" : removed ? "var(--critical)" : "var(--ai)";
  if (change.long) {
    return (
      <div className={cn("flex flex-col gap-1.5 px-4 py-3", !first && "border-t border-line")}>
        <span className="flex items-center gap-3 text-[14px] font-medium">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: dot }} />
          {change.label}
        </span>
        {change.before !== null && (
          <p className="m-0 pl-5 text-[14px] leading-[1.55] text-ink-4 line-through">
            {change.before}
          </p>
        )}
        {change.after !== null ? (
          <p className="m-0 pl-5 text-[14px] leading-[1.55] font-semibold text-ink-1">
            {change.after}
          </p>
        ) : (
          <p className="m-0 pl-5 text-[14px] text-ink-3">{t("fundEditor.proposals.removed")}</p>
        )}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "grid min-h-[46px] grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-1.5",
        !first && "border-t border-line",
      )}
    >
      <span aria-hidden className="size-2 rounded-full" style={{ background: dot }} />
      <span className="min-w-0 text-[14px]">{change.label}</span>
      <span className="text-[14px] whitespace-nowrap">
        {change.before !== null && <span className="text-ink-4 line-through">{change.before}</span>}
        {change.before !== null && change.after !== null && "  "}
        {change.after !== null ? (
          <span className="font-semibold">{change.after}</span>
        ) : (
          <span className="text-ink-3">{t("fundEditor.proposals.removed")}</span>
        )}
      </span>
    </div>
  );
}

export function ProposalCard({
  proposal,
  canDecide,
  busy,
  applying,
  onApply,
  onReject,
  onRejectLabel,
  note,
}: {
  proposal: ConfigProposalView;
  canDecide: boolean;
  busy: boolean;
  applying: boolean;
  onApply: () => void;
  onReject: () => void;
  onRejectLabel?: string;
  /** A line under the diff, e.g. what follows from the change. */
  note?: string;
}) {
  const t = useT();
  const stale = proposal.status === "stale";
  return (
    <article
      aria-label={t("fundEditor.proposals.title")}
      className="flex w-full flex-col gap-3.5 rounded-lg bg-surface p-[18px] shadow-card"
    >
      <p className="m-0 text-[15px] leading-[1.6]">{proposal.summary}</p>
      {proposal.fieldChanges.length > 0 ? (
        <div className="overflow-hidden rounded-md bg-surface shadow-[inset_0_0_0_1px_var(--line)]">
          {proposal.fieldChanges.map((change, index) => (
            <ChangeRow key={change.id} change={change} first={index === 0} />
          ))}
        </div>
      ) : (
        proposal.diff.length > 0 && (
          <ul className="m-0 grid list-none gap-1 p-0 text-[14px] text-ink-2">
            {proposal.diff.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )
      )}
      {note && <p className="m-0 text-meta text-ink-3">{note}</p>}
      {proposal.limitViolations.length > 0 && (
        <div className="flex gap-2.5 rounded-md bg-warning-wash p-3 text-list text-ink-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="m-0 font-medium text-ink-1">{t("fundEditor.proposals.limitsWarning")}</p>
            <ul className="m-0 mt-1 list-disc pl-5">
              {proposal.limitViolations.map((violation) => (
                <li key={`${violation.code}-${violation.key ?? ""}`}>{violation.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {stale ? (
        <p className="m-0 text-list text-ink-3">{t("fundEditor.proposals.stale")}</p>
      ) : canDecide ? (
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={onApply}
            disabled={busy}
            pending={applying}
            pendingLabel={t("fundEditor.proposals.applying")}
          >
            {t("fundEditor.proposals.apply")}
          </Button>
          <Button variant="quiet" size="md" onClick={onReject} disabled={busy}>
            {onRejectLabel ?? t("fundEditor.proposals.reject")}
          </Button>
        </div>
      ) : (
        <p className="m-0 text-list text-ink-3">{t("fundEditor.proposals.leadOnly")}</p>
      )}
    </article>
  );
}

/** The open proposals against the draft (and out-of-date ones, marked), newest first. */
export function ProposalsPanel({
  configId,
  onApplied,
  title,
  excludeId,
  beforeApply,
}: {
  configId: string;
  onApplied?: () => void | Promise<void>;
  beforeApply?: (() => Promise<boolean>) | undefined;
  title?: string;
  /** A proposal shown elsewhere (the one just made inline) is left out here. */
  excludeId?: string | null;
}) {
  const t = useT();
  const heading = title ?? t("fundEditor.proposals.title");
  const query = useConfigProposals(configId);
  const decision = useProposalDecision(configId, onApplied, beforeApply);
  const [showStale, setShowStale] = useState(false);
  const proposals = (query.data?.proposals ?? []).filter(
    (proposal) =>
      proposal.id !== excludeId && proposal.status !== "applied" && proposal.status !== "rejected",
  );
  const open = proposals.filter((proposal) => proposal.status === "open");
  const stale = proposals.filter((proposal) => proposal.status === "stale");
  if (!query.data || proposals.length === 0) return null;
  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      {open.length > 0 && (
        <h3 className="m-0 text-section font-semibold">
          {heading}
          <span className="ml-2 text-list font-normal text-ink-3 tabular-nums">{open.length}</span>
        </h3>
      )}
      {open.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          canDecide={query.data.canDecide}
          busy={decision.busy}
          applying={decision.applying === proposal.id}
          onApply={() => decision.apply(proposal.id)}
          onReject={() => decision.reject(proposal.id)}
        />
      ))}
      {stale.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-expanded={showStale}
            onClick={() => setShowStale((value) => !value)}
            className="cursor-pointer self-start border-0 bg-transparent p-0 font-[inherit] text-meta text-ink-3 hover:text-ink-1"
          >
            {showStale
              ? t("fundEditor.proposals.hideStale")
              : t("fundEditor.proposals.showStale", { count: stale.length })}
          </button>
          <Collapse open={showStale} className="flex flex-col gap-3">
            {stale.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                canDecide={false}
                busy={false}
                applying={false}
                onApply={() => undefined}
                onReject={() => undefined}
              />
            ))}
          </Collapse>
        </div>
      )}
    </section>
  );
}
