/**
 * Finds a customer's installation: the public facts come from
 * (no secrets, written by customer:new), the database URL from
 * (git-ignored, owner-only) or CUSTOMER_DATABASE_URL (CI). The URL must point
 * at the customer's own Supabase project, so credits can never land in another installation
 * (for example staging's DATABASE_URL in .env.local).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { pgConfig } from "../../lib/db-tls.mjs";
import { supabaseRefOf } from "./credits.ts";
import { customersDir } from "./files.ts";

/** A client for a customer's database, over verified TLS when it is a Supabase project. */
export function databaseClient(databaseUrl: string) {
  return new pg.Client(pgConfig(databaseUrl));
}

export type Customer = {
  slug: string;
  name: string;
  supabaseRef: string;
  vercelProjectId: string;
};

export const CUSTOMER_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function findCustomer(registry: unknown, slug: string): Customer {
  const customers = (registry as { customers?: unknown } | null)?.customers;
  if (!Array.isArray(customers)) throw new Error("customers/registry.json has no customers list");
  const entry = customers.find((item) => (item as { slug?: unknown })?.slug === slug) as
    Partial<Customer> | undefined;
  if (!entry)
    throw new Error(`No customer "${slug}" in customers/registry.json (customer:new adds it)`);
  const { name, supabaseRef, vercelProjectId } = entry;
  if (typeof supabaseRef !== "string" || !/^[a-z0-9]{20}$/.test(supabaseRef)) {
    throw new Error(`Customer "${slug}" has no valid supabaseRef in customers/registry.json`);
  }
  if (typeof vercelProjectId !== "string" || !vercelProjectId.startsWith("prj_")) {
    throw new Error(`Customer "${slug}" has no valid vercelProjectId in customers/registry.json`);
  }
  return { slug, name: typeof name === "string" ? name : slug, supabaseRef, vercelProjectId };
}

function readDatabaseUrl(path: string) {
  const mode = statSync(path).mode & 0o077;
  if (mode !== 0)
    throw new Error(`${path} holds a secret and must be readable by its owner only (chmod 600)`);
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^DATABASE_URL=(.*)$/.exec(line.trim());
    if (match?.[1]) return match[1].replace(/^"(.*)"$/, "$1");
  }
  throw new Error(`${path} has no DATABASE_URL line`);
}

export function loadInstance(root: string, slug: string, env: Record<string, string | undefined>) {
  if (!CUSTOMER_SLUG.test(slug)) throw new Error(`"${slug}" is not a customer slug`);
  const dir = customersDir(root, env);
  const registryPath = join(dir, "registry.json");
  if (!existsSync(registryPath))
    throw new Error(`${registryPath} is missing (customer:new creates it)`);
  const customer = findCustomer(JSON.parse(readFileSync(registryPath, "utf8")), slug);

  const envPath = join(dir, `${slug}.env`);
  const databaseUrl =
    env["CUSTOMER_DATABASE_URL"] || (existsSync(envPath) ? readDatabaseUrl(envPath) : undefined);
  if (!databaseUrl) {
    throw new Error(
      `No database URL for "${slug}": run it in a customer workflow (npm run customer:db-url sets ` +
        "CUSTOMER_DATABASE_URL for one run) or set CUSTOMER_DATABASE_URL",
    );
  }
  const ref = supabaseRefOf(databaseUrl);
  if (ref !== customer.supabaseRef) {
    throw new Error(
      `The database URL points at Supabase project ${ref ?? "(unknown)"}, not at ${customer.slug}'s ${customer.supabaseRef}`,
    );
  }
  return { customer, databaseUrl };
}
