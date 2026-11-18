// Rules for the production dependency audit. The gate is the same as
// `npm audit --omit=dev --audit-level=high`: any high or critical advisory fails, except an
// advisory listed below. An exception only covers an advisory that has no fixed version yet,
// and it stops covering it on its own when the advisory's range changes or when the package
// publishes a version newer than the last affected one. It has no end date: the product owner chose
// the
// no-date variant on 17 Nov 2026 (it stays until a fixed version exists or he removes it).

/**
 * @typedef {{ id: string, package: string, range: string, lastAffected: string,
 *   ticket: string, reason: string }} AuditException
 */

/** @type {AuditException[]} */
export const EXCEPTIONS = [
  {
    // "Ja, undtag den", then without a date: "koden skla ikke udløbe. den
    // skal bare ligge der på ubestemt tid til jeg vælger at nedlægge den" and "vi går med din
    // anbefaling" (the exception holds until a fixed picomatch exists).
    id: "GHSA-fc5q-39xc-vjpf",
    package: "picomatch",
    range: "<=4.0.7",
    lastAffected: "4.0.7",
    ticket: "T-1105",
    reason:
      "ReDoS in picomatch with no fixed version on npm. Only build tools use it (vite, " +
      "tinyglobby, unplugin, TanStack's router and start plugins) with our own glob patterns; " +
      "it is not in the server bundle (.output).",
  },
];

const BLOCKING = new Set(["high", "critical"]);

/**
 * High and critical advisories in an `npm audit --json` report, one per advisory and package.
 * A package's severity in the report always comes from these advisories, so checking them
 * covers exactly what `--audit-level=high` checks.
 */
export function blockingAdvisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
      const id = String(via.url ?? via.source).split("/").pop();
      const key = `${id} ${via.name}`;
      if (!found.has(key)) {
        found.set(key, { id, package: via.name, severity: via.severity, range: via.range, title: via.title });
      }
    }
  }
  return [...found.values()];
}

/** Compares plain x.y.z versions; prereleases and other shapes are ignored by the caller. */
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** Published stable versions newer than `lastAffected`. */
export function newerStableVersions(versions, lastAffected) {
  return versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v) && compareVersions(v, lastAffected) > 0);
}

/**
 * @param {{ report: unknown, exceptions: AuditException[],
 *   publishedVersions: Record<string, string[]> }} input
 * @returns {{ problems: string[], allowed: string[], notes: string[] }}
 */
export function evaluateAudit({ report, exceptions, publishedVersions }) {
  const problems = [];
  const allowed = [];
  const notes = [];
  const seen = new Set();

  for (const adv of blockingAdvisories(report)) {
    const label = `${adv.severity} ${adv.id} in ${adv.package} ${adv.range}: ${adv.title}`;
    const ex = exceptions.find((e) => e.id === adv.id && e.package === adv.package);
    if (!ex) {
      problems.push(label);
      continue;
    }
    seen.add(ex.id);
    if (adv.range !== ex.range) {
      problems.push(
        `${label} (the advisory's range changed from "${ex.range}"; a fixed version may exist, ` +
          `update ${ex.package} and remove the ${ex.ticket} exception)`,
      );
      continue;
    }
    const published = publishedVersions[ex.package];
    if (!Array.isArray(published) || !published.length || published.some((v) => typeof v !== "string")) {
      problems.push(`${label} (could not read the published versions of ${ex.package})`);
      continue;
    }
    const newer = newerStableVersions(published, ex.lastAffected);
    if (newer.length) {
      problems.push(
        `${label} (${ex.package} ${newer.join(", ")} is published after the last affected ` +
          `${ex.lastAffected}; update to it and remove the ${ex.ticket} exception)`,
      );
      continue;
    }
    allowed.push(`${label} (allowed by ${ex.ticket} until a fixed version is published)`);
  }

  for (const ex of exceptions) {
    if (!seen.has(ex.id)) {
      notes.push(`${ex.id} (${ex.package}) is no longer reported; remove its ${ex.ticket} exception.`);
    }
  }
  return { problems, allowed, notes };
}
