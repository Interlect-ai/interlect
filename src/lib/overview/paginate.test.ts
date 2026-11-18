import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllRows, type PageResult } from "./paginate.ts";

/** A fake PostgREST: `limit` is the server's max rows per answer, `exact` sends the count. */
function server(total: number, limit: number, exact: boolean) {
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number): Promise<PageResult<number>> => {
    calls.push([from, to]);
    const end = Math.min(to, from + limit - 1, total - 1);
    const data =
      from > end ? [] : Array.from({ length: end - from + 1 }, (_, index) => from + index);
    return { data, error: null, ...(exact ? { count: total } : {}) };
  };
  return { fetchPage, calls };
}

test("reads past 1,000 rows (the PostgREST limit) and returns every row once", async () => {
  const { fetchPage, calls } = server(2_350, 1000, true);
  const rows = await fetchAllRows(fetchPage);
  assert.equal(rows.length, 2_350);
  assert.equal(new Set(rows).size, 2_350);
  assert.deepEqual(calls, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

test("exactly one full page with a count stops without a wasted request", async () => {
  const { fetchPage, calls } = server(1000, 1000, true);
  assert.equal((await fetchAllRows(fetchPage)).length, 1000);
  assert.equal(calls.length, 1);
});

test("a server limit below the page size still returns every row (the count says there is more)", async () => {
  const { fetchPage } = server(1_500, 400, true);
  const rows = await fetchAllRows(fetchPage, 1000);
  assert.equal(rows.length, 1_500);
  assert.equal(new Set(rows).size, 1_500);
});

test("without a count, a short page ends the read", async () => {
  const { fetchPage } = server(2_001, 1000, false);
  assert.equal((await fetchAllRows(fetchPage)).length, 2_001);
});

test("an empty table is an empty list", async () => {
  const { fetchPage } = server(0, 1000, true);
  assert.deepEqual(await fetchAllRows(fetchPage), []);
});

test("a server that answers with fewer rows than its own count is an error, not a low number", async () => {
  await assert.rejects(
    () =>
      fetchAllRows(async (from): Promise<PageResult<number>> => ({
        data: from === 0 ? [1, 2, 3] : [],
        error: null,
        count: 10,
      })),
    /Hentede 3 af 10/,
  );
});

test("an error on any page fails the whole read", async () => {
  let call = 0;
  await assert.rejects(
    () =>
      fetchAllRows(async (): Promise<PageResult<number>> => {
        call += 1;
        return call === 1
          ? { data: Array.from({ length: 1000 }, (_, index) => index), error: null, count: 3000 }
          : { data: null, error: { message: "boom" } };
      }),
    /boom/,
  );
});
