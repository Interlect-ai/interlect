#!/usr/bin/env node
/**
 * Applies any `db/migrations/*.sql` file that hasn't been run yet, in
 * filename order, tracked in a small `schema_migrations` table on the
 * target database itself -- so this is safe to run repeatedly and only
 * ever applies what's new. Each file is expected to wrap itself in its own
 * `begin; ... commit;` (every migration in this repo already does), so a
 * failing file rolls itself back and is never recorded as applied. The log row
 * is written inside that same transaction, with the file's SHA-256, and a file
 * that changed after it ran stops the run before anything else is applied.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/run-migrations.mjs
 * (A Supabase database is always reached with a verified certificate, see lib/db-tls.mjs.)
 * (MIGRATIONS_UNTIL=0032 stops after that migration; only used by scripts/local-db.mjs.)
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pgConfig } from "./lib/db-tls.mjs";
import { changedFiles, sha256, withLogRow } from "./lib/migration-log.mjs";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL must be set.");
  process.exit(1);
}

const client = new pg.Client(pgConfig(databaseUrl));
await client.connect();

// Everything up to and including 0010 was already applied by hand, in the
// Supabase SQL Editor, in the original project, long before this script existed.
// Seeded only on that legacy database: the first time the log is created while
// the schema from 0001 already exists. A new, empty database (a new customer or a
// fresh staging) runs 0001 onwards like any other migration.
const ALREADY_APPLIED_BY_HAND = [
  "0001_m2_identity_access.sql",
  "0002_m3_fund_profiles.sql",
  "0003_m3_fund_editor.sql",
  "0004_m4_cases_evidence.sql",
  "0005_m8_scanner.sql",
  "0006_m4_multiformat_intake.sql",
  "0007_case_workspace_and_analysis_jobs.sql",
  "0008_guided_fund_configuration.sql",
  "0009_harden_trigger_function_permissions.sql",
  "0010_case_notes_and_entity_match.sql",
];

try {
  const { rows: stateRows } = await client.query(`
    select to_regclass('public.schema_migrations') is not null as has_log,
           to_regclass('public.funds') is not null as has_schema
  `);
  const { has_log: hasLog, has_schema: hasSchema } = stateRows[0];

  // MIGRATIONS_DRY_RUN=1 only lists what would run and changes nothing (not even the log).
  const dryRun = process.env["MIGRATIONS_DRY_RUN"] === "1";
  if (dryRun) console.log("Prøvekørsel: databasen ændres ikke.");

  if (!dryRun)
    await client.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
    -- SHA-256 of the file as it ran (T-864); rows from before have none until the next run.
    alter table public.schema_migrations add column if not exists sha256 text;
    -- Kun køreren (postgres, ejeren) må se og ændre loggen; ellers kan API'et springe
    -- migrationer over eller få gamle kørt igen (0025).
    alter table public.schema_migrations enable row level security;
    revoke all on public.schema_migrations from public, anon, authenticated, service_role;
  `);

  if (!dryRun && !hasLog && hasSchema) {
    for (const filename of ALREADY_APPLIED_BY_HAND) {
      await client.query(
        "insert into public.schema_migrations (filename) values ($1) on conflict (filename) do nothing",
        [filename],
      );
    }
  }

  // A dry run against a log from has no sha256 column yet.
  const hasHashColumn =
    !dryRun ||
    (hasLog &&
      (
        await client.query(
          `select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'schema_migrations'
              and column_name = 'sha256'`,
        )
      ).rowCount > 0);
  const logged = new Map(
    hasLog || !dryRun
      ? (
          await client.query(
            `select filename, ${hasHashColumn ? "sha256" : "null as sha256"}
               from public.schema_migrations`,
          )
        ).rows.map((row) => [row.filename, row.sha256])
      : hasSchema
        ? ALREADY_APPLIED_BY_HAND.map((filename) => [filename, null])
        : [],
  );
  const applied = new Set(logged.keys());

  const files = (await readdir(migrationsDir))
    // .down.sql files are manual rollback scripts, never meant to run forward.
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .sort();
  const contents = new Map();
  for (const filename of files) {
    contents.set(filename, await readFile(join(migrationsDir, filename), "utf8"));
  }
  const hashes = new Map([...contents].map(([filename, sql]) => [filename, sha256(sql)]));

  // A migration that already ran must never change: its new content would never run.
  const changed = changedFiles(logged, hashes);
  if (changed.length > 0) {
    console.error(
      `Stoppet: disse migrationer er ændret, efter de blev kørt: ${changed.join(", ")}. ` +
        "Læg ændringen i en ny migration, og sæt filen tilbage. Intet er kørt.",
    );
    process.exit(1);
  }

  // Local tests only (npm run db:local -- fresh --until 0032): stop after a given migration so
  // a backfill can be tested against rows that exist before it runs. Unset in CI.
  const until = process.env["MIGRATIONS_UNTIL"];
  const pending = files.filter(
    (name) => !applied.has(name) && (!until || name.slice(0, until.length) <= until),
  );
  if (pending.length === 0) {
    console.log("Ingen nye migrationer at køre.");
  }

  if (dryRun) {
    for (const filename of pending) console.log(`  ville køre: ${filename}`);
    console.log(`Prøvekørsel færdig: ${pending.length} migrationer venter.`);
    process.exit(0);
  }

  // Rows logged (or by hand) get the hash of the file as it is now, once.
  for (const [filename, hash] of logged) {
    if (hash || !hashes.has(filename)) continue;
    await client.query(
      "update public.schema_migrations set sha256 = $2 where filename = $1 and sha256 is null",
      [filename, hashes.get(filename)],
    );
  }

  for (const filename of pending) {
    const sql = withLogRow(contents.get(filename), filename, hashes.get(filename));
    console.log(`Kører ${filename} ...`);
    try {
      await client.query(sql);
    } catch (cause) {
      console.error(
        `${filename} fejlede -- databasen blev IKKE ændret (transaktionen rullede tilbage):`,
      );
      console.error(cause.message ?? cause);
      process.exit(1);
    }
    console.log(`  ${filename}: anvendt.`);
  }

  console.log("Færdig.");
} finally {
  await client.end();
}
