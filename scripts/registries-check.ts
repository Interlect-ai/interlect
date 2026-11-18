/**
 * Registertjek: kalder hvert lands register live med ét kendt selskab og skriver en tabel
 * (land · identitet · regnskabstal · seneste år · svartid). Gratis: ingen AI og ingen database,
 * kun registrenes egne, åbne API'er gennem de samme adaptere som screeningen.
 *
 *   npm run registries:check
 *
 * Stopper med kode 1, hvis et land, der skal virke (se `scripts/lib/registries-check.ts`), ikke
 * svarer. Danmarks identitet kræver `DATAFORDELER_API_KEY` og Sverige `BOLAGSVERKET_CLIENT_ID` og
 * `_SECRET`; uden dem springes de over med en note. Kører ugentligt og før release i
 * `.github/workflows/registries-check.yml`; i GitHub skrives tabellen i kørslens resumé og hver
 * fejl som en annotation.
 */
import { appendFileSync } from "node:fs";
import { lookupCvrByNumber } from "../src/lib/analysis/cvr-lookup.ts";
import {
  fetchAndParseFiling,
  searchVirkFilings,
} from "../src/lib/analysis/financial-statements.ts";
import {
  registryAdapter,
  type ForeignRegistryCountry,
} from "../src/lib/analysis/registries/index.ts";
import {
  failures,
  PROBES,
  renderTable,
  type Outcome,
  type ProbeResult,
  type RegistryProbe,
} from "./lib/registries-check.ts";

const TIMEOUT_MS = 90_000;
const RETRY_AFTER_MS = 65_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: intet svar efter 90 s`)), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function errorOutcome(error: unknown): Outcome {
  return { kind: "error", message: error instanceof Error ? error.message : String(error) };
}

async function probeDenmark(probe: RegistryProbe): Promise<Omit<ProbeResult, "probe" | "ms">> {
  let identity: Outcome;
  if (!process.env["DATAFORDELER_API_KEY"]?.trim()) {
    identity = { kind: "skipped", reason: "DATAFORDELER_API_KEY mangler" };
  } else {
    try {
      const company = await withTimeout(lookupCvrByNumber(probe.number), "CVR");
      identity = company ? { kind: "found", detail: company.name } : { kind: "empty" };
    } catch (error) {
      identity = errorOutcome(error);
    }
  }
  // Regnskaberne kommer fra Erhvervsstyrelsens åbne indeks og XBRL-filer, uden nøgle.
  let financials: Outcome;
  let latestYear: number | null = null;
  try {
    const filings = await withTimeout(searchVirkFilings(probe.number), "Virk-indekset");
    const newest = filings[0];
    const parsed = newest
      ? await withTimeout(fetchAndParseFiling(newest.documentUrl), "XBRL-filen")
      : null;
    const facts = parsed?.periods[0]?.facts.length ?? 0;
    if (newest && facts > 0) {
      latestYear = Number(newest.periodEnd.slice(0, 4));
      financials = { kind: "found", detail: `${facts} poster` };
    } else {
      financials = { kind: "empty" };
    }
  } catch (error) {
    financials = errorOutcome(error);
  }
  return { identity, financials, latestYear };
}

async function probeForeign(probe: RegistryProbe): Promise<Omit<ProbeResult, "probe" | "ms">> {
  const adapter = registryAdapter(probe.country as ForeignRegistryCountry);
  if (!adapter.configured()) {
    const skipped: Outcome = { kind: "skipped", reason: "nøgle mangler" };
    return { identity: skipped, financials: skipped, latestYear: null };
  }
  let identity: Outcome;
  try {
    const company = await withTimeout(adapter.lookupByNumber(probe.number), adapter.registryName);
    identity = company ? { kind: "found", detail: company.name } : { kind: "empty" };
  } catch (error) {
    identity = errorOutcome(error);
  }
  let financials: Outcome;
  let latestYear: number | null = null;
  try {
    const result = await withTimeout(adapter.fetchStatements(probe.number), adapter.registryName);
    const newest = result.statements.find((statement) => statement.lineItems.length > 0);
    if (newest) {
      latestYear = Number(newest.periodEnd.slice(0, 4));
      financials = {
        kind: "found",
        detail: `${newest.lineItems.length} poster, ${newest.currency}`,
      };
    } else {
      financials = { kind: "empty" };
    }
  } catch (error) {
    financials = errorOutcome(error);
  }
  return { identity, financials, latestYear };
}

async function attempt(probe: RegistryProbe): Promise<ProbeResult> {
  const started = Date.now();
  const outcome = probe.country === "DK" ? await probeDenmark(probe) : await probeForeign(probe);
  return { probe, ...outcome, ms: Date.now() - started };
}

/**
 * Et land, der fejler, prøves én gang til efter 65 s: KVK tillader ét kald i minuttet pr.
 * IP-adresse, og et register kan have et kort udfald. Fejler det igen, er fejlen rigtig.
 */
async function run(probe: RegistryProbe): Promise<ProbeResult> {
  const first = await attempt(probe);
  if (failures([first]).length === 0) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  return attempt(probe);
}

// Landene kaldes samtidig, ét kald ad gangen pr. land.
const results = await Promise.all(PROBES.map(run));
const table = renderTable(results);
const failed = failures(results);

console.log(table);
console.log("");
for (const failure of failed) {
  // Annotationen i GitHub; uden for Actions er det bare en linje i loggen.
  console.log(`::error title=Register ${failure.country}::${failure.field}: ${failure.message}`);
}
console.log(
  failed.length === 0
    ? "Alle lande, der skal virke, svarede."
    : `${failed.length} fejl i lande, der skal virke.`,
);

const summary = process.env["GITHUB_STEP_SUMMARY"];
if (summary) {
  appendFileSync(
    summary,
    [
      "## Registertjek (T-875)",
      "",
      table,
      "",
      "✅ svarede · ❌ skal virke, men svarede ikke · ⚠️ kendt fejl med ticket · – forventes ikke i dag · ⏭️ nøgle mangler",
      "",
      failed.length === 0
        ? "**Alle lande, der skal virke, svarede.**"
        : `**${failed.length} fejl:** ${failed.map((f) => `${f.country} (${f.field})`).join(", ")}`,
      "",
    ].join("\n"),
  );
}

process.exit(failed.length === 0 ? 0 : 1);
