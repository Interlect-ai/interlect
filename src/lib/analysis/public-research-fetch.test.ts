import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The screening's official documents and related homepages are fetched through
 * `pinnedFetch` (one DNS answer, the connection pinned to the checked address, every redirect
 * checked), never with a plain `fetch` that asks DNS again after the check.
 */
test("public research reads web pages only through pinnedFetch", () => {
  const source = readFileSync(new URL("./public-research.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(^|[^\w.])fetch\(/m);
  const body = source.split("async function fetchOfficialDocumentText(")[1]!.split("\n}\n")[0]!;
  assert.match(body, /pinnedFetch\(rawUrl,/);
  assert.match(body, /allowHost: \(\) => true/);
});
