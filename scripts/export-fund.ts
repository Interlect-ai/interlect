/**
 * Exports one fund: every row of every fund table as JSON lines, plus the fund's files in Storage,
 * with a manifest (table, rows, bytes, sha256). A forgotten person (gdpr_forget_person, 0072) is
 * not in it, because the export reads the live, masked data.
 *
 *   node scripts/export-fund.ts --fund <fund-id> --out <dir> [--no-files]
 *
 * Uses DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local (or the
 * environment). The output holds customer data: it is never written inside the repo, and the
 * folder is created with owner-only rights.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { pgConfig } from "./lib/db-tls.mjs";
import { exportFundData } from "./lib/export-fund.ts";

const ROOT = resolve(import.meta.dirname, "..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  const path = join(ROOT, ".env.local");
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && env[match[1]] === undefined) env[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
    }
  }
  return env;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

async function main() {
  const fundId = argument("fund");
  const outArgument = argument("out");
  if (!fundId || !UUID.test(fundId) || !outArgument) {
    throw new Error("Usage: node scripts/export-fund.ts --fund <fund-id> --out <dir> [--no-files]");
  }
  const out = resolve(outArgument);
  const fromRoot = relative(ROOT, out);
  const insideRepo =
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
  if (insideRepo) {
    throw new Error("The export holds customer data and must not be written inside the repo.");
  }
  const env = readEnv();
  if (!env["DATABASE_URL"]) throw new Error("DATABASE_URL is missing");

  const client = new pg.Client(pgConfig(env["DATABASE_URL"]));
  await client.connect();
  const manifest: Array<Record<string, unknown>> = [];
  try {
    const { tables, tablesWithoutFundId } = await exportFundData(client, fundId);
    manifest.push({
      kind: "not-exported",
      reason: "table has no fund_id column and no foreign key that leads to the fund",
      tables: tablesWithoutFundId,
    });
    await mkdir(join(out, "data"), { recursive: true, mode: 0o700 });
    for (const { table, rows, omittedColumns } of tables) {
      const body = rows.map((row) => `${JSON.stringify(row)}\n`).join("");
      await writeFile(join(out, "data", `${table}.jsonl`), body, { mode: 0o600 });
      manifest.push({
        kind: "table",
        table,
        rows: rows.length,
        sha256: sha256(body),
        omittedColumns,
      });
    }
  } finally {
    await client.end();
  }

  if (!process.argv.includes("--no-files")) {
    if (!env["SUPABASE_URL"] || !env["SUPABASE_SERVICE_ROLE_KEY"]) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed for the files (or use --no-files)",
      );
    }
    const storage = createClient(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"], {
      auth: { persistSession: false },
    });
    const { data: buckets, error } = await storage.storage.listBuckets();
    if (error) throw new Error(`listBuckets: ${error.message}`);
    for (const bucket of buckets) {
      // Files are stored under <fund-id>/...: only this fund's folder is exported.
      const paths = await listFolder(storage, bucket.name, fundId);
      for (const path of paths) {
        if (path.split("/").some((part) => part === ".." || part === "")) {
          throw new Error(`Refusing an unsafe storage path: ${bucket}/${path}`);
        }
        const { data, error: downloadError } = await storage.storage
          .from(bucket.name)
          .download(path);
        if (downloadError || !data)
          throw new Error(`download ${bucket.name}/${path}: ${downloadError?.message}`);
        const bytes = Buffer.from(await data.arrayBuffer());
        const target = join(out, "files", bucket.name, path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, bytes, { mode: 0o600 });
        manifest.push({
          kind: "file",
          bucket: bucket.name,
          path,
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      }
    }
  }

  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify({ fundId, exportedAt: new Date().toISOString(), entries: manifest }, null, 2),
    { mode: 0o600 },
  );
  const tableCount = manifest.filter((entry) => entry["kind"] === "table").length;
  const fileCount = manifest.filter((entry) => entry["kind"] === "file").length;
  console.log(`Exported ${tableCount} tables and ${fileCount} files to ${out}`);
}

async function listFolder(
  client: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const path = `${prefix}/${item.name}`;
      if (item.id === null) paths.push(...(await listFolder(client, bucket, path)));
      else paths.push(path);
    }
    if (data.length < 1000) break;
  }
  return paths;
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
