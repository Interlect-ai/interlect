/** Test af "Find selskabet" med falske CVR-, hjemmeside- og modelsvar (ingen netværk). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findCandidatesCore, type FindDeps } from "./find-candidates.core.ts";

const CVR_A = "26316804";
const CVR_B = "37561304";

function deps(over: Partial<FindDeps> = {}): FindDeps & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const count = <T>(_name: string, value: T) => value;
  const base: FindDeps = {
    searchNames: async () => count("searchNames", []),
    lookupCvr: async () => count("lookupCvr", null),
    profile: async () => count("profile", null),
    peek: async () => count("peek", null),
    webLookup: async () => count("webLookup", { candidates: [], failed: false }),
    pageText: async () => count("pageText", null),
    websiteHost: (raw) =>
      raw.includes(".") ? raw.replace(/^https?:\/\//, "").replace(/^www\./, "") : null,
  };
  const merged = {} as FindDeps;
  for (const key of Object.keys(base) as Array<keyof FindDeps>) {
    const fn = (over[key] ?? base[key]) as (...args: unknown[]) => unknown;
    (merged as unknown as Record<string, unknown>)[key] = async (...args: unknown[]) => {
      calls[key] = (calls[key] ?? 0) + 1;
      return fn(...args);
    };
  }
  merged.websiteHost = base.websiteHost;
  return Object.assign(merged, { calls });
}

test("tomt felt: ingen opslag", async () => {
  const d = deps();
  const result = await findCandidatesCore(d, { query: "  ", website: "" });
  assert.equal(result.outcome, "none");
  assert.equal(result.notes.length, 1);
  assert.deepEqual(d.calls, {});
});

test("entydigt: navn + forsidens CVR med samme navn springer valget over, uden betalt opslag", async () => {
  const d = deps({
    searchNames: async () => [{ cvrNumber: CVR_A, name: "Havbrug Nord ApS", status: "NORMAL" }],
    lookupCvr: async (cvr) =>
      cvr === CVR_A ? { cvrNumber: CVR_A, name: "Havbrug Nord ApS", status: "NORMAL" } : null,
    peek: async () => ({ host: "havbrugnord.dk", text: "CVR 26316804", cvrNumbers: [CVR_A] }),
    profile: async () => ({
      startDate: "2021-03-01",
      industryText: "Fiskeopdræt",
      legalFormText: "Anpartsselskab",
      city: "Hirtshals",
    }),
  });
  const result = await findCandidatesCore(d, { query: "Havbrug Nord", website: "havbrugnord.dk" });
  assert.equal(result.outcome, "unique");
  assert.equal(result.autoSelectedId, `cvr:${CVR_A}`);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.city, "Hirtshals");
  assert.equal(result.candidates[0]!.foundedYear, 2021);
  assert.equal(d.calls["webLookup"], undefined);
});

test("tvetydigt navn: to registerhit giver websøgning, og kun kontrollerede forslag vises", async () => {
  const d = deps({
    searchNames: async () => [
      { cvrNumber: CVR_A, name: "Nord Havbrug ApS", status: "NORMAL" },
      { cvrNumber: CVR_B, name: "Nord Havbrug Aqua ApS", status: "NORMAL" },
    ],
    webLookup: async () => ({
      failed: false,
      candidates: [
        // Kontrolleret via siden: domænet passer, og siden nævner navnet.
        { name: "Nord Havbrug AS", website: "nordhavbrug.no", country: "Norge", cvrNumber: null },
        // Ikke kontrolleret: siden kunne ikke hentes.
        { name: "Nord Havbrug Ltd", website: "nordhavbrug.co.uk", country: "UK", cvrNumber: null },
        // Ikke kontrolleret: siden nævner ikke navnet.
        { name: "Nord Havbrug Group", website: "nordhavbrug.com", country: null, cvrNumber: null },
      ],
    }),
    pageText: async (website) =>
      website === "nordhavbrug.no"
        ? { host: "nordhavbrug.no", text: "Velkommen til Nord Havbrug AS" }
        : website === "nordhavbrug.com"
          ? { host: "nordhavbrug.com", text: "Cookies" }
          : null,
  });
  const result = await findCandidatesCore(d, { query: "Nord Havbrug", website: "" });
  assert.equal(d.calls["webLookup"], 1);
  assert.equal(result.usedWebLookup, true);
  assert.equal(result.outcome, "ambiguous");
  assert.equal(result.autoSelectedId, null);
  const names = result.candidates.map((c) => c.name);
  assert.ok(names.includes("Nord Havbrug AS"));
  assert.ok(!names.includes("Nord Havbrug Ltd"));
  assert.ok(!names.includes("Nord Havbrug Group"));
  assert.equal(result.candidates.length, 3);
});

test("lookalike: et domæne, der viderestilles til en side der blot nævner navnet, godkendes ikke", async () => {
  const d = deps({
    webLookup: async () => ({
      failed: false,
      candidates: [
        { name: "Pleo", website: "pleo.io", country: "Danmark", cvrNumber: null },
        { name: "Pleo", website: "pleonasm.com", country: null, cvrNumber: null },
      ],
    }),
    pageText: async (website) =>
      website === "pleo.io"
        ? { host: "totally-other.example", text: "A blog post that mentions Pleo" }
        : { host: "pleonasm.com", text: "Pleo is a word" },
  });
  const result = await findCandidatesCore(d, { query: "Pleo", website: "" });
  assert.equal(result.candidates.length, 0);
});

test("ingen registerhit: websøgning kører, forslag via CVR i registret vises som danske kandidater", async () => {
  const d = deps({
    searchNames: async () => [],
    lookupCvr: async (cvr) =>
      cvr === CVR_A
        ? { cvrNumber: CVR_A, name: "Havbrug Nord Holding ApS", status: "NORMAL" }
        : null,
    webLookup: async () => ({
      failed: false,
      candidates: [{ name: "Havbrug Nord", website: null, country: "Danmark", cvrNumber: CVR_A }],
    }),
  });
  const result = await findCandidatesCore(d, { query: "Havbrug Nord", website: "" });
  assert.equal(result.usedWebLookup, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.cvrNumber, CVR_A);
  assert.equal(result.autoSelectedId, null);
});

test("kun ét uafklaret hit: ingen websøgning (R7-1), og CVR-indtastning bruger aldrig den", async () => {
  const one = deps({
    searchNames: async () => [{ cvrNumber: CVR_A, name: "Havbrug Nord ApS", status: "NORMAL" }],
  });
  const r1 = await findCandidatesCore(one, { query: "Havbrug Nord", website: "" });
  assert.equal(r1.usedWebLookup, false);
  assert.equal(r1.outcome, "ambiguous");

  const typed = deps({
    lookupCvr: async () => ({ cvrNumber: CVR_A, name: "Havbrug Nord ApS", status: "NORMAL" }),
  });
  const r2 = await findCandidatesCore(typed, { query: "CVR 26316804", website: "" });
  assert.equal(r2.usedWebLookup, false);
  assert.equal(r2.candidates[0]!.cvrNumber, CVR_A);
  assert.deepEqual(r2.candidates[0]!.matches, ["cvr"]);
});

test("ukendt CVR-nummer giver en tydelig note, ikke en fejl", async () => {
  const result = await findCandidatesCore(deps(), { query: "26316804", website: "" });
  assert.equal(result.outcome, "none");
  assert.match(result.notes.join(" "), /findes ikke i registret/);
});

test("registeret fejler: en venlig besked, ingen websøgning og ingen rå fejltekst", async () => {
  const d = deps({
    searchNames: async () => {
      throw new Error("ECONNRESET secret-internal-detail");
    },
  });
  const result = await findCandidatesCore(d, { query: "Havbrug Nord", website: "" });
  assert.equal(result.registryFailed, true);
  assert.equal(result.usedWebLookup, false);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.notes.length >= 1);
  assert.doesNotMatch(JSON.stringify(result), /ECONNRESET|secret-internal-detail/);
});

test("forsidens CVR, der tilhører et andet selskab, bruges ikke", async () => {
  const d = deps({
    searchNames: async () => [],
    lookupCvr: async () => ({ cvrNumber: CVR_B, name: "Accelerator Fonden", status: "NORMAL" }),
    peek: async () => ({ host: "havbrugnord.dk", text: "CVR 37561304", cvrNumbers: [CVR_B] }),
  });
  const result = await findCandidatesCore(d, { query: "Havbrug Nord", website: "havbrugnord.dk" });
  assert.ok(result.candidates.every((c) => c.cvrNumber !== CVR_B));
});

test("ugyldig hjemmeside og forside, der ikke kan læses, giver noter, ikke fejl", async () => {
  const bad = await findCandidatesCore(deps(), { query: "Pleo", website: "ikke en adresse" });
  assert.match(bad.notes.join(" "), /ikke ud som en adresse/);
  const unreadable = await findCandidatesCore(deps(), { query: "Pleo", website: "pleo.io" });
  assert.match(unreadable.notes.join(" "), /kunne ikke læses/);
});

test("ugyldigt CVR-tal behandles som navn med en note", async () => {
  const d = deps();
  const result = await findCandidatesCore(d, { query: "12345678", website: "" });
  assert.match(result.notes.join(" "), /ikke et gyldigt CVR-nummer/);
  assert.equal(d.calls["searchNames"], 1);
  assert.equal(d.calls["lookupCvr"], undefined);
});

test("tom saldo: websøgningen springes over med en forklaring og Fyld op (T-815)", async () => {
  const d = deps({
    webLookup: async () => ({ candidates: [], failed: true, skippedForCredits: true }),
  });
  const result = await findCandidatesCore(d, { query: "Helt Ukendt Selskab", website: "" });
  assert.equal(result.usedWebLookup, true);
  assert.equal(result.creditsStopped, true);
  assert.ok(result.noteKeys.some((note) => note.key === "intake.note.webSkippedCredits"));
  assert.match(result.notes.join(" "), /saldoen er brugt/);

  const failed = await findCandidatesCore(
    deps({ webLookup: async () => ({ candidates: [], failed: true }) }),
    { query: "Helt Ukendt Selskab", website: "" },
  );
  assert.equal(failed.creditsStopped, false);
  assert.ok(!failed.noteKeys.some((note) => note.key === "intake.note.webSkippedCredits"));
});

test("T-817: en forside, der viderestiller til et andet domæne, giver adressen og en note, ikke 'kunne ikke læses'", async () => {
  const d = deps({
    searchNames: async () => [{ cvrNumber: CVR_A, name: "Havbrug Nord ApS", status: "NORMAL" }],
    peek: async () => ({ redirectsTo: "https://havbrugnord.com/" }),
  });
  const result = await findCandidatesCore(d, { query: "Havbrug Nord", website: "havbrugnord.dk" });
  assert.equal(result.websiteRedirect, "https://havbrugnord.com/");
  assert.deepEqual(
    result.noteKeys.map((note) => note.key),
    ["intake.note.websiteRedirects"],
  );
  assert.match(result.notes[0]!, /havbrugnord\.dk viderestiller til havbrugnord\.com/);
  // Uden forsidens CVR afgør navnet alene ikke valget.
  assert.equal(d.calls["lookupCvr"], undefined);

  const unread = await findCandidatesCore(deps({ peek: async () => null }), {
    query: "Havbrug Nord",
    website: "havbrugnord.dk",
  });
  assert.equal(unread.websiteRedirect, null);
  assert.deepEqual(
    unread.noteKeys.map((note) => note.key).filter((key) => key.includes("website")),
    ["intake.note.websiteUnreadable"],
  );
});

test("AI-grænsen stopper websøgningen: grænseteksten vises som note (T-876 a)", async () => {
  const result = await findCandidatesCore(
    deps({
      webLookup: async () => ({
        candidates: [],
        failed: true,
        skippedForLimit: "Du har nået grænsen på 60 hjælpekald i timen.",
      }),
    }),
    { query: "Helt Ukendt Selskab", website: "" },
  );
  assert.equal(result.creditsStopped, false);
  assert.ok(result.noteKeys.some((note) => note.key === "intake.note.webSkippedLimit"));
  assert.match(result.notes.join(" "), /grænsen på 60 hjælpekald/);
});
