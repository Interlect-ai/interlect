/**
 * Nøglefund as a focus page (Case Screening v5, lines 388–412, the recommended "argument" style;
 * v0.4: "Styrker" and "Svagheder" with their weight as 1–3 small bars, never points).
 *
 * Measured: max 1020 px, gap 30; the balance box canvas, radius xl, padding 24/26, gap 12, two
 * 40/600 numbers with "styrker"/"svagheder" in 15 px ink-3 and a 10 px balance bar; columns
 * auto-fit min 320 px, gap 12, each with a 17/600 title and a coloured dot; rows padding 18/20
 * with hairlines, the finding 15/1.5 over the criterion (6 px dot + 12 px ink-3), and on the
 * right three 5 × 16 bars (radius 3) filled to the finding's weight.
 *
 * A screening before prompt v8 has no findings tied to criteria: its own strengths and
 * weaknesses are shown without the criterion line and the bars.
 */
import { motion, useReducedMotion } from "motion/react";
import { FocusPage } from "@/components/ds/FocusPage";
import type { FindingRow } from "@/lib/cases/screening-view";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { FindingBalance } from "./ScreeningModules";

export function FindingsFocus({
  companyName,
  onBack,
  columns,
  balance,
}: {
  companyName: string;
  onBack: () => void;
  columns: { up: FindingRow[]; down: FindingRow[] };
  balance: { up: number; down: number };
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const rise = (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED_FADE }
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, ease: EASE.out, delay },
        };
  return (
    <FocusPage
      backLabel={companyName}
      onBack={onBack}
      title={t("screening.findings.title")}
      className="max-w-[1020px]"
    >
      <motion.div className="flex flex-col gap-3 rounded-xl bg-canvas px-6 py-6" {...rise(0.12)}>
        <div className="flex items-baseline justify-between">
          <span className="flex items-baseline gap-2.5">
            <span className="text-[40px] leading-none font-semibold tracking-display">
              {columns.up.length}
            </span>
            <span className="text-body text-ink-3">
              {t(
                columns.up.length === 1
                  ? "screening.findings.strengthOne"
                  : "screening.findings.strengthMany",
              )}
            </span>
          </span>
          <span className="flex items-baseline gap-2.5">
            <span className="text-body text-ink-3">
              {t(
                columns.down.length === 1
                  ? "screening.findings.weaknessOne"
                  : "screening.findings.weaknessMany",
              )}
            </span>
            <span className="text-[40px] leading-none font-semibold tracking-display">
              {columns.down.length}
            </span>
          </span>
        </div>
        <FindingBalance up={balance.up} down={balance.down} height={10} />
      </motion.div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3">
        <Column
          title={t("screening.findings.strengths")}
          color="var(--positive)"
          rows={columns.up}
          delay={0.18}
        />
        <Column
          title={t("screening.findings.weaknesses")}
          color="var(--warning)"
          rows={columns.down}
          delay={0.24}
        />
      </div>
    </FocusPage>
  );
}

function Column({
  title,
  color,
  rows,
  delay,
}: {
  title: string;
  color: string;
  rows: FindingRow[];
  delay: number;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  return (
    <motion.section
      className="flex flex-col gap-2.5"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.6, ease: EASE.out, delay }}
    >
      <h3 className="m-0 flex items-center gap-2 px-1.5 text-section font-semibold">
        <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="m-0 rounded-lg bg-canvas px-5 py-[18px] text-list text-ink-3">
          {t("screening.findings.none")}
        </p>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-lg bg-surface shadow-card">
          {rows.map((row, index) => (
            <motion.div
              key={`${index}-${row.statement}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-line px-5 py-[18px] not-first:border-t"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduced
                  ? REDUCED_FADE
                  : { duration: 0.52, ease: EASE.out, delay: delay + 0.04 + index * 0.07 }
              }
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[15px] leading-[1.5]">{row.statement}</span>
                {row.criterionLabel && row.color && (
                  <span className="flex items-center gap-1.5 text-meta text-ink-3">
                    <span className="size-1.5 rounded-full" style={{ background: row.color }} />
                    {row.criterionLabel}
                  </span>
                )}
              </div>
              {row.importance !== null && (
                <span
                  className="flex gap-[3px]"
                  role="img"
                  aria-label={t("screening.findings.importance", { level: row.importance })}
                >
                  {[1, 2, 3].map((step) => (
                    <span
                      key={step}
                      className="h-4 w-[5px] rounded-[3px]"
                      style={{
                        background: step <= row.importance! ? color : "var(--chart-track)",
                      }}
                    />
                  ))}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </motion.section>
  );
}
