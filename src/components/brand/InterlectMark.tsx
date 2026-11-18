import { cn } from "@/lib/utils";

export type MarkTone = "brand" | "mono" | "inverse" | "current";

/**
 * Interlect-symbolet: to forskudte, parallelle former der griber ind i
 * hinanden og efterlader en smal negativ passage — evidensspor der
 * forskydes ind i én beslutning. Rent geometrisk, ét fladt lag.
 *
 * Passagen er ~3.33/32 af bredden, så den holder over 1.5px ved 16px.
 */
export function InterlectMark({
  size = 24,
  tone = "brand",
  className,
  title,
}: {
  size?: number;
  tone?: MarkTone;
  className?: string;
  title?: string;
}) {
  const fill =
    tone === "brand"
      ? "var(--brand-coral)"
      : tone === "mono"
        ? "var(--ink)"
        : tone === "inverse"
          ? "var(--surface)"
          : "currentColor";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn("shrink-0", className)}
    >
      {title && <title>{title}</title>}
      <path d="M7 6 H15 L11 30 H3 Z" fill={fill} />
      <path d="M19 2 H27 L23 26 H15 Z" fill={fill} />
    </svg>
  );
}
