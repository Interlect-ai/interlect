import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseMover } from "./orb-turn.ts";

test("only one orb moves: the biggest, then the first shown (T-651)", () => {
  assert.equal(chooseMover([]), null);
  assert.equal(
    chooseMover([
      ["step-1", { size: 20, order: 0 }],
      ["page", { size: 64, order: 1 }],
      ["step-2", { size: 20, order: 2 }],
    ]),
    "page",
  );
  assert.equal(
    chooseMover([
      ["row-2", { size: 20, order: 5 }],
      ["row-1", { size: 20, order: 3 }],
    ]),
    "row-1",
  );
  // The answer's 32 px orb wins over the send button's 20 px.
  assert.equal(
    chooseMover([
      ["send", { size: 20, order: 0 }],
      ["answer", { size: 32, order: 1 }],
    ]),
    "answer",
  );
});
