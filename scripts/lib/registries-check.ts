/**
 * Registertjek: hvad hvert lands register forventes at levere i dag, og hvordan et svar
 * bedømmes. Ren fil (intet netværk), så reglerne kan testes; selve kaldene står i
 * `scripts/registries-check.ts`.
 *
 * Forventningen følger og beslutningslogen: tal fra DK, NO, FI
 * (kun digitalt indsendte), LV, LT, FR og NL (kun deponerede); SE og EE venter på en gratis nøgle
 * eller aftale; PL, DE, ES og IT giver kun identitet. Et land, der skal virke og
 * ikke gør, gør tjekket rødt. Et land uden nøgle i miljøet springes over med en note, ikke rødt.
 */

export type Expectation = "yes" | "no";

export interface RegistryProbe {
  country: string;
  /** Registernummeret på ét kendt selskab, som registret har haft i flere år. */
  number: string;
  identity: Expectation;
  financials: Expectation;
  /** Hvorfor tallene ikke forventes, vist i tabellen. */
  note?: string;
  /**
   * En kendt fejl med sin ticket: vises som ⚠️ og gør ikke tjekket rødt, så længe ticketen er
   * åben. Fjernes, når ticketen er løst, så landet igen kan blive rødt.
   */
  knownIssue?: string;
}

export const PROBES: readonly RegistryProbe[] = [
  { country: "DK", number: "37561304", identity: "yes", financials: "yes" },
  { country: "NO", number: "998209218", identity: "yes", financials: "yes" },
  {
    country: "SE",
    number: "556012-5790",
    identity: "yes",
    financials: "yes",
    note: "kræver gratis nøgle (D21)",
  },
  { country: "FI", number: "0133265-6", identity: "yes", financials: "yes" },
  {
    country: "EE",
    number: "12417834",
    identity: "yes",
    financials: "no",
    note: "tal venter på aftale med RIK (D24)",
  },
  {
    country: "LV",
    number: "40203050078",
    identity: "yes",
    financials: "yes",
    knownIssue: "data.gov.lv svarer ikke fra GitHub eller skyen (fetch failed efter 21 s), T-948",
  },
  {
    country: "LT",
    number: "302767152",
    identity: "yes",
    financials: "yes",
    knownIssue: "get.data.gov.lt spærrer datacentre (svarer 500 fra GitHub og skyen), T-885",
  },
  { country: "FR", number: "794598813", identity: "yes", financials: "yes" },
  {
    country: "PL",
    number: "0000019193",
    identity: "yes",
    financials: "no",
    note: "kun identitet (D19)",
  },
  { country: "NL", number: "30204462", identity: "yes", financials: "yes" },
  {
    country: "DE",
    number: "529900DCE9HLEPY8MW24",
    identity: "yes",
    financials: "no",
    note: "kun identitet (D19)",
  },
  {
    country: "ES",
    number: "254900104NN37XK6MA89",
    identity: "yes",
    financials: "no",
    note: "kun identitet (D19)",
  },
  {
    country: "IT",
    number: "8156003EE5CFCCBBEB31",
    identity: "yes",
    financials: "no",
    note: "kun identitet (D19)",
  },
];

/** Hvad et opslag gav. `skipped`: nøglen mangler i miljøet; `error` er beskeden. */
export type Outcome =
  | { kind: "found"; detail: string }
  | { kind: "empty" }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; message: string };

export interface ProbeResult {
  probe: RegistryProbe;
  identity: Outcome;
  financials: Outcome;
  /** Seneste regnskabsår, når tallene kom. */
  latestYear: number | null;
  ms: number;
}

export type Cell = "ok" | "fail" | "known" | "not-expected" | "skipped";

/** Bedømmer ét felt: kun et forventet felt, der ikke kom, er en fejl (eller kendt med ticket). */
export function judge(expected: Expectation, outcome: Outcome, knownIssue?: string): Cell {
  if (outcome.kind === "skipped") return "skipped";
  if (outcome.kind === "found") return "ok";
  if (expected === "no") return "not-expected";
  return knownIssue ? "known" : "fail";
}

export interface Failure {
  country: string;
  field: "identitet" | "regnskabstal";
  message: string;
}

export function failures(results: readonly ProbeResult[]): Failure[] {
  const out: Failure[] = [];
  for (const result of results) {
    const fields = [
      ["identitet", result.probe.identity, result.identity],
      ["regnskabstal", result.probe.financials, result.financials],
    ] as const;
    for (const [field, expected, outcome] of fields) {
      if (judge(expected, outcome, result.probe.knownIssue) !== "fail") continue;
      out.push({
        country: result.probe.country,
        field,
        message:
          outcome.kind === "error"
            ? outcome.message
            : `${result.probe.number} gav intet svar fra registret`,
      });
    }
  }
  return out;
}

const SYMBOL: Record<Cell, string> = {
  ok: "✅",
  fail: "❌",
  known: "⚠️",
  "not-expected": "–",
  skipped: "⏭️",
};

function cellText(expected: Expectation, outcome: Outcome, knownIssue?: string): string {
  const cell = judge(expected, outcome, knownIssue);
  if (outcome.kind === "skipped") return `${SYMBOL[cell]} ${outcome.reason}`;
  if (outcome.kind === "found") return `${SYMBOL[cell]} ${outcome.detail}`;
  return SYMBOL[cell];
}

/** Markdown-tabellen: land · identitet · regnskabstal · seneste år · svartid. */
export function renderTable(results: readonly ProbeResult[]): string {
  const escape = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
  const lines = [
    "| Land | Identitet | Regnskabstal | Seneste år | Svartid | Note |",
    "|---|---|---|---|---|---|",
  ];
  for (const result of results) {
    const { probe } = result;
    const identity = cellText(probe.identity, result.identity, probe.knownIssue);
    const financials = cellText(probe.financials, result.financials, probe.knownIssue);
    const known =
      judge(probe.identity, result.identity, probe.knownIssue) === "known" ||
      judge(probe.financials, result.financials, probe.knownIssue) === "known";
    const errors = [result.identity, result.financials].flatMap((o) =>
      o.kind === "error" ? [o.message] : [],
    );
    const note = [...new Set([probe.note, known ? probe.knownIssue : undefined, ...errors])]
      .filter(Boolean)
      .join("; ");
    lines.push(
      `| ${probe.country} | ${escape(identity)} | ${escape(financials)} | ${
        result.latestYear ?? "–"
      } | ${(result.ms / 1000).toFixed(1)} s | ${escape(note)} |`,
    );
  }
  return lines.join("\n");
}
