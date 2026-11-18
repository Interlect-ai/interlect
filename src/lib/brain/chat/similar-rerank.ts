/**
 * "Similar cases" rerank (exam package D2): the profile vector finds look-alikes, and this
 * lifts the ones in the same sector (and stage) a little, so a case that merely reads alike in
 * another line of business does not beat one in the same line. A bonus on the vector rank, not a
 * filter: a much closer vector still wins. Pure (tested in similar-rerank.test.ts).
 */
export type SimilarProfile = { sector: string | null; stage: string | null };

export const SECTOR_BONUS = 0.05;
export const STAGE_BONUS = 0.01;
/** Rank 1 scores 1 / (1 + RANK_OFFSET); the offset keeps the bonus a nudge, not an override. */
export const RANK_OFFSET = 5;

const same = (a: string | null, b: string | null) =>
  a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Keeps the input order for equal scores; `candidates` come best vector match first. */
export function rerankSimilar<T extends SimilarProfile>(
  focus: SimilarProfile | null,
  candidates: readonly T[],
): T[] {
  if (!focus) return [...candidates];
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score:
        1 / (index + 1 + RANK_OFFSET) +
        (same(focus.sector, candidate.sector) ? SECTOR_BONUS : 0) +
        (same(focus.stage, candidate.stage) ? STAGE_BONUS : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.candidate);
}

/** A company name without trailing parentheses ("(demo 35)", "(case)") and legal form, lowercase. */
export function bareCompanyName(name: string): string {
  let bare = name.trim();
  while (/\s*\([^()]*\)\s*$/.test(bare)) bare = bare.replace(/\s*\([^()]*\)\s*$/, "");
  return bare
    .replace(/[\s,]+(ApS|A\/S|AB|AS|ASA|Oy|Oyj|GmbH|BV|B\.V\.|SA|S\.A\.|Ltd\.?|Inc\.?)$/i, "")
    .trim()
    .toLowerCase();
}

/**
 * A look-alike that only shares the case's name: another company with the same bare name.
 * Shown to the model as a flag, never used to rank, so neither the name nor its absence decides.
 */
export function isNameTwin(
  focus: { name: string; companyId: string } | null,
  candidate: { name: string; companyId: string },
): boolean {
  if (!focus || focus.companyId === candidate.companyId) return false;
  const bare = bareCompanyName(focus.name);
  return bare.length >= 2 && bare === bareCompanyName(candidate.name);
}
