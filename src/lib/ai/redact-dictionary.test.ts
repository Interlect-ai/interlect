import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRedactor } from "./redact.ts";
import { buildRedactionDictionary, isKeyRole } from "./redact-dictionary.ts";
import { loadRedactionDictionary } from "./redact-dictionary.server.ts";

test("key roles: founders, C-level, directors and the board; not employees or private owners", () => {
  for (const role of [
    "Founder",
    "Co-founder & CEO",
    "Medstifter",
    "CTO",
    "Chief Revenue Officer",
    "VP Sales",
    "Head of Product",
    "Adm. direktør",
    "DIREKTION",
    "Bestyrelsesformand",
    "BESTYRELSE",
    "Board member",
    "Chairman",
    "Ejer-leder",
  ]) {
    assert.ok(isKeyRole(role), role);
  }
  for (const role of [
    "Advisor",
    "Rådgiver",
    "Investor",
    "Business angel",
    "Ejer",
    "REEL EJER",
    "LEGALE EJERE",
    "Medarbejder",
    "Software engineer",
    "Founding engineer",
    "Kundeservice",
    "Sales Partner",
    "Advisory Board Member",
    "Rådgiver for bestyrelsen",
    "Founder's Associate",
    "Assistant to the CEO",
    "",
  ]) {
    assert.ok(!isKeyRole(role), role);
  }
});

test("the dictionary keeps key people and organisations and masks everyone else", () => {
  const dictionary = buildRedactionDictionary({
    people: [
      { name: "Anna Jensen", roles: ["CEO"], keyPerson: false },
      { name: "Jonas Ravn", roles: [], keyPerson: true },
      { name: "Line Hansen", aliases: ["Line H."], roles: ["Rådgiver"], keyPerson: false },
      { name: "Peter Holm", roles: ["REEL EJER"], keyPerson: false },
      { name: "  ", roles: [], keyPerson: false },
    ],
    organisations: ["Pleo Technologies ApS", "Seed Capital", ""],
  });
  assert.deepEqual(dictionary.keep, [
    "Anna Jensen",
    "Jonas Ravn",
    "Pleo Technologies ApS",
    "Seed Capital",
  ]);
  assert.deepEqual(dictionary.mask, [
    { name: "Line Hansen", aliases: ["Line H."] },
    { name: "Peter Holm", aliases: [] },
  ]);
});

type Filter = { op: string; column: string; value: unknown };

function fakeService(tables: Record<string, Record<string, unknown>[]>) {
  const queries: { table: string; columns: string; filters: Filter[]; ranges: number[][] }[] = [];
  const service = {
    from(table: string) {
      const query = { table, columns: "", filters: [] as Filter[], ranges: [] as number[][] };
      queries.push(query);
      const builder = {
        select(columns: string) {
          query.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push({ op: "eq", column, value });
          return builder;
        },
        in(column: string, value: unknown) {
          query.filters.push({ op: "in", column, value });
          return builder;
        },
        is(column: string, value: unknown) {
          query.filters.push({ op: "is", column, value });
          return builder;
        },
        neq(column: string, value: unknown) {
          query.filters.push({ op: "neq", column, value });
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          query.ranges.push([from, to]);
          const rows = tables[table] ?? [];
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { service, queries };
}

test("the loader reads people, Brain persons and their roles, scoped to the fund", async () => {
  const employees = Array.from({ length: 1200 }, (_, i) => ({
    id: `e${String(i).padStart(4, "0")}`,
    full_name: `Ansat${i} Medarbejdersen`,
    company_people: [{ role_title: "Medarbejder", registry_role: null, is_founder: false }],
  }));
  const { service, queries } = fakeService({
    people: [
      {
        id: "p1",
        full_name: "Anna Jensen",
        company_people: [{ role_title: "Founder", registry_role: null, is_founder: true }],
      },
      {
        id: "p2",
        full_name: "Line Hansen",
        company_people: [{ role_title: "Rådgiver", registry_role: null, is_founder: false }],
      },
      ...employees,
    ],
    brain_entities: [
      // Linked to Line Hansen in people: an alias, and her Brain role makes her a key person.
      {
        id: "b1",
        type: "person",
        name: "Line H. Hansen",
        aliases: ["L. Hansen"],
        ref_table: "people",
        ref_id: "p2",
      },
      {
        id: "b2",
        type: "person",
        name: "Søren Østergaard",
        aliases: [],
        ref_table: null,
        ref_id: null,
      },
      { id: "b3", type: "person", name: "Mikkel Ravn", aliases: [], ref_table: null, ref_id: null },
      { id: "b4", type: "person", name: "Åse Krogh", aliases: [], ref_table: null, ref_id: null },
      {
        id: "c1",
        type: "company",
        name: "Pleo",
        aliases: ["Pleo Technologies"],
        ref_table: null,
        ref_id: null,
      },
      {
        id: "i1",
        type: "investor",
        name: "Seed Capital",
        aliases: [],
        ref_table: null,
        ref_id: null,
      },
      { id: "b5", type: "person", name: "Ida Holm", aliases: [], ref_table: null, ref_id: null },
      // An angel registered as an investor under the name of a known private person.
      { id: "i2", type: "investor", name: "Åse Krogh", aliases: [], ref_table: null, ref_id: null },
    ],
    brain_facts: [
      {
        id: "f1",
        subject_id: "b1",
        object_id: "c1",
        predicate: "has_role",
        value_text: "Bestyrelsesmedlem",
      },
      { id: "f2", subject_id: "c1", object_id: "b3", predicate: "founded_by", value_text: null },
      { id: "f3", subject_id: "b4", object_id: "c1", predicate: "has_role", value_text: "Sælger" },
      // Reversed by the extractor: person → company. Still a founder.
      { id: "f4", subject_id: "b5", object_id: "c1", predicate: "founded_by", value_text: null },
    ],
    companies: [{ id: "co1", name: "Pleo", legal_name: "Pleo Technologies ApS" }],
  });

  const dictionary = await loadRedactionDictionary(service, "fund-a");

  for (const query of queries) {
    assert.ok(
      query.filters.some((f) => f.op === "eq" && f.column === "fund_id" && f.value === "fund-a"),
      `${query.table} is not scoped to the fund`,
    );
  }
  // 1,200 employees: the people table is read in pages until a short page.
  const factQuery = queries.find((q) => q.table === "brain_facts");
  assert.ok(
    factQuery?.filters.some((f) => f.op === "eq" && f.column === "status" && f.value === "active"),
    "proposed facts must not make anyone a key person",
  );
  const pages = queries.filter((q) => q.table === "people").flatMap((q) => q.ranges);
  assert.deepEqual(pages, [
    [0, 999],
    [1000, 1999],
  ]);
  assert.ok(dictionary.keep.includes("Anna Jensen"));
  assert.ok(dictionary.keep.includes("Line Hansen"), "board member via Brain");
  assert.ok(dictionary.keep.includes("L. Hansen"));
  assert.ok(dictionary.keep.includes("Mikkel Ravn"), "founder via Brain");
  assert.ok(dictionary.keep.includes("Pleo Technologies ApS"));
  assert.ok(dictionary.keep.includes("Seed Capital"));
  assert.ok(dictionary.keep.includes("Ida Holm"), "founder via a reversed founded_by");
  assert.ok(!dictionary.keep.includes("Åse Krogh"), "a private person is not kept as an investor");
  const masked = dictionary.mask.map((p) => p.name);
  assert.ok(masked.includes("Søren Østergaard"));
  assert.ok(masked.includes("Åse Krogh"));
  assert.ok(masked.includes("Ansat1199 Medarbejdersen"));
  assert.equal(masked.length, 1202);

  const redactor = createRedactor(dictionary);
  assert.equal(
    redactor.redact(
      "Line Hansen (bestyrelsen), Mikkel Ravn og Anna Jensen mødte Søren Østergaard og Åse Krogh fra Pleo.",
    ),
    "Line Hansen (bestyrelsen), Mikkel Ravn og Anna Jensen mødte [Person 1] og [Person 2] fra Pleo.",
  );
});

test("the loader fails loudly instead of returning a dictionary with holes", async () => {
  const service = {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        neq: () => builder,
        order: () => builder,
        range: () => Promise.resolve({ data: null, error: { message: "permission denied" } }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  await assert.rejects(loadRedactionDictionary(service, "fund-a"), /permission denied/u);
});
