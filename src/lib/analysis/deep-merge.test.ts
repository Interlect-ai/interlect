import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeSpecialistRationales } from "./deep-merge.ts";
import {
  CRITERION_RATIONALE,
  SYNTHESIS_CRITERION_RATIONALE,
  SYNTHESIS_FINDINGS,
} from "./deep-text-rules.ts";

const long = "Lang begrundelse. ".repeat(60);

test("the specialist's long text leads; the synthesis's own short text stays visible (#6)", () => {
  const merged = mergeSpecialistRationales(
    [
      {
        criterionKey: "team",
        rationale: "Syntesen er uenig i scoren.",
        verdict: "V",
        proposedScore: 70,
      },
      { criterionKey: "tech", rationale: "Kort teknik.", verdict: "T", proposedScore: 60 },
    ],
    [{ assessments: [{ criterionKey: "team", rationale: long }] }],
  );
  assert.equal(merged[0]?.rationale, `${long.trim()}\n\nSyntesen: Syntesen er uenig i scoren.`);
  assert.equal(merged[0]?.verdict, "V");
  assert.equal(merged[0]?.proposedScore, 70);
  // No specialist text for this criterion: the synthesis text stays alone.
  assert.equal(merged[1]?.rationale, "Kort teknik.");
});

test("the specialist text is used whenever it is long enough, even if the synthesis text is longer", () => {
  const synthesis = "Syntese. ".repeat(200);
  const merged = mergeSpecialistRationales(
    [{ criterionKey: "team", rationale: synthesis }],
    [{ assessments: [{ criterionKey: "team", rationale: long }] }],
  );
  assert.ok(merged[0]!.rationale.startsWith(long.trim()));
  assert.ok(merged[0]!.rationale.includes("Syntesen: "));
  // A specialist text below the floor is not used; a repeated text is not appended twice.
  const short = mergeSpecialistRationales(
    [{ criterionKey: "team", rationale: "Syntese." }],
    [{ assessments: [{ criterionKey: "team", rationale: "For kort." }] }],
  );
  assert.equal(short[0]?.rationale, "Syntese.");
  const same = mergeSpecialistRationales(
    [{ criterionKey: "team", rationale: long.trim() }],
    [{ assessments: [{ criterionKey: "team", rationale: long }] }],
  );
  assert.equal(same[0]?.rationale, long.trim());
});

test("the synthesis text limits are far below the specialists' (the long text is not repeated)", () => {
  assert.ok(SYNTHESIS_CRITERION_RATIONALE.schemaMax < CRITERION_RATIONALE.schemaMin * 3);
  assert.ok(SYNTHESIS_CRITERION_RATIONALE.schemaMax <= 900);
  assert.ok(SYNTHESIS_FINDINGS.maxItems <= 27);
});

test("research and specialist reuse keys stay on one version, the synthesis has its own", () => {
  const source = readFileSync(new URL("./specialist-prompts.ts", import.meta.url), "utf8");
  // Do not change these two without accepting that a failed run's paid research and specialists
  // can no longer be reused by the retry (loadReusableSpecialists keys on them).
  assert.match(
    source,
    /DEEP_PROMPT_VERSION =\s*"interlect-deep-specialists-2026-10-16-v16-highlights"/,
  );
  assert.match(source, /DEEP_WORKFLOW_VERSION = "interlect-deep-dd-workflow-v11-evidence-sheet"/);
  assert.match(source, /DEEP_SYNTHESIS_PROMPT_VERSION =\s*"[^"]*v13-short-tasks[^"]*"/);
  const deep = readFileSync(new URL("./deep.functions.ts", import.meta.url), "utf8");
  // Reuse of specialists compares the step's version with the specialist version only.
  assert.match(deep, /step\["prompt_version"\] !== DEEP_PROMPT_VERSION/);
  assert.match(deep, /prompt_version: DEEP_SYNTHESIS_PROMPT_VERSION/);
});
