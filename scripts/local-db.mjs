#!/usr/bin/env node
/**
 * A throwaway local Supabase database for testing migrations (and later RLS).
 * It never touches an external database: the connection string is built here and
 * always points at 127.0.0.1, whatever DATABASE_URL says.
 *
 *   npm run db:local -- fresh     new empty database, every migration, checks
 *   npm run db:local -- fresh --until 0032   stop after 0032 (to test a later backfill)
 *   npm run db:local -- migrate   run new migrations against the running database
 *   npm run db:local -- check     checks only
 *   npm run db:local -- url       print the connection string
 *   npm run db:local -- down      remove the container
 *
 * Needs a running Docker daemon. The image is pinned to Postgres 17 like the project.
 * Supabase Storage creates its own schema in a real project; the image only has the
 * database, so db/test/supabase-storage-shim.sql adds the parts the migrations use.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const ROOT = resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "db", "migrations");
const STORAGE_SHIM = join(ROOT, "db", "test", "supabase-storage-shim.sql");
const AUTH_SHIM = join(ROOT, "db", "test", "supabase-auth-shim.sql");

const CONTAINER = "interlect-local-db";
const IMAGE = "supabase/postgres:17.11.0.002";
const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
// Not a secret: the container only listens on 127.0.0.1 and is deleted after use.
const PASSWORD = "local-only";
const LOCAL_URL = `postgresql://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres`;

function docker(args, { allowFail = false } = {}) {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (cause) {
    if (allowFail) return "";
    throw new Error(`docker ${args.join(" ")} fejlede: ${cause.stderr || cause.message}`);
  }
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitForDatabase() {
  const deadline = Date.now() + 180_000;
  let lastError = null;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: LOCAL_URL });
    try {
      await client.connect();
      // The image restarts once after its init scripts; wait for the final server.
      const { rows } = await client.query(
        "select to_regprocedure('auth.uid()') is not null as ready",
      );
      await client.end();
      if (rows[0].ready) return;
    } catch (cause) {
      lastError = cause;
      await client.end().catch(() => {});
    }
    await sleep(1_000);
  }
  throw new Error(`Den lokale database blev ikke klar: ${lastError?.message ?? "ukendt fejl"}`);
}

async function withClient(run) {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function fresh() {
  docker(["rm", "-f", CONTAINER], { allowFail: true });
  docker([
    "run",
    "--detach",
    "--name",
    CONTAINER,
    "--env",
    `POSTGRES_PASSWORD=${PASSWORD}`,
    "--publish",
    `127.0.0.1:${PORT}:5432`,
    IMAGE,
  ]);
  console.log(`Startede ${CONTAINER} (${IMAGE}) på 127.0.0.1:${PORT}.`);
  await waitForDatabase();
  // The image's storage and auth schemas belong to supabase_admin, so the shims run as that
  // role over the container's local socket.
  for (const shim of [STORAGE_SHIM, AUTH_SHIM]) {
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-q",
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: readFileSync(shim, "utf8"), stdio: ["pipe", "ignore", "inherit"] },
    );
  }
  console.log("Storage- og MFA-skemaet er efterlignet (db/test/supabase-*-shim.sql).");
  migrate();
  await check();
}

function untilArgument() {
  const index = process.argv.indexOf("--until");
  return index > -1 ? process.argv[index + 1] : undefined;
}

function migrate() {
  const until = untilArgument();
  const env = { ...process.env, DATABASE_URL: LOCAL_URL };
  if (until) env["MIGRATIONS_UNTIL"] = until;
  else delete env["MIGRATIONS_UNTIL"];
  const result = spawnSync(process.execPath, [join(ROOT, "scripts", "run-migrations.mjs")], {
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Migrationerne fejlede mod den lokale database.");
  }
}

async function check() {
  const until = untilArgument();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .filter((name) => !until || name.slice(0, until.length) <= until)
    .sort();

  const problems = await withClient(async (client) => {
    const found = [];

    const { rows: applied } = await client.query(
      "select filename from public.schema_migrations order by filename",
    );
    const appliedSet = new Set(applied.map((row) => row.filename));
    const missing = files.filter((name) => !appliedSet.has(name));
    if (missing.length) found.push(`Ikke kørt: ${missing.join(", ")}`);

    const { rows: withoutRls } = await client.query(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
      order by c.relname
    `);
    if (withoutRls.length) {
      found.push(`Tabeller i public uden RLS: ${withoutRls.map((row) => row.relname).join(", ")}`);
    }

    // has_table_privilege sees every grant (also PUBLIC, which anon inherits), unlike
    // information_schema, which only shows grants involving the current user.
    const { rows: anonGrants } = await client.query(`
      select c.relname as table_name,
             string_agg(p.privilege, ', ' order by p.privilege) as privileges
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])
        as p(privilege)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
        and has_table_privilege('anon', c.oid, p.privilege)
      group by c.relname
      order by c.relname
    `);
    if (anonGrants.length) {
      found.push(
        `anon/PUBLIC har rettigheder på: ${anonGrants
          .map((row) => `${row.table_name} (${row.privileges})`)
          .join("; ")}`,
      );
    }

    const { rows: summary } = await client.query(`
      select
        (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p')) as tables,
        (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('v', 'm')) as views,
        (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public') as functions,
        (select count(*) from pg_policies where schemaname in ('public', 'storage')) as policies,
        (select count(*) from public.funds) as funds,
        (select count(*) from auth.users) as users
    `);
    const s = summary[0];
    console.log(
      `Migrationer kørt: ${appliedSet.size}/${files.length} · tabeller ${s.tables} · views ${s.views} · ` +
        `funktioner ${s.functions} · policies ${s.policies} · fonde ${s.funds} · brugere ${s.users}`,
    );
    return found;
  });

  if (problems.length) {
    for (const problem of problems) console.error(`FEJL: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "Tjek bestået: alle migrationer kørt, RLS på alle tabeller, ingen rettigheder til anon.",
  );
}

const command = process.argv[2] ?? "fresh";
try {
  if (command === "fresh") await fresh();
  else if (command === "migrate") {
    migrate();
    await check();
  } else if (command === "check") await check();
  else if (command === "url") console.log(LOCAL_URL);
  else if (command === "down") {
    docker(["rm", "-f", CONTAINER], { allowFail: true });
    console.log(`Fjernede ${CONTAINER}.`);
  } else {
    console.error(`Ukendt kommando: ${command}. Brug fresh, migrate, check, url eller down.`);
    process.exitCode = 1;
  }
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
}
