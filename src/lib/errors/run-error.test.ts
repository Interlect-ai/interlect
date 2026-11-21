import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { translate } from "../i18n/translate.ts";
import { publicRunError } from "./run-error.ts";

const quiet = <T>(run: () => T): T => {
  const original = console.error;
  console.error = () => {};
  try {
    return run();
  } finally {
    console.error = original;
  }
};

test("T-1070: no stored error means no sentence", () => {
  assert.equal(publicRunError(null, "da"), null);
  assert.equal(publicRunError("", "en"), null);
});

test("T-1070: the provider's or the database's text never reaches the person", () => {
  for (const language of ["da", "en"] as const) {
    const generic = translate(language, "caseView.route.errGeneric");
    for (const stored of [
      "AI_APICallError: openai/gpt-5.4 returned 500",
      "Den dybe analyse fejlede: perplexity/sonar-pro svarede ikke.",
      "Syntesen kunne ikke gennemføres: claude-opus svarede med en fejl.",
      'duplicate key value violates unique constraint "analysis_runs_pkey"',
      "Teamets månedsforbrug kunne ikke læses: PostgREST timeout",
    ]) {
      const shown = quiet(() => publicRunError(stored, language));
      assert.equal(shown, generic, stored);
    }
  }
});

test("T-1070: the known classes keep their own calm sentence in both languages", () => {
  for (const language of ["da", "en"] as const) {
    assert.equal(
      publicRunError("GatewayRateLimitError: Free tier exhausted", language),
      translate(language, "caseView.route.errCredits"),
    );
    assert.equal(
      publicRunError("Invalid API key for vercel gateway", language),
      translate(language, "caseView.route.errApiKey"),
    );
    assert.equal(
      publicRunError("Kun 2 af 6 researchspor lykkedes.", language),
      translate(language, "caseView.route.errResearch"),
    );
    assert.equal(
      publicRunError("Only 2 of 6 research tracks succeeded.", language),
      translate(language, "caseView.route.errResearch"),
    );
  }
});

test("T-1070: the server's own sentences pass as they are", () => {
  const own = "Denne screening er allerede sendt til dyb analyse.";
  assert.equal(publicRunError(own, "da"), own);
  assert.equal(
    publicRunError(translate("en", "appServer.credits.exhausted"), "en"),
    translate("en", "appServer.credits.exhausted"),
  );
});

test("T-1070: the case payload maps every stored run and step error before it leaves", () => {
  const source = readFileSync(new URL("../cases/cases.functions.ts", import.meta.url), "utf8");
  const raw = source.match(/errorMessage:\s*\(\w+\["error_message"\]/g) ?? [];
  assert.equal(raw.length, 0, "a raw error_message is sent to the client");
  const mapped = source.match(/errorMessage: publicRunError\(/g) ?? [];
  assert.equal(mapped.length, 2);
});

test("T-1070: a rate-limited research run keeps its calm 'try again shortly' line", () => {
  for (const language of ["da", "en"] as const) {
    for (const stored of ["da", "en"] as const) {
      assert.equal(
        publicRunError(translate(stored, "analysisServer.research.serviceLimited"), language),
        translate(language, "caseView.route.errCredits"),
      );
    }
  }
});

test("T-1070: mapping twice gives the same sentence, also in English", () => {
  for (const language of ["da", "en"] as const) {
    for (const stored of [
      "GatewayRateLimitError: Free tier",
      "Invalid API key",
      "Only 2 of 6 research tracks succeeded.",
      "openai/gpt-5 failed",
    ]) {
      const once = quiet(() => publicRunError(stored, language));
      assert.equal(
        quiet(() => publicRunError(once, language)),
        once,
        stored,
      );
    }
  }
});

test("T-1070: the case page reads error_message only through the server's own client", () => {
  const source = readFileSync(new URL("../cases/cases.functions.ts", import.meta.url), "utf8");
  const columns = source.match(/const CASE_RUN_COLUMNS =\s*"([^"]*)"/)?.[1] ?? "";
  assert.ok(columns.length > 0);
  assert.doesNotMatch(columns, /error_message/);
  // Every select that names error_message is on a getServiceClient() chain.
  for (const match of source.matchAll(/\.select\("[^"]*error_message[^"]*"\)/g)) {
    const before = source.slice(Math.max(0, match.index - 200), match.index);
    assert.match(before, /getServiceClient\(\)\s*\.from\("analysis_run(_step)?s"\)\s*$/, match[0]);
  }
});
