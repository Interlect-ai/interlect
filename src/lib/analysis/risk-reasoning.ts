/**
 * Does a risk's rationale reason about both likelihood and impact? The deep analysis' quality
 * check refuses a risk that does not. The rationale is written in the fund's language,
 * so the words are matched in Danish and in English (an English fund's analysis was refused because
 * only "sandsynlig"/"konsekvens" were looked for).
 */
const LIKELIHOOD = /sandsynlig|likelihood|likely|probabilit/i;
const IMPACT = /konsekvens|impact|consequence/i;

export function reasonsLikelihoodAndImpact(rationale: string): {
  likelihood: boolean;
  impact: boolean;
} {
  return { likelihood: LIKELIHOOD.test(rationale), impact: IMPACT.test(rationale) };
}
