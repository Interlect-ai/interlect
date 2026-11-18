/**
 * "Hvem var det nu lige?": a compact card about a company or a person, built from
 * Brain's page for them: the overview, the key figures (computed), the fund's own
 * history (earlier cases, decisions and reasons) and open questions. Shown at the top of the case's
 * Brain panel and as a pop-up when a company or person name is clicked (Brain answers, the brain
 * map, the cases list). A written section can be corrected ("Ret") and locked ("Lås") by those who
 * may review; a change locks the section so Brain's night writer leaves it alone. Reading costs
 * nothing (no AI call). There is no prototype for this card; it follows. The text is
 * drawn as React text (SafeText), never as HTML.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock, LockOpen, Pencil } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { showToast } from "@/components/ds/Toast";
import { SafeText } from "@/components/brain/SafeText";
import { ForgetPerson } from "@/components/brain/ForgetPerson";
import { editBrainPageSection, getBrainCard } from "@/lib/brain/pages.functions";
import {
  MAX_USER_SECTION_CHARS,
  cardHeading,
  pageKindLabel,
  type BrainCard,
  type ViewSection,
} from "@/lib/brain/page-view";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { userMessage } from "@/lib/errors/user-message";
import { cn } from "@/lib/utils";

export type CardSource = { caseId: string } | { entityId: string } | { pageId: string };

const NO_CITATIONS: ReadonlySet<number> = new Set();
const cardKey = (fundId: string, source: CardSource) => ["brain-card", fundId, source] as const;
const clean = (body: string) => body.replace(/\s*\[f:[^\]\s]+\]/g, "");
const shortDate = (iso: string | null, localeTag: string) => {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(time)
    ? ""
    : new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "short" }).format(time);
};

export function BrainCardView({
  fundId,
  source,
  className,
  asked = true,
}: {
  fundId: string;
  source: CardSource;
  className?: string;
  /** Show the question "Hvem var det nu lige?" above the name (the pop-up has it as its title). */
  asked?: boolean;
}) {
  const t = useT();
  const load = useServerFn(getBrainCard);
  const query = useQuery({
    queryKey: cardKey(fundId, source),
    queryFn: () => load({ data: { fundId, ...source } }),
    retry: false,
    staleTime: 30_000,
  });
  if (query.isLoading) {
    return (
      <div
        className={cn("flex flex-col gap-2.5", className)}
        aria-busy="true"
        role="status"
        aria-label={t("brainKnowledge.card.loading")}
      >
        {[0, 1].map((key) => (
          <div key={key} className="h-16 animate-pulse rounded-[16px] bg-canvas" />
        ))}
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div
        className={cn("flex flex-col items-start gap-3 rounded-[16px] bg-canvas p-4", className)}
      >
        <p className="m-0 text-list text-ink-2">{t("brainKnowledge.card.loadError")}</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          {t("brainKnowledge.card.retry")}
        </Button>
      </div>
    );
  }
  return (
    <CardBody
      fundId={fundId}
      source={source}
      card={query.data}
      asked={asked}
      className={className}
    />
  );
}

function CardBody({
  fundId,
  source,
  card,
  asked,
  className,
}: {
  fundId: string;
  source: CardSource;
  card: BrainCard;
  asked: boolean;
  className?: string | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const kindLabel = card.kind
    ? (pageKindLabel(card.kind, language) ?? card.kindLabel)
    : card.kindLabel;
  if (card.state !== "ok" || card.sections.length === 0) {
    return (
      <div className={cn("flex flex-col gap-1 rounded-[16px] bg-canvas p-4", className)}>
        <p className="m-0 text-body font-semibold text-ink-1">{card.title}</p>
        <p className="m-0 text-list text-ink-3">
          {card.state === "unknown"
            ? t("brainKnowledge.card.unknown")
            : t("brainKnowledge.card.noPage")}
        </p>
        {card.forgetEntityId && (
          <ForgetPerson fundId={fundId} entityId={card.forgetEntityId} name={card.title} />
        )}
      </div>
    );
  }
  return (
    <section
      aria-label={t("brainKnowledge.card.askedTitle", { title: card.title })}
      className={cn("flex flex-col gap-3.5 rounded-[16px] bg-canvas p-4", className)}
    >
      <header className="flex flex-col gap-0.5">
        <p className="m-0 text-meta font-medium text-ink-3">
          {asked ? t("brainKnowledge.card.askedKind", { kind: kindLabel ?? "" }) : kindLabel}
        </p>
        <h3 className="m-0 text-[17px] leading-tight font-semibold text-balance">{card.title}</h3>
      </header>
      {card.sections.map((section) => (
        <CardSection
          key={section.key}
          fundId={fundId}
          source={source}
          card={card}
          section={section}
        />
      ))}
      <p className="m-0 text-meta text-ink-4">
        {t("brainKnowledge.card.footer", {
          date: shortDate(card.updatedAt, localeTag),
          by: card.editedByUser
            ? t("brainKnowledge.card.editedByYou")
            : t("brainKnowledge.card.writtenByBrain"),
        })}
      </p>
      {card.forgetEntityId && (
        <ForgetPerson fundId={fundId} entityId={card.forgetEntityId} name={card.title} />
      )}
    </section>
  );
}

function CardSection({
  fundId,
  source,
  card,
  section,
}: {
  fundId: string;
  source: CardSource;
  card: BrainCard;
  section: ViewSection;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const edit = useServerFn(editBrainPageSection);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.bodyMd);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);
  const save = useMutation({
    mutationFn: (input: { bodyMd?: string; lock?: boolean; note: string }) =>
      edit({ data: { fundId, pageId: card.pageId!, key: section.key, ...input } }),
    onSuccess: (result, input) => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: cardKey(fundId, source) });
      showToast({
        message: result.unchanged
          ? t("brainKnowledge.card.toastUnchanged")
          : input.bodyMd !== undefined
            ? t("brainKnowledge.card.toastSavedLocked")
            : input.lock
              ? t("brainKnowledge.card.toastLocked")
              : t("brainKnowledge.card.toastUnlocked"),
      });
    },
    onError: (error) =>
      showToast({
        message: userMessage(error, t("brainKnowledge.card.saveError"), language),
        tone: "error",
      }),
  });
  const tooLong = draft.length > MAX_USER_SECTION_CHARS;
  const heading = cardHeading(section.key, language) ?? section.heading;
  const canChange = card.canEdit && !section.computed && card.pageId !== null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="m-0 text-list font-semibold text-ink-1">{heading}</h4>
        {section.computed && (
          <span className="text-meta text-ink-4">{t("brainKnowledge.card.computed")}</span>
        )}
        {section.locked && (
          <span className="inline-flex items-center gap-1 text-meta text-ink-3">
            <Lock className="size-3" aria-hidden /> {t("brainKnowledge.card.locked")}
          </span>
        )}
        {canChange && !editing && (
          <span className="ml-auto flex gap-1">
            <Button
              variant="quiet"
              size="sm"
              icon={Pencil}
              onClick={() => {
                setDraft(section.bodyMd);
                setEditing(true);
              }}
            >
              {t("brainKnowledge.card.edit")}
            </Button>
            <Button
              variant="quiet"
              size="sm"
              icon={section.locked ? LockOpen : Lock}
              pending={save.isPending}
              onClick={() =>
                save.mutate({
                  lock: !section.locked,
                  note: section.locked
                    ? t("brainKnowledge.card.noteUnlocked")
                    : t("brainKnowledge.card.noteLocked"),
                })
              }
            >
              {section.locked ? t("brainKnowledge.card.unlock") : t("brainKnowledge.card.lock")}
            </Button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            ref={area}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={t("brainKnowledge.card.editHeading", { heading })}
            rows={Math.min(12, Math.max(4, draft.split("\n").length + 1))}
            className="w-full resize-y rounded-sm bg-surface px-3 py-2.5 text-[14px] leading-[1.6] text-ink-1 outline-none focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]"
          />
          <p className={cn("m-0 text-meta", tooLong ? "text-critical" : "text-ink-3")}>
            {tooLong
              ? t("brainKnowledge.card.tooLong", {
                  count: draft.length,
                  max: MAX_USER_SECTION_CHARS,
                })
              : t("brainKnowledge.card.saveHint")}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
              {t("brainKnowledge.card.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              pending={save.isPending}
              disabled={tooLong || !draft.trim() || draft.trim() === section.bodyMd.trim()}
              onClick={() =>
                save.mutate({ bodyMd: draft, note: t("brainKnowledge.card.noteEdited") })
              }
            >
              {t("brainKnowledge.card.saveAndLock")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-list">
          <SafeText text={clean(section.bodyMd)} citationNumbers={NO_CITATIONS} />
        </div>
      )}
    </div>
  );
}

/** The pop-up: the same card in a dialog, opened by a click on a company or person name. */
export function BrainCardDialog({
  fundId,
  source,
  onClose,
}: {
  fundId: string;
  source: CardSource | null;
  onClose: () => void;
}) {
  const t = useT();
  // Keep the last source while the dialog fades out, so the content does not vanish first.
  const last = useRef<CardSource | null>(null);
  if (source) last.current = source;
  const shown = source ?? last.current;
  return (
    <Dialog
      open={source !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("brainKnowledge.card.title")}
      description={t("brainKnowledge.card.description")}
      className="max-h-[85svh] overflow-auto"
      footer={
        <Button variant="secondary" size="md" onClick={onClose}>
          {t("brainKnowledge.card.close")}
        </Button>
      }
    >
      {shown && <BrainCardView fundId={fundId} source={shown} asked={false} />}
    </Dialog>
  );
}
