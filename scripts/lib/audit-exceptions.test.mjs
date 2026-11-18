import { test } from "node:test";
import assert from "node:assert/strict";
import { EXCEPTIONS, blockingAdvisories, evaluateAudit, newerStableVersions } from "./audit-exceptions.mjs";

const picomatch = {
  source: 1247710,
  name: "picomatch",
  severity: "high",
  title: "picomatch vulnerable to ReDoS",
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  range: "<=4.0.7",
};

function report(...advisories) {
  const vulnerabilities = { vite: { name: "vite", severity: "high", via: ["picomatch", "tinyglobby"] } };
  for (const adv of advisories) {
    vulnerabilities[adv.name] = { name: adv.name, severity: adv.severity, via: [adv] };
  }
  return { vulnerabilities };
}

const base = { exceptions: EXCEPTIONS, publishedVersions: { picomatch: ["4.0.6", "4.0.7"] } };

test("the listed picomatch advisory is allowed while no fix exists", () => {
  const out = evaluateAudit({ ...base, report: report(picomatch) });
  assert.deepEqual(out.problems, []);
  assert.equal(out.allowed.length, 1);
});

test("any other high or critical advisory fails", () => {
  const other = { ...picomatch, name: "lodash", url: "https://github.com/advisories/GHSA-xxxx", severity: "critical" };
  const out = evaluateAudit({ ...base, report: report(picomatch, other) });
  assert.equal(out.problems.length, 1);
  assert.match(out.problems[0], /lodash/);
});

test("moderate and low advisories stay below the gate", () => {
  const moderate = { ...picomatch, name: "seroval", url: "https://github.com/advisories/GHSA-mod", severity: "moderate" };
  assert.deepEqual(blockingAdvisories(report(moderate)), []);
});

test("the exception ends when a newer picomatch is published", () => {
  const out = evaluateAudit({ ...base, publishedVersions: { picomatch: ["4.0.7", "4.0.8"] }, report: report(picomatch) });
  assert.match(out.problems[0], /4\.0\.8 is published/);
});

test("the exception ends when the advisory's range changes", () => {
  const out = evaluateAudit({ ...base, report: report({ ...picomatch, range: "<4.0.8" }) });
  assert.match(out.problems[0], /range changed/);
});

test("missing registry data fails instead of allowing", () => {
  const out = evaluateAudit({ ...base, publishedVersions: {}, report: report(picomatch) });
  assert.match(out.problems[0], /could not read/);
  for (const bad of [[], [{ error: {} }]]) {
    const res = evaluateAudit({ ...base, publishedVersions: { picomatch: bad }, report: report(picomatch) });
    assert.match(res.problems[0], /could not read/);
  }
});

test("a stale exception is reported as a note", () => {
  const out = evaluateAudit({ ...base, report: { vulnerabilities: {} } });
  assert.deepEqual(out.problems, []);
  assert.match(out.notes[0], /no longer reported/);
});

test("prereleases do not count as a fix", () => {
  assert.deepEqual(newerStableVersions(["4.0.7", "4.0.8-beta.1", "5.0.0", "3.0.2"], "4.0.7"), ["5.0.0"]);
});
