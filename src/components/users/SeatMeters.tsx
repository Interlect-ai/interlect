/**
 * The two seat counters at the top right (prototype: "6 af 8 pladser", "2 af 5 læsere").
 * Beslutning 7 and the review: only this fund's own counts are shown, never the
 * installation's limit or whether it is reached (the server decides and refuses with a clear
 * text), so there are no ticks.
 */
import { CountUp } from "@/components/ds/CountUp";
import { seatCounterText, type FundSeatUsage } from "@/lib/auth/fund-seats";
import { useLanguage, useT } from "@/lib/i18n/useT";

function Meter({
  used,
  noun,
  label,
}: {
  used: number;
  noun: { one: string; many: string };
  label: string;
}) {
  const language = useLanguage();
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-[190px] flex-col gap-2 rounded-lg bg-canvas px-4 py-3.5"
    >
      <span className="flex items-baseline gap-2">
        <span className="text-title font-semibold tracking-title">
          <CountUp value={used} />
        </span>
        <span className="text-list text-ink-3">{seatCounterText(used, null, noun, language)}</span>
      </span>
    </div>
  );
}

export function SeatMeters({ usage }: { usage: FundSeatUsage | undefined }) {
  const t = useT();
  if (!usage) return null;
  return (
    <>
      <Meter
        used={usage.seatsUsed}
        noun={{ one: t("users.seats.seatOne"), many: t("users.seats.seatMany") }}
        label={t("users.seats.seatsLabel")}
      />
      <Meter
        used={usage.readersUsed}
        noun={{ one: t("users.seats.readerOne"), many: t("users.seats.readerMany") }}
        label={t("users.seats.readersLabel")}
      />
    </>
  );
}
