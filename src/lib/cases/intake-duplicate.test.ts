/** Test af dubletkontrollen (domæne, navn og CVR) med en falsk klient. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { domainOfWebsite, lookupExistingCase } from "./intake-duplicate.ts";

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>, log: string[] = []): SupabaseClient {
  const from = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push(["eq", column, value]);
        return builder;
      },
      ilike: (column: string, value: unknown) => {
        filters.push(["ilike", column, value]);
        return builder;
      },
      limit: async () => {
        log.push(`${table}:${filters.map((f) => `${f[0]} ${f[1]}`).join(",")}`);
        const rows = (tables[table] ?? []).filter((row) =>
          filters.every(([kind, column, value]) =>
            kind === "eq"
              ? row[column] === value
              : String(row[column]).toLowerCase() === String(value).toLowerCase(),
          ),
        );
        return { data: rows.slice(0, 1), error: null };
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const tables = {
  companies: [
    {
      id: "co1",
      fund_id: "f1",
      name: "Havbrug Nord ApS",
      domain: "havbrugnord.dk",
      cvr_number: "26316804",
    },
    { id: "co2", fund_id: "f1", name: "Uden Domæne", domain: null, cvr_number: null },
  ],
  cases: [
    { id: "case1", fund_id: "f1", company_id: "co1" },
    { id: "case2", fund_id: "f1", company_id: "co2" },
  ],
};

test("domænet normaliseres som i RPC'en", () => {
  assert.equal(domainOfWebsite("https://www.HavbrugNord.dk/om"), "havbrugnord.dk");
  assert.equal(domainOfWebsite(""), null);
});

test("samme CVR i samme fond er en dublet, selv under et andet navn og uden hjemmeside", async () => {
  const hit = await lookupExistingCase(fakeClient(tables), {
    fundId: "f1",
    companyName: "Helt Andet Handelsnavn",
    domain: null,
    cvrNumber: "26316804",
  });
  assert.deepEqual(hit, { caseId: "case1", companyName: "Havbrug Nord ApS" });
});

test("samme CVR i en ANDEN fond er ikke en dublet (fond-isoleret)", async () => {
  const hit = await lookupExistingCase(fakeClient(tables), {
    fundId: "f2",
    companyName: "Havbrug Nord ApS",
    domain: "havbrugnord.dk",
    cvrNumber: "26316804",
  });
  assert.equal(hit, null);
});

test("domæne og navn virker som før; uden domæne bruges navnet (uden forskel på store/små bogstaver)", async () => {
  const byDomain = await lookupExistingCase(fakeClient(tables), {
    fundId: "f1",
    companyName: "x",
    domain: "havbrugnord.dk",
    cvrNumber: null,
  });
  assert.equal(byDomain?.caseId, "case1");
  const byName = await lookupExistingCase(fakeClient(tables), {
    fundId: "f1",
    companyName: "uden domæne",
    domain: null,
    cvrNumber: null,
  });
  assert.equal(byName?.caseId, "case2");
});

test("selskab uden case er ingen dublet, og fejl vises som venlig besked", async () => {
  const none = await lookupExistingCase(fakeClient({ companies: tables.companies, cases: [] }), {
    fundId: "f1",
    companyName: "x",
    domain: "havbrugnord.dk",
    cvrNumber: null,
  });
  assert.equal(none, null);
  const broken = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  await assert.rejects(
    lookupExistingCase(broken, { fundId: "f1", companyName: "x", domain: "a.dk", cvrNumber: null }),
    /kunne ikke kontrolleres/,
  );
});
