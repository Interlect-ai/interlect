/**
 * C8-opfølgning (0028): et økonomi-kriterium (financial_strength) forankres i kode-scoren fra
 * regnskaberne, medmindre fonden har fravalgt det. Ældre versioner uden valget er forankret.
 */
export function isCodeAnchored(criterion: { category: string; codeAnchor?: boolean | undefined }) {
  return criterion.category === "financial_strength" && criterion.codeAnchor !== false;
}
