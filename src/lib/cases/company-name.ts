// i18n-keep: the stored placeholder name's prefix, matched in code (the page shows its own text).
const PLACEHOLDER_NAME_PREFIX = "Ikke identificeret";

// Ord der typisk kun optræder i en tagline/sætning, aldrig i selve brandnavnet.
const TAGLINE_WORDS = new Set([
  "for",
  "your",
  "with",
  "the",
  "and",
  "a",
  "an",
  "of",
  "to",
  "is",
  "are",
  "we",
  "you",
]);

/**
 * Afviser tydelige sætninger/taglines (fx "Smarter spending for your
 * business" eller "High-quality carbon removal company") og kendte
 * pladsholdere, så vi ikke ved en fejl gemmer en marketing-sætning eller en
 * tom pladsholder som virksomhedens navn.
 */
export function looksLikeBrandName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /[.!?]$/.test(trimmed)) return false;
  if (trimmed.toLowerCase().startsWith(PLACEHOLDER_NAME_PREFIX.toLowerCase())) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  if (words.some((word) => TAGLINE_WORDS.has(word.toLowerCase()))) return false;
  // Et rigtigt flerords-brandnavn er stort set altid Title Case (fx "Nordic
  // Seed Partners"). Hvis alle ord efter det første starter med lille
  // bogstav, læser det som en almindelig sætning/tagline i stedet -- fx
  // "High-quality carbon removal company", hvor kun "High" er stort.
  if (words.length > 1 && words.slice(1).every((word) => /^[a-zà-ÿ]/.test(word))) {
    return false;
  }
  return true;
}

export function isPlaceholderCompanyName(name: string | null | undefined): boolean {
  return Boolean(name?.trim().startsWith(PLACEHOLDER_NAME_PREFIX));
}
