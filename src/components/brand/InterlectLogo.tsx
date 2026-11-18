import { cn } from "@/lib/utils";
import { InterlectMark, type MarkTone } from "./InterlectMark";

/**
 * Fuldt wordmark: symbol + "Interlect" (navnet har ingen ".ai").
 */
export function InterlectLogo({
  size = 28,
  tone = "brand",
  markOnly = false,
  wordmarkOnly = false,
  className,
}: {
  size?: number;
  tone?: MarkTone;
  markOnly?: boolean;
  wordmarkOnly?: boolean;
  className?: string;
}) {
  const fontSize = Math.round(size * 0.72);

  return (
    <span className={cn("inline-flex items-center gap-[3px]", className)}>
      {!wordmarkOnly && <InterlectMark size={size} tone={tone} title="Interlect" />}
      {!markOnly && (
        <span
          className="font-semibold leading-none text-ink"
          style={{ fontSize, letterSpacing: 0 }}
        >
          Interlect
        </span>
      )}
    </span>
  );
}
