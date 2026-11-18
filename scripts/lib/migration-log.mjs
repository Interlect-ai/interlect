/**
 * The migration log row is written in the same transaction as the migration itself:
 * a run that dies between the two can no longer leave an applied migration unlogged, so a
 * migration that is not idempotent is never run twice. The log also keeps the file's SHA-256,
 * so a file that is changed after it ran is caught instead of silently skipped.
 */
import { createHash } from "node:crypto";

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const FILENAME = /^[0-9]{4}_[a-z0-9_]+\.sql$/;
const COMMIT = /^[ \t]*commit[ \t]*;/gim;
// After the file's own final `commit;` only blank lines and `--` comments may follow.
const ONLY_COMMENTS = /^(?:\s|--[^\n]*)*$/;

/**
 * The migration's SQL with the log insert inside its transaction: just before the file's own
 * final `commit;`, or, for a file without its own transaction, appended to the same
 * multi-statement query (which Postgres runs as one implicit transaction).
 */
export function withLogRow(sql, filename, hash) {
  if (!FILENAME.test(filename)) throw new Error(`Ugyldigt migrationsnavn: ${filename}`);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Ugyldig sha256 for ${filename}`);
  const insert =
    `insert into public.schema_migrations (filename, sha256) ` +
    `values ('${filename}', '${hash}');\n`;
  const opensTransaction = /^[ \t]*begin[ \t]*;/im.test(sql);
  if (!opensTransaction) {
    if (/^[ \t]*commit[ \t]*;/im.test(sql)) {
      throw new Error(`${filename} har commit uden begin; loggen kan ikke placeres sikkert.`);
    }
    return `${sql}\n;\n${insert}`;
  }
  const match = [...sql.matchAll(COMMIT)].at(-1);
  if (!match || !ONLY_COMMENTS.test(sql.slice(match.index + match[0].length))) {
    throw new Error(
      `${filename} åbner en transaktion, men slutter ikke med commit; loggen kan ikke placeres sikkert.`,
    );
  }
  return `${sql.slice(0, match.index)}${insert}${sql.slice(match.index)}`;
}

/** Files whose content no longer matches the hash logged when they ran. */
export function changedFiles(logged, current) {
  return [...logged]
    .filter(([filename, hash]) => hash && current.has(filename) && current.get(filename) !== hash)
    .map(([filename]) => filename)
    .sort();
}
