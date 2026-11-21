/**
 * "Ret med AI" on one criterion (prototype Analysemetode and v0.7): the user writes the
 * focus in plain language, Interlect shows the new text (old struck through, new in bold), and
 * "Læg i kladden" / "Afvis" decide. The proposal is made against the saved draft (the editor saves
 * first), so what the diff shows is what is laid in. Admin and Lead only; Medlem uses the free-text
 * wishes under "Forslag fra teamet" (decision log).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp } from "lucide-react";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { ComposerStatus } from "@/components/ds/AiComposer";
import { showToast } from "@/components/ds/Toast";
import {
  proposeConfigChange,
  type ConfigProposalView,
} from "@/lib/funds/config-proposals.functions";
import { useT, useLanguage } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { fieldClass } from "@/components/ds/Field";
import { proposalsKey, ProposalCard, useProposalDecision } from "./proposals";
import { userMessage } from "@/lib/errors/user-message";

export function CriterionAiFix({
  configId,
  criterion,
  ensureSaved,
  onApplied,
}: {
  configId: string;
  criterion: { key: string; label: string };
  /** Saves the draft first, so the proposal is made against what the user sees. */
  ensureSaved: () => Promise<boolean>;
  /** The draft changed on the server: reload it into the editor. */
  onApplied: () => void | Promise<void>;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const propose = useServerFn(proposeConfigChange);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<ConfigProposalView | null>(null);

  const mutation = useMutation({
    mutationFn: async (instruction: string) => {
      if (!(await ensureSaved())) throw new Error(t("fundEditor.aiFix.saveFailed"));
      return propose({
        data: {
          configId,
          kind: "fix",
          // Sent to the model as input, so it stays Danish (i18n-keep).
          instruction: `Ret kriteriet "${criterion.label}" (nøgle ${criterion.key}): ${instruction}`,
        },
      });
    },
    onSuccess: async (view) => {
      setProposal(view);
      await queryClient.invalidateQueries({ queryKey: proposalsKey(configId) });
    },
    onError: (cause: Error) =>
      showToast({
        message: userMessage(cause, t("system.actionFailed"), language),
        tone: "error",
        duration: 6000,
      }),
  });
  // Laying the proposal in reloads the draft from the server, so what the user changed after the
  // proposal was made is saved first (and the server then calls the proposal out of date instead
  // of the editor silently dropping those changes).
  const decision = useProposalDecision(
    configId,
    async () => {
      setProposal(null);
      setOpen(false);
      setText("");
      await onApplied();
    },
    ensureSaved,
  );

  const canSend = text.trim().length >= 3 && !mutation.isPending;
  const send = () => {
    if (canSend) mutation.mutate(text.trim());
  };
  const close = () => {
    setOpen(false);
    setText("");
    setProposal(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="inline-flex h-[34px] cursor-pointer items-center gap-[7px] rounded-pill border-0 bg-surface px-3.5 font-[inherit] text-meta font-medium whitespace-nowrap text-ink-1 shadow-pill transition-transform active:scale-[.96]"
      >
        <InterlectMark size={11} />
        {t("fundEditor.aiFix.open")}
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2.5 rounded-md bg-surface p-3.5 shadow-raised">
      <div className="flex items-center gap-2 rounded-pill bg-canvas py-1 pr-1 pl-3.5">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
          disabled={mutation.isPending}
          aria-label={t("fundEditor.aiFix.question", { name: criterion.label })}
          placeholder={t("fundEditor.aiFix.question", { name: criterion.label })}
          className={cn(
            fieldClass,
            "h-8 flex-1 bg-transparent px-0 text-[14px] shadow-none focus:bg-transparent focus:shadow-none",
          )}
        />
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label={t("fundEditor.aiFix.send")}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-inverse text-ink-inverse transition-[opacity,transform] active:scale-90 disabled:cursor-default disabled:opacity-35"
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
      </div>
      {mutation.isPending && (
        <ComposerStatus>
          {t("fundEditor.aiFix.rewriting", { name: criterion.label })}
        </ComposerStatus>
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
          note={t("fundEditor.aiFix.note", { name: criterion.label })}
        />
      )}
      {!mutation.isPending && (
        <button
          type="button"
          onClick={close}
          className="h-[30px] cursor-pointer self-start rounded-pill border-0 bg-transparent px-2.5 font-[inherit] text-meta font-medium text-ink-3 hover:bg-hover"
        >
          {t("fundEditor.aiFix.cancel")}
        </button>
      )}
    </div>
  );
}
