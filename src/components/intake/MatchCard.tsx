/**
 * One candidate in the Find step (prototype "Opret case.dc.html", `matches`): a button row
 * with a 44 px neutral company tile, name 16/600 with "Bedste match" (11/600 coral ink), a 12 px meta
 * line (website, registration, city, founded) and the match signals ("Matcher navn" ...) with a
 * green check, and a 24 px selection circle. The chosen card is lifted (surface, 1.5 px ink
 * ring, card shadow); hover raises it 2 px. Cards rise in with a 70 ms stagger.
 *
 * Only real data is shown: registration, city and founding year appear when the register gave
 * them; a candidate from a web search shows its country and the checked website only.
 */
import { motion, useReducedMotion } from "motion/react";
import { Building2, Check } from "lucide-react";
import { EASE, SPRING } from "@/lib/motion";
import type { CompanyCandidate, MatchSignalKey } from "@/lib/analysis/identity-resolve";
import { registryNumberLabel } from "@/lib/analysis/registries/types";
import { candidateMeta } from "./candidate-format";
import { cn } from "@/lib/utils";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";

const SIGNAL_LABEL: Record<MatchSignalKey, MessageKey> = {
  name: "intake.match.signalName",
  website: "intake.match.signalWebsite",
  cvr: "intake.match.signalCvr",
};
const SIGNAL_ORDER: MatchSignalKey[] = ["name", "website", "cvr"];

export function MatchCard({
  candidate,
  index,
  selected,
  best,
  tabIndex,
  onSelect,
}: {
  candidate: CompanyCandidate;
  index: number;
  selected: boolean;
  best: boolean;
  /** Roving tabindex: only one card of the group is in the tab order. */
  tabIndex: 0 | -1;
  onSelect: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const signals = SIGNAL_ORDER.filter((key) => candidate.matches.includes(key));
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      data-candidate-id={candidate.id}
      onClick={onSelect}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced ? { duration: 0.12 } : { duration: 0.42, ease: EASE.out, delay: index * 0.07 }
      }
      {...(reduced ? {} : { whileHover: { y: -2 } })}
      className={cn(
        "grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 rounded-lg px-[18px] py-4 text-left outline-none transition-[background-color,box-shadow] duration-[220ms] focus-visible:ring-2 focus-visible:ring-action",
        selected
          ? "bg-surface shadow-[inset_0_0_0_1.5px_var(--ink-1),var(--shadow-card)]"
          : "bg-canvas",
      )}
    >
      {/* A neutral company glyph: design rules forbid initial circles as logos. */}
      <span className="grid size-11 place-items-center rounded-xl bg-sunken text-ink-3" aria-hidden>
        <Building2 className="size-5" strokeWidth={1.5} />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="text-[16px] font-semibold text-ink-1">{candidate.name}</span>
          {best && (
            <span className="text-micro font-semibold text-ai-ink">{t("intake.match.best")}</span>
          )}
          {candidate.inactive && (
            <span className="text-micro font-semibold text-warning">
              {t("intake.match.inactive")}
            </span>
          )}
          {!candidate.inactive && candidate.assessment.status === "uncertain" && (
            <span className="text-micro font-semibold text-warning">
              {t("intake.match.uncertain")}
            </span>
          )}
        </span>
        <span className="truncate text-meta text-ink-3">{candidateMeta(candidate, language)}</span>
        {signals.length > 0 && (
          <span className="flex flex-wrap gap-3">
            {signals.map((key) => (
              <span key={key} className="inline-flex items-center gap-[5px] text-micro text-ink-2">
                <Check className="size-[11px] text-positive" strokeWidth={2.5} aria-hidden />
                {key === "cvr" && candidate.registryCountry && candidate.registryCountry !== "DK"
                  ? t("intake.match.signalNumber", {
                      label: registryNumberLabel(candidate.registryCountry),
                    })
                  : t(SIGNAL_LABEL[key])}
              </span>
            ))}
          </span>
        )}
      </span>
      <motion.span
        className={cn(
          "grid size-6 place-items-center rounded-full text-white transition-colors duration-200",
          selected ? "bg-ink-1" : "bg-transparent shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
        )}
        aria-hidden
      >
        <motion.span
          initial={false}
          animate={{ opacity: selected ? 1 : 0, scale: selected ? 1 : 0.6 }}
          transition={reduced ? { duration: 0.12 } : SPRING.snappy}
          className="grid place-items-center"
        >
          <Check className="size-3 text-ink-inverse" strokeWidth={3} />
        </motion.span>
      </motion.span>
    </motion.button>
  );
}
