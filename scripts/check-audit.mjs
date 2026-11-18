// Production dependency audit: `npm audit --omit=dev --audit-level=high`, with
// the narrow exceptions in scripts/lib/audit-exceptions.mjs, which end when a fix is published. Fails closed: if
// npm audit or the registry cannot be read, the check fails.
import { spawnSync } from "node:child_process";
import { EXCEPTIONS, evaluateAudit } from "./lib/audit-exceptions.mjs";

function npm(args) {
  const res = spawnSync("npm", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw res.error;
  return res;
}

function fail(message) {
  console.error(`Production audit failed:\n${message}`);
  process.exit(1);
}

// npm audit exits 1 whenever it finds anything, so the JSON decides, not the exit code.
const audit = npm(["audit", "--omit=dev", "--json"]);
let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  fail(`npm audit did not return JSON (exit ${audit.status}).\n${audit.stderr}`);
}
if (report.error) fail(`npm audit error: ${JSON.stringify(report.error)}`);
if (!report.vulnerabilities) fail("npm audit returned no vulnerabilities section.");

const publishedVersions = {};
for (const pkg of new Set(EXCEPTIONS.map((e) => e.package))) {
  // npm view prints error JSON ({"error": ...}) on stdout when it fails, so check the exit too.
  const view = npm(["view", pkg, "versions", "--json"]);
  let parsed;
  try {
    parsed = JSON.parse(view.stdout);
  } catch {
    parsed = undefined;
  }
  if (view.status !== 0 || parsed === undefined || parsed?.error) {
    fail(`Could not read the published versions of ${pkg} (exit ${view.status}).\n${view.stderr}`);
  }
  publishedVersions[pkg] = Array.isArray(parsed) ? parsed : [parsed];
}

const { problems, allowed, notes } = evaluateAudit({ report, exceptions: EXCEPTIONS, publishedVersions });
for (const line of allowed) console.log(`Allowed: ${line}`);
for (const line of notes) console.log(`::warning::${line}`);
if (problems.length) fail("- " + problems.join("\n- "));
console.log("Production audit OK: no high or critical advisory outside the listed exceptions.");
