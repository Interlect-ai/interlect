/** Test af kladden i sessionStorage på Opret case. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStoredDraft, serializeDraft } from "./intake-draft.ts";

test("en kladde overlever en rundtur", () => {
  const draft = {
    query: "Havbrug Nord",
    website: "havbrugnord.dk",
    notes: "Intro fra Maja",
    fundIds: ["a", "b"],
  };
  assert.deepEqual(parseStoredDraft(serializeDraft(draft)), draft);
});

test("tom, ødelagt og fremmed data giver ingen kladde (aldrig en fejl)", () => {
  assert.equal(parseStoredDraft(null), null);
  assert.equal(parseStoredDraft("{ikke json"), null);
  assert.equal(
    parseStoredDraft(JSON.stringify({ query: "", website: "", notes: "", fundIds: ["a"] })),
    null,
  );
  assert.deepEqual(parseStoredDraft(JSON.stringify({ query: 5, website: "x.dk", fundIds: "a" })), {
    query: "",
    website: "x.dk",
    notes: "",
    fundIds: [],
  });
});

test("lange felter beskæres", () => {
  const stored = parseStoredDraft(
    serializeDraft({ query: "x".repeat(500), website: "", notes: "", fundIds: [] }),
  );
  assert.equal(stored?.query.length, 200);
});
