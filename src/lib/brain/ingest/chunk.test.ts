import assert from "node:assert/strict";
import { test } from "node:test";
import { CHUNK_MAX_TOKENS, CHUNK_TARGET_TOKENS, chunkBlocks, countTokens } from "./chunk.ts";
import type { Block } from "./extract.ts";

const sentence = (index: number) =>
  `Sætning ${index} beskriver selskabets vækst, kundetal og de vigtigste risici i kvartalet.`;
const paragraph = (start: number, count: number) =>
  Array.from({ length: count }, (_, index) => sentence(start + index)).join(" ");

test("no blocks give no chunks, and the same blocks always give the same chunks", () => {
  assert.deepEqual(chunkBlocks([]), []);
  const blocks: Block[] = [
    { kind: "heading", text: "Marked", level: 1 },
    { kind: "paragraph", text: paragraph(1, 120), page: 1 },
  ];
  assert.deepEqual(chunkBlocks(blocks), chunkBlocks(blocks));
});

test("a long section is cut at about 700 tokens and the next chunk starts with the end of the last", () => {
  const blocks: Block[] = [
    { kind: "heading", text: "Marked og konkurrence", level: 1 },
    ...Array.from({ length: 6 }, (_, index): Block => ({
      kind: "paragraph",
      text: paragraph(index * 12, 12),
      page: index + 1,
    })),
  ];
  const chunks = chunkBlocks(blocks);
  assert.ok(chunks.length >= 3, `chunks ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.tokenCount <= CHUNK_MAX_TOKENS + 120, `tokens ${chunk.tokenCount}`);
    assert.equal(chunk.heading, "Marked og konkurrence");
    assert.ok(chunk.content.startsWith("Marked og konkurrence\n\n"));
    assert.ok(chunk.content.length <= 8000);
  }
  chunks.slice(0, -1).forEach((chunk, index) => {
    const next = chunks[index + 1]!;
    const tail = chunk.content.split(/\s+/).slice(-6).join(" ");
    assert.ok(next.content.includes(tail), "the next chunk repeats the end of the previous one");
  });
  assert.deepEqual(
    chunks.map((chunk) => chunk.ordinal),
    chunks.map((_, index) => index),
  );
  assert.equal(chunks[0]?.pageFrom, 1);
  assert.ok((chunks.at(-1)?.pageTo ?? 0) >= 5);
});

test("a heading starts a new chunk (no overlap across sections) once the one before has some body", () => {
  const blocks: Block[] = [
    { kind: "heading", text: "Team", level: 1 },
    { kind: "paragraph", text: paragraph(1, 14) },
    { kind: "heading", text: "Økonomi", level: 1 },
    { kind: "paragraph", text: paragraph(100, 14) },
  ];
  const chunks = chunkBlocks(blocks);
  assert.deepEqual(
    chunks.map((chunk) => chunk.heading),
    ["Team", "Økonomi"],
  );
  assert.ok(!chunks[1]!.content.includes("Sætning 1 "));
});

test("a heading right after a very short section is merged instead of leaving a stub chunk", () => {
  const chunks = chunkBlocks([
    { kind: "heading", text: "Indledning", level: 1 },
    { kind: "paragraph", text: "Kort." },
    { kind: "heading", text: "Marked", level: 1 },
    { kind: "paragraph", text: paragraph(1, 14) },
  ]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.heading, "Marked");
});

test("a table is kept whole; a table over the limit is cut between rows with its header repeated", () => {
  const small = "Måned | Omsætning\nApril | 1,2 mio.\nMaj | 1,4 mio.";
  const keep = chunkBlocks([
    { kind: "paragraph", text: paragraph(1, 30) },
    { kind: "table", text: small },
  ]);
  assert.ok(
    keep.some((chunk) => chunk.content.includes(small)),
    "the small table is in one chunk",
  );

  const rows = Array.from(
    { length: 400 },
    (_, index) => `Kunde ${index} | ${index * 1000} kr. | Region ${index % 7}`,
  );
  const big = ["Kunde | Beløb | Region", ...rows].join("\n");
  const chunks = chunkBlocks([{ kind: "table", text: big }]);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.content.startsWith("Kunde | Beløb | Region"), "the header row is repeated");
    assert.ok(chunk.tokenCount <= CHUNK_MAX_TOKENS + 40);
  }
  const seen = new Set(
    chunks
      .flatMap((chunk) => chunk.content.split("\n"))
      .filter((line) => line.startsWith("Kunde ") && line !== "Kunde | Beløb | Region"),
  );
  assert.equal(seen.size, 400, "every row is in some chunk");
});

test("spreadsheet rows are one chunk each, headed by the sheet name, with no overlap", () => {
  const blocks: Block[] = [
    {
      kind: "row",
      text: "Ark: Beslutninger · Selskab: Pleo · Beslutning: Investeret",
      sheet: "Beslutninger",
    },
    {
      kind: "row",
      text: "Ark: Beslutninger · Selskab: Zeta · Beslutning: Kasseret",
      sheet: "Beslutninger",
    },
  ];
  const chunks = chunkBlocks(blocks);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.heading === "Beslutninger"));
  assert.ok(chunks[1]!.content.includes("Zeta") && !chunks[1]!.content.includes("Pleo"));
});

test("a single paragraph with no sentence breaks is still cut and never exceeds the limit", () => {
  const text = Array.from({ length: 3000 }, (_, index) => `ord${index}`).join(" ");
  const chunks = chunkBlocks([{ kind: "paragraph", text }]);
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((chunk) => chunk.tokenCount <= CHUNK_TARGET_TOKENS + 140));
});

test("a spreadsheet cell with a huge text cannot make a chunk the database would refuse", () => {
  const chunks = chunkBlocks([{ kind: "row", text: "x ".repeat(20_000), sheet: "A" }]);
  assert.ok(chunks[0]!.content.length <= 8000);
  assert.ok(countTokens(chunks[0]!.content) > 0);
});
