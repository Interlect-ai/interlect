/**
 * The files given to Brain from the composer's "+", inside the composer card: uploading,
 * ready to read (the reading uses credits, so it starts on "Læs ind i Brain"), being read in the
 * background, or what went wrong. No price is shown (P13).
 */
import { Check, FileText, X } from "lucide-react";
import { PendingLabel } from "@/components/ai/AiOrb";
import { Button } from "@/components/ds/Button";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import type { BrainAttachment } from "./useBrainAttachments";

export function BrainAttachmentList({
  items,
  onRead,
  onDismiss,
}: {
  items: BrainAttachment[];
  onRead: (item: BrainAttachment) => void;
  onDismiss: (id: string) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <ul
      aria-label={t("brainChat.attach.listLabel")}
      className="m-0 flex list-none flex-col gap-1.5 p-0"
    >
      {items.map((item) => (
        <li
          key={item.id}
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[14px] bg-canvas px-3 py-2"
        >
          <FileText className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 max-w-[260px] truncate text-list font-medium text-ink-1">
            {item.name}
          </span>
          <span
            role={item.phase === "failed" ? "alert" : "status"}
            className={cn(
              "min-w-0 flex-1 text-meta",
              item.phase === "failed" ? "text-critical" : "text-ink-3",
            )}
          >
            {item.phase === "uploading" && (
              <PendingLabel>{t("brainChat.attach.uploading")}</PendingLabel>
            )}
            {(item.phase === "ready" || item.phase === "approving") &&
              (item.pages
                ? t("brainChat.attach.readyPages", { pages: item.pages })
                : t("brainChat.attach.ready"))}
            {item.phase === "reading" && (
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-positive" strokeWidth={2} aria-hidden />
                {t("brainChat.attach.reading")}
              </span>
            )}
            {item.phase === "failed" && item.message}
          </span>
          {(item.phase === "ready" || item.phase === "approving") && (
            <Button
              variant="primary"
              size="sm"
              disabled={item.phase === "approving"}
              onClick={() => onRead(item)}
            >
              {item.phase === "approving" ? (
                <PendingLabel tone="ai" onDark>
                  {t("brainChat.attach.starting")}
                </PendingLabel>
              ) : (
                t("brainChat.attach.read")
              )}
            </Button>
          )}
          {item.phase !== "uploading" && item.phase !== "approving" && (
            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              aria-label={t("brainChat.attach.dismiss", { name: item.name })}
              className="grid size-7 shrink-0 place-items-center rounded-full text-ink-3 outline-none transition-colors hover:bg-hover hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
            >
              <X className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
