/**
 * A number that counts ("Tal"): 600–900 ms ease-out with tabular figures; when the
 * value changes it counts from the old value, never from 0, and gets a 400 ms colour pulse
 * (never a "+N point" text). On first mount it counts up from 0 unless `fromZero` is off.
 * Number format in the fund's language (decimal comma in Danish, point in English). Built on @number-flow/react; before the custom
 * element is ready, and under reduced motion, the formatted number is shown as plain text.
 */
import NumberFlow from "@number-flow/react";
import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { useLocaleTag } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

export function CountUp({
  value,
  decimals = 0,
  fromZero = true,
  duration = 800,
  pulse = true,
  className,
  suffix,
}: {
  value: number;
  decimals?: number;
  fromZero?: boolean;
  /** Milliseconds (600–900). */
  duration?: number;
  /** Colour pulse when the value changes after mount. */
  pulse?: boolean;
  className?: string;
  suffix?: string;
}) {
  const reduced = useReducedMotion();
  const locale = useLocaleTag();
  const [shown, setShown] = useState(fromZero && !reduced ? 0 : value);
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef<number | null>(null);

  useEffect(() => {
    if (typeof customElements === "undefined") return;
    let cancelled = false;
    void customElements.whenDefined("number-flow-react").then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Next frame, so NumberFlow sees a change from the first shown value.
    const frame = requestAnimationFrame(() => setShown(value));
    const before = previous.current;
    previous.current = value;
    if (pulse && !reduced && before !== null && before !== value && ref.current) {
      const up = value > before;
      const el = ref.current;
      // Pulse from the signal colour back to the inherited colour, then hand the colour back
      // to the className (a muted or inverse number keeps its own colour).
      const inherited = getComputedStyle(el).color;
      void animate(
        el,
        { color: [up ? "var(--positive)" : "var(--critical)", inherited] },
        { duration: 0.4, ease: "easeOut" },
      ).then(() => {
        el.style.removeProperty("color");
      });
    }
    return () => cancelAnimationFrame(frame);
  }, [value, pulse, reduced]);

  const format = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  const text = new Intl.NumberFormat(locale, format).format(reduced ? value : shown);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {ready && !reduced ? (
        <NumberFlow
          value={shown}
          locales={locale}
          format={format}
          isolate
          willChange
          transformTiming={{ duration, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
          spinTiming={{ duration, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
          {...(suffix !== undefined ? { suffix } : {})}
        />
      ) : (
        `${text}${suffix ?? ""}`
      )}
    </span>
  );
}
