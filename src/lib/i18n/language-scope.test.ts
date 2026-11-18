/** A worker's texts follow its fund's language. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLanguage } from "./language-scope.server.ts";
import { serverText } from "./server-text.ts";

test("outside a request and a scope the server writes Danish, as before", () => {
  assert.equal(serverText("caseServer.common.caseNotFound"), "Casen blev ikke fundet.");
});

test("inside a worker's scope it writes the fund's language, also after an await", async () => {
  const texts = await withLanguage("en", async () => {
    const first = serverText("analysisServer.deep.alreadySent");
    await new Promise((resolve) => setTimeout(resolve, 5));
    return [first, serverText("analysisServer.screening.summary", { name: "A", version: 3 })];
  });
  assert.deepEqual(texts, [
    "This screening has already been sent to deep analysis.",
    "Screening as A with profile version 3.",
  ]);
  // Two funds' workers in parallel keep their own language.
  const [da, en] = await Promise.all([
    withLanguage("da", async () => serverText("caseServer.common.caseNotFound")),
    withLanguage("en", async () => serverText("caseServer.common.caseNotFound")),
  ]);
  assert.deepEqual([da, en], ["Casen blev ikke fundet.", "The case was not found."]);
});
