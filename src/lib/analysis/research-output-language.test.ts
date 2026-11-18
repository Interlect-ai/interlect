import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The research's statements and gaps are shown to the team and become its evidence, so
 * they follow the team's language. Before, the prompt always said "concise Danish", and an English
 * team got Danish research findings and gaps.
 */
test("the research writes its statements and gaps in the team's language", () => {
  const source = readFileSync(new URL("./public-research.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Write statements and gaps in concise Danish/);
  assert.match(
    source,
    /Write statements and gaps in concise \$\{englishPromptLanguageName\(input\.language \?\? DEFAULT_LANGUAGE\)\}/,
  );
  // The paid call passes the run's language (the worker runs in the team's language).
  assert.match(
    source,
    /buildResearchMessages\(\s*\{ \.\.\.input, language: requestLanguage\(\) \}/,
  );
  const method = readFileSync(new URL("./method-detail.functions.ts", import.meta.url), "utf8");
  assert.match(method, /language: profile\.language \?\? DEFAULT_LANGUAGE/);
});
