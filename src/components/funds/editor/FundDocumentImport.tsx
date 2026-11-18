import { AiOrb } from "@/components/ai/AiOrb";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  analyzeFundDocument,
  type FundDocumentProposal,
} from "@/lib/funds/document-import.functions";
import { supabase } from "@/lib/supabase/client";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { userMessage } from "@/lib/errors/user-message";

export function FundDocumentImport({
  fundId,
  configId,
  onProposal,
  onBusyChange,
  initialFile = null,
  onInitialFileTaken,
}: {
  fundId: string;
  configId: string;
  onProposal: (proposal: FundDocumentProposal) => void;
  onBusyChange?: ((busy: boolean) => void) | undefined;
  /** A file picked with "+" on the overview: imported as soon as the step opens. */
  initialFile?: File | null | undefined;
  onInitialFileTaken?: (() => void) | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const analyze = useServerFn(analyzeFundDocument);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<string[]>([]);

  async function importFile(file: File | null) {
    if (!file || busy) return;
    if (file.type !== "application/pdf" || file.size > 25_000_000) {
      setError(t("fundEditor.import.pickPdf"));
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    setReviewNotes([]);
    setStatus(t("fundEditor.import.uploading"));
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    const storagePath = `${fundId}/fund-config/${configId}/${crypto.randomUUID()}-${safeName}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("pitch-decks")
        .upload(storagePath, file, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      setStatus(t("fundEditor.import.reading"));
      const result = await analyze({
        data: {
          fundId,
          configId,
          storagePath,
          fileName: file.name,
          sizeBytes: file.size,
        },
      });
      onProposal(result.proposal);
      setReviewNotes(result.proposal.reviewNotes);
      setStatus(t("fundEditor.import.done", { count: result.pageCount }));
    } catch (cause) {
      await supabase.storage.from("pitch-decks").remove([storagePath]);
      setStatus(null);
      setError(userMessage(cause, t("fundEditor.import.failed"), language));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  // Once per picked file, also under StrictMode's double effect.
  const taken = useRef<File | null>(null);
  const importRef = useRef(importFile);
  importRef.current = importFile;
  const takenRef = useRef(onInitialFileTaken);
  takenRef.current = onInitialFileTaken;
  useEffect(() => {
    if (!initialFile || taken.current === initialFile) return;
    taken.current = initialFile;
    takenRef.current?.();
    void importRef.current(initialFile);
  }, [initialFile]);

  return (
    <section className="flex flex-col gap-3.5">
      <label
        className={cn(
          "flex cursor-pointer items-center gap-3.5 rounded-lg p-[18px] shadow-[inset_0_0_0_1.5px_var(--line-strong)] transition-[box-shadow,background-color] duration-200 hover:bg-action-wash hover:shadow-[inset_0_0_0_1.5px_var(--action)] focus-within:shadow-[inset_0_0_0_1.5px_var(--action)]",
          busy && "pointer-events-none opacity-70",
        )}
      >
        {busy ? (
          <AiOrb size={20} tone="ai" />
        ) : (
          <FileUp className="size-5 shrink-0 text-action" aria-hidden />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-medium">
            {busy ? t("fundEditor.import.analysing") : t("fundEditor.import.title")}
          </span>
          <span className="text-meta text-ink-3">{t("fundEditor.import.hint")}</span>
        </span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            void importFile(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
      </label>
      {status && (
        <p
          role="status"
          className={cn(
            "m-0 flex items-center gap-2 text-list leading-5",
            busy ? "text-ink-2" : "text-positive",
          )}
        >
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-list leading-5 text-critical">
          {error}
        </p>
      )}
      {reviewNotes.length > 0 && (
        <details className="rounded-md bg-canvas p-3.5">
          <summary className="cursor-pointer text-list font-medium text-ink-1">
            {t("fundEditor.import.reviewNotes", { count: reviewNotes.length })}
          </summary>
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-meta leading-4 text-ink-3">
            {reviewNotes.map((note, index) => (
              <li key={`${index}-${note}`} className="border-l-2 border-warning/40 pl-2">
                {note}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
