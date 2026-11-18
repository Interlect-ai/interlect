/**
 * The Geografi map's colours (O02, e). A country with cases starts at 55 % of the action
 * colour (the prototype's 35 % could hardly be seen, so Danmark with 11 cases did not stand out)
 * and is full at the most cases. Countries without cases are a light ink wash over the card,
 * which stays visible in dark (the old sunken grey was almost the card's own colour there).
 */
export const MAP_MIN_STRENGTH = 55;

export function countryFill(value: number | null, max: number): string {
  if (value === null || value <= 0) return "color-mix(in srgb, var(--ink-1) 9%, var(--bg-canvas))";
  const strength = Math.round(
    MAP_MIN_STRENGTH + ((100 - MAP_MIN_STRENGTH) * value) / Math.max(1, max),
  );
  return `color-mix(in srgb, var(--action) ${Math.min(100, strength)}%, var(--bg-canvas))`;
}
