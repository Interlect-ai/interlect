/**
 * The customer's credit ledger and settings in their own database (0070, 0071, 0077), written
 * with the installation's postgres role. A credit is a plain row in ai_credit_ledger: the
 * trigger from 0077 moves ai_settings.balance_dkk, and the unique (kind, ref_id) index makes a
 * top-up idempotent, so a run that stopped halfway is finished by running it again with its ref.
 */
import type pg from "pg";
import { SETTINGS, type CreditKind, type LedgerTotals, type UnpricedRuns } from "./credits.ts";

/**
 * Adds a credit and turns enforcement on (from the first top-up the credits are what the
 * installation may spend), in one transaction. Returns false when the ref was already added with
 * the same amount; a ref reused for another amount or kind is an error.
 */
export async function addCredit(
  client: pg.Client,
  credit: { kind: CreditKind; amountDkk: number; ref: string; note: string },
) {
  await client.query("begin");
  try {
    const existing = await client.query<{ kind: string; amount_dkk: string }>(
      `select kind, amount_dkk from public.ai_credit_ledger
        where ref_id = $1 and kind in ('gift', 'purchase')`,
      [credit.ref],
    );
    const previous = existing.rows[0];
    if (
      previous &&
      (previous.kind !== credit.kind || Number(previous.amount_dkk) !== credit.amountDkk)
    ) {
      throw new Error(
        `Ref ${credit.ref} was already used for a ${previous.kind} of ${previous.amount_dkk} kr; use a new ref`,
      );
    }
    if (!previous) {
      await client.query(
        `insert into public.ai_credit_ledger (kind, amount_dkk, ref_id, note) values ($1, $2, $3, $4)`,
        [credit.kind, credit.amountDkk, credit.ref, credit.note],
      );
    }
    await client.query(
      `update public.ai_settings set credits_enforced = true, updated_at = now()
        where id and not credits_enforced`,
    );
    await client.query("commit");
    return !previous;
  } catch (cause) {
    // A rollback on a dropped connection fails too; the original error is the one that matters.
    await client.query("rollback").catch(() => {});
    throw cause;
  }
}

export async function ledgerTotals(client: pg.Client): Promise<LedgerTotals> {
  const { rows } = await client.query<Record<string, string | boolean>>(
    `select
       coalesce(sum(l.amount_dkk) filter (where l.kind in ('gift', 'purchase')), 0) as credits,
       coalesce(sum(l.amount_dkk) filter (
         where l.kind = 'usage' and l.scope <> 'eval' and l.status <> 'released'), 0) as used,
       coalesce(sum(l.amount_dkk) filter (
         where l.kind = 'usage' and l.scope = 'eval' and l.status <> 'released'), 0) as eval,
       s.balance_dkk, s.usd_to_dkk, s.credits_enforced
     from public.ai_settings s
     left join public.ai_credit_ledger l on true
     where s.id
     group by s.balance_dkk, s.usd_to_dkk, s.credits_enforced`,
  );
  const row = rows[0];
  if (!row) throw new Error("ai_settings has no row: is this an Interlect database?");
  return {
    creditsDkk: Number(row["credits"]),
    usedDkk: Number(row["used"]),
    evalDkk: Number(row["eval"]),
    balanceDkk: Number(row["balance_dkk"]),
    usdToDkk: Number(row["usd_to_dkk"]),
    creditsEnforced: row["credits_enforced"] === true,
  };
}

/**
 * Finished analyses the gateway reported no price for: 0114 books what the run charged
 * against its budget, and a run that stored no such bound its whole reservation, so the
 * customer paid more than the run cost. `dkk` is what those runs were booked at in all (a run has
 * one reservation). Only for Interlect's view of an installation
 * (customer:settings); the customer never sees a price (P13), and Systemstatus is public.
 */
export async function unpricedRuns(client: pg.Client): Promise<UnpricedRuns> {
  const { rows } = await client.query<{ runs: string; dkk: string }>(
    `select count(distinct r.id) as runs, coalesce(sum(l.amount_dkk), 0) as dkk
       from public.analysis_runs r
       join public.ai_credit_ledger l
         on l.kind = 'usage' and l.scope = 'analysis' and l.ref_id = r.id and l.status = 'final'
      where r.status in ('complete', 'awaiting_approval') and r.actual_cost is null`,
  );
  return { runs: Number(rows[0]?.runs ?? 0), dkk: Number(rows[0]?.dkk ?? 0) };
}

const COLUMNS = SETTINGS.map((setting) => setting.column);

export async function readSettings(client: pg.Client) {
  const { rows } = await client.query<Record<string, unknown>>(
    `select ${COLUMNS.join(", ")} from public.ai_settings where id`,
  );
  if (!rows[0]) throw new Error("ai_settings has no row: is this an Interlect database?");
  return rows[0];
}

/** Writes only known columns; the database's own checks (0070, 0076) have the last word. */
export async function updateSettings(client: pg.Client, changes: Record<string, unknown>) {
  const entries = Object.entries(changes).filter(([column]) => COLUMNS.includes(column));
  if (entries.length === 0) return;
  const assignments = entries.map(([column], index) => `${column} = $${index + 1}`);
  const result = await client.query(
    `update public.ai_settings set ${assignments.join(", ")}, updated_at = now() where id`,
    entries.map(([, value]) => value),
  );
  if (result.rowCount !== 1) throw new Error("ai_settings was not updated");
}
