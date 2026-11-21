import assert from "node:assert/strict";
import { test } from "node:test";
import { thesesPreamble, thesisText } from "./store.server.ts";

test("T-1047: Brain gets the default thesis and the other theses' names, nothing more", () => {
  const line = thesesPreamble("Nordisk seed", [{ name: "Klima growth" }, { name: "Biotek" }]);
  assert.match(line, /^Standardtese: Nordisk seed\./);
  assert.match(line, /Klima growth, Biotek/);
});

test("T-1094: a setup per stage is told per stage, the shared rows first", () => {
  const text = thesisText(
    {
      version: 3,
      fund_mandates: {
        thesis: "Klima",
        stages: ["seed", "series_a"],
        geographies: null,
        sectors: null,
        ticket_min_eur: null,
        ticket_max_eur: null,
        risk_posture: null,
        dealbreakers: [],
        setup: { about: "Vi er tekniske investorer." },
      },
      mandate_gates: [
        {
          stage: "seed",
          label: "Prototype",
          description: null,
          treatment: "review",
          sort_order: 3,
        },
        { stage: null, label: "Norden", description: null, treatment: "hard", sort_order: 1 },
      ],
      assessment_criteria: [
        { stage: "series_a", label: "Traktion", description: null, weight: 100, sort_order: 2 },
        { stage: "seed", label: "Team", description: null, weight: 100, sort_order: 1 },
      ],
    },
    true,
  );
  assert.match(text, /Hvem teamet er, og hvordan det tænker: Vi er tekniske investorer\./);
  assert.ok(
    text.indexOf("Mandatkrav:\n- Norden (bindende)") <
      text.indexOf("Mandatkrav for Seed:\n- Prototype (til vurdering)"),
  );
  assert.ok(
    text.indexOf("Kriterier og vægte for Seed:\n- Team 100 %") <
      text.indexOf("Kriterier og vægte for Series A:\n- Traktion 100 %"),
  );
});
