import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionMovementKind,
  daysWithoutAction,
  isAwaitingDecision,
  needsNudge,
  reasonRequired,
  appRefusal,
  requiredCapability,
  transitionTarget,
} from "./lifecycle.ts";
import { movementKind } from "../brain/movement.ts";

test("Afventer beslutning is committee + active only", () => {
  assert.equal(isAwaitingDecision("committee", "active"), true);
  assert.equal(isAwaitingDecision("committee", "on_hold"), false);
  assert.equal(isAwaitingDecision("deep_analysis", "active"), false);
});

test("nudge after 7 days without action, only for active cases", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  assert.equal(daysWithoutAction("2026-10-03T12:00:00Z", now), 7);
  assert.equal(needsNudge("active", "2026-10-03T12:00:00Z", now), true);
  assert.equal(needsNudge("active", "2026-10-04T12:00:00Z", now), false);
  assert.equal(needsNudge("on_hold", "2026-09-01T12:00:00Z", now), false);
});

test("anything entering or leaving Besluttet is a decision", () => {
  assert.equal(requiredCapability("close", "screening"), "decide_case");
  assert.equal(requiredCapability("invest", "committee"), "decide_case");
  assert.equal(requiredCapability("reopen", "decided"), "decide_case");
  assert.equal(requiredCapability("send_to_committee", "decided"), "decide_case");
  assert.equal(requiredCapability("reopen_in_deep_analysis", "decided"), "decide_case");
  assert.equal(requiredCapability("reopen", "screening"), "move_process_stage");
  assert.equal(requiredCapability("hold", "committee"), "move_process_stage");
  assert.equal(requiredCapability("send_to_committee", "deep_analysis"), "move_process_stage");
});

test("the action's movement matches the SQL rule for the resulting log row", () => {
  const phases = ["screening", "deep_analysis", "committee", "decided"] as const;
  const statuses = ["active", "on_hold", "closed", "invested"] as const;
  for (const action of [
    "send_to_committee",
    "hold",
    "close",
    "invest",
    "reopen",
    "back_to_screening",
    "reopen_in_deep_analysis",
  ] as const) {
    for (const phase of phases) {
      for (const status of statuses) {
        if ((phase === "decided") !== (status === "closed" || status === "invested")) continue;
        const target = transitionTarget(action);
        const nextStatus = target.status ?? status;
        const nextPhase =
          target.phase ?? (phase === "decided" && nextStatus === "active" ? "committee" : phase);
        if (nextPhase === phase && nextStatus === status) {
          assert.equal(
            actionMovementKind(action, phase, status),
            null,
            `${action} ${phase}/${status}`,
          );
          continue;
        }
        const expected =
          nextStatus !== status
            ? movementKind("status", status, nextStatus, phase)
            : movementKind("phase", phase, nextPhase, phase);
        assert.equal(
          actionMovementKind(action, phase, status),
          expected,
          `${action} ${phase}/${status}`,
        );
      }
    }
  }
});

test("reasons are required for hold, reject, decline in committee and invest", () => {
  assert.equal(reasonRequired("hold"), true);
  assert.equal(reasonRequired("reject"), true);
  assert.equal(reasonRequired("decline_ic"), true);
  assert.equal(reasonRequired("invest"), true);
  assert.equal(reasonRequired("advance"), false);
  assert.equal(reasonRequired("reopen"), false);
});

test("a decided case is never held (harden C, S2)", () => {
  assert.match(appRefusal("hold", "decided") ?? "", /Genåbn den først/);
  assert.equal(appRefusal("hold", "committee"), null);
  assert.equal(appRefusal("close", "decided"), null);
});
