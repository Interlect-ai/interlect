import { test } from "node:test";
import assert from "node:assert/strict";
import { runStatusText, runsSince } from "./rules.ts";
import {
  mapCaseRow,
  mapEventRow,
  mapOpenTaskRow,
  mapRunRow,
  numberOrNull,
  one,
} from "./mappers.ts";
import { buildFundTasks, caseViewFor, mapTaskCase } from "./task-build.ts";

test("every run status has a Danish word", () => {
  assert.equal(runStatusText("queued"), "i kø");
  assert.equal(runStatusText("running"), "kører");
  assert.equal(runStatusText("complete"), "færdig");
  assert.equal(runStatusText("failed"), "fejlede");
  assert.equal(runStatusText("awaiting_approval"), "afventer godkendelse");
  assert.equal(runStatusText("cancelled"), "annulleret");
  assert.equal(runStatusText("something_new"), "har en ukendt status");
  for (const status of ["queued", "running", "complete", "failed", "cancelled"]) {
    assert.doesNotMatch(runStatusText(status), /_|queued|cancelled|complete$/);
  }
});

test("the run read reaches back over the 14 activity days", () => {
  assert.equal(runsSince(new Date("2026-10-02T10:00:00Z")), "2026-09-17T00:00:00.000Z");
  assert.equal(runsSince(new Date("2026-10-30T10:00:00Z")), "2026-10-15T00:00:00.000Z");
  // The Danish date counts: 23:30 UTC on 31 Oct is already 1 Nov in Denmark.
  assert.equal(runsSince(new Date("2026-10-31T23:30:00Z")), "2026-10-17T00:00:00.000Z");
});

// -- row mapping ------------------------------------------------------------------------------

test("an embedded row may come as an object or as a one-element array", () => {
  assert.deepEqual(one({ a: 1 }), { a: 1 });
  assert.deepEqual(one([{ a: 1 }]), { a: 1 });
  assert.equal(one([]), null);
  assert.equal(one(null), null);
  assert.equal(one(undefined), null);
  assert.equal(numberOrNull("72.5"), 72.5);
  assert.equal(numberOrNull(null), null);
  assert.equal(numberOrNull("x"), null);
});

test("a case row reads the company and the sector label whichever way they are embedded", () => {
  const asObject = mapCaseRow({
    id: "c1",
    phase: "screening",
    status: "active",
    created_at: "2026-09-01T10:00:00Z",
    last_action_at: "2026-09-02T10:00:00Z",
    companies: {
      name: "Pleo",
      stage: "series_b",
      hq_country: "DK",
      sector_key: "fintech",
      sector_taxonomy: { label_da: "Fintech" },
    },
  });
  assert.equal(asObject.name, "Pleo");
  assert.equal(asObject.sector, "Fintech");
  const asArray = mapCaseRow({
    id: "c2",
    phase: "committee",
    status: "active",
    created_at: "2026-09-01T10:00:00Z",
    last_action_at: "2026-09-02T10:00:00Z",
    companies: [
      {
        name: "X",
        stage: null,
        hq_country: null,
        sector_key: null,
        sector_taxonomy: [{ label_da: "Software" }],
      },
    ],
  });
  assert.equal(asArray.sector, "Software");
  assert.equal(asArray.country, null);
  const orphan = mapCaseRow({
    id: "c3",
    phase: "screening",
    status: "active",
    created_at: "2026-09-01T10:00:00Z",
    last_action_at: "2026-09-02T10:00:00Z",
    companies: null,
  });
  assert.equal(orphan.name, "Ikke identificeret");
  assert.equal(orphan.sector, null);
});

test("a run row reads the score from an object or an array and keeps missing scores null", () => {
  const base = {
    id: "r",
    case_id: "c",
    kind: "screening",
    status: "complete",
    previous_run_id: null,
    created_at: "2026-09-01T10:00:00Z",
    completed_at: null,
  };
  assert.equal(
    mapRunRow({ ...base, recommendations: [{ overall_score: "71.5", evidence_confidence: 0.6 }] })
      .overallScore,
    71.5,
  );
  assert.equal(
    mapRunRow({ ...base, recommendations: { overall_score: 64, evidence_confidence: null } })
      .evidenceConfidence,
    null,
  );
  assert.equal(mapRunRow({ ...base, recommendations: null }).overallScore, null);
});

test("event and task rows keep the fields the rules read", () => {
  assert.deepEqual(
    mapEventRow({
      id: "e",
      case_id: "c",
      field: "phase",
      to_phase: "committee",
      to_status: null,
      occurred_at: "2026-09-01T10:00:00Z",
      undo_of: null,
    }),
    {
      id: "e",
      caseId: "c",
      field: "phase",
      toPhase: "committee",
      toStatus: null,
      occurredAt: "2026-09-01T10:00:00Z",
      undoOf: null,
    },
  );
  assert.deepEqual(
    mapOpenTaskRow({ case_id: "c", assignee_id: null, due_on: "2026-10-05T00:00:00Z" }),
    {
      caseId: "c",
      assigneeId: null,
      dueOn: "2026-10-05",
    },
  );
});

// -- tasks ------------------------------------------------------------------------------------

const taskRow = (id: string, caseId: string, over: Record<string, unknown> = {}) => ({
  id,
  case_id: caseId,
  kind: "question",
  title: `Task ${id}`,
  description: null,
  why: null,
  assignee_id: null,
  due_on: null,
  linked_kind: null,
  linked_key: null,
  created_at: "2026-09-20T10:00:00Z",
  ...over,
});

test("tasks on decided cases and on unknown cases are left out", () => {
  const cases = new Map([
    mapTaskCase({ id: "open", phase: "screening", companies: { name: "Åben" } }),
    mapTaskCase({ id: "done", phase: "decided", companies: [{ name: "Færdig" }] }),
  ]);
  const tasks = buildFundTasks({
    taskRows: [taskRow("1", "open"), taskRow("2", "done"), taskRow("3", "ghost")],
    cases,
    casesWithDeep: new Set(),
    assigneeNames: new Map(),
    userId: "me",
  });
  assert.deepEqual(
    tasks.map((task) => task.id),
    ["1"],
  );
  assert.equal(tasks[0]!.caseName, "Åben");
});

test("the case view is 'deep' only with a finished deep analysis and a case past screening", () => {
  assert.equal(caseViewFor("deep_analysis", true), "deep");
  assert.equal(caseViewFor("committee", true), "deep");
  assert.equal(caseViewFor("screening", true), "screening");
  assert.equal(caseViewFor("deep_analysis", false), "screening");
});

test("a task knows whether it is mine and who has it; dates are cut to the day", () => {
  const cases = new Map([
    mapTaskCase({ id: "c", phase: "deep_analysis", companies: { name: "X" } }),
  ]);
  const [mine, theirs, nobody] = buildFundTasks({
    taskRows: [
      taskRow("m", "c", { assignee_id: "me", due_on: "2026-10-05T00:00:00Z" }),
      taskRow("t", "c", { assignee_id: "maja" }),
      taskRow("n", "c"),
    ],
    cases,
    casesWithDeep: new Set(["c"]),
    assigneeNames: new Map([["maja", "Maja Hansen"]]),
    userId: "me",
  });
  assert.equal(mine!.mine, true);
  assert.equal(mine!.dueOn, "2026-10-05");
  assert.equal(mine!.caseView, "deep");
  assert.equal(theirs!.mine, false);
  assert.equal(theirs!.assigneeName, "Maja Hansen");
  assert.equal(nobody!.assigneeId, null);
  assert.equal(nobody!.assigneeName, null);
});
