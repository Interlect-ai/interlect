/**
 * One fixed colour per stage key, so a stage has the same colour in the stage donut and in the
 * stage bars, whatever the filter or the order of the list.
 */
const STAGE_COLOR_ORDER = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "later",
  "growth",
  "buyout",
] as const;

export function stageColor(stage: string): string {
  if (stage === "unknown") return "var(--hairline-strong)";
  const index = (STAGE_COLOR_ORDER as readonly string[]).indexOf(stage);
  if (index >= 0) return `var(--series-${index + 1})`;
  // A stage the fund wrote itself: a colour from its text, the same every time.
  let hash = 0;
  for (const char of stage) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `var(--series-${(hash % STAGE_COLOR_ORDER.length) + 1})`;
}
