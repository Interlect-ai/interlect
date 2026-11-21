/**
 * The sheets behind the cards of "Sådan screener vi": one calm layout for every
 * card. On top, two short things: what the card shows on a case, and what Interlect looks for.
 * Below, "Det kan I ændre" with the editing for that card. The Financials card has its own body:
 * where the figures come from, and the finance rules as switches, saved in the team's language.
 * Facts from the code (reports: finance-summary.ts, financials.functions.ts, registries/index.ts,
 * financial-gates.ts, scoring.ts, prompt.ts, tasks.ts).
 */
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Toggle } from "@/components/ds/Toggle";
import {
  FINANCE_GATES,
  financeGateTreatment,
  type FinanceGateKey,
} from "@/lib/analysis/financial-gates";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import { FINANCE_GATE_TEXT_EN } from "@/lib/funds/config-templates-en";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

type EditorState = SaveFundConfigInput;

/** "Det viser kortet" · "Det leder Interlect efter" · "Det kan I ændre". */
export function CardSheetBody({
  shows,
  looksFor,
  change,
  children,
}: {
  shows: string;
  looksFor: string[];
  change?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-7 pt-1 pb-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-lg bg-canvas p-[18px]">
          <h3 className="m-0 text-meta font-semibold text-ink-3">{t("fundSetup.cards.shows")}</h3>
          <p className="m-0 text-list leading-[1.55] text-ink-1">{shows}</p>
        </section>
        <section className="flex flex-col gap-2 rounded-lg bg-canvas p-[18px]">
          <h3 className="m-0 text-meta font-semibold text-ink-3">
            {t("fundSetup.cards.looksFor")}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {looksFor.map((line) => (
              <li key={line} className="flex items-start gap-2 text-list leading-[1.5] text-ink-1">
                <span aria-hidden className="mt-[8px] size-[5px] shrink-0 rounded-full bg-ink-3" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-section font-semibold">{t("fundSetup.cards.change")}</h3>
          {change && <p className="m-0 text-list text-ink-3">{change}</p>}
        </div>
        {children}
      </section>
      <p className="m-0 border-t border-line pt-4 text-meta text-ink-3">
        {t("fundSetup.cards.applies")}
      </p>
    </div>
  );
}

const FINANCE_PLAIN: Record<FinanceGateKey, MessageKey> = {
  finance_positive_equity: "fundSetup.finance.rule.equity",
  finance_runway_12m: "fundSetup.finance.rule.runway",
  finance_min_filings: "fundSetup.finance.rule.filings",
  finance_filing_age_18m: "fundSetup.finance.rule.age",
  finance_no_going_concern: "fundSetup.finance.rule.goingConcern",
  finance_nibd_ebitda_3x: "fundSetup.finance.rule.debt",
};

/** Where the figures come from, and the finance rules as switches. */
export function FinanceSheetBody({
  value,
  onChange,
  readOnly,
  children,
}: {
  value: EditorState;
  onChange: (value: EditorState) => void;
  readOnly?: boolean | undefined;
  /** The ask box, as in the other sheets. */
  children?: ReactNode;
}) {
  const t = useT();
  const language = useLanguage();
  const has = (key: string) => value.gates.some((gate) => gate.key === key);
  const text = (gate: (typeof FINANCE_GATES)[number]) =>
    language === "en" && FINANCE_GATE_TEXT_EN[gate.key]
      ? FINANCE_GATE_TEXT_EN[gate.key]!
      : { label: gate.label, description: gate.description };
  const toggle = (gate: (typeof FINANCE_GATES)[number], on: boolean) => {
    if (on) {
      if (has(gate.key)) return;
      const words = text(gate);
      onChange({
        ...value,
        gates: [
          ...value.gates,
          {
            key: gate.key,
            label: words.label,
            description: words.description,
            treatment: gate.treatment,
          },
        ],
      });
    } else {
      onChange({ ...value, gates: value.gates.filter((item) => item.key !== gate.key) });
    }
  };
  return (
    <CardSheetBody
      shows={t("fundSetup.finance.shows")}
      looksFor={[
        t("fundSetup.finance.source1"),
        t("fundSetup.finance.source2"),
        t("fundSetup.finance.source3"),
      ]}
      change={t("fundSetup.finance.changeLead")}
    >
      {children}
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg bg-surface p-0 shadow-card">
        {FINANCE_GATES.map((gate, index) => {
          const on = has(gate.key);
          const hard = financeGateTreatment(gate.key) === "hard";
          return (
            <motion.li
              key={gate.key}
              layout
              transition={SPRING.smooth}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-[18px] py-3.5",
                index > 0 && "border-t border-line",
              )}
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-list font-semibold text-ink-1">{text(gate).label}</span>
                <span className="text-meta leading-[1.5] text-ink-3">
                  {t(FINANCE_PLAIN[gate.key])}{" "}
                  {hard ? t("fundSetup.finance.isBinding") : t("fundSetup.finance.isReview")}
                </span>
              </span>
              <Toggle
                checked={on}
                disabled={Boolean(readOnly)}
                label={text(gate).label}
                onCheckedChange={(next) => toggle(gate, next)}
              />
            </motion.li>
          );
        })}
      </ul>
      <p className="m-0 rounded-md bg-canvas px-4 py-3 text-meta leading-[1.55] text-ink-2">
        {t("fundSetup.finance.unknownNote")}
      </p>
    </CardSheetBody>
  );
}

/** The threshold as one large slider with its number. */
export function ThresholdControl({
  value,
  onChange,
}: {
  value: EditorState;
  onChange: (value: EditorState) => void;
}) {
  const t = useT();
  const threshold = Math.min(100, Math.max(0, value.analysisThreshold));
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
      <div className="flex items-baseline justify-between">
        <span className="text-list font-semibold text-ink-1">{t("fundSetup.board.threshold")}</span>
        <span className="text-[34px] leading-none font-semibold tracking-title tabular-nums">
          {threshold}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={threshold}
        aria-label={t("fundSetup.board.threshold")}
        onChange={(event) => onChange({ ...value, analysisThreshold: Number(event.target.value) })}
        className="w-full cursor-pointer accent-[var(--ink-1)]"
      />
      <div className="flex justify-between text-micro text-ink-4 tabular-nums" aria-hidden>
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
    </div>
  );
}
