/** Test af kapabilitetsproben for kilde og ansvarlig (migration 0056). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROBE_TTL_MISSING_MS,
  PROBE_TTL_PRESENT_MS,
  createCaseOriginProbe,
  mayEditCaseOrigin,
  type ProbeResult,
} from "./intake-probe.ts";

function setup(results: ProbeResult[]) {
  let clock = 1_000;
  let calls = 0;
  const probe = createCaseOriginProbe(
    async () => results[Math.min(calls++, results.length - 1)]!,
    () => clock,
  );
  return { probe, advance: (ms: number) => (clock += ms), calls: () => calls };
}

test("kolonnen findes: sand og cachet i fem minutter", async () => {
  const t = setup([{ error: null }]);
  assert.equal(await t.probe(), true);
  t.advance(PROBE_TTL_PRESENT_MS - 1);
  assert.equal(await t.probe(), true);
  assert.equal(t.calls(), 1, "cachet");
  t.advance(2);
  await t.probe();
  assert.equal(t.calls(), 2, "udløbet efter fem minutter");
});

test("42703 (kolonnen mangler): falsk, kort cache, og 0056 opdages inden for 20 sekunder", async () => {
  const t = setup([
    { error: { code: "42703", message: "column cases.source_kind does not exist" } },
    { error: null },
  ]);
  assert.equal(await t.probe(), false);
  t.advance(PROBE_TTL_MISSING_MS - 1);
  assert.equal(await t.probe(), false);
  assert.equal(t.calls(), 1, "stadig cachet");
  t.advance(2);
  assert.equal(await t.probe(), true, "nyt opslag efter 20 sekunder finder kolonnen");
  assert.equal(t.calls(), 2);
});

test("kolonnenavnet i beskeden tæller som mangel, selv uden kode", async () => {
  const t = setup([{ error: { message: "Could not find the 'source_kind' column of 'cases'" } }]);
  assert.equal(await t.probe(), false);
});

test("en uventet fejl er ikke et bevis: falsk (der skrives aldrig på et gæt), kort cache og logget", async () => {
  const logged: string[] = [];
  let calls = 0;
  const probe = createCaseOriginProbe(
    async () => {
      calls += 1;
      return { error: { code: "57P01", message: "terminating connection" } };
    },
    () => 5,
    (message) => logged.push(message),
  );
  assert.equal(await probe(), false);
  assert.equal(logged.length, 1);
  assert.equal(calls, 1);
});

test("kilde og ansvarlig: skaberen inden for to timer, ellers kun Lead og Admin", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const own = { callerId: "u1", createdBy: "u1", isLeadOrAdmin: false };
  assert.equal(mayEditCaseOrigin({ ...own, createdAt: "2026-10-02T11:00:00Z", now }), true);
  assert.equal(mayEditCaseOrigin({ ...own, createdAt: "2026-10-02T09:59:00Z", now }), false);
  assert.equal(
    mayEditCaseOrigin({ ...own, createdBy: "u2", createdAt: "2026-10-02T11:59:00Z", now }),
    false,
    "en andens case",
  );
  assert.equal(
    mayEditCaseOrigin({ ...own, createdBy: "u2", isLeadOrAdmin: true, createdAt: null, now }),
    true,
  );
  assert.equal(mayEditCaseOrigin({ ...own, createdAt: null, now }), false);
});
