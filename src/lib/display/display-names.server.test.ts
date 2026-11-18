import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localizeGraphLabels, shapeGraph } from "../brain/graph.ts";
import { shapePageDetail } from "../brain/page-view.ts";
import {
  loadChoiceKey,
  loadDemoView,
  loadDisplayAliases,
  loadDisplayNamer,
  teamRegisterHits,
} from "./display-names.server.ts";

type Row = Record<string, unknown>;

const lower = (value: unknown) => String(value).trim().toLowerCase();

function clearReads(reads: Record<string, number>) {
  for (const table of Object.keys(reads)) delete reads[table];
}

/** A tiny in-memory stand-in for the tables the loader reads and the one it writes. */
function fakeService(opts: {
  demoView: boolean;
  failUpsert?: boolean;
  brain?: { entities?: Row[]; decisions?: Row[] };
  companies?: Row[];
  /** Aliases stored before this load. */
  stored?: Row[];
  /** Another load that stores aliases just before this load's first write. */
  meanwhile?: Row[];
  /** Every table but `funds` fails to read. */
  failReads?: boolean;
}) {
  const aliasRows: Row[] = [...(opts.stored ?? [])];
  const tables: Record<string, Row[]> = {
    companies: opts.companies ?? [
      {
        id: "c1",
        name: "Veo",
        legal_name: "Veo Technologies ApS",
        website: "https://www.veo.dk",
        domain: "veo.io",
        domains: ["veo.dk"],
        cvr_number: "12345678",
        registry_number: null,
      },
      { id: "c2", name: "Pleo", legal_name: null },
    ],
    people: [{ id: "p1", full_name: "Maria Holmgaard" }],
    brain_entities: opts.brain?.entities ?? [],
    brain_historical_decisions: opts.brain?.decisions ?? [],
    display_aliases: aliasRows,
  };
  const upserts: Row[][] = [];
  /** Reads per table. */
  const reads: Record<string, number> = {};
  const read = (table: string) => (reads[table] = (reads[table] ?? 0) + 1);
  let meanwhile = opts.meanwhile;
  const service = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        range: async () => {
          read(table);
          if (opts.failReads) return { data: null, error: { message: "nede" } };
          return { data: [...(tables[table] ?? [])], error: null };
        },
        maybeSingle: async () => {
          read(table);
          return { data: table === "funds" ? { demo_view: opts.demoView } : null, error: null };
        },
        // As 0106 and 0111: one row per real name (a second one is left out), one owner per alias
        // (a second one fails the whole write).
        upsert: async (rows: Row[]) => {
          upserts.push(rows);
          if (opts.failUpsert) return { error: { message: "boom" } };
          if (meanwhile) {
            aliasRows.push(...meanwhile);
            meanwhile = undefined;
          }
          const fresh = rows.filter(
            (row) => !aliasRows.some((r) => lower(r["real_name"]) === lower(row["real_name"])),
          );
          const owned = (alias: unknown) =>
            aliasRows.some((r) => r["owns_alias"] === true && lower(r["alias"]) === lower(alias));
          if (fresh.some((row) => row["owns_alias"] === true && owned(row["alias"]))) {
            return {
              error: {
                code: "23505",
                message:
                  'duplicate key value violates unique constraint "display_aliases_one_owner"',
              },
            };
          }
          for (const row of fresh) aliasRows.push({ ...row, id: String(aliasRows.length) });
          return { error: null };
        },
      };
      return query;
    },
  };
  return { service: service as unknown as SupabaseClient, upserts, reads, aliasRows };
}

test("a team without the demo view is not touched: no namer, nothing written", async () => {
  const { service, upserts } = fakeService({ demoView: false });
  assert.equal(await loadDisplayAliases(service, "f1"), null);
  assert.equal(await loadDisplayNamer(service, "f1"), null);
  assert.equal(upserts.length, 0);
});

test("the demo view invents one alias per name; brand and legal name share one", async () => {
  const { service, upserts } = fakeService({ demoView: true });
  const aliases = (await loadDisplayAliases(service, "f1"))!;
  assert.equal(aliases.length, 4);
  const byReal = new Map(aliases.map((a) => [a.real, a.alias]));
  assert.equal(byReal.get("Veo"), byReal.get("Veo Technologies ApS"));
  assert.notEqual(byReal.get("Veo"), byReal.get("Pleo"));
  for (const a of aliases) assert.ok(!byReal.has(a.alias), "an alias is never a real name");
  // The names with an alias of their own first, then the legal name that shares Veo's.
  assert.deepEqual(
    upserts.map((rows) => rows.map((r) => [r["real_name"], r["owns_alias"]])),
    [
      [
        ["Veo", true],
        ["Pleo", true],
        ["Maria Holmgaard", true],
      ],
      [["Veo Technologies ApS", false]],
    ],
  );
  // A second load finds them all and writes nothing more.
  await loadDisplayAliases(service, "f1");
  assert.equal(upserts.length, 2);
});

test("the namer from the loaded aliases hides every real name, in any form", async () => {
  const { service } = fakeService({ demoView: true });
  const namer = (await loadDisplayNamer(service, "f1"))!;
  const out = namer.apply("Veo Technologies ApS, Veo, Pleo and Maria Holmgaard");
  for (const real of ["Veo", "Pleo", "Maria", "Holmgaard"]) assert.ok(!out.includes(real), out);
});

test("it fails closed: when the names cannot be saved nothing is shown", async () => {
  const { service } = fakeService({ demoView: true, failUpsert: true });
  await assert.rejects(loadDisplayAliases(service, "f1"), /kunne ikke gemmes/);
});

test("the view hides each company's web address and register number behind its alias", async () => {
  const { service } = fakeService({ demoView: true });
  const view = (await loadDemoView(service, "f1"))!;
  const out = view.apply("Se https://www.veo.dk/om, CVR 12345678");
  assert.ok(!out.includes("veo.dk") && !out.includes("12345678"), out);
  assert.match(out, /\.example\/om, CVR \d{8}$/);
});

test("a screen in the demo team reads each table once when no name is new (T-770)", async () => {
  const { service, reads, upserts } = fakeService({ demoView: true });
  await loadDemoView(service, "f1");
  clearReads(reads);
  const view = (await loadDemoView(service, "f1"))!;
  assert.ok(!view.apply("Veo, www.veo.dk, CVR 12345678").includes("12345678"));
  // The flag, the names and the aliases, and the companies once for both names and masker.
  assert.deepEqual(reads, {
    funds: 1,
    companies: 1,
    people: 1,
    brain_entities: 1,
    brain_historical_decisions: 1,
    display_aliases: 1,
  });
  assert.equal(upserts.length, 2);
  // A register search reads once too.
  clearReads(reads);
  await teamRegisterHits(service, "f1", "DK", [{ cvrNumber: "12345678", name: "VEO" }]);
  assert.equal(reads["companies"], 1);
  assert.equal(reads["display_aliases"], 1);
});

test("a team that leaves the demo view is untouched again, even if its names cannot be read", async () => {
  // Seen with the demo view on: its names are read alongside the flag.
  await loadDemoView(fakeService({ demoView: true }).service, "f-leaves");
  const off = fakeService({ demoView: false, failReads: true });
  assert.equal(await loadDemoView(off.service, "f-leaves"), null);
  assert.equal(off.upserts.length, 0);
  // Not seen as a demo team any more: the next load reads only the flag.
  clearReads(off.reads);
  assert.equal(await loadDemoView(off.service, "f-leaves"), null);
  assert.deepEqual(off.reads, { funds: 1 });
});

test("two loads at once never give two names the same invented alias (T-765 c)", async () => {
  // What this load invents for Pleo when no other load is busy.
  const alone = (await loadDisplayAliases(fakeService({ demoView: true }).service, "f1"))!;
  const pleo = alone.find((a) => a.real === "Pleo")!.alias;
  // Another load stores another company with that very alias just before this load writes.
  const { service, aliasRows, upserts } = fakeService({
    demoView: true,
    meanwhile: [
      { id: "m1", kind: "company", real_name: "Northwind", alias: pleo, owns_alias: true },
    ],
  });
  const aliases = (await loadDisplayAliases(service, "f1"))!;
  const byReal = new Map(aliases.map((a) => [a.real, a.alias]));
  assert.notEqual(byReal.get("Pleo"), pleo);
  assert.equal(byReal.get("Northwind"), pleo);
  // Brand and legal name still share theirs, and every other alias has one owner.
  assert.equal(byReal.get("Veo"), byReal.get("Veo Technologies ApS"));
  const owners = aliasRows.filter((r) => r["owns_alias"] === true).map((r) => lower(r["alias"]));
  assert.equal(new Set(owners).size, owners.length);
  assert.equal(new Set(aliases.map((a) => a.alias)).size, aliases.length - 1);
  // The first write failed, the second invented again, then the shared names were written.
  assert.equal(upserts.length, 3);
});

test("a name that shares an alias gets the one stored, also when another load stored it", async () => {
  // Another load stored the brand name first, with an alias of its own.
  const { service } = fakeService({
    demoView: true,
    meanwhile: [
      { id: "m1", kind: "company", real_name: "Veo", alias: "Brixen Bio", owns_alias: true },
    ],
  });
  const aliases = (await loadDisplayAliases(service, "f1"))!;
  const byReal = new Map(aliases.map((a) => [a.real, a.alias]));
  assert.equal(byReal.get("Veo"), "Brixen Bio");
  assert.equal(byReal.get("Veo Technologies ApS"), "Brixen Bio");
});

test("the whole demo view: names, address and number, on the way out and back (T-769)", async () => {
  assert.equal(await loadDemoView(fakeService({ demoView: false }).service, "f1"), null);
  const { service } = fakeService({ demoView: true });
  const view = (await loadDemoView(service, "f1"))!;
  const out = view.apply("Veo (www.veo.dk, CVR 12345678) og Maria Holmgaard");
  for (const real of ["Veo", "veo.dk", "12345678", "Maria", "Holmgaard"]) {
    assert.ok(!out.includes(real), out);
  }
  const s = view.stream();
  const streamed = s.push("Veo (www.ve") + s.push("o.dk, CVR 1234") + s.push("5678) og Maria Holm");
  assert.equal(streamed + s.push("gaard") + s.flush(), out);
  assert.equal(view.reverse(view.apply("veo.dk, CVR 12345678")), "veo.dk, CVR 12345678");
  // `companies.domain` is a host too (the web proposals are built from it).
  assert.ok(!view.apply("se veo.io").includes("veo.io"));
});

test("a choice is compared as the screen showed it (T-776)", async () => {
  const plain = await loadChoiceKey(fakeService({ demoView: false }).service, "f1");
  assert.equal(plain("Veo.DK"), "veo.dk");
  const { service } = fakeService({ demoView: true });
  const view = (await loadDemoView(service, "f1"))!;
  const key = await loadChoiceKey(service, "f1");
  for (const real of ["veo.dk", "pleo.io", "veo had a weak team"]) {
    assert.notEqual(key(real), real);
    assert.equal(key(real), view.apply(real).toLowerCase());
  }
  // Two values shown alike are chosen together: the known host and another one with the name.
  assert.equal(key("veo.dk"), key("veo.com"));
});

test("a register search keeps only the team's own companies in the demo view (T-776)", async () => {
  const hits = [
    { cvrNumber: "12345678", name: "VEO TECH ApS", status: "NORMAL" },
    { cvrNumber: "87654321", name: "VEO HOLDING ApS", status: "NORMAL" },
  ];
  const plain = fakeService({ demoView: false }).service;
  assert.deepEqual(await teamRegisterHits(plain, "f1", "DK", hits), hits);
  const { service } = fakeService({ demoView: true });
  const kept = await teamRegisterHits(service, "f1", "DK", hits);
  // The team's own name, not the register's spelling, so the namer knows it.
  assert.deepEqual(kept, [{ ...hits[0], name: "Veo Technologies ApS" }]);
  const shown = JSON.stringify((await loadDemoView(service, "f1"))!.applyJson(kept));
  assert.ok(!shown.includes("12345678") && !/veo/i.test(shown), shown);
  // The same digits in another country's register are another company.
  const finnish = [{ cvrNumber: "1234567-8", name: "Veo Oy", status: "" }];
  assert.deepEqual(await teamRegisterHits(service, "f1", "FI", finnish), []);
});

// What Brain found in documents, registers and on the web, as on the demo team on staging
// Founders, competitors, banks, universities, investors, and a description.
const brainEntities: Row[] = [
  { id: "e1", type: "company", name: "Veo Technologies", aliases: ["Veo Technologies ApS"] },
  { id: "e2", type: "company", name: "TWO AS", aliases: [] },
  { id: "e3", type: "company", name: "Google", aliases: [] },
  { id: "e4", type: "company", name: "AWS", aliases: [] },
  { id: "e5", type: "company", name: "Visa", aliases: [] },
  { id: "e6", type: "company", name: "MIT", aliases: [] },
  { id: "e7", type: "company", name: "Formue", aliases: [] },
  { id: "e8", type: "company", name: "Komplett", aliases: [] },
  { id: "e9", type: "company", name: "Root AS", aliases: [] },
  { id: "e10", type: "company", name: "Danske Bank", aliases: [] },
  { id: "e11", type: "company", name: "Burnley FC", aliases: [] },
  { id: "e12", type: "company", name: 'SIA "Sonarworks"', aliases: [] },
  { id: "e13", type: "company", name: "leading payments company", aliases: [] },
  { id: "e14", type: "investor", name: "Sequoia Capital", aliases: [] },
  { id: "e15", type: "investor", name: "Atomico", aliases: [] },
  { id: "e16", type: "investor", name: "Curiosity", aliases: [] },
  { id: "e17", type: "fund_vehicle", name: "NVIDIA Inception Program", aliases: [] },
  {
    id: "e18",
    type: "person",
    name: "Henrik Teisbæk",
    aliases: ["Henrik Bjørn Teisbæk"],
  },
  { id: "e19", type: "person", name: "Félix Blossier", aliases: [] },
  { id: "e20", type: "person", name: "Felix Blossier", aliases: [] },
  { id: "e21", type: "person", name: "Tesi", aliases: [] },
  // A point on the team's own company shares its alias.
  { id: "e22", type: "company", name: "Veo", aliases: [], ref_table: "companies", ref_id: "c1" },
  // Another Maria, only in Brain: the team's own Maria keeps her first name alone.
  { id: "e23", type: "person", name: "Maria Jensen", aliases: [] },
  { id: "e24", type: "investor", name: "Niklas Zennström", aliases: [] },
  { id: "e25", type: "company", name: "competitors", aliases: [] },
];
const brainDecisions: Row[] = [
  { id: "d1", company_name: "Kyckr" },
  { id: "d2", company_name: "N/A" },
];
const brainService = () =>
  fakeService({ demoView: true, brain: { entities: brainEntities, decisions: brainDecisions } });

/** Every real name the demo view must hide (each one as the screen could write it). */
const REAL_NAMES = [
  "Veo Technologies",
  "Veo",
  "Pleo",
  "Maria Holmgaard",
  "Maria",
  "Holmgaard",
  "Jensen",
  "Niklas",
  "Zennström",
  "TWO AS",
  "Two",
  "TWO",
  "Google",
  "AWS",
  "Visa",
  "MIT",
  "Formue",
  "Komplett",
  "Root AS",
  "Root",
  "Danske Bank",
  "Burnley",
  "Sonarworks",
  "Sequoia",
  "Atomico",
  "Curiosity",
  "NVIDIA",
  "Henrik",
  "Teisbæk",
  "Félix",
  "Felix",
  "Blossier",
  "Tesi",
  "Kyckr",
];

/** The real names `shown` still writes as names (a capital letter, a whole word). */
function realNamesIn(shown: string): string[] {
  return REAL_NAMES.filter((name) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, "u").test(shown),
  );
}

test("names only Brain knows get invented names too, readably (T-777)", async () => {
  const { service } = brainService();
  const aliases = (await loadDisplayAliases(service, "f1"))!;
  const byReal = new Map(aliases.map((a) => [a.real, a]));
  // A description is no name, and its sentence stays as written.
  assert.equal(byReal.has("leading payments company"), false);
  // A Brain point on the team's own company, another spelling and one written with an accent
  // share the alias.
  assert.equal(byReal.get("Veo")!.alias, byReal.get("Veo Technologies ApS")!.alias);
  assert.equal(byReal.get("Veo Technologies")!.alias, byReal.get("Veo")!.alias);
  assert.equal(byReal.get("Henrik Bjørn Teisbæk")!.alias, byReal.get("Henrik Teisbæk")!.alias);
  assert.equal(byReal.get("Felix Blossier")!.alias, byReal.get("Félix Blossier")!.alias);
  // People always get a person's name; an investor sounds like one; a kind word stays.
  assert.equal(byReal.get("Tesi")!.kind, "person");
  assert.match(byReal.get("Atomico")!.alias, / (Capital|Ventures|Partners|Invest|Growth)$/);
  assert.match(byReal.get("Sequoia Capital")!.alias, /^\S+ Capital$/);
  assert.match(byReal.get("Danske Bank")!.alias, /^\S+ Bank$/);
  assert.match(byReal.get("Burnley FC")!.alias, /^\S+ FC$/);
  // The team's own names are the strict ones; what only Brain knows is marked.
  assert.equal(byReal.get("Veo")!.outside, false);
  assert.equal(byReal.get("Pleo")!.outside, false);
  assert.equal(byReal.get("Google")!.outside, true);
  // A name from a file is strict too: a file is often typed in small letters.
  assert.equal(byReal.get("Kyckr")!.outside, false);
  // A word Brain kept as a point, and what a file writes for no name, get no alias.
  assert.equal(byReal.has("competitors"), false);
  assert.equal(byReal.has("N/A"), false);
  // An investor written as a person's name gets a person's name.
  assert.equal(byReal.get("Niklas Zennström")!.kind, "person");
  for (const a of aliases) assert.ok(!byReal.has(a.alias), `${a.alias} is a real name`);
});

test("the brain map in the demo team shows no real name (T-777)", async () => {
  const { service } = brainService();
  const view = (await loadDemoView(service, "f1"))!;
  // What brain_graph_payload gives: every active point by its name (0074), and a case and a sector.
  const points = [
    ...brainEntities.map((e) => ({
      id: String(e["id"]),
      type: String(e["type"]),
      label: String(e["name"]),
    })),
    { id: "k1", type: "case", label: "Veo Technologies ApS" },
    { id: "s1", type: "sector", label: "Fintech" },
  ];
  const graph = localizeGraphLabels(
    shapeGraph({
      nodes: {
        ids: points.map((p) => p.id),
        types: points.map((p) => p.type),
        labels: points.map((p) => p.label),
        first_seen: points.map(() => 0),
        decision: points.map(() => null),
        ref: points.map(() => null),
      },
      preds: ["competes_with"],
      edges: { src: [0], dst: [2], pred: [0], proposed: [false], recorded: [0] },
      truncated: false,
    }),
    "en",
  );
  // What getBrainGraph returns: the graph through the demo view (inDemoView).
  const shown = view.applyJson(graph);
  assert.deepEqual(realNamesIn(JSON.stringify(shown)), []);
  // The description and the sector are left as they are.
  assert.ok(shown.nodes.labels.includes("leading payments company"));
  assert.ok(shown.nodes.labels.includes("Fintech"));
});

test("a Brain page in the demo team shows no real name, and ordinary words stay (T-777)", async () => {
  const { service } = brainService();
  const view = (await loadDemoView(service, "f1"))!;
  const body = [
    "Veo was founded by Henrik Bjørn Teisbæk; Henrik and Félix Blossier run it. Tesi invested.",
    "Two founders left in 2023 for a two-year break; the root cause was a visa for one of them.",
    "Competitors: Root AS (Root), TWO AS, Kyckr. Backed by Sequoia Capital, Atomico and Curiosity.",
    "Runs on AWS and Google; pays with Visa. Alumni of MIT, now at Formue and Komplett.",
    'Partners: Danske Bank, Burnley FC, SIA "Sonarworks" (Sonarworks) and NVIDIA Inception Program.',
    "Deck: root-deck.pdf, two_kort.xlsx, #kyckr. Our curiosity was a leading payments company.",
    "Maria said kyckr had a weak team. Zennström invested. The **root** cause, „root“ and root….",
    "Two competitors raised. N/A.",
  ].join("\n\n");
  const detail = shapePageDetail(
    {
      id: "page-1",
      kind: "company",
      title: "Veo Technologies",
      version: 2,
      updated_at: "2026-10-18T08:00:00Z",
      updated_by: "L4",
      sections: [{ key: "overview", heading: "Overview", body_md: body }],
    },
    [{ version: 1, changed_by: "L4", created_at: "2026-10-17T08:00:00Z", sections: [] }],
    "en",
  )!;
  // What getBrainPage returns: the page through the demo view (inDemoView).
  const shown = view.applyJson({ ...detail, canEdit: true });
  const text = JSON.stringify(shown);
  assert.deepEqual(realNamesIn(text), []);
  assert.ok(!/root-deck|two_kort|#kyckr/i.test(text), text);
  // Readable: the ordinary words are still the words.
  for (const word of [
    "two-year break",
    "the root cause",
    "a visa",
    "Our curiosity",
    "The **root** cause, „root“ and root…",
    " competitors raised. N/A.",
  ]) {
    assert.ok(text.includes(word), `${word} is gone: ${text}`);
  }
  assert.ok(text.includes("a leading payments company"), text);
});

test("names only a site or a file carries get an alias before they are shown (T-777)", async () => {
  const site = fakeService({ demoView: true }).service;
  // A proposed company's domain shares its name's alias, so the domain shows no real name.
  const portfolio = (await loadDemoView(site, "f1", [
    { name: "Kyckr Technologies" },
    { name: "kyckr", sameAs: "Kyckr Technologies" },
  ]))!;
  assert.ok(!/kyckr/i.test(portfolio.apply("Kyckr Technologies (kyckr.com), kyckr")));
  assert.equal(portfolio.apply("kyckr"), portfolio.apply("Kyckr Technologies"));
  const { service } = fakeService({ demoView: true });
  const view = (await loadDemoView(service, "f1", [{ name: "Neople" }, { name: "Rendra Oy" }]))!;
  const shown = view.apply("Portfolio: Neople, Rendra Oy and Rendra (neople.com).");
  assert.ok(!/Neople|Rendra/i.test(shown), shown);
  // Seeded once: the next screen knows them without the file.
  const later = (await loadDemoView(service, "f1"))!;
  assert.equal(later.apply("Neople"), view.apply("Neople"));
});

test("a company goes by the name its own web address gives it (T-782)", async () => {
  const { service } = fakeService({
    demoView: true,
    companies: [
      {
        id: "c1",
        name: "Veo Technologies",
        legal_name: "Veo Technologies ApS",
        website: "https://www.veo.co/",
        domain: "veo.co",
        domains: ["veo.co"],
      },
      {
        id: "c2",
        name: "Weaviate",
        legal_name: "Weaviate Holding Inc.",
        website: "https://weaviate.io/",
      },
      // An address that is not the name's first part gives no short name.
      { id: "c3", name: "Northvolt Battery Systems", website: "https://example.com" },
    ],
  });
  const aliases = (await loadDisplayAliases(service, "f1"))!;
  const byReal = new Map(aliases.map((a) => [a.real, a.alias]));
  assert.equal(byReal.get("Veo"), byReal.get("Veo Technologies"));
  assert.ok(
    !byReal.has("Weaviate Holding") && !byReal.has("Northvolt"),
    [...byReal.keys()].join(", "),
  );
  const view = (await loadDemoView(service, "f1"))!;
  const out = view.apply(
    "Veo looks like a real sports-video company. Should we invest in Veo? veo had a weak team.",
  );
  assert.ok(!/veo/i.test(out), out);
  assert.equal((out.match(new RegExp(byReal.get("Veo")!, "g")) ?? []).length, 3, out);
});

test("an investor named after a place or a body is no person (T-910)", async () => {
  const { service } = fakeService({
    demoView: true,
    brain: {
      entities: [
        { id: "e1", type: "investor", name: "Business Finland", aliases: [] },
        { id: "e2", type: "investor", name: "Niklas Zennström", aliases: [] },
      ],
    },
  });
  const aliases = (await loadDisplayAliases(service, "f1"))!;
  const kindOf = new Map(aliases.map((a) => [a.real, a.kind]));
  assert.equal(kindOf.get("Business Finland"), "company");
  assert.equal(kindOf.get("Niklas Zennström"), "person");
  const namer = (await loadDisplayNamer(service, "f1"))!;
  const out = namer.apply(
    "Headquartered in Helsinki, Finland. The business plan was reviewed. Backed by Business Finland and Zennström.",
  );
  assert.match(out, /Helsinki, Finland\. The business plan was reviewed\./);
  for (const real of ["Business Finland", "Zennström"]) assert.ok(!out.includes(real), out);
});

test("the name a company goes by stays the team's own when Brain stored it first (T-782)", async () => {
  const { service } = fakeService({
    demoView: true,
    companies: [{ id: "c1", name: "Veo Technologies", website: "https://app.veo.co/" }],
    // Stored from a Brain point, with an alias of its own.
    stored: [{ id: "s1", kind: "company", real_name: "Veo", alias: "Brixen Bio" }],
  });
  const aliases = (await loadDisplayAliases(service, "f1"))!;
  assert.equal(aliases.find((a) => a.real === "Veo")?.outside, false);
  const namer = (await loadDisplayNamer(service, "f1"))!;
  // As one of the team's own names it is hidden in any case, not only with a capital.
  assert.ok(
    !/veo/i.test(namer.apply("veo had a weak team; Veo grew")),
    namer.apply("veo had a weak team"),
  );
});
