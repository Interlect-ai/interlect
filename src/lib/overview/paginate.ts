/**
 * Reads every row of a query that PostgREST would cut off (it answers at most 1,000 rows, or
 * whatever the project's max-rows says). A number built from a cut-off list is silently too low,
 * so this keeps asking from where the last answer ended, stops only when the server's `count`
 * says all rows are in (or an empty page), and throws instead of returning less than the count.
 * Queries must have a stable order (`order("id")`), or rows can repeat or go missing between pages.
 */

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
  /** The total number of rows matching the query (request it with `{ count: "exact" }`). */
  count?: number | null;
}

export const PAGE_SIZE = 1000;
/** A hard stop, so a server that ignores `range` cannot loop for ever. */
const MAX_PAGES = 500;

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = rows.length;
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    const data = result.data ?? [];
    rows.push(...data);
    if (typeof result.count === "number") total = result.count;
    if (data.length === 0) break;
    if (total !== null) {
      if (rows.length >= total) break;
      continue;
    }
    // Without a count only a short page proves the end, and a server limit below `pageSize`
    // would look short: always ask for the count.
    if (data.length < pageSize) break;
  }
  if (total !== null && rows.length < total) {
    // i18n-keep: the callers log it and show their own text (appServer.overview.*).
    throw new Error(`Hentede ${rows.length} af ${total} rækker.`);
  }
  return rows;
}
