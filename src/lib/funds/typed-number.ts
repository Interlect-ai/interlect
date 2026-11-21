/**
 * (TS-4): numbers typed in Teamopsætning. The fields show a number in the team's language
 * (Danish `500.000` and `2,5`, English `500,000` and `2.5`), and typing accepts both formats in
 * either language, so "1,500,000" is never read as 1,500 and "1.000" is never read as 1.
 *
 * Pure, so it can be tested with node --test.
 */

export type DecimalSeparator = "," | ".";

/** The decimal separator of a language tag: "da-DK" gives ",", "en-GB" gives ".". */
export function decimalSeparatorOf(localeTag: string): DecimalSeparator {
  const part = new Intl.NumberFormat(localeTag)
    .formatToParts(1.5)
    .find((item) => item.type === "decimal");
  return part?.value === "," ? "," : ".";
}

const count = (text: string, char: string) => text.split(char).length - 1;

/**
 * A number typed with or without grouping, or null when the text is not a number.
 *
 * - Both "," and "." in the text: the last one is the decimal separator, the other groups
 *   ("1.500.000,5" and "1,500,000.5").
 * - One kind used several times: grouping ("1.500.000", "1,500,000"); groups must be three digits.
 * - One separator once: the language's own decimal separator (`decimal`) is a decimal; otherwise
 *   the other separator groups when exactly three digits follow ("1.000" in Danish is 1,000) and
 *   is a decimal when not ("2.5" in Danish is 2.5). Without `decimal` (amounts in whole units)
 *   the three-digit rule decides in both languages ("500,000" and "500.000" are 500,000).
 *
 * Spaces (also the narrow spaces `Intl` puts in some languages) and apostrophes are ignored.
 */
export function parseTypedNumber(text: string, decimal?: DecimalSeparator): number | null {
  const raw = String(text).replace(/[\s\u00a0\u202f']/g, "");
  if (!/^[\d.,]*\d[\d.,]*$/.test(raw)) return null;
  const commas = count(raw, ",");
  const dots = count(raw, ".");
  let plain: string;
  if (commas && dots) {
    const point: DecimalSeparator = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
    const group = point === "," ? "." : ",";
    const [whole, fraction, ...rest] = raw.split(point);
    if (rest.length || fraction === undefined || fraction.includes(group)) return null;
    if (!isGrouped(whole!, group)) return null;
    plain = `${whole!.split(group).join("")}.${fraction}`;
  } else if (commas || dots) {
    const separator = commas ? "," : ".";
    const grouped = isGrouped(raw, separator);
    if (count(raw, separator) > 1) {
      if (!grouped) return null;
      plain = raw.split(separator).join("");
    } else if (separator !== decimal && grouped) {
      plain = raw.replace(separator, "");
    } else {
      plain = raw.replace(separator, ".");
    }
  } else {
    plain = raw;
  }
  const value = Number(plain);
  return Number.isFinite(value) ? value : null;
}

/** "1.500.000" with `.` (first group 1-3 digits, then groups of exactly three). */
function isGrouped(text: string, separator: DecimalSeparator): boolean {
  const [first, ...groups] = text.split(separator);
  return (
    /^\d{1,3}$/.test(first ?? "") && groups.length > 0 && groups.every((g) => /^\d{3}$/.test(g))
  );
}
