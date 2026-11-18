/**
 * Konsistensmåling (masterplan P4, beslutning 25/9-2026): når samme case screenes flere
 * gange med samme tese, viser spredningen, hvor stabil modellen er. Ren fil, så den kan
 * testes med node --test.
 */

export interface ScreeningRunScore {
  runId: string;
  configVersionId: string;
  completedAt: string;
  overallScore: number | null;
  criterionScores: Record<string, number | null>;
}

export interface ConsistencySummary {
  /** Kørsler med samme tese som den aktuelle, ældste først. */
  runs: Array<{ runId: string; completedAt: string; score: number }>;
  /** Højeste minus laveste samlede score (point). Null ved under to kørsler. */
  spread: number | null;
  /** Kriterier sorteret efter størst spredning, kun dem der svinger. */
  volatileCriteria: Array<{ key: string; spread: number }>;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

export function summarizeConsistency(
  all: ScreeningRunScore[],
  configVersionId: string,
): ConsistencySummary {
  const same = all
    .filter((run) => run.configVersionId === configVersionId && run.overallScore !== null)
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1));
  const runs = same.map((run) => ({
    runId: run.runId,
    completedAt: run.completedAt,
    score: run.overallScore as number,
  }));
  if (runs.length < 2) return { runs, spread: null, volatileCriteria: [] };
  const scores = runs.map((run) => run.score);
  const spread = round(Math.max(...scores) - Math.min(...scores));
  const keys = new Set(same.flatMap((run) => Object.keys(run.criterionScores)));
  const volatileCriteria = [...keys]
    .map((key) => {
      const values = same
        .map((run) => run.criterionScores[key])
        .filter((value): value is number => typeof value === "number");
      return {
        key,
        spread: values.length >= 2 ? round(Math.max(...values) - Math.min(...values)) : 0,
      };
    })
    .filter((item) => item.spread > 0)
    .sort((a, b) => b.spread - a.spread);
  return { runs, spread, volatileCriteria };
}
