/**
 * Toggle ("Toggle (fast spec)"): track 46×28, radius 14, padding 3; 22 px white
 * thumb with a soft shadow; on = --positive and the thumb moves 18 px. The thumb uses the
 * snappy spring (replacing the prototype's cubic-bezier(.34,1.4,.64,1)), the track colour
 * fades 200 ms, and while pressed the thumb stretches 2 px towards where it is going, as on
 * iOS ("Toggle").
 */
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function Toggle({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when no visible label is linked. */
  label?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  // 2 px longer while pressed, anchored on the side it leaves (transform only, no width).
  const stretch = pressed && !reduced ? 24 / 22 : 1;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onBlur={() => setPressed(false)}
      className={cn(
        "box-border block h-7 w-[46px] flex-none cursor-pointer rounded-[14px] p-[3px] outline-none transition-colors duration-200 ease-standard",
        "focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      style={{ background: checked ? "var(--positive)" : "var(--line-strong)" }}
    >
      <motion.span
        className="block size-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.18),0_2px_6px_rgba(0,0,0,.08)]"
        style={{ originX: checked ? 1 : 0 }}
        initial={false}
        animate={{ x: checked ? 18 : 0, scaleX: stretch }}
        transition={reduced ? { duration: 0 } : SPRING.snappy}
      />
    </button>
  );
}
