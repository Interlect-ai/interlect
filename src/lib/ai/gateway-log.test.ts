import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gatewayErrorSummary } from "./gateway-log.ts";

test("a gateway error is logged as its kind and size, never its text (T-742)", () => {
  const summary = gatewayErrorSummary({
    code: "invalid_request",
    type: "bad_request",
    message: "Invalid input: Søren Hansen from Acme ApS said ...",
  });
  assert.deepEqual(summary, { code: "invalid_request", type: "bad_request", messageLength: 50 });
  assert.equal(JSON.stringify(summary).includes("Søren"), false);
  assert.deepEqual(gatewayErrorSummary(undefined), { code: null, type: null, messageLength: 0 });
  assert.deepEqual(gatewayErrorSummary("raw text"), { code: null, type: null, messageLength: 8 });
});

test("no server log carries a model answer or a whole gateway error (T-742)", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const sources = {
    deep: read("../analysis/deep.functions.ts"),
    worker: read("../analysis/deep-worker.server.ts"),
    screening: read("../analysis/screening.functions.ts"),
    cheap: read("../funds/cheap-gateway.server.ts"),
    criterion: read("../funds/criterion-assist.functions.ts"),
    documentImport: read("../funds/document-import.functions.ts"),
    researchModule: read("../funds/research-module-override.functions.ts"),
    modulePrompt: read("../funds/module-prompt-override.functions.ts"),
  };
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /console\.\w+\("\[ai-gateway\]", body\.error\)/, name);
    assert.doesNotMatch(source, /error: gatewayError,/, name);
    assert.doesNotMatch(source, /text start: \$\{completion\.content/, name);
    assert.doesNotMatch(source, /output=\$\{rejectedJson/, name);
  }
});
