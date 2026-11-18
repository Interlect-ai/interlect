import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changedFiles, sha256, withLogRow } from "./migration-log.mjs";

const HASH = "a".repeat(64);
const MIGRATIONS = join(import.meta.dirname, "..", "..", "db", "migrations");

test("the log row goes just before the file's own commit", () => {
  const sql = "-- 0100\nbegin;\ncreate table x (id int);\ncommit;\n";
  const out = withLogRow(sql, "0100_x.sql", HASH);
  assert.match(
    out,
    /create table x \(id int\);\ninsert into public\.schema_migrations .*;\ncommit;\n$/,
  );
  assert.equal(out.match(/commit;/g)?.length, 1);
});

test("a trailing comment after commit is fine, and a word like 'commit' in a comment is not taken", () => {
  const sql = "begin;\n-- commit; happens below\nselect 1;\ncommit; -- done\n\n-- end\n";
  const out = withLogRow(sql, "0100_x.sql", HASH);
  assert.ok(out.indexOf("insert into public.schema_migrations") > out.indexOf("select 1;"));
  assert.ok(
    out.indexOf("insert into public.schema_migrations") < out.lastIndexOf("commit; -- done"),
  );
});

test("a file without its own transaction gets the row in the same query", () => {
  const out = withLogRow("create table x (id int)", "0100_x.sql", HASH);
  assert.match(out, /^create table x \(id int\)\n;\ninsert into public\.schema_migrations/);
});

test("a transaction that does not end with commit, or a bad name, is refused", () => {
  assert.throws(() => withLogRow("begin;\nselect 1;\ncommit;\nselect 2;\n", "0100_x.sql", HASH));
  assert.throws(() => withLogRow("select 1;\ncommit;\n", "0100_x.sql", HASH));
  assert.throws(() => withLogRow("select 1;", "0100_x'); drop table y; --.sql", HASH));
  assert.throws(() => withLogRow("select 1;", "0100_x.sql", "nothex"));
});

test("every migration in the repository can carry its log row", () => {
  for (const name of readdirSync(MIGRATIONS).filter((file) => /^\d{4}_.*\.sql$/.test(file))) {
    if (name.endsWith(".down.sql")) continue;
    const sql = readFileSync(join(MIGRATIONS, name), "utf8");
    assert.doesNotThrow(() => withLogRow(sql, name, sha256(sql)), name);
  }
});

test("a changed file is caught; a file logged without a hash is not", () => {
  const logged = new Map([
    ["0001_a.sql", sha256("a")],
    ["0002_b.sql", null],
    ["0003_c.sql", sha256("c")],
  ]);
  const current = new Map([
    ["0001_a.sql", sha256("a")],
    ["0002_b.sql", sha256("b")],
    ["0003_c.sql", sha256("c changed")],
  ]);
  assert.deepEqual(changedFiles(logged, current), ["0003_c.sql"]);
});
