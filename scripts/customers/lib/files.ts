/**
 * The customer files, in CUSTOMERS_DIR (default):
 *   registry.json      no secrets and no personal data: which customers exist and where they
 *                      live. Its home is the branch "customers", which the customer workflows
 *                      check out into CUSTOMERS_DIR and push back after every run.
 *   <slug>.state.json  owner-only, never committed: the steps one run has done
 *   <slug>.lock        while a run is going, so two runs for one customer never overlap
 *   <slug>.env only for an installation made: its database URL. Runs now
 *                      get a database password for that run only (freshDatabaseUrl).
 * Files are written to a temporary name and renamed, so a crash never leaves half a file.
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { CustomerState } from "./provision.ts";

export type RegistryEntry = {
  slug: string;
  name: string;
  region: string;
  supabaseRef: string;
  appUrl: string;
  createdAt: string;
  /**
   * "provisioning" until customer:new has run every step; "active" from then; "paused" while
   * customer:pause has stopped the app. release.yml updates active and paused ones.
   * "handed-over" once customer:handover has moved it to the customer's own accounts: it
   * is never released to again, and its paused pilot is deleted after the customer's go.
   */
  status: "provisioning" | "active" | "paused" | "handed-over";
  vercelProjectId?: string;
  /**
   * The customer's projects as soon as a handover has made them (ids, no secrets), so a run that
   * is started again only ever continues in exactly those, and a rehearsal can remove them again.
   */
  handoverTarget?: {
    vercelTeamId: string;
    supabaseOrg: string;
    supabaseRef?: string;
    vercelProjectId?: string;
  };
  /** Where the customer's own installation lives after the handover (ids, no secrets). */
  handover?: {
    at: string;
    rehearsal: boolean;
    vercelTeamId: string;
    vercelProjectId: string;
    supabaseOrg: string;
    supabaseRef: string;
    appUrl: string;
  };
  /** The values it was created with (not personal data), so a continuing run must match. */
  language?: "da" | "en";
  currency?: "DKK" | "EUR";
  freeCreditsDkk?: number;
  /** A test installation (slug test-…): never released to, deleted again. */
  test?: boolean;
};

/** CUSTOMERS_DIR (relative to the repository) or */
export function customersDir(root: string, env: Record<string, string | undefined> = process.env) {
  return resolve(root, env["CUSTOMERS_DIR"] || "customers");
}

export function customerPaths(
  root: string,
  slug: string,
  env: Record<string, string | undefined> = process.env,
) {
  const dir = customersDir(root, env);
  return {
    registry: join(dir, "registry.json"),
    env: join(dir, `${slug}.env`),
    state: join(dir, `${slug}.state.json`),
    lock: join(dir, `${slug}.lock`),
  };
}

function writeAtomically(path: string, text: string, ownerOnly: boolean) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { mode: ownerOnly ? 0o600 : 0o644 });
  if (ownerOnly) chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

function assertOwnerOnly(path: string) {
  if ((statSync(path).mode & 0o077) !== 0)
    throw new Error(`${path} must be readable by its owner only (chmod 600)`);
}

export function readState(path: string): CustomerState | null {
  if (!existsSync(path)) return null;
  assertOwnerOnly(path);
  const state = JSON.parse(readFileSync(path, "utf8")) as CustomerState;
  if (!state?.options?.slug || typeof state.done !== "object")
    throw new Error(`${path} is not a customer:new state file`);
  return state;
}

export function writeState(path: string, state: CustomerState) {
  writeAtomically(path, `${JSON.stringify(state, null, 2)}\n`, true);
}

export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  assertOwnerOnly(path);
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1]) values[match[1]] = (match[2] ?? "").replace(/^"(.*)"$/, "$1");
  }
  return values;
}

export function writeEnvFile(path: string, values: Record<string, string>) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeAtomically(
    path,
    `# customer:new (T-212). Secret: never commit or share.\n${lines.join("\n")}\n`,
    true,
  );
}

/** Holds the lock until release() is called; a second run for the same slug is refused. */
export function acquireLock(path: string) {
  let handle: number;
  try {
    handle = openSync(path, "wx", 0o600);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    throw new Error(
      `${path} exists: another customer:new for this customer is running. If none is (a run was killed), delete the file and run again.`,
    );
  }
  writeFileSync(handle, `${process.pid}\n`);
  closeSync(handle);
  return () => rmSync(path, { force: true });
}

export function readRegistry(path: string): { customers: RegistryEntry[] } {
  if (!existsSync(path)) return { customers: [] };
  const registry = JSON.parse(readFileSync(path, "utf8")) as { customers?: unknown };
  if (!Array.isArray(registry.customers)) throw new Error(`${path} has no customers list`);
  return { ...registry, customers: registry.customers as RegistryEntry[] };
}

export function registryEntry(path: string, slug: string) {
  return readRegistry(path).customers.find((customer) => customer.slug === slug) ?? null;
}

/** Adds the customer or updates its entry (keeping when it was created); others keep their order. */
export function upsertRegistry(path: string, entry: RegistryEntry) {
  const registry = readRegistry(path);
  const index = registry.customers.findIndex((customer) => customer.slug === entry.slug);
  const previous = registry.customers[index];
  if (!previous) registry.customers.push(entry);
  else registry.customers[index] = { ...previous, ...entry, createdAt: previous.createdAt };
  writeAtomically(path, `${JSON.stringify(registry, null, 2)}\n`, false);
}

/** Replaces the customer's entry as it is given (fields left out are removed). */
export function replaceRegistryEntry(path: string, entry: RegistryEntry) {
  const registry = readRegistry(path);
  const index = registry.customers.findIndex((customer) => customer.slug === entry.slug);
  if (index < 0) throw new Error(`No customer "${entry.slug}" in the registry`);
  registry.customers[index] = entry;
  writeAtomically(path, `${JSON.stringify(registry, null, 2)}\n`, false);
}

export function removeFromRegistry(path: string, slug: string) {
  const registry = readRegistry(path);
  registry.customers = registry.customers.filter((customer) => customer.slug !== slug);
  writeAtomically(path, `${JSON.stringify(registry, null, 2)}\n`, false);
}
