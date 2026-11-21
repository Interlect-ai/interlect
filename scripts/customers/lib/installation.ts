/**
 * The customer's own database during customer:new: migrations, the check that the
 * installation is complete, its settings, its first fund and the admin's invitation. Written with
 * the installation's postgres role over the session pooler, each step in one transaction, and
 * each step safe to run again.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { FundConfigTemplate } from "../../../src/lib/funds/config-templates.ts";
import { fundDraftRows } from "../../../src/lib/funds/fund-draft.ts";
import { settingChanges } from "./credits.ts";
import { databaseClient } from "./instance.ts";
import { updateSettings } from "./ledger.ts";
import { INVITATION_DAYS, settingFlags, type CustomerOptions } from "./provision.ts";

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * A new project's pooler can refuse its tenant for a few minutes, so the first connect waits.
 * A password set a moment ago (freshDatabaseUrl) can take the pooler a little while to see, so
 * authRetryMs keeps trying a refused password for that long; after it, a wrong password fails.
 */
export async function connect(
  databaseUrl: string,
  options: { timeoutMs?: number; authRetryMs?: number; onWait?: (message: string) => void } = {},
) {
  const { timeoutMs = 5 * 60_000, authRetryMs = 0, onWait = () => {} } = options;
  const started = Date.now();
  const deadline = started + timeoutMs;
  for (;;) {
    const client = databaseClient(databaseUrl);
    try {
      await client.connect();
      await client.query("select 1");
      return client;
    } catch (cause) {
      await client.end().catch(() => {});
      const message = (cause as Error).message;
      const refused = /password authentication failed/i.test(message);
      if ((refused && Date.now() - started >= authRetryMs) || Date.now() >= deadline) {
        throw new Error(`Could not connect to the customer's database: ${message}`);
      }
      onWait(message);
      await sleep(10_000);
    }
  }
}

export function migrationFiles(root: string) {
  return readdirSync(join(root, "db", "migrations"))
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .sort();
}

/** The same runner as the migrations workflow, so a customer gets exactly what staging got. */
export function runMigrations(root: string, databaseUrl: string) {
  const env: Record<string, string | undefined> = { ...process.env, DATABASE_URL: databaseUrl };
  delete env["MIGRATIONS_UNTIL"];
  delete env["MIGRATIONS_DRY_RUN"];
  const result = spawnSync(process.execPath, [join(root, "scripts", "run-migrations.mjs")], {
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      "A migration failed (that file rolled itself back; see the log above). Fix it and run again.",
    );
  }
}

/** Storage buckets the migrations create (0004, 0053). */
const BUCKETS = ["brain-sources", "pitch-decks"];
/** Tables that the app reads as the signed-in user; without select on them nobody can work. */
const CORE_USER_TABLES = ["funds", "fund_memberships", "cases", "fund_config_versions"];

/**
 * Problems that make the installation unsafe or incomplete; empty when it is ready. Compared with
 * staging: every migration applied, both extensions and buckets, the settings row,
 * RLS on every public table, no table or view readable by anon, no public bucket, service_role
 * able to read everything but the migration log.
 */
export async function installationProblems(client: pg.Client, files: string[]) {
  const problems: string[] = [];
  const applied = new Set(
    (
      await client.query<{ filename: string }>("select filename from public.schema_migrations")
    ).rows.map((row) => row.filename),
  );
  const missing = files.filter((file) => !applied.has(file));
  if (missing.length > 0) problems.push(`migrations not applied: ${missing.join(", ")}`);

  const { rows } = await client.query<Record<string, string[] | null | number>>(
    `
    select
      (select array_agg(e) from unnest(array['vector', 'pg_trgm']) e
        where not exists (select 1 from pg_extension where extname = e)) as missing_extensions,
      (select array_agg(b) from unnest($1::text[]) b
        where not exists (select 1 from storage.buckets where id = b)) as missing_buckets,
      (select count(*) from public.ai_settings where id)::int as settings_rows,
      (select array_agg(c.relname::text order by c.relname) from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity) as without_rls,
      (select array_agg(c.relname::text order by c.relname) from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
          and has_table_privilege('anon', c.oid, 'select')) as anon_readable,
      (select array_agg(id order by id) from storage.buckets where public) as public_buckets,
      (select array_agg(c.relname::text order by c.relname) from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'schema_migrations'
          and not has_table_privilege('service_role', c.oid, 'select')) as service_blind,
      (select array_agg(t) from unnest($2::text[]) t
        where to_regclass('public.' || t) is null
           or not has_any_column_privilege('authenticated', ('public.' || t)::regclass, 'select'))
        as user_blind
  `,
    [BUCKETS, CORE_USER_TABLES],
  );
  const row = rows[0] ?? {};
  const list = (key: string) => (row[key] as string[] | null) ?? [];
  if (list("missing_extensions").length)
    problems.push(`extensions missing: ${list("missing_extensions").join(", ")}`);
  if (list("missing_buckets").length)
    problems.push(`storage buckets missing: ${list("missing_buckets").join(", ")}`);
  if (row["settings_rows"] !== 1) problems.push("ai_settings has no row");
  if (list("without_rls").length)
    problems.push(`tables without RLS: ${list("without_rls").join(", ")}`);
  if (list("anon_readable").length)
    problems.push(`tables or views anon can read: ${list("anon_readable").join(", ")}`);
  if (list("public_buckets").length)
    problems.push(`public storage buckets: ${list("public_buckets").join(", ")}`);
  if (list("service_blind").length)
    problems.push(`tables service_role cannot read: ${list("service_blind").join(", ")}`);
  if (list("user_blind").length)
    problems.push(`tables signed-in users cannot read: ${list("user_blind").join(", ")}`);
  return problems;
}

/** Language, currency and enforcement (on from the start; the first top-up adds credits). */
export async function applySettings(client: pg.Client, options: CustomerOptions) {
  await updateSettings(client, settingChanges(settingFlags(options)));
}

/**
 * The customer's first fund: named after the customer, in its language, with version 1 as a
 * draft from the template (exactly as createFund makes one), so the admin finishes and publishes
 * it in Fondsopsætning. No members: the admin joins by accepting the invitation. Reason codes,
 * Brain budgets and the language default come from the funds triggers (0033, 0040, 0085).
 * Found again by its slug, so a run that stopped after the commit does not make a second fund.
 */
export async function ensureFirstFund(
  client: pg.Client,
  input: { name: string; slug: string; language: "da" | "en"; template: FundConfigTemplate },
) {
  const existing = await client.query<{ id: string }>(
    "select id from public.funds where slug = $1",
    [input.slug],
  );
  if (existing.rows[0]) return { fundId: existing.rows[0].id, created: false };

  const draft = fundDraftRows(input.template, input.slug, input.language);
  await client.query("begin");
  try {
    const fund = await client.query<{ id: string }>(
      "insert into public.funds (name, slug, language) values ($1, $2, $3) returning id",
      [input.name, input.slug, input.language],
    );
    const fundId = fund.rows[0]!.id;
    const config = await client.query<{ id: string }>(
      `insert into public.fund_config_versions (fund_id, version, profile_key, status, source_basis)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        fundId,
        draft.config.version,
        draft.config.profile_key,
        draft.config.status,
        draft.config.source_basis,
      ],
    );
    const configId = config.rows[0]!.id;
    const mandate = draft.mandate;
    await client.query(
      `insert into public.fund_mandates (config_version_id, thesis, stages, geographies, sectors,
         ticket_min_eur, ticket_max_eur, ticket_note, analysis_threshold, approval_mode,
         risk_posture, strategy_type, stage_expectations, dealbreakers)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)`,
      [
        configId,
        mandate.thesis,
        mandate.stages,
        mandate.geographies,
        mandate.sectors,
        mandate.ticket_min_eur,
        mandate.ticket_max_eur,
        mandate.ticket_note,
        mandate.analysis_threshold,
        mandate.approval_mode,
        mandate.risk_posture,
        mandate.strategy_type,
        JSON.stringify(mandate.stage_expectations),
        mandate.dealbreakers,
      ],
    );
    for (const gate of draft.gates) {
      await client.query(
        `insert into public.mandate_gates (config_version_id, gate_key, label, description, treatment, sort_order)
         values ($1, $2, $3, $4, $5, $6)`,
        [configId, gate.gate_key, gate.label, gate.description, gate.treatment, gate.sort_order],
      );
    }
    for (const criterion of draft.criteria) {
      await client.query(
        `insert into public.assessment_criteria
           (config_version_id, criterion_key, label, description, score_category, weight, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          configId,
          criterion.criterion_key,
          criterion.label,
          criterion.description,
          criterion.score_category,
          criterion.weight,
          criterion.sort_order,
        ],
      );
    }
    await client.query("commit");
    return { fundId, created: true };
  } catch (cause) {
    await client.query("rollback").catch(() => {});
    throw cause;
  }
}

export type InviteResult =
  | { status: "created"; invitationId: string; token: string; expiresAt: string }
  | { status: "pending"; invitationId: string; expiresAt: string }
  | { status: "accepted"; invitationId: string };

/**
 * Invites the customer's admin to the first fund through the app's own invitations (0001): the
 * token is shown once and only its SHA-256 is stored, exactly as createInvitation does, and the
 * link creates the account with a password. A pending invitation is kept unless reinvite is set;
 * a new link revokes every earlier one that was not taken (also expired ones), so only one link
 * is ever open. exclusive (customer:new's own first fund) also closes open links for any other
 * address, and refuses when someone else has already accepted one. Written to the audit log as a
 * system action.
 */
export async function inviteAdmin(
  client: pg.Client,
  input: {
    fundId: string;
    email: string;
    reinvite: boolean;
    exclusive?: boolean;
    now?: Date;
    /** The audit log's "by": the script that made the link (customer:new unless given). */
    by?: string;
  },
): Promise<InviteResult> {
  const now = input.now ?? new Date();
  await client.query("begin");
  try {
    if (input.exclusive) {
      const others = await client.query<{ id: string; accepted_at: Date | null }>(
        `select id, accepted_at from public.invitations
          where fund_id = $1 and email_normalized <> $2 and revoked_at is null for update`,
        [input.fundId, input.email],
      );
      if (others.rows.some((row) => row.accepted_at)) {
        throw new Error(
          "Another address has already accepted an admin invitation to this fund; it is in use, " +
            "so customer:new will not invite a different admin",
        );
      }
      if (others.rows.length > 0) {
        await client.query(
          "update public.invitations set revoked_at = $2 where id = any($1::uuid[])",
          [others.rows.map((row) => row.id), now],
        );
      }
    }
    const { rows } = await client.query<{
      id: string;
      accepted_at: Date | null;
      expires_at: Date;
    }>(
      `select id, accepted_at, expires_at from public.invitations
        where fund_id = $1 and email_normalized = $2 and revoked_at is null
        order by created_at desc for update`,
      [input.fundId, input.email],
    );
    const accepted = rows.find((row) => row.accepted_at);
    if (accepted) {
      await client.query("commit");
      return { status: "accepted", invitationId: accepted.id };
    }
    const pending = rows.find((row) => row.expires_at.getTime() > now.getTime());
    if (pending && !input.reinvite) {
      await client.query("commit");
      return {
        status: "pending",
        invitationId: pending.id,
        expiresAt: pending.expires_at.toISOString(),
      };
    }
    if (rows.length > 0) {
      await client.query(
        "update public.invitations set revoked_at = $2 where id = any($1::uuid[])",
        [rows.map((row) => row.id), now],
      );
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(now.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
    const inserted = await client.query<{ id: string }>(
      `insert into public.invitations (fund_id, email_normalized, roles, token_hash, expires_at)
       values ($1, $2, array['admin']::public.app_role[], $3, $4) returning id`,
      [input.fundId, input.email, tokenHash, expiresAt],
    );
    const invitationId = inserted.rows[0]!.id;
    // Never the token; the same fields as the app's invitation_created event.
    await client.query(
      `insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
       values ($1, 'system', null, 'invitation_created', 'invitations', $2, $3::jsonb)`,
      [
        input.fundId,
        invitationId,
        JSON.stringify({
          email: input.email,
          roles: ["admin"],
          expires_at: expiresAt.toISOString(),
          by: input.by ?? "customer:new",
        }),
      ],
    );
    await client.query("commit");
    return { status: "created", invitationId, token, expiresAt: expiresAt.toISOString() };
  } catch (cause) {
    await client.query("rollback").catch(() => {});
    throw cause;
  }
}
