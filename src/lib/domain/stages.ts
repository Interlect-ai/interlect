/**
 * P1: de nye casestadier Vækst og Buyout / generationsskifte kan kun vælges, når fonden
 * selv har dem i sin stadieliste (fondens måde at slå dem til og fra). Fondens stadier er
 * fri tekst, så de genkendes på ord.
 */
const PATTERNS: Record<"growth" | "buyout", RegExp> = {
  growth: /v[æa]kst|growth|break-?even/i,
  buyout: /buyout|generationsskift|succession|ejerskifte/i,
};

export function fundAllowsStage(fundStages: string[], stage: "growth" | "buyout"): boolean {
  return fundStages.some((entry) => PATTERNS[stage].test(entry));
}
