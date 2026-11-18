/**
 * Brain's prompts may not know the exam: a prompt that names a demo company, a
 * demo person or a figure from the demo story would pass the exam without being better. Fails CI
 * when one does. Covers every prompt Brain sends: src/lib/brain/prompts/ and the chat prompt.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { DEMO_CASE_COUNT, demoBaseName, STORY_CASES } from "./demo-story.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const PROMPT_DIR = join(ROOT, "src/lib/brain/prompts");

function promptFiles(): string[] {
  return [
    ...readdirSync(PROMPT_DIR)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => join(PROMPT_DIR, name)),
    join(ROOT, "src/lib/brain/chat/prompt.ts"),
    join(ROOT, "src/lib/brain/eval/judge.ts"),
  ];
}

/** Company names, people and the story's distinctive figures. */
function demoMarkers(): RegExp[] {
  const words = new Set<string>(["Kildevæld"]);
  for (let index = 0; index < DEMO_CASE_COUNT; index += 1) words.add(demoBaseName(index));
  for (const story of STORY_CASES) {
    for (const person of story.people ?? []) words.add(person.name);
  }
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...[...words].map((word) => new RegExp(`\\b${escape(word)}\\b`, "i")),
    /\bdemo\s+\d{1,2}\b/i,
    // Figures the story's answers turn on.
    /\b2,4 mio/,
    /\b55 %/,
    /\b62 %/,
    /\b97 %/,
    /\b3,1 mio/,
    /\b210\.000\b/,
    /\b1\.200 solgte\b/,
  ];
}

test("no Brain prompt contains a demo name, person or story figure", () => {
  const markers = demoMarkers();
  const hits: string[] = [];
  for (const file of promptFiles()) {
    const text = readFileSync(file, "utf8");
    for (const marker of markers) {
      const match = marker.exec(text);
      if (match) hits.push(`${file.slice(ROOT.length + 1)}: "${match[0]}"`);
    }
  }
  assert.deepEqual(hits, []);
});

test("the marker list covers the demo world", () => {
  const markers = demoMarkers();
  assert.ok(markers.some((m) => m.test("Asger Holm-Frandsen")));
  assert.ok(markers.some((m) => m.test("Solsort Pay")));
  assert.ok(markers.some((m) => m.test("demo 07")));
  assert.ok(!markers.some((m) => m.test("Svar kort og med kilder.")));
});
