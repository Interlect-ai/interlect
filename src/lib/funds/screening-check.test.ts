/** Kvalitetstjekket af fondens screening. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  codeScreeningIssues,
  mergeScreeningIssues,
  parseScreeningAiCheck,
  SCREENING_CHECK_JSON_SCHEMA,
  type ScreeningSetupForCheck,
} from "./screening-check.ts";

const setup: ScreeningSetupForCheck = {
  thesis: "Nordisk B2B-software i seed.",
  riskPosture: "Moderat.",
  stages: ["seed"],
  geographies: ["Danmark", "Sverige"],
  sectors: ["B2B-software"],
  ticket: { minEur: 500_000, maxEur: 2_000_000 },
  dealbreakers: [],
  criteria: [
    {
      key: "team",
      label: "Team",
      description: "Founders med dokumenteret erfaring fra markedet og evne til at rekruttere.",
      category: "founder_market_fit",
      weight: 50,
    },
    {
      key: "traction",
      label: "Traction",
      description: "Betalende kunder, vækst i omsætning og lav churn over de seneste måneder.",
      category: "traction_gtm",
      weight: 50,
    },
  ],
  gates: [
    {
      key: "geo",
      label: "Norden",
      description: "Har selskabet hovedsæde i Norden?",
      treatment: "hard",
    },
  ],
  instruction: "Vi vægter betalingsvillighed over brugervækst.",
  cards: ["finance"],
  research: [{ moduleId: "screening_market", questions: ["Who are the competitors?"] }],
};

test("en god opsætning giver ingen fund fra koden", () => {
  assert.deepEqual(codeScreeningIssues(setup, []), []);
});

test("koden finder grænser, dubletter, tynde tekster og overlap", () => {
  const issues = codeScreeningIssues(
    {
      ...setup,
      criteria: [
        ...setup.criteria,
        {
          key: "team_2",
          label: "team",
          description: "Godt team.",
          category: "team_market_fit",
          weight: 10,
        },
        {
          key: "traction_2",
          label: "Kunder",
          description: "Betalende kunder, vækst i omsætning og lav churn de seneste måneder.",
          category: "traction_gtm",
          weight: 10,
        },
      ],
      gates: [
        ...setup.gates,
        { key: "geo_2", label: "Norden", description: "Nordisk.", treatment: "review" },
      ],
      instruction: "Traction skal vægte 60 %.",
      research: [
        {
          moduleId: "screening_market",
          questions: ["Who are the competitors?", "who are the competitors"],
        },
      ],
    },
    [
      { code: "weight_sum", message: "Vægtene summer til 120 %, ikke 100 %." },
      { code: "duplicate_gate", message: "Mandatreglen geo findes to gange." },
    ],
  );
  const found = issues.map((issue) => `${issue.area}:${issue.target ?? "-"}:${issue.kind}`);
  assert.deepEqual(found, [
    "criteria:-:limit",
    "gates:-:duplicate",
    "criteria:team_2:duplicate",
    "criteria:team_2:vague",
    "criteria:traction_2:overlap",
    "gates:geo_2:duplicate",
    "gates:geo_2:vague",
    "instruction:-:conflict",
    "research:screening_market:duplicate",
  ]);
  assert.ok(issues.every((issue) => issue.source === "code"));
});

test("en tom instruktion er en note, ikke en fejl", () => {
  const issues = codeScreeningIssues({ ...setup, instruction: "  " }, []);
  assert.deepEqual(
    issues.map((issue) => [issue.area, issue.kind, issue.severity]),
    [["instruction", "missing", "note"]],
  );
});

test("modellens svar læses punkt for punkt, og ukendte mål bliver hele området", () => {
  const ai = parseScreeningAiCheck(
    JSON.stringify({
      verdict: "needs_work",
      issues: [
        {
          area: "instruction",
          target: null,
          kind: "conflict",
          message: "Trækker mod vægtene.",
          suggestion: "",
        },
        {
          area: "criteria",
          target: "findes_ikke",
          kind: "vague",
          message: "Løs.",
          suggestion: null,
        },
        {
          area: "criteria",
          target: "team",
          kind: "vague",
          message: "Løs.",
          suggestion: "Skarpere.",
        },
        {
          area: "nope",
          target: null,
          kind: "vague",
          message: "Ugyldigt område.",
          suggestion: null,
        },
      ],
    }),
  );
  assert.ok(ai);
  assert.equal(ai.issues.length, 3);
  assert.equal(ai.issues[0]?.suggestion, null);
  const merged = mergeScreeningIssues(setup, [], ai);
  assert.deepEqual(
    merged.map((issue) => [issue.area, issue.target, issue.severity, issue.source]),
    [
      ["instruction", null, "fix", "ai"],
      ["criteria", null, "fix", "ai"],
      ["criteria", "team", "fix", "ai"],
    ],
  );
  assert.equal(parseScreeningAiCheck("ikke json"), null);
  assert.equal(parseScreeningAiCheck(JSON.stringify({ verdict: "måske", issues: [] })), null);
});

test("et fund, koden allerede har, gentages ikke; en klar opsætning giver noter", () => {
  const code = codeScreeningIssues({ ...setup, instruction: "Traction skal vægte 60 %." }, []);
  const merged = mergeScreeningIssues(setup, code, {
    verdict: "ready",
    issues: [
      { area: "instruction", target: null, kind: "conflict", message: "Igen.", suggestion: null },
      { area: "risk", target: null, kind: "vague", message: "Løs risikoprofil.", suggestion: null },
    ],
  });
  assert.deepEqual(
    merged.map((issue) => [issue.area, issue.kind, issue.severity, issue.source]),
    [
      ["instruction", "conflict", "note", "code"],
      ["risk", "vague", "note", "ai"],
    ],
  );
});

test("the strict schema lists every field as required", () => {
  const item = SCREENING_CHECK_JSON_SCHEMA.properties.issues.items;
  assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
});
