import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeRefusalText } from "./merge.ts";

test("every refusal of the database functions has a Danish text, and nothing else is shown", () => {
  for (const message of [
    "brain_merge_entities: an entity cannot be merged into itself",
    "brain_merge_entities: the entities have different types",
    "brain_merge_entities: both entities must be active",
    "brain_merge_entities: an entity projected from the database cannot be merged away",
    "brain_merge_entities: a fact links the two entities, so they cannot be merged",
    "brain_merge_entities: unknown entity",
    "brain_split_entities: the entity is not merged",
    "brain_split_entities: there is no merge in the log to undo",
    "brain_split_entities: the log of the merge has been masked and cannot be undone",
    "brain_split_entities: the entity is merged into another one than the log says",
    "brain_split_entities: the winner is itself merged or gone; undo that first",
  ]) {
    const text = mergeRefusalText(message);
    assert.ok(text && /[æøåA-Z]/.test(text), message);
  }
  assert.equal(mergeRefusalText("deadlock detected"), null);
});
