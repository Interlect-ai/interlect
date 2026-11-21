/**
 * The thesis row (prototype Teamopsaetning v3, `thesisCards`): one white 272 px card per
 * investment thesis the user is a member of (fund = thesis) with a thin line, the selected
 * one in a 2 px ink ring, and "Ny investeringstese" last as the same card (Admin only; the server
 * checks it too).
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
        className="flex flex-wrap gap-3 p-0.5"
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
              className="flex min-h-[92px] w-full min-w-0 cursor-pointer flex-col items-start gap-1.5 rounded-lg border-0 bg-surface px-[18px] py-[15px] text-left font-[inherit] transition-[box-shadow,transform] duration-[250ms] hover:-translate-y-px sm:w-[272px] motion-reduce:hover:translate-y-0"
              style={{
                boxShadow: selected
                  ? "inset 0 0 0 2px var(--ink-1)"
                  : "inset 0 0 0 1px var(--line-strong)",
              }}
            >
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 truncate text-[14px] font-semibold text-ink-1">
                  {candidate.name}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-meta text-ink-3">
                  <span
                    aria-hidden
                    className="size-[7px] rounded-full"
                    style={{ background: status.dot }}
                  />
                  {candidate.isDemo
                    ? t("fundSetup.thesisRow.demo", { status: statusLabel })
                    : statusLabel}
                </span>
              </span>
              <span className="line-clamp-2 text-meta leading-[1.5] text-ink-3">
                {candidate.shortThesis || t("fundSetup.thesisRow.thesisMissing")}
              </span>
            </motion.button>
          );
        })}
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="flex min-h-[92px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-0 bg-surface px-[18px] py-[15px] font-[inherit] text-list text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-[transform] duration-[250ms] hover:-translate-y-px sm:w-[272px] motion-reduce:hover:translate-y-0"
          >
            <Plus aria-hidden className="size-[18px]" />
            {t("fundSetup.thesisRow.create")}
          </button>
        )}
      </div>
    </Reveal>
  );
}
