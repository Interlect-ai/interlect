/**
 * Cuts text on Unicode code points, never inside a surrogate pair: Postgres rejects a lone
 * surrogate, and char_length checks count code points (harden, S4-18).
 */
export function clipCodePoints(text: string, max: number): string {
  if (text.length <= max) return text;
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
}
