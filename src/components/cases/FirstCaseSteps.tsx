/**
 * The case list's empty state: the first case in five steps. Built like the shared EmptyState
 * (States.tsx: centred, 56 px tile, 24/600 title, 15 px ink-3 text, rising in over 500 ms), with
 * the steps as one white list with hairlines inside a canvas box (v0.3 "Sektioner lever i bokse").
 * One primary action: "Opret case", for those who may create cases. The steps that
 * have a page link to it; the rest describe what happens after the case is created.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { ChevronRight, Inbox, Plus } from "lucide-react";
import { buttonClass } from "@/components/ds/Button";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";

type StepKey = "setup" | "team" | "create" | "screen" | "decide";

const STEPS: ReadonlyArray<{ key: StepKey; to?: "/fond" | "/brugere" | "/opret-case" }> = [
  { key: "setup", to: "/fond" },
  { key: "team", to: "/brugere" },
  { key: "create", to: "/opret-case" },
  { key: "screen" },
  { key: "decide" },
];

export function FirstCaseSteps({ canCreate }: { canCreate: boolean }) {
  const t = useT();
  const reduced = useReducedMotion();
  return (
    <div className="grid min-h-full place-items-center px-4 py-10 md:p-10">
      <motion.div
        className="flex w-full max-w-[560px] flex-col items-center gap-3.5 text-center"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.5, ease: EASE.out }}
      >
        <span className="grid size-14 place-items-center rounded-[16px] bg-sunken text-ink-3">
          <Inbox className="size-[22px]" strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="m-0 text-[24px] font-semibold tracking-title">
          {t("demoData.firstCase.title")}
        </h2>
        <p className="m-0 text-[15px] leading-[1.55] text-ink-3">{t("demoData.firstCase.body")}</p>
        <div className="mt-2 w-full rounded-xl bg-canvas p-2.5 text-left">
          <ol className="m-0 flex list-none flex-col overflow-hidden rounded-lg bg-surface p-0 shadow-[0_0_0_1px_var(--line)]">
            {STEPS.map((step, index) => {
              const body = (
                <>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sunken text-meta font-medium text-ink-2 tabular-nums">
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-[1.4]">
                    <span className="text-list font-medium text-ink-1">
                      {t(`demoData.firstCase.${step.key}Title`)}
                    </span>
                    <span className="text-meta text-ink-3">
                      {t(`demoData.firstCase.${step.key}Body`)}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={step.key} className="not-first:border-t not-first:border-line">
                  {step.to ? (
                    <StepLink to={step.to}>{body}</StepLink>
                  ) : (
                    <div className="flex items-center gap-3.5 px-4 py-3.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        {canCreate && (
          <Link to="/opret-case" className={buttonClass({ variant: "primary", className: "mt-2" })}>
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            {t("demoData.firstCase.start")}
          </Link>
        )}
      </motion.div>
    </div>
  );
}

function StepLink({
  to,
  children,
}: {
  to: "/fond" | "/brugere" | "/opret-case";
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3.5 px-4 py-3.5 outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:bg-hover"
    >
      {children}
      <ChevronRight
        className="size-4 shrink-0 text-ink-4 opacity-0 transition-opacity duration-[var(--dur-quick)] group-hover:opacity-100 group-focus-visible:opacity-100"
        strokeWidth={1.75}
        aria-hidden
      />
    </Link>
  );
}
