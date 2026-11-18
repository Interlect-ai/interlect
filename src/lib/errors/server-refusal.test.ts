import assert from "node:assert/strict";
import { test } from "node:test";
import { translate } from "../i18n/translate.ts";
import { isServerRefusal } from "./server-refusal.ts";

test("recognises the server's refusal in both languages (T-650 a)", () => {
  for (const language of ["da", "en"] as const) {
    const cause = new Error(translate(language, "caseServer.cases.notFoundOrNoAccess"));
    assert.equal(isServerRefusal(cause, "caseServer.cases.notFoundOrNoAccess"), true);
    const thread = new Error(translate(language, "brainServer.chat.threadNotFound"));
    assert.equal(isServerRefusal(thread, "brainServer.chat.threadNotFound"), true);
  }
});

test("anything else is not the refusal", () => {
  assert.equal(
    isServerRefusal(new Error("Failed to fetch"), "caseServer.cases.noPublishedSetup"),
    false,
  );
  assert.equal(
    isServerRefusal(new Error("Teamet blev ikke fundet."), "caseServer.cases.notFoundOrNoAccess"),
    false,
  );
  assert.equal(isServerRefusal(null, "caseServer.cases.noPublishedSetup"), false);
  assert.equal(
    isServerRefusal(
      "Casen blev ikke fundet, eller du har ikke adgang.",
      "caseServer.cases.notFoundOrNoAccess",
    ),
    false,
  );
});
