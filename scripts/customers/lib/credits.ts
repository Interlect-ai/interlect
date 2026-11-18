/**
 * Pure rules behind customer:topup and customer:settings: the Vercel budget that backs a
 * customer's credits, the installation settings that may be changed, and the check that a
 * database URL belongs to the customer it is used for. No I/O, so it is unit tested.
 */

export type CreditKind = "gift" | "purchase";

/** Finished analyses booked at their cap because the gateway reported no price. */
export type UnpricedRuns = { runs: number; dkk: number };

/** What the ledger says, in kroner (ai_credit_ledger, ai_settings). */
export type LedgerTotals = {
  /** Every gift and purchase ever added. */
  creditsDkk: number;
  /** The customer's own usage (analysis, chat, Brain), reserved or final. */
  usedDkk: number;
  /** Eval usage: paid by Interlect, not drawn from the credits, but run through the same project. */
  evalDkk: number;
  /** ai_settings.balance_dkk: credits minus the customer's own usage. */
  balanceDkk: number;
  usdToDkk: number;
  creditsEnforced: boolean;
};

/** Vercel's smallest budget. */
export const MIN_BUDGET_USD = 1;

/**
 * The project budget at Vercel is the safety net under the ledger (02-TRD §4): it stops the
 * installation's AI calls if our own accounting fails. It equals everything that may be spent
 * through the project: every credit ever added plus the eval Interlect has paid for. It never
 * resets (refreshPeriod "none"), so it is recomputed at every top-up. Rounded up to whole dollars:
 * Vercel keeps one decimal and must never round the net below what was added.
 */
export function budgetLimitUsd(totals: Pick<LedgerTotals, "creditsDkk" | "evalDkk" | "usdToDkk">) {
  const usd = (totals.creditsDkk + totals.evalDkk) / totals.usdToDkk;
  return Math.max(MIN_BUDGET_USD, Math.ceil(usd - 1e-6));
}

/**
 * Vercel meters a budget from the moment it is created, so its spend can only trail the ledger.
 * Spend above the ledger's means our ledger undercounts, and the safety net will stop the
 * customer while they still have credits. Small differences (prices rounded by the gateway) are
 * allowed.
 */
export function spendDrift(vercelSpendUsd: number, totals: LedgerTotals) {
  const vercelDkk = vercelSpendUsd * totals.usdToDkk;
  const ledgerDkk = totals.usedDkk + totals.evalDkk;
  const toleranceDkk = Math.max(5, ledgerDkk * 0.05);
  return { vercelDkk, ledgerDkk, ahead: vercelDkk > ledgerDkk + toleranceDkk };
}

/** A positive amount in kroner with at most two decimals ("1500", "249,50" or "249.50"). */
export function parseDkk(raw: string | undefined, flag = "--dkk") {
  const text = (raw ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error(`${flag} must be an amount in kroner, got "${raw ?? ""}"`);
  const amount = Number(text);
  if (amount <= 0 || amount > 1_000_000)
    throw new Error(`${flag} must be above 0 and at most 1,000,000`);
  return amount;
}

type Value = number | string | boolean;
type Setting = { flag: string; column: string; parse: (raw: string) => Value };

function numberIn(min: number, max: number, { exclusiveMin = false, integer = false } = {}) {
  return (raw: string) => {
    const value = Number(raw.trim().replace(",", "."));
    const ok =
      raw.trim() !== "" &&
      Number.isFinite(value) &&
      (exclusiveMin ? value > min : value >= min) &&
      value <= max &&
      (!integer || Number.isInteger(value));
    if (!ok) {
      const range = `${exclusiveMin ? "above" : "at least"} ${min} and at most ${max}`;
      throw new Error(`must be ${integer ? "a whole number " : ""}${range}, got "${raw}"`);
    }
    return value;
  };
}

function oneOf(...options: string[]) {
  return (raw: string) => {
    if (!options.includes(raw))
      throw new Error(`must be one of ${options.join(", ")}, got "${raw}"`);
    return raw;
  };
}

function onOff(raw: string) {
  if (raw === "on") return true;
  if (raw === "off") return false;
  throw new Error(`must be on or off, got "${raw}"`);
}

/** The installation settings in ai_settings (0070, 0071, 0076, 0085), with the database's own limits. */
export const SETTINGS: readonly Setting[] = [
  { flag: "usd-to-dkk", column: "usd_to_dkk", parse: numberIn(0, 100, { exclusiveMin: true }) },
  { flag: "brain-share-pct", column: "brain_share_pct", parse: numberIn(0, 100) },
  {
    flag: "brain-pause-at-remaining-pct",
    column: "brain_pause_at_remaining_pct",
    parse: numberIn(0, 100),
  },
  { flag: "brain-dkk-per-new-case", column: "brain_dkk_per_new_case", parse: numberIn(0, 1000) },
  { flag: "brain-dkk-per-decision", column: "brain_dkk_per_decision", parse: numberIn(0, 1000) },
  { flag: "eval-monthly-cap-dkk", column: "eval_monthly_cap_dkk", parse: numberIn(0, 10_000) },
  {
    flag: "max-custom-specialists",
    column: "max_custom_specialists",
    parse: numberIn(0, 6, { integer: true }),
  },
  { flag: "credits-enforced", column: "credits_enforced", parse: onOff },
  { flag: "display-currency", column: "display_currency", parse: oneOf("DKK", "EUR") },
  {
    flag: "dkk-per-display-unit",
    column: "dkk_per_display_unit",
    parse: numberIn(0, 100, { exclusiveMin: true }),
  },
  { flag: "default-language", column: "default_language", parse: oneOf("da", "en") },
];

/**
 * Turns the given flags into column changes. DKK is always 1 krone per unit, so switching to DKK
 * sets the rate too; EUR needs its fixed rate (no live rate in 1.0).
 */
export function settingChanges(flags: Record<string, string | undefined>) {
  const changes: Record<string, Value> = {};
  for (const setting of SETTINGS) {
    const raw = flags[setting.flag];
    if (raw === undefined) continue;
    try {
      changes[setting.column] = setting.parse(raw);
    } catch (cause) {
      throw new Error(`--${setting.flag} ${(cause as Error).message}`);
    }
  }
  const currency = changes["display_currency"];
  if (currency === "DKK") {
    if (changes["dkk_per_display_unit"] !== undefined && changes["dkk_per_display_unit"] !== 1) {
      throw new Error("--dkk-per-display-unit must be 1 for DKK");
    }
    changes["dkk_per_display_unit"] = 1;
  }
  if (currency === "EUR" && changes["dkk_per_display_unit"] === undefined) {
    throw new Error(
      "--display-currency EUR needs --dkk-per-display-unit (kroner per euro, e.g. 7.46)",
    );
  }
  return changes;
}

/**
 * The Supabase project a Postgres URL points at: the direct host (db.<ref>.supabase.co) or the
 * pooler user (postgres.<ref>). Null for anything else.
 */
export function supabaseRefOf(databaseUrl: string) {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  const host = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (host) return host[1] ?? null;
  const user = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(url.username));
  if (user && url.hostname.endsWith(".pooler.supabase.com")) return user[1] ?? null;
  return null;
}
