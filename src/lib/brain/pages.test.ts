import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPageOps,
  assemblePage,
  citedIds,
  clipText,
  computedSections,
  pageDate,
  factRefs,
  normalizeRefs,
  pageSearchText,
  pageWriterPrompt,
  parsePageOps,
  periodLabel,
  rewriteRefs,
  writerFacts,
  writerInputHash,
  writerSectionsToIds,
  type PageData,
  type PageFact,
  type PageSection,
  type WrittenSection,
} from "./pages.ts";

const COMPANY = "e0000000-0000-4000-8000-000000000001";
const F1 = "f0000000-0000-4000-8000-000000000001";
const F2 = "f0000000-0000-4000-8000-000000000002";
const F3 = "f0000000-0000-4000-8000-000000000003";

function fact(id: string, overrides: Partial<PageFact>): PageFact {
  return {
    id,
    predicate: "metric",
    statement: "Nordlys havde ARR på 2,1 mio. kr. i 2025.",
    subjectId: COMPANY,
    subjectName: "Nordlys ApS",
    objectId: null,
    objectName: "ARR",
    valueText: "ARR",
    valueNum: 2_100_000,
    unit: "kr.",
    validFrom: "2025-01-01",
    validTo: "2025-12-31",
    trust: "customer_doc",
    recordedAt: "2026-10-01T10:00:00.000000+00:00",
    ...overrides,
  };
}

const companyData: PageData = {
  entity: { id: COMPANY, type: "company", name: "Nordlys ApS" },
  facts: [
    fact(F1, {}),
    fact(F2, {
      predicate: "raised_round",
      statement: "Nordlys rejste en seed-runde på 5 mio. kr. i marts 2025.",
      valueNum: 5_000_000,
      validFrom: "2025-03-12",
      validTo: null,
    }),
  ],
  cases: [
    {
      caseId: "c1",
      createdAt: "2025-02-01T09:00:00+00:00",
      phase: "decided",
      decision: "reject",
      decidedAt: "2025-03-12T10:00:00+00:00",
      reasons: ["For tidligt, ingen traction"],
      note: "Stærkt team,\n svag GTM.",
    },
    { caseId: "c2", createdAt: "2026-09-01T09:00:00+00:00", phase: "screening" },
  ],
  historical: [{ decidedOn: "2021-06-01", kind: "invest", reasons: [] }],
  contradictions: [],
};

test("dates and periods are written the Danish way", () => {
  assert.equal(pageDate("2026-03-12T10:00:00Z"), "12. mar 2026");
  assert.equal(pageDate("nope"), null);
  assert.equal(periodLabel("2025-01-01", "2025-12-31"), "2025");
  assert.equal(periodLabel("2024-01-01", "2025-12-31"), "2024–2025");
  assert.equal(periodLabel("2025-03-12", null), "fra 12. mar 2025");
  assert.equal(periodLabel(null, null), null);
});

test("a company page's computed sections come from the database, empty ones are left out", () => {
  const sections = computedSections("company", companyData);
  assert.deepEqual(
    sections.map((section) => section.key),
    ["our_history", "key_metrics", "funding", "timeline"],
  );
  const history = sections.find((section) => section.key === "our_history")!.body_md;
  assert.match(history, /^- 2025 · Kasseret 12\. mar 2025 · For tidligt, ingen traction/);
  assert.match(history, /Seneste note: "Stærkt team, svag GTM\."/);
  assert.match(history, /- 2026 · Åben \(screening\)/);
  assert.match(history, /- 2021 · Investeret \(før Interlect\)/);
  const metrics = sections.find((section) => section.key === "key_metrics")!.body_md;
  assert.equal(metrics, `- ARR: 2.100.000 kr. (2025, kundedokument) [f:${F1}]`);
  const funding = sections.find((section) => section.key === "funding")!.body_md;
  assert.equal(funding, `- Nordlys rejste en seed-runde på 5 mio. kr. i marts 2025. [f:${F2}]`);
});

test("the thesis and fund overview pages are computed from the fund's configuration and counts", () => {
  const thesis = computedSections("thesis", {
    config: {
      version: 3,
      thesis: "Klimateknologi i Norden.",
      sectors: ["energi"],
      stages: ["seed"],
      geographies: ["DK", "SE"],
    },
    decisions: [{ kind: "invest", total: 4, lastYear: 1 }],
    lessons: [{ shortId: "pb-00001", section: "red_flags", text: "Ingen betalende kunder." }],
  });
  assert.deepEqual(
    thesis.map((section) => section.key),
    ["stated", "in_practice", "lessons"],
  );
  assert.match(thesis[0]!.body_md, /Klimateknologi i Norden\.\n\n- Sektorer: energi/);
  assert.equal(thesis[1]!.body_md, "- Investeret: 4 i alt, 1 det seneste år");
  assert.equal(thesis[2]!.body_md, "**Røde flag**\n- pb-00001: Ingen betalende kunder.");
  const overview = computedSections("fund_overview", { stats: { facts: 1234, pages: 7 } });
  assert.equal(overview[0]!.body_md, "- Aktive fakta: 1.234\n- Sider: 7");
});

test("an invented reference removes its sentence, a known one stays (06 L4 validation)", () => {
  const known = new Set([F1]);
  const body = `Nordlys havde ARR på 2,1 mio. kr. i 2025 [f:${F1}]. Selskabet er markedsleder [f:${F3}]. Teamet er stærkt.\n- Ny kunde [f:${F3}]\n- Gammel kunde [f:${F1}]`;
  const result = rewriteRefs(body, (id) => (known.has(id) ? id : null));
  assert.equal(
    result.body,
    `Nordlys havde ARR på 2,1 mio. kr. i 2025 [f:${F1}]. Teamet er stærkt.\n- Gammel kunde [f:${F1}]`,
  );
  assert.equal(result.removed, 2);
  assert.deepEqual(citedIds(result.body), [F1]);
});

test("a reference after the full stop still removes its own sentence", () => {
  const result = rewriteRefs("Selskabet er markedsleder. [f:F9] Teamet er stærkt. [f:F1]", (id) =>
    id === "F1" ? id : null,
  );
  assert.equal(result.body, "Teamet er stærkt. [f:F1]");
  assert.equal(result.removed, 1);
});

test("facts get short references, and the writer's references map back to fact ids", () => {
  const { refOf, idOf } = factRefs([{ id: F1 }, { id: F2 }, { id: F1 }]);
  assert.equal(refOf.get(F1), "F1");
  assert.equal(refOf.get(F2), "F2");
  assert.equal(idOf.size, 2);
  const back = rewriteRefs("ARR steg [f:F2]. Opdigtet [f:F9].", (label) => idOf.get(label) ?? null);
  assert.equal(back.body, `ARR steg [f:${F2}].`);
  assert.equal(back.removed, 1);
});

test("the writer's operations are validated and capped at 8", () => {
  const ok = {
    op: "append_line",
    key: "team",
    heading: "",
    text: "CTO fra Vestas [f:F1]",
    factRefs: [],
  };
  const parsed = parsePageOps({
    ops: [
      {
        op: "upsert_section",
        key: "overview",
        heading: "Overblik",
        text: "Tekst [f:F1].",
        factRefs: [],
      },
      { op: "delete_page", key: "overview", heading: "", text: "", factRefs: [] },
      ...Array.from({ length: 9 }, () => ok),
    ],
  });
  assert.equal(parsed.ops.length, 8);
  assert.equal(parsed.invalid, 3);
  assert.deepEqual(parsePageOps("nope"), { ops: [], invalid: 1 });
});

test("operations change only writable, unlocked sections", () => {
  const sections = new Map<string, WrittenSection>([
    ["overview", { heading: "Overblik", body: "Gammel tekst [f:F1]. Forældet [f:F2]." }],
    ["team", { heading: "Team", body: "Låst af en bruger." }],
  ]);
  const { ops } = parsePageOps({
    ops: [
      { op: "mark_outdated", key: "overview", heading: "", text: "", factRefs: ["F2"] },
      { op: "append_line", key: "overview", heading: "", text: "Ny linje [f:F3].", factRefs: [] },
      {
        op: "upsert_section",
        key: "team",
        heading: "Team",
        text: "Overskrevet [f:F1].",
        factRefs: [],
      },
      {
        op: "upsert_section",
        key: "our_history",
        heading: "x",
        text: "Beregnet [f:F1].",
        factRefs: [],
      },
      {
        op: "upsert_section",
        key: "product_market",
        heading: "",
        text: "Batterier [f:F1].",
        factRefs: [],
      },
    ],
  });
  const result = applyPageOps(
    sections,
    ops,
    new Set(["overview", "team", "product_market"]),
    new Set(["team"]),
    (key) => (key === "product_market" ? "Produkt og marked" : key),
  );
  assert.equal(result.applied, 3);
  assert.equal(result.ignored, 2);
  assert.equal(result.sections.get("overview")!.body, "Gammel tekst [f:F1].\nNy linje [f:F3].");
  assert.equal(result.sections.get("team")!.body, "Låst af en bruger.");
  assert.deepEqual(result.sections.get("product_market"), {
    heading: "Produkt og marked",
    body: "Batterier [f:F1].",
  });
});

test("the stored page keeps the kind's order, a locked section as it was, and unchanged dates", () => {
  const old = "2026-10-01T02:15:00.000Z";
  const now = "2026-10-07T02:15:00.000Z";
  const current: PageSection[] = [
    {
      key: "team",
      heading: "Team (vores)",
      body_md: "Skrevet af en partner.",
      fact_ids: [],
      updated_at: old,
      locked_by_user: true,
    },
    {
      key: "key_metrics",
      heading: "Nøgletal",
      body_md: `- ARR: 2.100.000 kr. (2025, kundedokument) [f:${F1}]`,
      fact_ids: [F1],
      updated_at: old,
      locked_by_user: false,
      computed: true,
    },
  ];
  const page = assemblePage(
    "company",
    current,
    computedSections("company", companyData),
    new Map([
      ["overview", { heading: "Overblik", body: `Nordlys laver batteristyring [f:${F2}].` }],
      ["team", { heading: "Team", body: "Brain prøvede at skrive her." }],
      ["product_market", { heading: "Produkt og marked", body: "  " }],
    ]),
    now,
  );
  assert.deepEqual(
    page.map((section) => section.key),
    ["overview", "our_history", "key_metrics", "team", "funding", "timeline"],
  );
  assert.deepEqual(page[3], current[0]);
  assert.equal(page[2]!.updated_at, old);
  assert.equal(page[0]!.updated_at, now);
  assert.deepEqual(page[0]!.fact_ids, [F2]);
  assert.equal(page[1]!.computed, true);
  assert.equal(page[0]!.computed, undefined);
  assert.ok(!pageSearchText(page).includes("[f:"));
});

test("the writer's prompt lists the writable sections and the facts with references", () => {
  const prompt = pageWriterPrompt({
    kind: "company",
    title: "Nordlys ApS",
    writable: ["overview", "team"],
    sections: new Map([["overview", { heading: "Overblik", body: "Batterier [f:F1]." }]]),
    facts: [{ ...fact(F1, {}), ref: "F1", isNew: true }],
  });
  assert.match(prompt, /Skrivbare sektioner: overview \(Overblik\), team \(Team\)/);
  assert.match(prompt, /## overview · Overblik\nBatterier \[f:F1\]\./);
  assert.match(prompt, /## team · Team\n\(tom\)/);
  assert.match(
    prompt,
    /F1 \[NY\] Nordlys havde ARR på 2,1 mio\. kr\. i 2025\. \(2025, kundedokument\)/,
  );
});

test("T-709: a decision is marked for the writer, and has_case never reaches it", () => {
  const decided = fact("f2", {
    predicate: "decided",
    statement: "Investeret 2026-03-02 (Nordlys ApS).",
    validFrom: "2026-03-02",
    validTo: null,
    trust: "partner",
  });
  const hasCase = fact("f3", { predicate: "has_case", statement: "Nordlys ApS har en case." });
  const forWriter = writerFacts([fact(F1, {}), decided, hasCase]);
  assert.deepEqual(
    forWriter.map((item) => item.predicate),
    ["metric", "decided"],
  );
  const prompt = pageWriterPrompt({
    kind: "company",
    title: "Nordlys ApS",
    writable: ["overview"],
    sections: new Map(),
    facts: forWriter.map((item, index) => ({ ...item, ref: `F${index + 1}`, isNew: false })),
  });
  assert.match(prompt, /F2 BESLUTNING: Investeret 2026-03-02 \(Nordlys ApS\)\./);
  assert.doesNotMatch(prompt, /F1 BESLUTNING/);
  assert.doesNotMatch(prompt, /har en case/);
});

test("the writer's ways of writing a reference are made exact", () => {
  assert.equal(
    normalizeRefs("A [f: F3]. B [F4]. C [f:F3, F7]. D [f:F1,F2]."),
    "A [f:F3]. B [f:F4]. C [f:F3] [f:F7]. D [f:F1] [f:F2].",
  );
  assert.equal(normalizeRefs("[F1, F2]"), "[f:F1] [f:F2]");
});

test("in the writer's text a sentence without a reference goes, a heading line stays", () => {
  const result = rewriteRefs(
    "**Kunder:**\nSelskabet har 40 kunder. Kunderne er bl.a. Novo og Lego [f:F1].\n1. Opdigtet punkt [f:F9]\n- Stiftet i 2019 [f:F1]. 40 % af kunderne er offentlige [f:F9].",
    (ref) => (ref === "F1" ? ref : null),
    { requireRef: true },
  );
  assert.equal(
    result.body,
    "**Kunder:**\nKunderne er bl.a. Novo og Lego [f:F1].\n- Stiftet i 2019 [f:F1].",
  );
  assert.equal(result.removed, 3);
});

test("an abbreviation before a capital letter does not split a sentence", () => {
  const result = rewriteRefs(
    "ARR var 2,1 mio. EUR i 2025 [f:F3]. Teamet har ti ansatte [f:F1].",
    (ref) => (ref === "F1" ? ref : null),
  );
  assert.equal(result.body, "Teamet har ti ansatte [f:F1].");
});

test("the writer's sections back in fact ids: a rewrite the check would empty keeps the old text", () => {
  const before = new Map([
    ["overview", { heading: "Overblik", body: `Batterier til skibe [f:${F1}].` }],
    ["team", { heading: "Team", body: `To stiftere [f:${F2}].` }],
  ]);
  const after = new Map([
    ["overview", { heading: "Overblik", body: "Markedsleder i Norden. Uden kilde [f:F9]." }],
    ["team", { heading: "Team", body: "Tre stiftere [f: F2]. Gæt uden kilde." }],
  ]);
  const idOf = new Map([
    ["F1", F1],
    ["F2", F2],
  ]);
  const result = writerSectionsToIds(before, after, idOf);
  assert.equal(result.sections.get("overview")!.body, `Batterier til skibe [f:${F1}].`);
  assert.equal(result.sections.get("team")!.body, `Tre stiftere [f:${F2}].`);
  assert.equal(result.removed, 3);
});

test("over-long text is cut at a sentence, and outdated references may carry their brackets", () => {
  assert.equal(
    clipText("Første [f:F1]. Anden [f:F2]. Tredje.", 30),
    "Første [f:F1]. Anden [f:F2].",
  );
  const long = "Lang sætning [f:F1]. ".repeat(200);
  const parsed = parsePageOps({
    ops: [
      { op: "upsert_section", key: "overview", heading: "", text: long, factRefs: [] },
      {
        op: "mark_outdated",
        key: "overview",
        heading: "",
        text: "",
        factRefs: ["[f:F3]", "f:F4", "F5"],
      },
    ],
  });
  assert.equal(parsed.invalid, 0);
  const upsert = parsed.ops[0]!;
  assert.ok(
    upsert.op === "upsert_section" && upsert.text.length <= 2500 && upsert.text.endsWith("."),
  );
  const outdated = parsed.ops[1]!;
  assert.deepEqual(outdated.op === "mark_outdated" ? outdated.factRefs : null, ["F3", "F4", "F5"]);
});

test("an empty rewrite is ignored, and a repeated key keeps the locked copy", () => {
  const { ops } = parsePageOps({
    ops: [{ op: "upsert_section", key: "overview", heading: "Ny", text: "  ", factRefs: [] }],
  });
  const result = applyPageOps(
    new Map([["overview", { heading: "Overblik", body: "Tekst [f:F1]." }]]),
    ops,
    new Set(["overview"]),
    new Set(),
    () => "Overblik",
  );
  assert.equal(result.ignored, 1);
  assert.equal(result.sections.get("overview")!.body, "Tekst [f:F1].");
  const locked: PageSection = {
    key: "overview",
    heading: "Overblik",
    body_md: "Låst.",
    fact_ids: [],
    updated_at: "2026-10-01T00:00:00Z",
    locked_by_user: true,
  };
  const page = assemblePage(
    "company",
    [locked, { ...locked, body_md: "Kopi.", locked_by_user: false }],
    [],
    new Map([["overview", { heading: "Overblik", body: "Brain [f:F1]." }]]),
    "2026-10-07T00:00:00Z",
  );
  assert.deepEqual(page, [locked]);
});

test("the writer's input hash changes with the facts, not with the order of nothing", () => {
  const base = {
    model: "openai/gpt-5.4-mini",
    system: "v1",
    writable: ["overview"],
    facts: [{ id: F1, recordedAt: "2026-10-01", statement: "A." }],
  };
  assert.equal(writerInputHash(base), writerInputHash({ ...base }));
  assert.notEqual(
    writerInputHash(base),
    writerInputHash({
      ...base,
      facts: [...base.facts, { id: F2, recordedAt: "2026-10-02", statement: "B." }],
    }),
  );
  assert.notEqual(writerInputHash(base), writerInputHash({ ...base, writable: [] }));
});
