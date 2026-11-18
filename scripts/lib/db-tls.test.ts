import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { SUPABASE_CA_PATH, libpqUrl, pgConfig } from "./db-tls.mjs";

const POOLER =
  "postgresql://postgres.abcdefghijklmnopqrst:p%40ss@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
const DIRECT = "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54329/postgres";

test("T-825: the repo holds Supabase's root CA, valid until 2031", () => {
  const ca = new X509Certificate(readFileSync(SUPABASE_CA_PATH));
  assert.match(ca.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(ca.ca, true);
  assert.ok(new Date(ca.validTo) > new Date("2031-01-01"));
});

test("T-825: node-postgres verifies a Supabase pooler or direct host against the CA", () => {
  for (const url of [POOLER, DIRECT]) {
    const config = pgConfig(url);
    assert.equal(config.ssl?.rejectUnauthorized, true);
    assert.match(config.ssl?.ca ?? "", /BEGIN CERTIFICATE/);
    assert.equal(config.connectionString, url);
  }
});

test("T-825: a weaker sslmode in the URL can never turn verification off", () => {
  for (const mode of ["disable", "no-verify", "require", "prefer"]) {
    const config = pgConfig(`${POOLER}?sslmode=${mode}&uselibpqcompat=true&application_name=x`);
    assert.equal(config.connectionString, `${POOLER}?application_name=x`);
    assert.equal(config.ssl?.rejectUnauthorized, true);
  }
});

test("T-825: psql and pg_dump get verify-full with the CA in the repo", () => {
  const url = new URL(libpqUrl(`${POOLER}?sslmode=require&sslrootcert=/tmp/other.crt`));
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(url.searchParams.get("sslrootcert"), SUPABASE_CA_PATH);
  assert.equal(url.searchParams.getAll("sslmode").length, 1);
  assert.equal(url.password, "p%40ss");
});

test("T-825: the local test database is left as it is", () => {
  assert.deepEqual(pgConfig(LOCAL), { connectionString: LOCAL });
  assert.equal(libpqUrl(LOCAL), LOCAL);
  // Look-alike hosts are not Supabase.
  const lookalike = "postgresql://u:p@supabase.com.evil.example:5432/postgres";
  assert.equal(pgConfig(lookalike).ssl, undefined);
});

test("T-825: node-postgres keeps the verified TLS even with sslmode=no-verify in the URL", () => {
  // pg merges the parsed connection string over the config, so a TLS parameter left in the URL
  // would win; pgConfig removes them.
  const require = createRequire(import.meta.url);
  const ConnectionParameters = require("pg/lib/connection-parameters.js") as new (
    config: object,
  ) => {
    host: string;
    ssl: { ca?: string; rejectUnauthorized?: boolean } | boolean;
  };
  const params = new ConnectionParameters(pgConfig(`${POOLER}?sslmode=no-verify`));
  assert.equal(params.host, "aws-0-eu-central-1.pooler.supabase.com");
  assert.equal(typeof params.ssl, "object");
  const ssl = params.ssl as { ca?: string; rejectUnauthorized?: boolean };
  assert.equal(ssl.rejectUnauthorized, true);
  assert.match(ssl.ca ?? "", /BEGIN CERTIFICATE/);
});
