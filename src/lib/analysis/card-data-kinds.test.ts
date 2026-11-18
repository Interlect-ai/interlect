import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEAM_AXES, teamHasRadar, type TeamAxis } from "./card-data-kinds.ts";

function person(scored: readonly TeamAxis[]) {
  return {
    scores: Object.fromEntries(
      TEAM_AXES.map((axis) => [axis, scored.includes(axis) ? 7 : null]),
    ) as Record<TeamAxis, number | null>,
  };
}

describe("teamHasRadar", () => {
  it("draws the radar from three scored axes", () => {
    assert.equal(teamHasRadar({ people: [person(["domain", "execution", "technical"])] }), true);
  });

  it("counts an axis once even when several people scored it", () => {
    const people = [person(["domain", "execution"]), person(["domain", "execution"])];
    assert.equal(teamHasRadar({ people }), false);
  });

  it("adds up axes across people", () => {
    const people = [person(["domain", "execution"]), person(["leadership"])];
    assert.equal(teamHasRadar({ people }), true);
  });

  it("falls back (no radar) with fewer than three axes or nobody", () => {
    assert.equal(teamHasRadar({ people: [person(["domain"])] }), false);
    assert.equal(teamHasRadar({ people: [] }), false);
  });

  it("only looks at the four people the radar shows", () => {
    const people = [person([]), person([]), person([]), person([]), person([...TEAM_AXES])];
    assert.equal(teamHasRadar({ people }), false);
  });
});
