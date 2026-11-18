#!/usr/bin/env node
/**
 * TLS for every database connection from scripts and workflows. A Supabase database
 * (the pooler *.pooler.supabase.com or the direct host db.<ref>.supabase.co) is always reached
 * over TLS with the certificate verified against Supabase's own root CA, which is kept in the repo
 * (db/certs/supabase-prod-ca-2021.crt, "Supabase Root 2021 CA", valid until 26 Apr 2031), and the
 * host name checked (libpq's sslmode=verify-full). Whatever sslmode the URL carries is replaced,
 * so a secret without sslmode (staging's DATABASE_URL) or with a weaker one is still verified.
 * Any other host (the local test database, CI's service container) is left as it is.
 *
 * node-postgres: new pg.Client(pgConfig(url)).
 * psql/pg_dump in a workflow: DATABASE_URL="$(node scripts/lib/db-tls.mjs)" reads DATABASE_URL
 * from the environment and prints it with sslmode=verify-full and sslrootcert set.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SUPABASE_CA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "db",
  "certs",
  "supabase-prod-ca-2021.crt",
);

/** URL parameters that set TLS; libpq and pg-connection-string would let them win over ours. */
const TLS_PARAMS = ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"];

export function isSupabaseHost(databaseUrl) {
  const host = new URL(databaseUrl).hostname.toLowerCase();
  return host.endsWith(".supabase.com") || host.endsWith(".supabase.co");
}

function withoutTlsParams(databaseUrl) {
  const url = new URL(databaseUrl);
  for (const name of TLS_PARAMS) url.searchParams.delete(name);
  return url;
}

/** Options for pg.Client/pg.Pool: a verified connection to Supabase, anything else unchanged. */
export function pgConfig(databaseUrl) {
  if (!isSupabaseHost(databaseUrl)) return { connectionString: databaseUrl };
  return {
    connectionString: withoutTlsParams(databaseUrl).toString(),
    // node checks the host name against the certificate by default (verify-full).
    ssl: { ca: readFileSync(SUPABASE_CA_PATH, "utf8"), rejectUnauthorized: true },
  };
}

/** The URL for libpq (psql, pg_dump): verify-full against Supabase's CA, anything else unchanged. */
export function libpqUrl(databaseUrl) {
  if (!isSupabaseHost(databaseUrl)) return databaseUrl;
  const url = withoutTlsParams(databaseUrl);
  url.searchParams.set("sslmode", "verify-full");
  url.searchParams.set("sslrootcert", SUPABASE_CA_PATH);
  return url.toString();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }
  process.stdout.write(libpqUrl(databaseUrl));
}
