/**
 * The thesis row (prototype Fondsopsaetning v2, "Opsætning"): one card per investment thesis the
 * user is a member of (fund = thesis), the selected one in a 1.5 px ink ring, and
 * "Ny investeringstese" last (Admin only; the server checks it too).
 */
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { Reveal } from "@/components/ds/Reveal";
import type { MemberFund } from "@/lib/funds/funds.functions";
import { PRESS } from "@/lib/motion";
import type { MessageKey } from "@/lib/i18n/translate";
import { useT } from "@/lib/i18n/useT";

const STATUS: Record<MemberFund["configStatus"], { label: MessageKey; dot: string }> = {
  active: { label: "fundSetup.thesisRow.published", dot: "var(--positive)" },
  draft: { label: "fundSetup.thesisRow.draft", dot: "var(--warning)" },
  none: { label: "fundSetup.thesisRow.none", dot: "var(--ink-4)" },
};

export function FundThesisRow({
  funds,
  activeId,
  onSelect,
  onCreate,
}: {
  funds: MemberFund[];
  activeId: string | null;
  onSelect: (fundId: string) => void;
  /** Absent when the user may not create a thesis (only an Admin can). */
  onCreate?: (() => void) | undefined;
}) {
  const t = useT();
  return (
    <Reveal delay={0.04}>
      <div
        role="group"
        aria-label={t("fundSetup.thesisRow.groupLabel")}
        className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5 p-0.5"
      >
        {funds.map((candidate) => {
          const selected = candidate.id === activeId;
          const status = STATUS[candidate.configStatus];
          const statusLabel = t(status.label);
          return (
            <motion.button
              key={candidate.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(candidate.id)}
              whileTap={PRESS.whileTap}
              transition={PRESS.transition}
              className="flex min-w-0 cursor-pointer flex-col items-start gap-1.5 rounded-lg border-0 px-[18px] py-4 text-left font-[inherit] transition-[background,box-shadow] duration-[240ms]"
              style={{
                background: selected ? "var(--bg-surface)" : "var(--bg-canvas)",
                boxShadow: selected ? "inset 0 0 0 1.5px var(--ink-1)" : "none",
              }}
            >
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 truncate text-[15px] font-semibold text-ink-1">
                  {candidate.name}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-[5px] text-micro text-ink-3">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ background: status.dot }}
                  />
                  {candidate.isDemo
                    ? t("fundSetup.thesisRow.demo", { status: statusLabel })
                    : statusLabel}
                </span>
              </span>
              <span className="line-clamp-2 text-meta leading-[1.45] text-ink-3">
                {candidate.shortThesis || t("fundSetup.thesisRow.thesisMissing")}
              </span>
            </motion.button>
          );
        })}
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-0 bg-transparent font-[inherit] text-list font-medium text-ink-2 shadow-[inset_0_0_0_1.5px_var(--line-strong)] transition-[box-shadow,color,background] duration-200 hover:bg-action-wash hover:text-action hover:shadow-[inset_0_0_0_1.5px_var(--action)]"
          >
            <Plus aria-hidden className="size-[18px]" />
            {t("fundSetup.thesisRow.create")}
          </button>
        )}
      </div>
    </Reveal>
  );
}
