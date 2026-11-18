/**
 * Fund export: every row of every table that belongs to one fund, as plain JSON.
 * Used by scripts/export-fund.ts (customer:export builds on it) and by the database tests, which
 * prove that a forgotten person is not in the export either.
 *
 * A table belongs to the fund when it has a fund_id column, or when it has no fund_id but a
 * foreign key to a table that belongs to the fund (fund_mandates → funds, mandate_gates →
 * fund_mandates, financial_statement_line_items → financial_statements): its rows are those whose
 * parent row is the fund's. Both lists are read from the database, so a new table is exported
 * without touching this file. Vectors (embeddings) and generated search columns are left out: they
 * are rebuilt after an import. The funds row itself is included.
 */
import type pg from "pg";

export interface ExportedTable {
  table: string;
  rows: Array<Record<string, unknown>>;
  /** Columns left out because they are derived (vectors, generated search columns). */
  omittedColumns: string[];
  /** For a table without fund_id: the foreign keys its rows were found through. */
  via?: string[];
}

/** A single-column foreign key between two tables in public. */
export interface ForeignKeyLink {
  table: string;
  column: string;
  parentTable: string;
  parentColumn: string;
}

/** How one table's rows of the fund are selected: a where clause on $1 (the fund id). */
export interface TableScope {
  table: string;
  where: string;
  via?: string[];
}

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Quotes an identifier that came from the catalog; refuses anything unexpected. */
export function quoteIdentifier(name: string): string {
  if (!SAFE_IDENTIFIER.test(name)) throw new Error(`Unexpected identifier: ${name}`);
  return `"${name}"`;
}

/** The select list for a table: every column except vectors and generated columns. */
export function exportColumns(
  columns: Array<{ column_name: string; udt_name: string; is_generated: string }>,
): { selected: string[]; omitted: string[] } {
  const selected: string[] = [];
  const omitted: string[] = [];
  for (const column of columns) {
    // Derived columns are rebuilt after an import; secret hashes (invitation tokens, signing
    // secrets) never leave the database.
    const derived =
      column.udt_name === "vector" ||
      column.udt_name === "tsvector" ||
      column.is_generated === "ALWAYS" ||
      /(^|_)(token|secret)(_|$)/.test(column.column_name);
    (derived ? omitted : selected).push(column.column_name);
  }
  return { selected, omitted };
}

export async function listFundTables(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `select c.table_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'fund_id' and t.table_type = 'BASE TABLE'
      order by c.table_name`,
  );
  return rows.map((row) => row.table_name);
}

/** Base tables in public without a fund_id column: not exported, and named in the manifest. */
export async function listTablesWithoutFundId(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `select t.table_name
       from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and not exists (select 1 from information_schema.columns c
                         where c.table_schema = t.table_schema and c.table_name = t.table_name
                           and c.column_name = 'fund_id')
      order by t.table_name`,
  );
  return rows.map((row) => row.table_name);
}

export async function listForeignKeyLinks(client: pg.Client): Promise<ForeignKeyLink[]> {
  const { rows } = await client.query<{
    table_name: string;
    column_name: string;
    parent_table: string;
    parent_column: string;
  }>(
    `select child.relname as table_name, a.attname as column_name,
            parent.relname as parent_table, pa.attname as parent_column
       from pg_constraint con
       join pg_class child on child.oid = con.conrelid
       join pg_namespace cn on cn.oid = child.relnamespace and cn.nspname = 'public'
       join pg_class parent on parent.oid = con.confrelid
       join pg_namespace pn on pn.oid = parent.relnamespace and pn.nspname = 'public'
       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
       join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
      where con.contype = 'f' and cardinality(con.conkey) = 1
      order by child.relname, a.attname, parent.relname`,
  );
  return rows.map((row) => ({
    table: row.table_name,
    column: row.column_name,
    parentTable: row.parent_table,
    parentColumn: row.parent_column,
  }));
}

/**
 * Which tables are the fund's and how to select their rows. `funds` by id, tables with
 * fund_id by it; then, round by round, every table without fund_id with a foreign key to a table
 * already found. Its rows are those whose parent row is the fund's through any such key (so a
 * nullable key does not hide a row); a key back into the table's own path (a cycle or a
 * self-reference) is not followed. Tables that never reach the fund stay "not exported".
 */
export function planFundTables(
  fundIdTables: string[],
  tablesWithoutFundId: string[],
  links: ForeignKeyLink[],
): { scopes: TableScope[]; notReached: string[] } {
  const direct = new Map<string, string>([["funds", "id = $1"]]);
  for (const table of fundIdTables) if (table !== "funds") direct.set(table, "fund_id = $1");
  const reached = new Set(direct.keys());
  const order: string[] = [];
  let remaining = tablesWithoutFundId.filter((table) => !reached.has(table));
  for (;;) {
    const found = remaining.filter((table) =>
      links.some((link) => link.table === table && reached.has(link.parentTable)),
    );
    if (found.length === 0) break;
    for (const table of found) {
      reached.add(table);
      order.push(table);
    }
    remaining = remaining.filter((table) => !reached.has(table));
  }

  const parentsOf = (table: string, path: Set<string>) =>
    links.filter(
      (link) =>
        link.table === table &&
        reached.has(link.parentTable) &&
        !path.has(link.parentTable) &&
        link.parentTable !== table,
    );
  const whereFor = (table: string, path: Set<string>): string | null => {
    const own = direct.get(table);
    if (own) return own;
    const next = new Set(path).add(table);
    const parts = parentsOf(table, path).flatMap((link) => {
      const parent = whereFor(link.parentTable, next);
      return parent
        ? [
            `${quoteIdentifier(link.column)} in (select ${quoteIdentifier(link.parentColumn)} from public.${quoteIdentifier(link.parentTable)} where ${parent})`,
          ]
        : [];
    });
    if (parts.length === 0) return null;
    return parts.length > 1 ? `(${parts.join(" or ")})` : parts[0]!;
  };

  const scopes: TableScope[] = [...direct.entries()].map(([table, where]) => ({ table, where }));
  for (const table of order) {
    const where = whereFor(table, new Set());
    if (!where) continue;
    scopes.push({
      table,
      where,
      via: parentsOf(table, new Set()).map(
        (link) => `${link.column} → ${link.parentTable}.${link.parentColumn}`,
      ),
    });
  }
  return { scopes, notReached: remaining };
}

export async function exportFundData(
  client: pg.Client,
  fundId: string,
  options: { snapshot?: boolean } = {},
): Promise<{ tables: ExportedTable[]; tablesWithoutFundId: string[] }> {
  // The caller may already hold a transaction (the database tests do).
  if (options.snapshot === false) return readTables(client, fundId);
  // One snapshot for every table: the export is consistent even while the fund is in use.
  await client.query("begin isolation level repeatable read read only");
  try {
    return await readTables(client, fundId);
  } finally {
    await client.query("rollback");
  }
}

async function readTables(
  client: pg.Client,
  fundId: string,
): Promise<{ tables: ExportedTable[]; tablesWithoutFundId: string[] }> {
  const { scopes, notReached } = planFundTables(
    await listFundTables(client),
    (await listTablesWithoutFundId(client)).filter((name) => name !== "schema_migrations"),
    await listForeignKeyLinks(client),
  );
  const out: ExportedTable[] = [];
  for (const scope of scopes) {
    const { rows: columns } = await client.query<{
      column_name: string;
      udt_name: string;
      is_generated: string;
    }>(
      `select column_name, udt_name, is_generated
         from information_schema.columns
        where table_schema = 'public' and table_name = $1
        order by ordinal_position`,
      [scope.table],
    );
    const { selected, omitted } = exportColumns(columns);
    const list = selected.map(quoteIdentifier).join(", ");
    const { rows } = await client.query(
      `select ${list} from public.${quoteIdentifier(scope.table)} where ${scope.where} order by 1`,
      [fundId],
    );
    out.push({
      table: scope.table,
      rows,
      omittedColumns: omitted,
      ...(scope.via ? { via: scope.via } : {}),
    });
  }
  return { tables: out, tablesWithoutFundId: notReached };
}
