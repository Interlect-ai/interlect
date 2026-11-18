/**
 * The "Søg på nettet" switch in Brain's composer toolbar. Off by default and per
 * question: the chip shows the extra price (+1 kr.) so it is known before sending, and turning
 * it on makes the next question go through the approval card (WebApproval) first.
 */
import { Globe } from "lucide-react";
import { ComposerChip } from "@/components/ds/AiComposer";
import { WEB_CHIP_KEY } from "@/lib/brain/chat-view";
import { useT } from "@/lib/i18n/useT";

export function WebSearchChip({
  on,
  onChange,
  disabled = false,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <ComposerChip
      icon={Globe}
      active={on}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      aria-label={t(WEB_CHIP_KEY)}
      onClick={() => onChange(!on)}
    >
      {t(WEB_CHIP_KEY)}
    </ComposerChip>
  );
}
