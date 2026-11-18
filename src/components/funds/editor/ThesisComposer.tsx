/**
 * "Lad Interlect hjælpe med tesen" on the Se page (prototype Fondsopsaetning v2): the big composer,
 * a focus chip, and below it the proposal as a diff with "Læg i kladden" / "Afvis". Admin and Lead
 * only (Medlem uses the free-text wishes under "Forslag fra teamet"). A proposal needs a draft, so
 * the first send makes one (the active version stays untouched). The microphone is not shown: there
 * is nothing behind it. The + opens the editing flow's first step, where a document (LPA, PPM, thesis)
 * is read into the draft with page references.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleCheck, SlidersHorizontal } from "lucide-react";
import { AiComposer, ComposerChip, ComposerStatus } from "@/components/ds/AiComposer";
import { Button } from "@/components/ds/Button";
import { showToast } from "@/components/ds/Toast";
import {
  proposeConfigChange,
  type ConfigProposalView,
} from "@/lib/funds/config-proposals.functions";
import { useT, useLanguage } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { proposalsKey, ProposalCard, ProposalsPanel, useProposalDecision } from "./proposals";
import { userMessage } from "@/lib/errors/user-message";

const EXAMPLE_KEYS = [
  "fundEditor.composer.example1",
  "fundEditor.composer.example2",
  "fundEditor.composer.example3",
  "fundEditor.composer.example4",
  "fundEditor.composer.example5",
] as const;

export function ThesisComposer({
  draftId,
  draftVersion,
  criteria,
  ensureDraft,
  onAttach,
  onFiles,
  onReview,
  onDraftChanged,
  beforeApply,
  showPanel = true,
  onProposalShown,
}: {
  /** The draft's id, or null when none exists yet (the first send makes one). */
  draftId: string | null;
  draftVersion: number | null;
  criteria: Array<{ key: string; label: string }>;
  ensureDraft: () => Promise<string>;
  /** "+" opens the document import; left out where the import already stands below (editor). */
  onAttach?: (() => void) | undefined;
  /** "+" picks a PDF (LPA, PPM, thesis) and hands it to the document import. */
  onFiles?: ((files: File[]) => void) | undefined;
  /** "Gennemse kladde": opens the editing flow on the last step. */
  onReview: () => void;
  /** The draft changed (a proposal was laid in): refresh what shows it; rejects if it could not. */
  onDraftChanged: () => void | Promise<void>;
  /** Runs before a proposal is laid in (the editor saves unsaved edits); false stops it. */
  beforeApply?: (() => Promise<boolean>) | undefined;
  /** False where the page has its own proposals panel (the editor), so none shows twice. */
  showPanel?: boolean | undefined;
  /** The proposal shown inline, so the page's own panel can leave it out. */
  onProposalShown?: ((id: string | null) => void) | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const propose = useServerFn(proposeConfigChange);
  const [text, setText] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);
  const [proposal, setProposal] = useState<ConfigProposalView | null>(null);
  const [proposalConfigId, setProposalConfigId] = useState<string | null>(null);
  const [applied, setApplied] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: async (instruction: string) => {
      const configId = await ensureDraft();
      const view = await propose({ data: { configId, kind: "thesis", instruction } });
      return { configId, view };
    },
    onSuccess: async ({ configId, view }) => {
      setProposal(view);
      setProposalConfigId(configId);
      setApplied(null);
      setText("");
      await queryClient.invalidateQueries({ queryKey: proposalsKey(configId) });
    },
    onError: (cause: Error) =>
      showToast({
        message: userMessage(cause, t("system.actionFailed"), language),
        tone: "error",
        duration: 6000,
      }),
  });

  // The changed draft is fetched BEFORE "Gennemse kladde" is offered: opened on the old copy,
  // the editor would publish it over the proposal just laid in (found, flow 5). When the
  // fetch fails, the button is not offered and the toast says so.
  const afterApplied = async () => {
    try {
      await onDraftChanged();
      setApplied(draftVersion);
    } catch (cause) {
      console.error("[fund-config] fetch after a proposal was laid in", cause);
      setApplied(null);
      showToast({ message: t("fundEditor.composer.reloadFailed"), tone: "error", duration: 8000 });
    }
  };
  const decision = useProposalDecision(
    proposalConfigId ?? draftId ?? "none",
    async () => {
      await afterApplied();
      setProposal(null);
    },
    beforeApply,
  );
  const shownId = proposal?.id ?? null;
  useEffect(() => onProposalShown?.(shownId), [onProposalShown, shownId]);

  const send = (value: string) => {
    // Sent to the model as input, so it stays Danish (data, not interface text).
    const instruction = focus ? `Fokus: ${focus}. ${value}` : value;
    mutation.mutate(instruction);
  };

  const activeConfigId = proposalConfigId ?? draftId;
  return (
    <div className="flex flex-col items-center gap-3.5">
      <AiComposer
        variant="fund"
        // Fondsopsaetning v2: the composer stands on the Velaris ground.
        velaris
        className="w-full"
        heading={t("fundEditor.composer.heading")}
        label={t("fundEditor.composer.label")}
        value={text}
        onChange={setText}
        onSend={send}
        placeholder={EXAMPLE_KEYS.map((key) => t(key))}
        busy={mutation.isPending}
        onAttach={onAttach}
        onFiles={onFiles}
        accept="application/pdf,.pdf"
        attachLabel={t("fundEditor.composer.attach")}
        context={
          <ComposerChip
            look="fund"
            icon={SlidersHorizontal}
            active={focus !== null}
            aria-expanded={focusOpen}
            onClick={() => setFocusOpen((open) => !open)}
          >
            {focus ?? t("fundEditor.composer.focus")}
          </ComposerChip>
        }
        below={
          <div className="flex w-full max-w-[720px] flex-col items-stretch gap-3.5">
            {mutation.isPending && (
              <ComposerStatus>{t("fundEditor.composer.reviewing")}</ComposerStatus>
            )}
            {proposal && (
              <ProposalCard
                proposal={proposal}
                canDecide
                busy={decision.busy}
                applying={decision.applying === proposal.id}
                onApply={() => decision.apply(proposal.id)}
                onReject={() => {
                  decision.reject(proposal.id);
                  setProposal(null);
                }}
              />
            )}
            {applied !== null && !proposal && (
              <div role="status" className="flex items-center gap-2.5 text-[14px] text-ink-1">
                <CircleCheck className="size-4 text-positive" aria-hidden />
                {t("fundEditor.composer.applied", { version: applied })}
                <Button variant="secondary" size="sm" className="ml-auto" onClick={onReview}>
                  {t("fundEditor.composer.review")}
                </Button>
              </div>
            )}
          </div>
        }
      >
        {focusOpen && (
          <div
            className="flex flex-wrap gap-1.5 pt-1"
            role="group"
            aria-label={t("fundEditor.composer.focus")}
          >
            {[null, ...criteria.map((criterion) => criterion.label)].map((label) => {
              const selected = focus === label;
              return (
                <button
                  key={label ?? "alle"}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setFocus(label);
                    setFocusOpen(false);
                  }}
                  className={cn(
                    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[10px] border-0 px-3 font-[inherit] text-meta transition-colors duration-200",
                    selected
                      ? "bg-inverse text-ink-inverse"
                      : "bg-canvas text-ink-2 hover:bg-hover",
                  )}
                >
                  {label ?? t("fundEditor.composer.wholeThesis")}
                </button>
              );
            })}
          </div>
        )}
      </AiComposer>
      {showPanel && activeConfigId && (
        <div className="w-full max-w-[720px]">
          <ProposalsPanel
            configId={activeConfigId}
            excludeId={proposal?.id ?? null}
            onApplied={afterApplied}
            beforeApply={beforeApply}
          />
        </div>
      )}
    </div>
  );
}
