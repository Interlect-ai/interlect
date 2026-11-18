/**
 * Hurtig / Grundig in Brain's composer toolbar. The chip shows the choice and what a question
 * typically costs, so the price is known before sending; the menu shows the cap per question.
 */
import { useState } from "react";
import { Check, Gauge } from "lucide-react";
import { ComposerChip } from "@/components/ds/AiComposer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ds/Popover";
import type { ChatMode } from "@/lib/brain/chat-contract";
import { CHAT_MODE_CHOICES } from "@/lib/brain/chat-view";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

const ORDER: ChatMode[] = ["fast", "deep"];

export function ModeMenu({
  value,
  onChange,
  disabled = false,
}: {
  value: ChatMode;
  onChange: (value: ChatMode) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ComposerChip
          icon={Gauge}
          chevron
          active={value === "deep"}
          disabled={disabled}
          aria-label={t("brainChat.mode.label", { mode: t(CHAT_MODE_CHOICES[value].labelKey) })}
        >
          {t(CHAT_MODE_CHOICES[value].labelKey)}
        </ComposerChip>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[300px] p-1.5">
        {ORDER.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => {
              onChange(mode);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left outline-none",
              "transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action",
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-baseline justify-between gap-2 text-list text-ink-1">
                <span className="font-medium">{t(CHAT_MODE_CHOICES[mode].labelKey)}</span>
              </span>
              <span className="text-meta text-ink-3">{t(CHAT_MODE_CHOICES[mode].hintKey)}</span>
            </span>
            {value === mode && (
              <Check className="mt-0.5 size-4 shrink-0 text-ink-1" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
