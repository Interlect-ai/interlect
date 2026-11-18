import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { textareaClass } from "@/components/funds/editor/fields";
import { proposeCriterionDescription } from "@/lib/funds/criterion-assist.functions";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { userMessage } from "@/lib/errors/user-message";
import { cn } from "@/lib/utils";

type Criterion = SaveFundConfigInput["criteria"][number];

/**
 * "Hjælp mig" for ét analysekriterium: brugeren skriver stikord, AI'en foreslår en uddybet
 * beskrivelse, og kun et klik på "Brug forslaget" lægger den i kladden. Beskrivelsen er den tekst,
 * analyserne faktisk læser. (Et konkret ønske om at rette teksten, med diff, er "Ret med AI".)
 */
export function CriterionAssist({
  fundId,
  criterion,
  fund,
  onAccept,
}: {
  fundId: string;
  criterion: Criterion;
  fund: Pick<SaveFundConfigInput, "thesis" | "stages" | "sectors" | "geographies" | "riskPosture">;
  onAccept: (description: string) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const propose = useServerFn(proposeCriterionDescription);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [proposal, setProposal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canGenerate =
    criterion.label.trim().length > 0 &&
    (notes.trim().length > 0 || criterion.description.trim().length > 0);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const result = await propose({
        data: {
          fundId,
          label: criterion.label.trim(),
          category: criterion.category,
          description: criterion.description.trim(),
          notes: notes.trim(),
          thesis: fund.thesis,
          stages: fund.stages,
          sectors: fund.sectors,
          geographies: fund.geographies,
          riskPosture: fund.riskPosture,
        },
      });
      setProposal(result.description);
    } catch (cause) {
      setError(userMessage(cause, t("fundSetup.assist.failed"), language));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setNotes("");
    setProposal(null);
    setError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-[34px] cursor-pointer items-center gap-[7px] rounded-pill border-0 bg-transparent px-3 font-[inherit] text-meta font-medium whitespace-nowrap text-ink-2 transition-colors hover:bg-hover"
      >
        <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden />
        {t("fundSetup.assist.help")}
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2.5 rounded-md bg-surface p-3.5 shadow-raised">
      <label className="flex flex-col gap-1.5 text-meta text-ink-3">
        {t("fundSetup.assist.prompt")}
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className={cn(textareaClass, "min-h-[72px]")}
          placeholder={t("fundSetup.assist.placeholder")}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !canGenerate}
          pending={busy ? "ai" : false}
          pendingLabel={t("fundSetup.assist.elaborating")}
          onClick={() => void generate()}
        >
          {proposal ? t("common.retry") : t("fundSetup.assist.elaborate")}
        </Button>
        <Button size="sm" variant="quiet" disabled={busy} onClick={close}>
          {t("common.close")}
        </Button>
      </div>
      {!canGenerate && !busy && (
        <p className="m-0 text-meta text-ink-3">{t("fundSetup.assist.needInput")}</p>
      )}
      {error && (
        <p role="alert" className="m-0 text-meta text-critical">
          {error}
        </p>
      )}
      {proposal && (
        <div className="flex flex-col gap-2 border-t border-line pt-2.5">
          <p className="m-0 text-[14px] leading-[1.55] whitespace-pre-line text-ink-1">
            {proposal}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onAccept(proposal);
                close();
              }}
            >
              {t("fundSetup.assist.accept")}
            </Button>
            <span className="text-meta text-ink-3">{t("fundSetup.assist.acceptNote")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
