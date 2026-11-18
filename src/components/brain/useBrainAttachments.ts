/**
 * The "+" in Brain's composer: a file goes into Brain with the same upload as Brain ·
 * Kilder (`ingest.functions.ts`): a signed URL to the private bucket, a check of the file,
 * then a human approves the reading (it uses credits, so nothing is read before the click; no
 * price is shown, P13). A file that is over the reading cap is read up to the pages that fit.
 * Read in the background by Brain's worker; the answers can use it once it is read.
 */
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  approveBrainIngest,
  completeBrainUpload,
  discardBrainUpload,
  requestBrainUpload,
} from "@/lib/brain/ingest.functions";
import { BRAIN_SOURCES_BUCKET } from "@/lib/brain/ingest/bucket";
import { useT, useLanguage } from "@/lib/i18n/useT";
import { supabase } from "@/lib/supabase/client";
import type { Language } from "@/lib/i18n/language";
import { userMessage } from "@/lib/errors/user-message";

/** What Brain · Kilder takes (the worker reads these). */
export const BRAIN_ATTACH_ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.md";

type AttachmentState =
  | { phase: "uploading" }
  | { phase: "ready"; sourceId: string; pageLimit: number | null; pages: number | null }
  | { phase: "approving"; sourceId: string; pageLimit: number | null; pages: number | null }
  | { phase: "reading" }
  | { phase: "failed"; message: string };

export type BrainAttachment = { id: string; name: string } & AttachmentState;

function messageOf(cause: unknown, fallback: string, language: Language): string {
  return userMessage(cause, fallback, language);
}

export function useBrainAttachments(fundId: string) {
  const t = useT();
  const language = useLanguage();
  const requestUpload = useServerFn(requestBrainUpload);
  const completeUpload = useServerFn(completeBrainUpload);
  const approve = useServerFn(approveBrainIngest);
  const discard = useServerFn(discardBrainUpload);
  const [items, setItems] = useState<BrainAttachment[]>([]);
  const queryClient = useQueryClient();
  // Brain · Kilder shows the new source, as after its own upload.
  const refreshSources = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ["brain-sources", fundId] }),
    [fundId, queryClient],
  );
  // A card belongs to its team: another team's file is never approved from here.
  useEffect(() => setItems([]), [fundId]);

  const patch = useCallback((id: string, next: AttachmentState) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? ({ ...next, id, name: item.name } as BrainAttachment) : item,
      ),
    );
  }, []);

  const add = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = crypto.randomUUID();
        setItems((current) => [...current, { id, name: file.name, phase: "uploading" }]);
        void (async () => {
          try {
            const ticket = await requestUpload({
              data: {
                fundId,
                fileName: file.name,
                sizeBytes: file.size,
                trustTier: "customer_doc",
              },
            });
            const { error } = await supabase.storage
              .from(BRAIN_SOURCES_BUCKET)
              .uploadToSignedUrl(
                ticket.path,
                ticket.token,
                file,
                file.type ? { contentType: file.type } : undefined,
              );
            if (error) throw new Error(t("brainKnowledge.sources.uploadFailed"));
            const result = await completeUpload({ data: { fundId, sourceId: ticket.sourceId } });
            if (result.status === "duplicate") {
              patch(id, {
                phase: "failed",
                message: t("brainKnowledge.sources.exists", { title: result.existing.title }),
              });
              return;
            }
            refreshSources();
            patch(id, {
              phase: "ready",
              sourceId: result.sourceId,
              // Sent with the approval when the file is over the reading cap.
              pageLimit: result.suggestedPages,
              // Shown: the pages that will be read (also a PDF cut at the page cap).
              pages: result.suggestedPages ?? result.pageLimit,
            });
          } catch (cause) {
            patch(id, {
              phase: "failed",
              message: messageOf(cause, t("brainKnowledge.sources.failed"), language),
            });
          }
        })();
      }
    },
    [completeUpload, fundId, patch, refreshSources, requestUpload, t],
  );

  const read = useCallback(
    async (item: BrainAttachment) => {
      if (item.phase !== "ready") return;
      const { sourceId, pageLimit, pages } = item;
      patch(item.id, { phase: "approving", sourceId, pageLimit, pages });
      try {
        await approve({
          data: { fundId, sourceId, ...(pageLimit ? { pageLimit } : {}) },
        });
        patch(item.id, { phase: "reading" });
        refreshSources();
      } catch (cause) {
        patch(item.id, {
          phase: "failed",
          message: messageOf(cause, t("brainKnowledge.sources.failed"), language),
        });
      }
    },
    [approve, fundId, patch, refreshSources, t],
  );

  /**
   * Takes the card away. An uploaded file that was never approved is not read (0 kr.), and it is
   * removed too, row and file, so it does not stay in Brain's sources for ever. A failed
   * removal is not shown: the night job removes unapproved uploads after a week.
   */
  const dismiss = useCallback(
    (id: string) => {
      const item = items.find((entry) => entry.id === id);
      setItems((current) => current.filter((entry) => entry.id !== id));
      if (item?.phase !== "ready") return;
      void discard({ data: { fundId, sourceId: item.sourceId } })
        .catch(() => {})
        .finally(refreshSources);
    },
    [discard, fundId, items, refreshSources],
  );

  return { items, add, read, dismiss };
}
