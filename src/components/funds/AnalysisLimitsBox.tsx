/**
 * Analysegrænser in Teamopsætning (spec B6): what a screening and a deep analysis may cost
 * at most, the optional monthly limit, what happens at the limit, and what the team's runs really
 * cost the last 30 days. Kroner are for Admin and Lead only and only here (beslutningslog 2. nov):
 * the card does not render for anyone else, and `getFundAnalysisLimits` refuses them too.
 * One primary action, "Ret grænser", opens the dialog; the confirmed number is the team's real
 * limit (`confirmCaps`). The choice at the limit is saved at once, like the AI level.
 * Every change applies to new runs only and is written to the change history by the server.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { TextField } from "@/components/ds/Field";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { showToast } from "@/components/ds/Toast";
import type { LimitAction } from "@/lib/analysis/model-tiers";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import { userMessage } from "@/lib/errors/user-message";
import { getFundAnalysisLimits, updateFundAiSettings } from "@/lib/funds/ai-settings.functions";
import type {
  AnalysisLimitKind,
  AnalysisLimitsView,
  RunCostStats,
} from "@/lib/funds/analysis-limits";
import {
  formatDkk,
  formatDkkRange,
  limitIsTight,
  monthState,
  nextMonthStart,
  parseCapInput,
  type CapInput,
} from "@/lib/funds/analysis-limits-display";
import type { MessageKey } from "@/lib/i18n/translate";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

type Kind = "screening" | "deep";
type KindView = AnalysisLimitKind & { costs: RunCostStats | null };

const KIND_LABEL: Record<Kind, MessageKey> = {
  screening: "fundSetup.analysisLimits.screening",
  deep: "fundSetup.analysisLimits.deep",
};
const PER_RUN: Record<Kind, MessageKey> = {
  screening: "fundSetup.analysisLimits.perScreening",
  deep: "fundSetup.analysisLimits.perDeep",
};

const FIELD_LABEL: Record<Kind, MessageKey> = {
  screening: "fundSetup.analysisLimits.fieldScreening",
  deep: "fundSetup.analysisLimits.fieldDeep",
};

const analysisLimitsKey = (fundId: string) => ["fund-analysis-limits", fundId] as const;

export function AnalysisLimitsBox({ fundId }: { fundId: string }) {
  const t = useT();
  const language = useLanguage();
  const access = useMyAccess(fundId);
  const allowed = access.data?.capabilities?.includes("configure_fund") === true;
  const load = useServerFn(getFundAnalysisLimits);
  const save = useServerFn(updateFundAiSettings);
  const queryClient = useQueryClient();
  const headingId = useId();
  const [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: analysisLimitsKey(fundId),
    queryFn: () => load({ data: { fundId } }),
    enabled: allowed,
    retry: false,
  });
  const action = useMutation({
    mutationFn: (limitAction: LimitAction) => save({ data: { fundId, limitAction } }),
    onSuccess: () => afterSave(),
    onError: (error) =>
      showToast({
        message: userMessage(error, t("fundSetup.analysisLimits.saveFailed"), language),
        tone: "error",
      }),
  });
  async function afterSave() {
    void queryClient.invalidateQueries({ queryKey: ["fund-change-history", fundId] });
    void queryClient.invalidateQueries({ queryKey: ["fund-ai-settings", fundId] });
    await queryClient.invalidateQueries({ queryKey: analysisLimitsKey(fundId) });
    showToast({ message: t("fundSetup.analysisLimits.appliesToast") });
  }

  if (!allowed) return null;
  if (query.isLoading) {
    return (
      <section
        aria-busy="true"
        aria-label={t("fundSetup.analysisLimits.heading")}
        className="flex flex-col gap-2 rounded-lg bg-canvas p-[22px]"
      >
        <div className="h-5 w-48 animate-pulse rounded-md bg-sunken" />
        <div className="h-9 w-72 max-w-full animate-pulse rounded-md bg-sunken" />
      </section>
    );
  }
  if (query.isError || !query.data) {
    return (
      <section className="flex flex-col items-start gap-2 rounded-lg bg-canvas p-[22px]">
        <h2 className="m-0 text-list font-semibold">{t("fundSetup.analysisLimits.heading")}</h2>
        <p className="m-0 text-list text-ink-3">{t("fundSetup.analysisLimits.loadError")}</p>
        <Button variant="secondary" size="md" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </section>
    );
  }
  const view = query.data;
  if (!view.available) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-[18px] rounded-lg bg-canvas p-[22px]"
    >
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="m-0 text-list font-semibold">
            {t("fundSetup.analysisLimits.heading")}
          </h2>
          <p className="m-0 text-meta text-ink-3">{t("fundSetup.analysisLimits.help")}</p>
        </div>
        <span className="ml-auto" />
        <Button variant="secondary" size="md" onClick={() => setEditing(true)}>
          {t("fundSetup.analysisLimits.edit")}
        </Button>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-10 gap-y-6">
        <KindColumn kind="screening" data={view.screening} limitAction={view.limitAction} />
        <KindColumn kind="deep" data={view.deep} limitAction={view.limitAction} />
        <MonthColumn view={view} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-list font-semibold">{t("fundSetup.analysisLimits.atLimit")}</span>
        <SegmentedControl<LimitAction>
          aria-label={t("fundSetup.analysisLimits.atLimit")}
          size="sm"
          value={action.isPending && action.variables ? action.variables : view.limitAction}
          options={[
            { value: "shrink", label: t("fundSetup.analysisLimits.shrink") },
            { value: "ask", label: t("fundSetup.analysisLimits.ask") },
          ]}
          onChange={(next) => {
            if (next !== view.limitAction && !action.isPending) action.mutate(next);
          }}
        />
        <p className="m-0 basis-full text-meta text-ink-3">
          {t(
            view.limitAction === "ask"
              ? "fundSetup.analysisLimits.askHelp"
              : "fundSetup.analysisLimits.shrinkHelp",
          )}
        </p>
      </div>

      <EditLimitsDialog
        open={editing}
        onOpenChange={setEditing}
        view={view}
        onSave={async (change) => {
          await save({ data: { fundId, ...change, confirmCaps: true } });
          setEditing(false);
          await afterSave();
        }}
      />
    </section>
  );
}

function KindColumn({
  kind,
  data,
  limitAction,
}: {
  kind: Kind;
  data: KindView;
  limitAction: LimitAction;
}) {
  const t = useT();
  const language = useLanguage();
  const tight = limitIsTight(data);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-meta text-ink-3">{t(KIND_LABEL[kind])}</span>
      <span className="text-[28px] leading-none font-semibold tracking-title tabular-nums">
        {formatDkk(data.capDkk, language)}
        <span className="ml-2 text-list font-normal text-ink-3">{t(PER_RUN[kind])}</span>
      </span>
      <span className="text-micro text-ink-3">
        {data.ownCapDkk === null
          ? t("fundSetup.analysisLimits.standardNote")
          : t("fundSetup.analysisLimits.ownNote", {
              standard: formatDkk(data.standardCapDkk, language),
            })}
      </span>
      <p className="m-0 text-meta text-ink-3 tabular-nums">
        {data.costs
          ? t(
              data.costs.runs === 1
                ? "fundSetup.analysisLimits.costsOne"
                : "fundSetup.analysisLimits.costsMany",
              {
                average: formatDkk(data.costs.averageDkk, language, true),
                range: formatDkkRange(data.costs.lowestDkk, data.costs.highestDkk, language),
                runs: data.costs.runs,
              },
            )
          : t("fundSetup.analysisLimits.noRuns")}
      </p>
      {tight && (
        <StatusLine tone="warning">
          {t(
            limitAction === "ask"
              ? "fundSetup.analysisLimits.tightAsk"
              : "fundSetup.analysisLimits.tightShrink",
          )}
        </StatusLine>
      )}
    </div>
  );
}

function MonthColumn({ view }: { view: AnalysisLimitsView }) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const month = monthState(view);
  const used = formatDkk(month.usedDkk, language, true);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-meta text-ink-3">{t("fundSetup.analysisLimits.month")}</span>
      <span className="text-[28px] leading-none font-semibold tracking-title tabular-nums">
        {used}
        <span className="ml-2 text-list font-normal text-ink-3">
          {month.capDkk === null
            ? t("fundSetup.analysisLimits.usedNoCap")
            : t("fundSetup.analysisLimits.usedOf", { cap: formatDkk(month.capDkk, language) })}
        </span>
      </span>
      {month.pct !== null ? (
        <div
          role="meter"
          aria-label={t("fundSetup.analysisLimits.monthMeter")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(month.pct)}
          className="h-2 w-full overflow-hidden rounded-full bg-sunken"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-[var(--dur-base)]",
              month.reached ? "bg-critical" : month.pct >= 80 ? "bg-warning" : "bg-ink-1",
            )}
            style={{ width: `${month.pct}%` }}
          />
        </div>
      ) : (
        <span className="text-micro text-ink-3">{t("fundSetup.analysisLimits.noMonthly")}</span>
      )}
      {month.reached && (
        <StatusLine tone="critical">
          {t("fundSetup.analysisLimits.monthReached", {
            date: nextMonthStart().toLocaleDateString(localeTag, { day: "numeric", month: "long" }),
          })}
        </StatusLine>
      )}
    </div>
  );
}

/** Status as a coloured dot and text in ink-1 ("Status"), readable at AA. */
function StatusLine({ tone, children }: { tone: "warning" | "critical"; children: ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-2 text-meta text-ink-1">
      <span
        aria-hidden
        className={cn(
          "mt-[5px] size-[7px] shrink-0 rounded-full",
          tone === "critical" ? "bg-critical" : "bg-warning",
        )}
      />
      <span>{children}</span>
    </p>
  );
}

interface LimitsChange {
  screeningCapDkk?: number | null;
  deepCapDkk?: number | null;
  monthlyCapDkk?: number | null;
}

function textOf(value: number | null): string {
  return value === null ? "" : String(value);
}

function EditLimitsDialog({
  open,
  onOpenChange,
  view,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: AnalysisLimitsView;
  onSave: (change: LimitsChange) => Promise<void>;
}) {
  const t = useT();
  const language = useLanguage();
  const [screening, setScreening] = useState("");
  const [deep, setDeep] = useState("");
  const [monthly, setMonthly] = useState("");
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each time the dialog opens it starts from what is saved now.
  useEffect(() => {
    if (!open) return;
    setScreening(textOf(view.screening.ownCapDkk));
    setDeep(textOf(view.deep.ownCapDkk));
    setMonthly(textOf(view.monthlyCapDkk));
    setShown(false);
    setError(null);
    // Only on opening: a refetch while the dialog is open must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsed = {
    screening: parseCapInput(screening, view.screening.minDkk, view.screening.maxDkk),
    deep: parseCapInput(deep, view.deep.minDkk, view.deep.maxDkk),
    // At least 1 kr.: a limit of 0 reads as broken; empty means no monthly limit.
    monthly: parseCapInput(monthly, 1, view.monthlyMaxDkk),
  };
  // A saved limit the installation has since narrowed stays valid until the person changes it.
  const untouched = (kind: Kind, text: string) => text === textOf(view[kind].ownCapDkk);
  if (!parsed.screening.ok && untouched("screening", screening)) {
    parsed.screening = { ok: true, value: view.screening.ownCapDkk };
  }
  if (!parsed.deep.ok && untouched("deep", deep)) {
    parsed.deep = { ok: true, value: view.deep.ownCapDkk };
  }
  const valid = parsed.screening.ok && parsed.deep.ok && parsed.monthly.ok;
  const value = (input: CapInput) => (input.ok ? input.value : null);
  // An empty field gets the standard, inside the installation's limit (what a new run really gets).
  const effective = (kind: Kind) =>
    value(parsed[kind]) ?? Math.min(view[kind].standardCapDkk, view[kind].maxDkk);
  const monthlyValue = value(parsed.monthly);

  const hint = (input: CapInput, min: number, max: number, rangeKey: MessageKey, ok: string) =>
    !shown || input.ok
      ? ok
      : input.reason === "number"
        ? t("fundSetup.analysisLimits.notNumber")
        : t(rangeKey, { min: formatDkk(min, language), max: formatDkk(max, language) });

  async function submit() {
    setShown(true);
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      // Only what changed is sent: a limit saved earlier is never judged again (the server checks
      // only what it is sent, ai-settings.functions.ts).
      const change: LimitsChange = {};
      if (value(parsed.screening) !== view.screening.ownCapDkk) {
        change.screeningCapDkk = value(parsed.screening);
      }
      if (value(parsed.deep) !== view.deep.ownCapDkk) change.deepCapDkk = value(parsed.deep);
      if (monthlyValue !== view.monthlyCapDkk) change.monthlyCapDkk = monthlyValue;
      if (Object.keys(change).length === 0) {
        onOpenChange(false);
        return;
      }
      await onSave(change);
    } catch (cause) {
      setError(userMessage(cause, t("fundSetup.analysisLimits.saveFailed"), language));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title={t("fundSetup.analysisLimits.dialogTitle")}
      description={t("fundSetup.analysisLimits.dialogHelp")}
      footer={
        <>
          <Button variant="quiet" size="md" disabled={saving} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="md" disabled={saving} onClick={() => void submit()}>
            {saving ? t("fundSetup.analysisLimits.saving") : t("fundSetup.analysisLimits.save")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {(["screening", "deep"] as const).map((kind) => (
          <TextField
            key={kind}
            label={t(FIELD_LABEL[kind])}
            inputMode="decimal"
            autoComplete="off"
            value={kind === "screening" ? screening : deep}
            onChange={(event) =>
              (kind === "screening" ? setScreening : setDeep)(event.target.value)
            }
            placeholder={String(view[kind].standardCapDkk)}
            invalid={shown && !parsed[kind].ok}
            hint={hint(
              parsed[kind],
              view[kind].minDkk,
              view[kind].maxDkk,
              "fundSetup.analysisLimits.range",
              t("fundSetup.analysisLimits.fieldHint", {
                standard: formatDkk(view[kind].standardCapDkk, language),
                min: formatDkk(view[kind].minDkk, language),
                max: formatDkk(view[kind].maxDkk, language),
              }),
            )}
          />
        ))}
        <TextField
          label={t("fundSetup.analysisLimits.fieldMonthly")}
          inputMode="decimal"
          autoComplete="off"
          value={monthly}
          onChange={(event) => setMonthly(event.target.value)}
          placeholder={t("fundSetup.analysisLimits.noneShort")}
          invalid={shown && !parsed.monthly.ok}
          hint={hint(
            parsed.monthly,
            1,
            view.monthlyMaxDkk,
            "fundSetup.analysisLimits.range",
            t("fundSetup.analysisLimits.monthlyHint", {
              max: formatDkk(view.monthlyMaxDkk, language),
            }),
          )}
        />
        {/* The confirmation: these numbers become the team's real limits (confirmCaps). */}
        {valid && (
          <p className="m-0 rounded-[12px] bg-sunken px-3.5 py-2.5 text-list text-ink-1">
            {monthlyValue === null
              ? t("fundSetup.analysisLimits.confirm", {
                  screening: formatDkk(effective("screening"), language),
                  deep: formatDkk(effective("deep"), language),
                })
              : t("fundSetup.analysisLimits.confirmMonthly", {
                  screening: formatDkk(effective("screening"), language),
                  deep: formatDkk(effective("deep"), language),
                  monthly: formatDkk(monthlyValue, language),
                })}
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-meta text-critical">
            {error}
          </p>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
