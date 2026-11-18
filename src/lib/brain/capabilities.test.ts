/** Test af Brain-kapacitetsproben (batch 0). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_BRAIN,
  PROBE_TTL_MISSING_MS,
  PROBE_TTL_PRESENT_MS,
  createCachedProbe,
  deriveBrainCapabilities,
  isMissingError,
  showBrain,
  type BrainProbes,
  type ProbeResult,
} from "./capabilities.ts";

function setup(results: ProbeResult[], logs: string[] = []) {
  let clock = 1_000;
  let calls = 0;
  const probe = createCachedProbe(
    async () => results[Math.min(calls++, results.length - 1)]!,
    () => clock,
    (message, code) => logs.push(`${code ?? "-"}:${message}`),
  );
  return { probe, advance: (ms: number) => (clock += ms), calls: () => calls };
}

test("tabellen findes: sand og cachet i fem minutter", async () => {
  const t = setup([{ error: null }]);
  assert.equal(await t.probe(), true);
  t.advance(PROBE_TTL_PRESENT_MS - 1);
  assert.equal(await t.probe(), true);
  assert.equal(t.calls(), 1);
  t.advance(2);
  await t.probe();
  assert.equal(t.calls(), 2);
});

for (const code of ["42P01", "42703", "PGRST205", "PGRST204"]) {
  test(`${code} (mangler): falsk, kort cache, logges ikke som fejl`, async () => {
    const logs: string[] = [];
    const t = setup([{ error: { code, message: "x" } }, { error: null }], logs);
    assert.equal(await t.probe(), false);
    t.advance(PROBE_TTL_MISSING_MS - 1);
    assert.equal(await t.probe(), false);
    assert.equal(t.calls(), 1, "stadig cachet");
    t.advance(2);
    assert.equal(await t.probe(), true, "ny migration opdages inden for 20 sekunder");
    assert.deepEqual(logs, []);
  });
}

test("relation does not exist uden kode tæller som mangel", () => {
  assert.equal(isMissingError({ message: 'relation "public.brain_threads" does not exist' }), true);
  assert.equal(isMissingError({ message: "Could not find the table in the schema cache" }), true);
  assert.equal(isMissingError({ code: "42501", message: "permission denied" }), false);
});

test("anden fejl: falsk (aldrig vis på et gæt), logges, kort cache", async () => {
  const logs: string[] = [];
  const t = setup([{ error: { code: "08006", message: "connection failure" } }], logs);
  assert.equal(await t.probe(), false);
  assert.equal(logs.length, 1);
  t.advance(PROBE_TTL_MISSING_MS + 1);
  await t.probe();
  assert.equal(t.calls(), 2);
});

test("en forespørgsel der kaster giver falsk og bryder ikke siden", async () => {
  let clock = 0;
  const probe = createCachedProbe(
    async () => {
      throw new Error("netværk");
    },
    () => clock,
  );
  assert.equal(await probe(), false);
  clock += 1;
  assert.equal(await probe(), false);
});

test("nøglen holder separate svar (pr. fond)", async () => {
  const seen: string[] = [];
  const probe = createCachedProbe(async (key) => {
    seen.push(key);
    return { error: key === "fund-b" ? { code: "42P01", message: "x" } : null };
  });
  assert.equal(await probe("fund-a"), true);
  assert.equal(await probe("fund-b"), false);
  assert.equal(await probe("fund-a"), true);
  assert.deepEqual(seen, ["fund-a", "fund-b"]);
});

const allOn: BrainProbes = {
  flagOn: true,
  settingsTable: true,
  episodesTable: true,
  fundHasEpisodes: true,
  threadsTable: true,
  chatRouteReady: true,
  ingestColumns: true,
  bucket: true,
};
const strict = { memberCanDecide: false, memberCanPublish: false };

test("alt tændt: Admin, Lead og Medlem må chatte; Læser ikke", () => {
  for (const role of ["admin", "lead", "member"] as const) {
    assert.equal(showBrain(deriveBrainCapabilities(allOn, [role], strict)), true, role);
  }
  const reader = deriveBrainCapabilities(allOn, ["reader"], strict);
  assert.equal(reader.canChat, false);
  assert.equal(showBrain(reader), false);
});

test("staging i dag (0040-0045, ingen 0047, ingen chat-route): Brain er skjult for alle roller", () => {
  const staging: BrainProbes = {
    ...allOn,
    threadsTable: false,
    chatRouteReady: false,
    ingestColumns: false,
    bucket: false,
  };
  for (const role of ["admin", "lead", "member", "reader"] as const) {
    const caps = deriveBrainCapabilities(staging, [role], strict);
    assert.equal(caps.chat, false);
    assert.equal(showBrain(caps), false, role);
  }
});

test("tråde findes men chat-routen er ikke udgivet: stadig skjult", () => {
  const caps = deriveBrainCapabilities({ ...allOn, chatRouteReady: false }, ["admin"], strict);
  assert.equal(caps.chat, false);
  assert.equal(showBrain(caps), false);
});

test("BRAIN_ENABLED slukket (produktion): intet er tændt, selv hvis tabellerne findes", () => {
  const caps = deriveBrainCapabilities({ ...allOn, flagOn: false }, ["admin"], strict);
  assert.equal(caps.enabled, false);
  assert.equal(caps.chat, false);
  assert.equal(caps.memory, false);
  assert.equal(caps.ingest, false);
  assert.equal(showBrain(caps), false);
});

test("hukommelse kræver mindst én episode; vedhæft kræver kolonner og bucket", () => {
  const empty = deriveBrainCapabilities({ ...allOn, fundHasEpisodes: false }, ["admin"], strict);
  assert.equal(empty.memory, false);
  assert.equal(empty.chat, true);
  assert.equal(
    deriveBrainCapabilities({ ...allOn, bucket: false }, ["admin"], strict).ingest,
    false,
  );
  assert.equal(deriveBrainCapabilities(allOn, ["admin"], strict).ingest, true);
});

test("glem-rettigheden er kun Admin", () => {
  assert.equal(deriveBrainCapabilities(allOn, ["admin"], strict).canForget, true);
  assert.equal(deriveBrainCapabilities(allOn, ["lead"], strict).canForget, false);
  assert.equal(deriveBrainCapabilities(allOn, ["member"], strict).canForget, false);
});

test("showBrain tåler manglende svar", () => {
  assert.equal(showBrain(null), false);
  assert.equal(showBrain(undefined), false);
  assert.equal(showBrain(NO_BRAIN), false);
});
