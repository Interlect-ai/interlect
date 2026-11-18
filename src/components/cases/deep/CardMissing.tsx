/**
 * What a card on Konklusion says when there is nothing to draw (a card with a score draws its
 * criteria instead):
 *
 * - `MissingInfo`: when the analysis found nothing to draw at all, "Mangler information" over an
 *   empty chart, with "Afklar med Brain" (the Spørg Interlect panel opens with the question
 *   ready, nothing is sent until the person sends it), "Udfyld" and a small field where the team
 *   writes what it knows (saved as a note on the case, which Brain also reads) or adds a file.
 * - `EconomyNotFound`: the Økonomi card without annual reports, the same way.
 *
 * "Udfyld" opens "Ny opgave" in "Skal afklares" under the cards with a short title filled in
 * (title, assignee, due date); nothing is saved until the person creates the task. It is
 * only there for people who may manage tasks.
 *
 * Never an empty box. All sit inside a card that opens its tab, so their controls stop the click
 * from reaching the card.
 */
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ListPlus, MessageCircleQuestion, Paperclip, SearchX } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { showToast } from "@/components/ds/Toast";
import { addCaseNote } from "@/lib/cases/cases.functions";
import { CASE_FILE_ACCEPT } from "@/lib/cases/case-files";
import { requestAskOpen } from "@/lib/brain/ask";
import { userMessage } from "@/lib/errors/user-message";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { filesKey, notesKey } from "../screening/case-tab-data";
import { useCaseFileUpload } from "../screening/useCaseFileUpload";
import { EmptyChart } from "./CardFallbackCharts";

/** What "Udfyld" asks the page to put in "Ny opgave". */
export interface CardFillRequest {
  title: string;
  description: string | null;
  /** The specialist's first criterion, for "Knyt til"; null for Økonomi. */
  criterionKey: string | null;
}

/** A control inside a card: its click must not open the card's tab. */
function stop(event: MouseEvent) {
  event.stopPropagation();
}

export function AskBrainButton({ question, children }: { question: string; children?: ReactNode }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        requestAskOpen(window, question);
      }}
      className="relative z-[1] inline-flex items-center gap-1.5 text-meta font-medium text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
    >
      <MessageCircleQuestion className="size-3.5" strokeWidth={1.75} aria-hidden />
      {children ?? t("deep.cards.askBrain")}
    </button>
  );
}

/** "Udfyld": the gap becomes a task in "Skal afklares". */
export function FillButton({ onFill }: { onFill: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onFill();
      }}
      className="relative z-[1] inline-flex items-center gap-1.5 text-meta font-medium text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
    >
      <ListPlus className="size-3.5" strokeWidth={1.75} aria-hidden />
      {t("deep.cards.fill")}
    </button>
  );
}

/** The Økonomi card without annual reports: "Ikke fundet" over an empty chart, never alone. */
export function EconomyNotFound({
  question,
  onFill,
}: {
  question: string;
  onFill?: (() => void) | undefined;
}) {
  const t = useT();
  return (
    <EmptyChart bars={3}>
      <span className="flex max-w-[340px] flex-col items-center gap-2 text-center">
        <SearchX className="size-5 text-ink-4" strokeWidth={1.75} aria-hidden />
        <span className="text-list font-semibold text-ink-2">{t("deep.cards.notFound")}</span>
        <span className="line-clamp-3 text-meta leading-[1.5] text-ink-3">
          {t("deep.cards.economyNotFound")}
        </span>
        <span className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-1">
          <AskBrainButton question={question} />
          {onFill && <FillButton onFill={onFill} />}
        </span>
      </span>
    </EmptyChart>
  );
}

export function MissingInfo({
  fundId,
  caseId,
  label,
  reason,
  question,
  onFill,
}: {
  fundId: string;
  caseId: string;
  /** The specialist's name; the note starts with it. */
  label: string;
  reason: string | null;
  question: string;
  onFill?: (() => void) | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const add = useServerFn(addCaseNote);
  const upload = useCaseFileUpload(fundId, caseId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: (body: string) => add({ data: { fundId, caseId, body: `${label}: ${body}` } }),
    onSuccess: async () => {
      setDraft("");
      showToast({ message: t("deep.cards.missingSaved"), tone: "success" });
      await queryClient.invalidateQueries({ queryKey: notesKey(caseId) });
    },
    onError: (cause) =>
      showToast({
        message: userMessage(cause, t("deep.cards.missingSaveError"), language),
        tone: "error",
      }),
  });
  const send = useMutation({
    mutationFn: (file: File) => upload(file),
    onSuccess: async () => {
      showToast({ message: t("deep.cards.missingUploaded"), tone: "success" });
      await queryClient.invalidateQueries({ queryKey: filesKey(caseId, fundId) });
    },
    onError: (cause) =>
      showToast({
        message: userMessage(cause, t("deep.cards.missingUploadError"), language),
        tone: "error",
      }),
  });
  const ready = draft.trim().length > 0 && !save.isPending;
  return (
    <span
      className="relative z-[1] flex w-full max-w-[400px] cursor-default flex-col gap-3"
      onClick={stop}
    >
      <EmptyChart bars={4}>
        <span className="flex flex-col items-center gap-1.5 text-center">
          <SearchX className="size-5 text-ink-4" strokeWidth={1.75} aria-hidden />
          <span className="text-list font-semibold text-ink-2">{t("deep.cards.missingTitle")}</span>
          <span className="line-clamp-3 text-meta leading-[1.5] text-ink-3">
            {reason ?? t("deep.cards.missingHint")}
          </span>
        </span>
      </EmptyChart>
      <span className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        <AskBrainButton question={question} />
        {onFill && <FillButton onFill={onFill} />}
      </span>
      <span className="flex flex-col gap-2 rounded-lg bg-surface p-2.5 shadow-[0_0_0_1px_var(--line)]">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("deep.cards.missingPlaceholder")}
          aria-label={t("deep.cards.missingFieldLabel", { label })}
          rows={2}
          maxLength={3800}
          className="min-h-[52px] resize-none rounded-md bg-transparent px-1.5 py-1 text-[14px] leading-[1.5] text-ink-1 outline-none placeholder:text-ink-4"
        />
        <span className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={send.isPending}
            className="inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-meta font-medium text-ink-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50"
          >
            <Paperclip className="size-3.5" strokeWidth={1.75} aria-hidden />
            {send.isPending ? t("deep.cards.missingUploading") : t("deep.cards.missingUpload")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={CASE_FILE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) send.mutate(file);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!ready}
            onClick={() => save.mutate(draft.trim())}
          >
            {save.isPending ? t("deep.cards.missingSaving") : t("deep.cards.missingSave")}
          </Button>
        </span>
      </span>
    </span>
  );
}
