import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("a failed helper call books its known price, not 0 (T-749 b)", () => {
  const gateway = readFileSync(new URL("./cheap-gateway.server.ts", import.meta.url), "utf8");
  // Every failure after the provider answered carries the price it reported.
  assert.match(gateway, /new HelperRejected\(serverText\("fundServer\.gateway\.cutOff"\), cost\)/);
  assert.match(
    gateway,
    /new HelperRejected\(serverText\("fundServer\.gateway\.overBudget"\), cost\)/,
  );
  assert.match(
    gateway,
    /new HelperCallFailed\(serverText\("fundServer\.common\.aiNoAnswer"\), cost\)/,
  );
  const assist = readFileSync(new URL("./assist-calls.server.ts", import.meta.url), "utf8");
  assert.match(assist, /await settle\(false, knownHelperCost\(cause\)\)/);
  assert.doesNotMatch(assist, /settle\(false, null\)/);
});
