import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bulkHighlight,
  menuGroups,
  primaryAction,
  recommendedAction,
  statusChipKey,
  undoToastDuration,
  type CaseActionState,
} from "./case-actions.ts";
import { reasonCodesToSend, reasonOptions } from "./reason-options.ts";
import { reasonRequired } from "./lifecycle.ts";

const all = { canMove: true, canDecide: true, canRun: true };
const state = (over: Partial<CaseActionState> = {}): CaseActionState => ({
  phase: "screening",
  status: "active",
  hasScreening: true,
  canRunDeep: true,
  hasDeep: false,
  running: false,
  ...over,
});

test("the next step follows the phase (DESIGN.md Handlinger v2)", () => {
  assert.equal(recommendedAction(state()), "runDeepAnalysis");
  assert.equal(
    recommendedAction(state({ hasScreening: false, canRunDeep: false })),
    "runScreening",
  );
  // Already sent to a deep analysis (e.g. after Tilbage til screening): screen again first.
  assert.equal(recommendedAction(state({ canRunDeep: false })), "rerunScreening");
  assert.equal(recommendedAction(state({ phase: "deep_analysis" })), "sendToCommittee");
  assert.equal(recommendedAction(state({ phase: "committee" })), "markInvested");
  assert.equal(recommendedAction(state({ status: "on_hold" })), "resume");
  assert.equal(recommendedAction(state({ phase: "decided", status: "closed" })), "reopen");
});

test("Genåbn opens the menu; the list resumes directly, the case top asks why", () => {
  assert.deepEqual(
    primaryAction(state({ phase: "decided", status: "invested" }), "list")?.command,
    {
      kind: "menu",
    },
  );
  assert.deepEqual(primaryAction(state({ status: "on_hold" }), "list")?.command, {
    kind: "transition",
    action: "reopen",
    dialog: null,
  });
  assert.deepEqual(primaryAction(state({ status: "on_hold" }), "top")?.command, {
    kind: "transition",
    action: "reopen",
    dialog: "resume",
  });
  assert.equal(primaryAction(state({ running: true }), "list"), null);
});

test("hold, close, invest and committee always ask for reasons", () => {
  const items = menuGroups(state({ phase: "deep_analysis" }), all, "list").flatMap(
    (group) => group.items,
  );
  const dialog = (id: string) => {
    const command = items.find((item) => item.id === id)?.command;
    return command?.kind === "transition" ? command.dialog : undefined;
  };
  assert.equal(dialog("hold"), "hold");
  assert.equal(dialog("close"), "close");
  assert.equal(dialog("markInvested"), "invest");
  assert.equal(dialog("sendToCommittee"), "committee");
});

test("a decided case offers Genåbn instead of Fase and no Status group", () => {
  const groups = menuGroups(state({ phase: "decided", status: "closed" }), all, "list");
  assert.deepEqual(
    groups.map((group) => group.heading),
    ["reopen", "decision"],
  );
  const close = groups[1]?.items.find((item) => item.id === "close");
  assert.equal(close?.current, true);
});

test("Genåbn reaches every phase; the case top asks why, the list moves (harden G1, G2)", () => {
  const decidedCase = state({ phase: "decided", status: "invested", hasDeep: true });
  const reopen = (surface: "list" | "top") =>
    menuGroups(decidedCase, all, surface)[0]?.items.map((item) => [item.id, item.command]);
  assert.deepEqual(reopen("top"), [
    ["reopenInScreening", { kind: "transition", action: "back_to_screening", dialog: "reopen" }],
    [
      "reopenInDeepAnalysis",
      { kind: "transition", action: "reopen_in_deep_analysis", dialog: "reopen" },
    ],
    ["sendToCommittee", { kind: "transition", action: "send_to_committee", dialog: "reopen" }],
  ]);
  assert.deepEqual(reopen("list"), [
    ["reopenInScreening", { kind: "transition", action: "back_to_screening", dialog: null }],
    [
      "reopenInDeepAnalysis",
      { kind: "transition", action: "reopen_in_deep_analysis", dialog: null },
    ],
    ["sendToCommittee", { kind: "transition", action: "send_to_committee", dialog: "committee" }],
  ]);
  // Leaving Besluttet is a decision: a member without decide_case sees why not.
  const member = menuGroups(decidedCase, { canMove: true, canDecide: false, canRun: true }, "top");
  assert.equal(
    member[0]?.items.find((item) => item.id === "sendToCommittee")?.blocked,
    "Kræver Lead eller Admin",
  );
});

test("the committee's status menu leads with the decision (Status v2)", () => {
  const groups = menuGroups(state({ phase: "committee" }), all, "top");
  assert.equal(groups[0]?.heading, "decision");
  assert.equal(groups[0]?.items[0]?.id, "markInvested");
  assert.equal(groups[0]?.items[0]?.recommended, true);
});

test("a member without decide_case sees decisions disabled with the reason", () => {
  const items = menuGroups(
    state(),
    { canMove: true, canDecide: false, canRun: true },
    "list",
  ).flatMap((group) => group.items);
  assert.equal(items.find((item) => item.id === "close")?.blocked, "Kræver Lead eller Admin");
  assert.equal(items.find((item) => item.id === "hold")?.blocked, null);
});

test("a deep analysis needs a finished screening", () => {
  const items = menuGroups(state({ hasScreening: false, canRunDeep: false }), all, "list").flatMap(
    (group) => group.items,
  );
  assert.equal(
    items.find((item) => item.id === "runDeepAnalysis")?.blocked,
    "Kræver en færdig screening",
  );
});

test("status chip derives Afventer beslutning; bulk highlights the fitting action", () => {
  assert.equal(statusChipKey("committee", "active"), "awaiting_decision");
  assert.equal(statusChipKey("committee", "on_hold"), "on_hold");
  assert.deepEqual(bulkHighlight([state(), state()]), { deep: true, committee: false });
  assert.deepEqual(bulkHighlight([state(), state({ phase: "deep_analysis" })]), {
    deep: false,
    committee: false,
  });
});

const codes = [
  { code: "wrong_timing", label: "Forkert timing", appliesTo: ["hold", "reject", "decline_ic"] },
  {
    code: "awaiting_milestone",
    label: "Afventer milepæl",
    appliesTo: ["hold", "reject", "decline_ic"],
  },
  { code: "too_early", label: "For tidligt", appliesTo: ["hold", "reject", "decline_ic"] },
  { code: "small_market", label: "For lille marked", appliesTo: ["hold", "reject", "decline_ic"] },
  { code: "strong_team", label: "Stærkt team", appliesTo: ["advance", "invest", "reopen"] },
  {
    code: "other",
    label: "Andet",
    appliesTo: ["advance", "hold", "reject", "decline_ic", "invest", "reopen"],
  },
];

test("reason chips: suggested first, the rest behind Flere årsager, never Andet", () => {
  const hold = reasonOptions(codes, ["hold"]);
  assert.deepEqual(
    hold.primary.map((option) => option.value),
    ["wrong_timing", "awaiting_milestone", "too_early"],
  );
  assert.deepEqual(
    hold.more.map((option) => option.value),
    ["small_market"],
  );
  const invest = reasonOptions(codes, ["invest"]);
  assert.deepEqual(
    [...invest.primary, ...invest.more].map((option) => option.value),
    ["strong_team"],
  );
});

test("a note alone is saved as Andet where a reason is required", () => {
  assert.deepEqual(reasonCodesToSend([], "Venter på tal", ["hold"], codes, reasonRequired), [
    "other",
  ]);
  assert.deepEqual(reasonCodesToSend([], "Godt team", ["advance"], codes, reasonRequired), []);
  assert.deepEqual(reasonCodesToSend(["too_early"], "", ["hold"], codes, reasonRequired), [
    "too_early",
  ]);
  const withoutOther = codes.filter((code) => code.code !== "other");
  assert.equal(reasonCodesToSend([], "Note", ["hold"], withoutOther, reasonRequired), null);
});

test("Genåbn i dyb analyse needs a deep analysis to reopen", () => {
  const items = (hasDeep: boolean) =>
    menuGroups(state({ phase: "decided", status: "closed", hasDeep }), all, "list").flatMap(
      (group) => group.items,
    );
  assert.equal(
    items(false).find((item) => item.id === "reopenInDeepAnalysis")?.blocked,
    "Ingen dyb analyse endnu",
  );
  assert.equal(items(true).find((item) => item.id === "reopenInDeepAnalysis")?.blocked, null);
});

test("a reason list that failed to load still lets a note through as Andet", () => {
  assert.deepEqual(reasonCodesToSend([], "Venter på tal", ["hold"], [], reasonRequired), ["other"]);
});

test("Fortryd is only offered while the server still takes it (harden E1)", () => {
  // A quick answer: the full 5 s.
  assert.equal(undoToastDuration(200), 5_000);
  // A 3 s answer: the server's 7 s window minus the answer and time for the undo to arrive.
  assert.equal(undoToastDuration(3_000), 2_500);
  // Far too slow: no Fortryd rather than one the server refuses.
  assert.equal(undoToastDuration(4_500), null);
});
