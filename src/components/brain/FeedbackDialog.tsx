/**
 * What 👎 may add (gap doc): "Forkert" (with the cited sources that were wrong) or
 * "Mangler noget", and a short comment. The 👎 itself is already saved as "wrong" when this
 * opens, so closing it loses nothing; "Gem" replaces the rating with the details.
 */
import { useState } from "react";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import {
  FEEDBACK_COMMENT_MAX,
  type BrainFeedbackDetails,
  type BrainFeedbackRating,
  type ChatCitation,
} from "@/lib/brain/chat-contract";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

type Kind = "wrong" | "incomplete";

export function FeedbackDialog({
  open,
  citations,
  displayNumbers,
  initial,
  initialDetails,
  onClose,
  onSave,
}: {
  open: boolean;
  /** The sources of the answer, numbered as in the text. */
  citations: readonly ChatCitation[];
  /** Stored source number → the number shown in the answer. */
  displayNumbers: ReadonlyMap<number, number>;
  initial: BrainFeedbackRating | null;
  /** What was saved before, so a second look does not start empty (and wipe it on "Gem"). */
  initialDetails: BrainFeedbackDetails | null;
  onClose: () => void;
  /** Resolves true when the rating is saved; the dialog stays open (with the draft) otherwise. */
  onSave: (rating: Kind, details: BrainFeedbackDetails) => Promise<boolean>;
}) {
  const t = useT();
  const [kind, setKind] = useState<Kind>(initial === "incomplete" ? "incomplete" : "wrong");
  const [picked, setPicked] = useState<ReadonlySet<number>>(
    () => new Set(initialDetails?.wrongCitationNs ?? []),
  );
  const [comment, setComment] = useState(initialDetails?.comment ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const saved = await onSave(kind, {
      wrongCitationNs: kind === "wrong" ? [...picked].sort((a, b) => a - b) : [],
      comment: comment.trim(),
    });
    setSaving(false);
    if (saved) onClose();
  };

  const toggle = (n: number) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (!next.delete(n)) next.add(n);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("brainChat.feedback.title")}
      description={t("brainChat.feedback.description")}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button variant="primary" size="md" disabled={saving} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <SegmentedControl<Kind>
        aria-label={t("brainChat.feedback.kindLabel")}
        size="sm"
        value={kind}
        onChange={setKind}
        options={[
          { value: "wrong", label: t("brainChat.feedback.wrong") },
          { value: "incomplete", label: t("brainChat.feedback.incomplete") },
        ]}
      />
      {kind === "wrong" && citations.length > 0 && (
        <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-meta text-ink-3">
            {t("brainChat.feedback.wrongSources")}
          </legend>
          {[...citations]
            .sort((a, b) => (displayNumbers.get(a.n) ?? a.n) - (displayNumbers.get(b.n) ?? b.n))
            .map((citation) => (
              <label
                key={citation.n}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-list text-ink-1",
                  "transition-colors duration-[var(--dur-quick)] hover:bg-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action",
                )}
              >
                <input
                  type="checkbox"
                  checked={picked.has(citation.n)}
                  onChange={() => toggle(citation.n)}
                  className="size-4 shrink-0 accent-[var(--action)]"
                />
                <span className="shrink-0 text-meta text-ink-3">
                  [{displayNumbers.get(citation.n) ?? citation.n}]
                </span>
                <span className="min-w-0 truncate">{citation.label}</span>
              </label>
            ))}
        </fieldset>
      )}
      <textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={FEEDBACK_COMMENT_MAX}
        rows={3}
        aria-label={t("brainChat.feedback.commentLabel")}
        placeholder={
          kind === "wrong"
            ? t("brainChat.feedback.placeholderWrong")
            : t("brainChat.feedback.placeholderIncomplete")
        }
        className="w-full resize-none rounded-[12px] bg-sunken px-3 py-2.5 text-list text-ink-1 outline-none placeholder:text-ink-4 focus-visible:ring-2 focus-visible:ring-action"
      />
    </Dialog>
  );
}
