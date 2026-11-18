import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aboveThreshold,
  dotPosition,
  scoreDomain,
  firstSentence,
  gateCounts,
  plural,
  ticketLine,
  versionRow,
} from "./overview-summary.ts";

test("firstSentence takes the first sentence and shortens long ones", () => {
  assert.equal(firstSentence("Vi tror på klima. Og mere."), "Vi tror på klima.");
  assert.equal(firstSentence("  Ingen punktum her  "), "Ingen punktum her");
  assert.equal(firstSentence(""), "");
  const long = `${"ord ".repeat(80)}slut.`;
  const out = firstSentence(long, 100);
  assert.ok(out.length <= 100 && out.endsWith("…"));
});

test("ticketLine formats one or both bounds, null when none", () => {
  assert.equal(ticketLine(null, null), null);
  assert.equal(ticketLine(500_000, 2_000_000), "€500 t. – €2 mio.");
  assert.equal(ticketLine(1_500_000, null), "Fra €1,5 mio.");
  assert.equal(ticketLine(null, 250_000), "Op til €250 t.");
});

test("aboveThreshold counts in code and handles no threshold", () => {
  assert.deepEqual(aboveThreshold([58, 72, 90, 71], 72), { above: 2, total: 4 });
  assert.deepEqual(aboveThreshold([], 72), { above: 0, total: 0 });
  assert.deepEqual(aboveThreshold([80], null), { above: 0, total: 1 });
});

test("scoreDomain frames scores and threshold, at least 40 wide", () => {
  assert.deepEqual(scoreDomain([], null), { lo: 0, hi: 100 });
  assert.deepEqual(scoreDomain([58, 64, 81], 72), { lo: 50, hi: 90 });
  const narrow = scoreDomain([70, 72], 71);
  assert.ok(narrow.hi - narrow.lo >= 40 && narrow.lo <= 70 && narrow.hi >= 72);
  const top = scoreDomain([96, 99], 98);
  assert.ok(top.hi === 100 && top.hi - top.lo >= 40);
});

test("dotPosition stays on the line", () => {
  const domain = { lo: 50, hi: 90 };
  assert.equal(dotPosition(30, domain), 0);
  assert.equal(dotPosition(70, domain), 50);
  assert.equal(dotPosition(120, domain), 100);
});

test("gateCounts and plural", () => {
  assert.deepEqual(
    gateCounts([{ treatment: "hard" }, { treatment: "review" }, { treatment: "hard" }]),
    {
      hard: 2,
      review: 1,
    },
  );
  assert.equal(plural(1, "kriterie", "kriterier"), "1 kriterie");
  assert.equal(plural(0, "kriterie", "kriterier"), "0 kriterier");
});

test("versionRow names the status and falls back without source", () => {
  const format = (iso: string) => iso.slice(0, 10);
  assert.deepEqual(
    versionRow(
      {
        version: 2,
        status: "draft",
        sourceBasis: "",
        activatedAt: null,
        createdAt: "2026-09-27T10:00:00Z",
      },
      format,
    ),
    { label: "v2", title: "Kladde under arbejde", meta: "Uden kildebeskrivelse · 2026-09-27" },
  );
  assert.equal(
    versionRow(
      {
        version: 1,
        status: "superseded",
        sourceBasis: "Skabelon",
        activatedAt: "2026-09-01T00:00:00Z",
        createdAt: "2026-08-30T00:00:00Z",
      },
      format,
    ).title,
    "Tidligere version",
  );
  // The editor's own drafts carry a machine value; it is shown in words, never raw.
  assert.equal(
    versionRow(
      {
        version: 7,
        status: "active",
        sourceBasis: "administrator_configuration",
        activatedAt: "2026-10-07T00:00:00Z",
        createdAt: "2026-10-07T00:00:00Z",
      },
      format,
    ).meta,
    "Ændret i opsætningen · 2026-10-07",
  );
});

test("versionRow shows the Danish template note in English for an English team (T-688)", () => {
  const input = {
    version: 1,
    status: "active",
    sourceBasis:
      "Venture-skabelon oprettet i Interlect.ai. Kræver menneskelig gennemgang og publicering.",
    activatedAt: "2026-10-07T00:00:00Z",
    createdAt: "2026-10-07T00:00:00Z",
  };
  const format = (iso: string) => iso.slice(0, 10);
  assert.equal(
    versionRow(input, format, "en").meta,
    "Venture template created in Interlect.ai. Requires human review and publishing. · 2026-10-07",
  );
  assert.equal(versionRow(input, format).meta.startsWith("Venture-skabelon"), true);
  assert.equal(
    versionRow({ ...input, sourceBasis: "Vores egen note" }, format, "en").meta,
    "Vores egen note · 2026-10-07",
  );
});
