/**
 * AI-kreditter: the balance and this month's usage split into Analyse, Spørg
 * and Brain, on Fondsopsætning and Overblik. Money is for Admin and Lead only (the card does not
 * render for anyone else, and the server refuses them too). States: ok; low (under the pause line:
 * Brain's background work waits, analysis and Spørg go on); empty (no new analysis starts,
 * "Fyld op for at køre flere analyser", a run in progress still finishes); not enforced (usage
 * only, nothing is stopped). "Fyld op" is for Admin: it opens the payment link from the
 * environment, or says honestly that payment is not set up yet.
 */
import { useId, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button, buttonClass } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { useCreditMeterQuery } from "./useCreditMeterQuery";
import {
  METER_SCOPES,
  type CreditMeter as Meter,
  formatCredit,
  topUpMailto,
  type MeterScope,
  type MeterState,
} from "@/lib/ai/credit-meter";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import type { MessageKey } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

const NOTICE: Record<Exclude<MeterState, "ok">, MessageKey> = {
  low: "shell.credit.noticeLow",
  empty: "shell.credit.noticeEmpty",
  not_enforced: "shell.credit.noticeNotEnforced",
};

const SCOPE_LABEL: Record<MeterScope, MessageKey> = {
  analysis: "shell.credit.scopes.analysis",
  chat: "shell.credit.scopes.chat",
  brain: "shell.credit.scopes.brain",
};

export function CreditMeter({ fundId }: { fundId: string }) {
  const t = useT();
  const access = useMyAccess(fundId);
  const allowed = access.data?.capabilities?.includes("configure_fund") === true;
  const query = useCreditMeterQuery(fundId, allowed);
  const headingId = useId();
  if (!allowed) return null;
  if (query.isLoading) {
    return (
      <section
        aria-busy="true"
        aria-label={t("shell.credit.title")}
        className="flex flex-col gap-2 rounded-lg bg-canvas p-[22px]"
      >
        <div className="h-5 w-40 animate-pulse rounded-md bg-sunken" />
        <div className="h-9 w-56 animate-pulse rounded-md bg-sunken" />
      </section>
    );
  }
  if (query.isError || !query.data) {
    return (
      <section className="flex flex-col items-start gap-2 rounded-lg bg-canvas p-[22px]">
        <h2 className="m-0 text-list font-semibold">{t("shell.credit.title")}</h2>
        <p className="m-0 text-list text-ink-3">{t("shell.credit.loadFailed")}</p>
        <Button variant="secondary" size="md" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </section>
    );
  }
  const meter = query.data;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-[18px] rounded-lg bg-canvas p-[22px]"
    >
      <header className="flex flex-wrap items-center gap-3">
        <h2 id={headingId} className="m-0 text-list font-semibold">
          {t("shell.credit.title")}
        </h2>
        <span className="ml-auto" />
        {meter.state !== "not_enforced" && <TopUp meter={meter} />}
      </header>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-10 gap-y-5">
        {meter.state !== "not_enforced" && <Balance meter={meter} />}
        <Usage meter={meter} />
      </div>
      {meter.state !== "ok" && (
        <p
          className={cn(
            "m-0 rounded-[12px] px-3.5 py-2.5 text-list",
            meter.state === "empty"
              ? "bg-critical-wash text-critical"
              : meter.state === "low"
                ? "bg-sunken text-ink-1"
                : "text-ink-3",
          )}
        >
          {t(NOTICE[meter.state], { pct: meter.pausePct })}
          {meter.state !== "not_enforced" && !meter.canTopUp && ` ${t("shell.credit.askAdmin")}`}
        </p>
      )}
    </section>
  );
}

function Balance({ meter }: { meter: Meter }) {
  const t = useT();
  const language = useLanguage();
  const pct = meter.remainingPct ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <span className="text-meta text-ink-3">{t("shell.credit.balance")}</span>
      <span className="text-[28px] leading-none font-semibold tracking-title tabular-nums">
        {formatCredit(Math.max(0, meter.balanceDkk), meter, false, language)}
        <span className="ml-2 text-list font-normal text-ink-3">{t("shell.credit.remaining")}</span>
      </span>
      <div
        {...(meter.remainingPct === null
          ? { "aria-hidden": true }
          : {
              role: "meter",
              "aria-label": t("shell.credit.remainingLabel"),
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": Math.round(pct),
              "aria-valuetext": t("shell.credit.remainingPct", { pct: Math.round(pct) }),
            })}
        className="relative h-2 w-full overflow-hidden rounded-full bg-sunken"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-[var(--dur-base)]",
            meter.state === "empty"
              ? "bg-critical"
              : meter.state === "low"
                ? "bg-warning"
                : "bg-ink-1",
          )}
          style={{ width: `${pct}%` }}
        />
        <span
          aria-hidden
          className="absolute top-0 h-full w-px bg-ink-4"
          style={{ left: `${meter.pausePct}%` }}
        />
      </div>
      <span className="text-micro text-ink-3">
        {meter.creditedDkk > 0
          ? t("shell.credit.pool", {
              amount: formatCredit(meter.creditedDkk, meter, false, language),
              pct: meter.pausePct,
            })
          : t("shell.credit.noCredits")}
      </span>
    </div>
  );
}

function Usage({ meter }: { meter: Meter }) {
  const t = useT();
  const language = useLanguage();
  const total = METER_SCOPES.reduce((sum, scope) => sum + meter.usage[scope], 0);
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <span className="text-meta text-ink-3">{t("shell.credit.usedThisMonth")}</span>
      {total === 0 ? (
        <p className="m-0 text-list text-ink-3">{t("shell.credit.nothingUsed")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {METER_SCOPES.map((scope) => (
            <li key={scope} className="grid grid-cols-[64px_minmax(0,1fr)_88px] items-center gap-3">
              <span className="text-list text-ink-2">{t(SCOPE_LABEL[scope])}</span>
              <span className="h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
                <span
                  className="block h-full rounded-full bg-ink-1"
                  style={{ width: `${total > 0 ? (meter.usage[scope] / total) * 100 : 0}%` }}
                />
              </span>
              <span className="text-right text-list tabular-nums">
                {formatCredit(meter.usage[scope], meter, true, language)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TopUp({ meter }: { meter: Meter }) {
  const t = useT();
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  if (!meter.canTopUp) return null;
  const urgent = meter.state === "empty" || meter.state === "low";
  if (meter.topUpUrl) {
    return (
      <a
        href={meter.topUpUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass({ variant: urgent ? "primary" : "secondary", size: "md" })}
      >
        {t("shell.credit.topUp")}
        <ArrowUpRight className="size-4" strokeWidth={1.75} aria-hidden />
      </a>
    );
  }
  return (
    <>
      <Button variant={urgent ? "primary" : "secondary"} size="md" onClick={() => setOpen(true)}>
        {t("shell.credit.topUp")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("shell.credit.topUp")}
        description={
          meter.supportEmail
            ? t("shell.credit.requestDescription")
            : t("shell.credit.paymentNotSetUp")
        }
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setOpen(false)}>
              {t("common.close")}
            </Button>
            {meter.supportEmail && (
              <a
                href={topUpMailto({
                  email: meter.supportEmail,
                  fundName: meter.fundName,
                  balanceText: formatCredit(Math.max(0, meter.balanceDkk), meter, false, language),
                  state: meter.state,
                  language,
                })}
                onClick={() => setOpen(false)}
                className={buttonClass({ variant: "primary", size: "md" })}
              >
                {t("shell.credit.sendRequest")}
              </a>
            )}
          </>
        }
      >
        <p className="m-0 text-list text-ink-2">
          {meter.supportEmail ? t("shell.credit.mailBody") : t("shell.credit.writeToUs")}
        </p>
      </Dialog>
    </>
  );
}
