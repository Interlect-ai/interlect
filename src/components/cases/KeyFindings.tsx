/**
 * D-9 (designlærred, variant B · 26/9-2026): screeningens tre nøglefund som små farvede
 * kort under konklusionen: trækker op, trækker ned og mangler vi at vide. Hvert kort
 * viser det vigtigste fund; et klik folder alle fund af den slags ud under kortene.
 * Farven sidder i kortets flade og ikonet, teksten står i blæk (kontrast).
 */
import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUp, Circle, type LucideIcon } from "lucide-react";
import type { StatementView } from "@/lib/cases/view-model";
import { EASE_ENTER, MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { Language } from "@/lib/i18n/language";
import { translate, type MessageKey } from "@/lib/i18n/translate";

type Kind = "up" | "down" | "unknown";

const KINDS: Array<{
  key: Kind;
  label: MessageKey;
  icon: LucideIcon;
  surface: string;
  iconColor: string;
}> = [
  {
    key: "up",
    label: "caseView.findings.up",
    icon: ArrowUp,
    surface: "bg-[color-mix(in_oklab,var(--series-1)_9%,var(--surface))]",
    iconColor: "text-[var(--series-1)]",
  },
  {
    key: "down",
    label: "caseView.findings.down",
    icon: ArrowDown,
    surface: "bg-warning-wash",
    iconColor: "text-warning",
  },
  {
    key: "unknown",
    label: "caseView.findings.unknown",
    icon: Circle,
    surface: "bg-surface-neutral",
    iconColor: "text-ink-3",
  },
];

/**
 * Kritiske risici står først (princip 5), derefter modargumentet (dyb analyse), høje
 * risici og til sidst øvrige svagheder.
 */
function severityRank(item: StatementView, language: Language) {
  if (item.meta.includes(translate(language, "screening.model.riskCritical"))) return 0;
  if (item.meta === translate(language, "screening.model.counterArgument")) return 1;
  if (item.meta.startsWith(translate(language, "screening.model.riskWord"))) return 2;
  return 3;
}

export function KeyFindings({
  strengths,
  weaknesses,
  questions,
  labels,
  className,
}: {
  strengths: StatementView[];
  weaknesses: StatementView[];
  questions: StatementView[];
  /** Egne overskrifter (dyb analyse: "Hvorfor nu", "Hvad taler imod", "Betingelse"). */
  labels?: Partial<Record<Kind, string>>;
  className?: string;
}) {
  const t = useT();
  const language = useLanguage();
  const [open, setOpen] = useState<Kind | null>(null);
  const panelId = useId();
  const items: Record<Kind, StatementView[]> = {
    up: strengths,
    down: [...weaknesses].sort((a, b) => severityRank(a, language) - severityRank(b, language)),
    unknown: questions,
  };
  if (!strengths.length && !weaknesses.length && !questions.length) return null;
  const kinds = KINDS.map((kind) => ({ ...kind, label: labels?.[kind.key] ?? t(kind.label) }));
  const openKind = open ? kinds.find((kind) => kind.key === open) : null;
  return (
    <div className={className}>
      {/* Lidt bredere midte ("Trækker ned"), så kortene ikke står i en symmetrisk tre-rytme. */}
      <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr_1fr]">
        {kinds.map((kind) => {
          const list = items[kind.key];
          const Icon = kind.icon;
          const first = list[0]?.statement;
          const isOpen = open === kind.key;
          return (
            <button
              key={kind.key}
              type="button"
              disabled={!list.length}
              onClick={() => setOpen(isOpen ? null : kind.key)}
              aria-expanded={isOpen}
              aria-controls={isOpen ? `${panelId}-${kind.key}` : undefined}
              className={cn(
                "flex min-w-0 flex-col gap-2 rounded-xl px-4 py-3.5 text-left transition-shadow",
                kind.surface,
                isOpen
                  ? "shadow-[0_0_0_1.5px_var(--ink-3)]"
                  : list.length
                    ? "hover:shadow-[0_0_0_1px_var(--hairline-strong)]"
                    : "opacity-70",
              )}
            >
              <span className="flex items-center justify-between gap-2 text-meta font-semibold text-ink-2">
                <span className="flex items-center gap-1.5">
                  <Icon className={cn("size-3.5", kind.iconColor)} strokeWidth={2.2} aria-hidden />
                  {kind.label}
                </span>
                <span className="font-normal tabular-nums text-ink-3">{list.length}</span>
              </span>
              <span className="line-clamp-3 text-list leading-5 text-ink">
                {first ?? t("caseView.findings.none")}
              </span>
            </button>
          );
        })}
      </div>
      <AnimatePresence initial={false} mode="wait">
        {openKind && (
          <motion.div
            id={`${panelId}-${openKind.key}`}
            key={openKind.key}
            role="region"
            aria-label={openKind.label}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: MOTION.disclosure, ease: EASE_ENTER }}
            className="overflow-hidden"
          >
            <ul className="mt-3 grid gap-2 rounded-xl border border-hairline bg-surface px-4 py-3">
              {items[openKind.key].map((item, index) => (
                <li key={`${index}:${item.statement}`} className="text-list leading-5 text-ink-2">
                  {item.statement}
                  {item.meta && <span className="ml-2 text-meta text-ink-4">{item.meta}</span>}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
