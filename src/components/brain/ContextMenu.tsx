/**
 * The @ context chip in Brain's composer (Interlect Brain: "Alle cases", a case, "Tesen").
 * Choosing sets what the NEXT question is asked about (`caseId` / `entityIds` / `scope` in the
 * request). Search is injected, so the Admin test page needs no database. Only this fund's own
 * cases and entities are ever offered; nothing is invented.
 */
import { useEffect, useRef, useState } from "react";
import { AtSign, Building2, Check, Layers, Quote, User } from "lucide-react";
import { ComposerChip } from "@/components/ds/AiComposer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ds/Popover";
import type { BrainMention } from "@/lib/brain/chat.functions";
import { ALL_CASES, contextLabel, sameContext, type BrainContext } from "@/lib/brain/chat-view";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

export function ContextMenu({
  value,
  onChange,
  search,
  disabled = false,
}: {
  value: BrainContext;
  onChange: (value: BrainContext) => void;
  /** Cases and entities matching the text; leave out to offer only the fixed choices. */
  search?: ((query: string) => Promise<BrainMention[]>) | undefined;
  disabled?: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrainMention[]>([]);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !search) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        search(query.trim())
          .then((found) => {
            if (cancelled) return;
            setResults(found);
            setFailed(false);
          })
          .catch(() => {
            if (cancelled) return;
            setResults([]);
            setFailed(true);
          });
      },
      query ? 200 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, search]);

  const choose = (next: BrainContext) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  const fixed: { context: BrainContext; icon: typeof Layers; label: string }[] = [
    { context: ALL_CASES, icon: Layers, label: t("brainChat.context.allCases") },
    { context: { kind: "thesis" }, icon: Quote, label: t("brainChat.context.thesis") },
  ];
  // A company that already is a case is offered once (as the case).
  const caseLabels = new Set(
    results.filter((r) => r.kind === "case").map((r) => r.label.toLowerCase()),
  );
  const found = results.filter((r) => r.kind === "case" || !caseLabels.has(r.label.toLowerCase()));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTimeout(() => inputRef.current?.focus(), 0);
      }}
    >
      <PopoverTrigger asChild>
        <ComposerChip
          icon={AtSign}
          chevron
          active={value.kind !== "cases"}
          disabled={disabled}
          aria-label={t("brainChat.context.label", { context: contextLabel(value, language) })}
        >
          {contextLabel(value, language)}
        </ComposerChip>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[280px] p-1.5">
        {fixed.map(({ context, icon: Icon, label }) => (
          <Row
            key={label}
            icon={<Icon className="size-4 text-ink-3" strokeWidth={1.75} aria-hidden />}
            label={label}
            checked={sameContext(value, context)}
            onClick={() => choose(context)}
          />
        ))}
        {search && (
          <>
            <div className="mx-1 my-1.5 h-px bg-line" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("brainChat.context.searchPlaceholder")}
              aria-label={t("brainChat.context.searchPlaceholder")}
              maxLength={80}
              className="mb-1 h-9 w-full rounded-[10px] bg-sunken px-3 text-list text-ink-1 outline-none placeholder:text-ink-4 focus-visible:ring-2 focus-visible:ring-action"
            />
            <div className="flex max-h-[220px] flex-col overflow-auto">
              {found.map((mention) => {
                const context: BrainContext =
                  mention.kind === "case"
                    ? { kind: "case", id: mention.id, label: mention.label }
                    : { kind: "entity", id: mention.id, label: mention.label };
                return (
                  <Row
                    key={`${mention.kind}:${mention.id}`}
                    icon={
                      mention.kind === "case" ? (
                        <Building2 className="size-4 text-ink-3" strokeWidth={1.75} aria-hidden />
                      ) : (
                        <User className="size-4 text-ink-3" strokeWidth={1.75} aria-hidden />
                      )
                    }
                    label={mention.label}
                    checked={sameContext(value, context)}
                    onClick={() => choose(context)}
                  />
                );
              })}
              {found.length === 0 && (
                <p className="m-0 px-2.5 py-2 text-meta text-ink-3">
                  {failed ? t("brainChat.context.searchFailed") : t("brainChat.context.noneFound")}
                </p>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Row({
  icon,
  label,
  checked,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-list text-ink-1 outline-none",
        "transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked && <Check className="size-4 shrink-0 text-ink-1" strokeWidth={1.75} aria-hidden />}
    </button>
  );
}
