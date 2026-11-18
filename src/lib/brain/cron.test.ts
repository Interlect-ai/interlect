/** Brain cron auth and keys. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedCron, nightlyKey } from "./cron.ts";

test("the cron route needs the exact bearer secret, and refuses everything without one", () => {
  assert.equal(isAuthorizedCron("Bearer s3cret", "s3cret"), true);
  assert.equal(isAuthorizedCron("Bearer wrong", "s3cret"), false);
  assert.equal(isAuthorizedCron("s3cret", "s3cret"), false);
  assert.equal(isAuthorizedCron(null, "s3cret"), false);
  assert.equal(isAuthorizedCron("Bearer ", undefined), false);
  assert.equal(isAuthorizedCron("Bearer ", ""), false);
});

test("the nightly key is the UTC date", () => {
  assert.equal(nightlyKey(new Date("2026-09-30T23:30:00-02:00")), "2026-10-01");
});
