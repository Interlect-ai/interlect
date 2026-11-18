/**
 * D-6: mandatets segmenter i lister (caselisten, Overblik). Ét mærke pr. konfigureret krav
 * i den aktive fondsprofil, med kravets behandling (bindende eller til vurdering), så et
 * bindende brud kan ses i listen. Et krav, AI'en ikke har svaret på, er "ikke afklaret".
 */
import { financeGateTreatment, isFinanceGate } from "../analysis/financial-gates.ts";

export type GateMark = "passed" | "hard_breach" | "review_breach" | "unknown";

export function gateMarks(
  assessed: Array<{ gateKey?: string; passed?: boolean | null }>,
  profileGates: Array<{ key: string; treatment: "hard" | "review" }>,
): GateMark[] {
  const byKey = new Map(assessed.map((gate) => [gate.gateKey, gate.passed ?? null]));
  return profileGates.map((gate) => {
    const passed = byKey.get(gate.key) ?? null;
    if (passed === true) return "passed";
    if (passed === null) return "unknown";
    const treatment = isFinanceGate(gate.key) ? financeGateTreatment(gate.key) : gate.treatment;
    return treatment === "hard" ? "hard_breach" : "review_breach";
  });
}
