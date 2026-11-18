/**
 * The source panel on the Brain page ("kildepanel til højre, som kan foldes ind"):
 * the sources of one answer as cards (label, date, the verbatim quote; never how far it can be
 * trusted). A chip in the answer selects its card; sources that have a page (a case, a note)
 * have a link to it, web sources a link out. Plain text only (the quote is data, never HTML).
 * Folding is remembered in this browser.
 */
import { useEffect, useRef } from "react";
import { ArrowUpRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { IconButton } from "@/components/ds/Button";
import type { CardSource } from "@/components/brain/BrainCard";
import type { ChatCitation } from "@/lib/brain/chat-contract";
import { citationTarget } from "@/lib/brain/chat-model";
import { safeExternalHref } from "@/lib/brain/chat-text";
import { useLocaleTag, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

export function SourcePanel({
  citations,
  displayNumbers,
  selected,
  onSelect,
  folded,
  onFold,
  onOpenHref,
  onWho,
}: {
  citations: readonly ChatCitation[];
  /** Stored source number → the number shown; the cards follow that order. */
  displayNumbers: ReadonlyMap<number, number>;
  selected: number | null;
  onSelect: (n: number | null) => void;
  folded: boolean;
  onFold: (folded: boolean) => void;
  /** Opens an internal page without a full page load (a running answer must not be cut). */
  onOpenHref: (href: string) => void;
  /** Opens "Hvem var det nu lige?" for a case's company or a cited page. */
  onWho?: ((source: CardSource) => void) | undefined;
}) {
  const t = useT();
  const shown = (n: number) => displayNumbers.get(n) ?? n;
  const localeTag = useLocaleTag();
  // Folding swaps the focused button: keep the keyboard reader on the control that took its place.
  const toggle = useRef<HTMLButtonElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else toggle.current?.focus();
  }, [folded]);
  if (folded) {
    return (
      <aside
        aria-label={t("brainChat.sources.title")}
        className="flex w-12 shrink-0 flex-col items-center border-l border-line pt-3"
      >
        <IconButton
          ref={toggle}
          icon={PanelRightOpen}
          size={32}
          aria-label={t("brainChat.sources.show")}
          title={t("brainChat.sources.show")}
          onClick={() => onFold(false)}
          className="bg-transparent text-ink-3 shadow-none hover:bg-hover"
        />
      </aside>
    );
  }
  return (
    <aside
      aria-label={t("brainChat.sources.title")}
      className="flex w-[320px] shrink-0 flex-col border-l border-line max-lg:w-[280px]"
    >
      <header className="flex shrink-0 items-center gap-2 py-3 pr-3 pl-5">
        <span className="min-w-0 flex-1 text-[15px] font-semibold">
          {t("brainChat.sources.title")}
        </span>
        <span className="text-meta text-ink-3">{citations.length}</span>
        <IconButton
          ref={toggle}
          icon={PanelRightClose}
          size={32}
          aria-label={t("brainChat.sources.fold")}
          title={t("brainChat.sources.foldShort")}
          onClick={() => onFold(true)}
          className="bg-transparent text-ink-3 shadow-none hover:bg-hover"
        />
      </header>
      <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto p-0 px-3 pb-4">
        {[...citations]
          .sort((a, b) => shown(a.n) - shown(b.n))
          .map((citation) => {
            const target = citationTarget(citation);
            const label = target.deleted ? t("brainChat.sources.deleted") : target.label;
            const open = selected === citation.n;
            const external = citation.kind === "web" ? safeExternalHref(citation.ref) : null;
            return (
              <li key={citation.n}>
                <div
                  className={cn(
                    "flex flex-col gap-1.5 rounded-[14px] px-3 py-2.5 transition-colors duration-[var(--dur-quick)]",
                    open ? "bg-ai-wash" : "bg-canvas hover:bg-hover",
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={t("brainChat.sources.sourceLabel", { n: shown(citation.n), label })}
                    onClick={() => onSelect(open ? null : citation.n)}
                    className="flex min-w-0 items-baseline gap-2 rounded-[8px] text-left outline-none focus-visible:ring-2 focus-visible:ring-action"
                  >
                    <span className="shrink-0 text-meta text-ink-3">[{shown(citation.n)}]</span>
                    <span className="min-w-0 flex-1 text-list font-medium break-words text-ink-1">
                      {label}
                    </span>
                  </button>
                  {citation.quote && !target.deleted && (
                    <blockquote
                      className={cn(
                        "m-0 border-l-2 border-line-strong pl-3 text-meta break-words whitespace-pre-line text-ink-2",
                        !open && "line-clamp-2",
                      )}
                    >
                      {citation.quote}
                    </blockquote>
                  )}
                  {open && citation.at && !target.deleted && (
                    <span className="text-micro text-ink-3">
                      {new Date(citation.at).toLocaleDateString(localeTag, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  )}
                  {open &&
                    onWho &&
                    !target.deleted &&
                    (citation.kind === "case" || citation.kind === "page") && (
                      <button
                        type="button"
                        onClick={() =>
                          onWho(
                            citation.kind === "case"
                              ? { caseId: citation.id }
                              : { pageId: citation.id },
                          )
                        }
                        className="inline-flex cursor-pointer items-center self-start rounded-[6px] border-0 bg-transparent p-0 text-meta font-medium text-ink-1 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-action"
                      >
                        {t("brainChat.sources.who")}
                      </button>
                    )}
                  {open && !target.deleted && !citation.quote && !target.href && !external && (
                    <span className="text-micro text-ink-3">{t("brainChat.sources.noQuote")}</span>
                  )}
                  {open && target.href && !external && (
                    <a
                      href={target.href}
                      onClick={(event) => {
                        if (
                          event.button === 0 &&
                          !event.metaKey &&
                          !event.ctrlKey &&
                          !event.shiftKey &&
                          !event.altKey
                        ) {
                          event.preventDefault();
                          onOpenHref(target.href!);
                        }
                      }}
                      className="inline-flex items-center gap-1 self-start rounded-[6px] text-meta font-medium text-ink-1 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-action"
                    >
                      {t("brainChat.sources.openSource")}
                      <ArrowUpRight className="size-3.5" strokeWidth={1.75} aria-hidden />
                    </a>
                  )}
                  {open && external && (
                    <a
                      href={external}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 self-start rounded-[6px] text-meta font-medium text-ink-1 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-action"
                    >
                      {t("brainChat.sources.openWebsite")}
                      <ArrowUpRight className="size-3.5" strokeWidth={1.75} aria-hidden />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
      </ul>
    </aside>
  );
}
