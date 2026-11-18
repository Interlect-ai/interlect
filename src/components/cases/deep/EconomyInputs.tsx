/**
 * "Udfyld" on a key figure of the Økonomi tab: a key figure Interlect
 * could not find in an annual report says "Ikke fundet", and Admin, Lead and Medlem can type in
 * the raw figures for one financial year. The figures are saved on the case ("Indtastet af …")
 * and the metrics are calculated from them in code, like an annual report's; a report's own
 * figure always wins. Opens under the key figures like a task's "Udfyld" in the prototype.
 *
 * Measured from TaskList's fill-in: canvas card, radius xl, padding 20 22, fields 44 px in a
 * grid (min 220), actions right-aligned.
 */
import { useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ds/Button";
import { TextField } from "@/components/ds/Field";
import type { ManualFinancialMetric } from "@/lib/analysis/manual-financials";
import {
  deleteFinancialInput,
  saveFinancialInput,
  type ManualFinancialInputView,
} from "@/lib/cases/financials.functions";
import { KPI_INPUTS, parseAmount, type EconomyKpiKey } from "@/lib/cases/economy-inputs";
import { LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { userMessage } from "@/lib/errors/user-message";

function amountText(value: number, language: Language): string {
  return new Intl.NumberFormat(LANGUAGE_TAGS[language], { maximumFractionDigits: 2 }).format(value);
}

export function EconomyInputForm({
  fundId,
  caseId,
  kpi,
  label,
  defaultYear,
  maxYear,
  currency,
  inputs,
  onClose,
}: {
  fundId: string;
  caseId: string;
  kpi: EconomyKpiKey;
  /** The key figure's name ("Bruttomargin"). */
  label: string;
  defaultYear: number;
  /** The latest year a figure can be entered for (the newest report's, else last year). */
  maxYear: number;
  currency: string;
  /** Everything entered on the case so far (prefills a year that has figures). */
  inputs: readonly ManualFinancialInputView[];
  onClose: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const queryClient = useQueryClient();
  const save = useServerFn(saveFinancialInput);
  const remove = useServerFn(deleteFinancialInput);
  const titleId = useId();
  const metrics = KPI_INPUTS[kpi];
  const entered = (year: number, metric: ManualFinancialMetric) =>
    inputs.find((input) => input.fiscalYear === year && input.metric === metric) ?? null;
  const prefill = (year: number) =>
    Object.fromEntries(
      metrics.map((metric) => {
        const existing = entered(year, metric);
        return [metric, existing ? amountText(existing.value, language) : ""];
      }),
    ) as Record<ManualFinancialMetric, string>;

  const [yearText, setYearText] = useState(String(defaultYear));
  const [values, setValues] = useState(() => prefill(defaultYear));
  // Fields the person typed in: a new year only prefills the fields they have not touched.
  const [touched, setTouched] = useState<ReadonlySet<ManualFinancialMetric>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const year = Number(yearText);
  const yearValid = /^\d{4}$/.test(yearText) && year >= 1990 && year <= maxYear;
  const parsed = useMemo(
    () =>
      Object.fromEntries(
        metrics.map((metric) => {
          const text = values[metric]?.trim() ?? "";
          return [metric, text === "" ? undefined : parseAmount(text)];
        }),
      ) as Record<ManualFinancialMetric, number | null | undefined>,
    [metrics, values],
  );
  const hasExisting = yearValid && metrics.some((metric) => entered(year, metric) !== null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["financial-statements", caseId] });

  async function onSave() {
    setError(null);
    if (!yearValid) return setError(t("finance.economy.yearInvalid", { max: maxYear }));
    if (metrics.some((metric) => parsed[metric] === null)) {
      return setError(t("finance.economy.amountInvalid"));
    }
    // Only figures that change are saved, so "Indtastet af" stays with whoever entered the rest.
    const toSave = metrics.filter(
      (metric) =>
        typeof parsed[metric] === "number" && entered(year, metric)?.value !== parsed[metric],
    );
    // A field emptied for a year that had a figure removes that figure.
    const toRemove = metrics.filter(
      (metric) => parsed[metric] === undefined && entered(year, metric) !== null,
    );
    if (toSave.length === 0 && toRemove.length === 0) {
      if (metrics.some((metric) => typeof parsed[metric] === "number")) return onClose();
      return setError(t("finance.economy.nothingToSave"));
    }
    setPending(true);
    try {
      for (const metric of toSave) {
        await save({
          data: { fundId, caseId, metric, fiscalYear: year, value: parsed[metric] as number },
        });
      }
      for (const metric of toRemove) {
        await remove({ data: { fundId, caseId, metric, fiscalYear: year } });
      }
      await refresh();
      onClose();
    } catch (cause) {
      setError(userMessage(cause, t("system.actionFailed"), language));
      // Some figures may be saved before the error: show what is stored now.
      await refresh();
    } finally {
      setPending(false);
    }
  }

  async function onRemoveYear() {
    setError(null);
    setPending(true);
    try {
      for (const metric of metrics) {
        if (entered(year, metric)) {
          await remove({ data: { fundId, caseId, metric, fiscalYear: year } });
        }
      }
      await refresh();
      onClose();
    } catch (cause) {
      setError(userMessage(cause, t("system.actionFailed"), language));
      await refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <motion.section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-xl bg-canvas px-5 py-5 md:px-[22px]"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.42, ease: EASE.out }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <span id={titleId} className="text-section font-semibold">
          {t("finance.economy.formTitle", { label: label.toLowerCase() })}
        </span>
        <span className="max-w-[720px] text-meta leading-[1.5] text-ink-3">
          {t("finance.economy.formHint", { currency, label: label.toLowerCase() })}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
        <TextField
          label={t("finance.economy.year")}
          inputMode="numeric"
          autoFocus
          value={yearText}
          invalid={yearText !== "" && !yearValid}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d]/g, "").slice(0, 4);
            setYearText(next);
            const nextYear = Number(next);
            if (/^\d{4}$/.test(next)) {
              const fresh = prefill(nextYear);
              setValues(
                (previous) =>
                  Object.fromEntries(
                    metrics.map((metric) => [
                      metric,
                      touched.has(metric) ? previous[metric] : fresh[metric],
                    ]),
                  ) as Record<ManualFinancialMetric, string>,
              );
            }
          }}
        />
        {metrics.map((metric) => {
          const value = parsed[metric];
          const existing = yearValid ? entered(year, metric) : null;
          return (
            <TextField
              key={metric}
              label={`${t(`finance.economy.input.${metric}`)} (${currency})`}
              inputMode="decimal"
              value={values[metric] ?? ""}
              invalid={value === null}
              hint={
                value === null
                  ? t("finance.economy.amountInvalid")
                  : typeof value === "number"
                    ? `${amountText(value, language)} ${currency}`
                    : existing?.enteredByName
                      ? t(
                          existing.sourceKind === "brain"
                            ? "finance.economy.find.foundByBrain"
                            : "finance.economy.enteredBy",
                          { name: existing.enteredByName },
                        )
                      : t("finance.economy.amountHint")
              }
              onChange={(event) => {
                const next = event.target.value;
                setTouched((previous) => new Set(previous).add(metric));
                setValues((previous) => ({ ...previous, [metric]: next }));
              }}
            />
          );
        })}
      </div>
      {error && (
        <p role="alert" className="m-0 text-meta text-critical">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {hasExisting && (
          <Button variant="danger" size="md" onClick={onRemoveYear} disabled={pending}>
            {t("finance.economy.removeAll", { year })}
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="quiet" size="md" onClick={onClose} disabled={pending}>
          {t("finance.economy.cancel")}
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={onSave}
          pending={pending}
          pendingLabel={t("finance.economy.saving")}
        >
          {t("finance.economy.save")}
        </Button>
      </div>
    </motion.section>
  );
}
