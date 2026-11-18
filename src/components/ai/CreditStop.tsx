/**
 * "Fyld op" where an AI action stops on the balance: the case, Brain and
 * Opret case. The explanation is the page's own text; next to it Admin gets the credit meter's
 * "Fyld op" (payment link or request), everyone else is told to ask an Admin. The numbers are the
 * meter's (Admin and Lead only, the same query), so a Lead or a member sees "Bed en Admin om at
 * fylde op".
 */
import { TopUp } from "./CreditMeter";
import { useCreditMeterQuery } from "./useCreditMeterQuery";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

/** "Fyld op" for Admin, otherwise the line about asking an Admin. */
export function CreditTopUpAction({ fundId }: { fundId: string }) {
  const t = useT();
  const access = useMyAccess(fundId);
  const allowed = access.data?.capabilities?.includes("configure_fund") === true;
  const query = useCreditMeterQuery(fundId, allowed);
  if (access.isLoading || (allowed && query.isLoading)) return null;
  const meter = query.data;
  if (meter?.canTopUp) return <TopUp meter={meter} />;
  // The meter could not be loaded: an Admin must not be told to ask an Admin.
  if (allowed && !meter) return null;
  return <span className="text-list text-ink-3">{t("shell.credit.askAdmin")}</span>;
}

export function CreditStop({
  fundId,
  message,
  onlyWhenEmpty = false,
  className,
}: {
  fundId: string;
  message: string;
  /**
   * Shown only when the meter says the balance is used up: Brain's own monthly limit gives the
   * same refusal, and that one is not topped up. Only Admin and Lead can see the meter.
   */
  onlyWhenEmpty?: boolean;
  className?: string;
}) {
  const access = useMyAccess(fundId);
  const allowed = access.data?.capabilities?.includes("configure_fund") === true;
  const query = useCreditMeterQuery(fundId, allowed && onlyWhenEmpty);
  if (onlyWhenEmpty && query.data?.state !== "empty") return null;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] bg-critical-wash px-3.5 py-2.5",
        className,
      )}
    >
      <p className="m-0 min-w-0 flex-1 text-list text-critical">{message}</p>
      <CreditTopUpAction fundId={fundId} />
    </div>
  );
}
