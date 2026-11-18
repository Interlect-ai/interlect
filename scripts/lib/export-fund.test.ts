import { test } from "node:test";
import assert from "node:assert/strict";
import { planFundTables, type ForeignKeyLink } from "./export-fund.ts";

const link = (table: string, column: string, parentTable: string): ForeignKeyLink => ({
  table,
  column,
  parentTable,
  parentColumn: "id",
});

test("T-806: tables without fund_id are reached through their parent", () => {
  const { scopes, notReached } = planFundTables(
    ["cases", "financial_statements"],
    ["fund_mandates", "mandate_gates", "financial_statement_line_items", "countries"],
    [
      link("fund_mandates", "fund_profile_id", "funds"),
      link("mandate_gates", "mandate_id", "fund_mandates"),
      link("financial_statement_line_items", "statement_id", "financial_statements"),
    ],
  );
  const where = Object.fromEntries(scopes.map((scope) => [scope.table, scope.where]));
  assert.equal(where["funds"], "id = $1");
  assert.equal(where["cases"], "fund_id = $1");
  assert.equal(
    where["mandate_gates"],
    '"mandate_id" in (select "id" from public."fund_mandates" where "fund_profile_id" in (select "id" from public."funds" where id = $1))',
  );
  assert.match(
    where["financial_statement_line_items"]!,
    /from public."financial_statements" where fund_id = \$1/,
  );
  assert.deepEqual(notReached, ["countries"]);
});

test("T-806: every key to the fund counts, and cycles are not followed", () => {
  const { scopes } = planFundTables(
    ["cases"],
    ["links", "mandates", "a", "b"],
    [
      link("mandates", "fund", "funds"),
      link("links", "case_id", "cases"),
      link("links", "mandate_id", "mandates"),
      link("a", "case_id", "cases"),
      link("a", "b_id", "b"),
      link("b", "a_id", "a"),
      link("b", "self_id", "b"),
    ],
  );
  const where = Object.fromEntries(scopes.map((scope) => [scope.table, scope.where]));
  assert.match(where["links"]!, /^\("case_id" in .* or "mandate_id" in .*\)$/);
  // b is reached through a; a's key back to b is followed only where it does not loop.
  assert.match(where["b"]!, /^"a_id" in \(select "id" from public."a" where "case_id" in/);
  assert.doesNotMatch(where["b"]!, /"self_id"/);
});

test("T-806: identifiers from the catalog are quoted or refused", () => {
  assert.throws(() => planFundTables([], ["x"], [link("x", "bad;drop", "funds")]));
});
