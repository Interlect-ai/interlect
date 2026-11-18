/** "Find selskabet" i et udenlandsk register med falske registersvar (ingen netværk). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findForeignCandidates, type ForeignFindAdapter } from "./find-candidates.foreign.ts";
import type { RegistryCompany } from "../analysis/registries/types.ts";

const company = (over: Partial<RegistryCompany> = {}): RegistryCompany => ({
  country: "NO",
  registryNumber: "923609016",
  name: "Equinor ASA",
  formerNames: [],
  active: true,
  status: "Aktiv",
  website: "equinor.com",
  registryUrl: "https://virksomhet.brreg.no/nb/oppslag/enheter/923609016",
  ...over,
});

function adapter(over: Partial<ForeignFindAdapter> = {}): ForeignFindAdapter {
  return {
    registryName: "Brønnøysundregistrene",
    numberLabel: "Org.nr.",
    supportsNameSearch: true,
    configured: () => true,
    normalizeNumber: (raw) =>
      /^\d{9}$/.test(raw.replace(/\s/g, "")) ? raw.replace(/\s/g, "") : null,
    searchByName: async () => [
      company(),
      company({ registryNumber: "999999999", name: "Equinor Energy AS" }),
    ],
    lookupByNumber: async (number) => (number === "923609016" ? company() : null),
    ...over,
  };
}

test("a valid number is looked up and becomes one candidate the user picks (no auto choice)", async () => {
  const result = await findForeignCandidates(adapter(), { country: "NO", query: "923 609 016" });
  assert.equal(result.candidates.length, 1);
  const [candidate] = result.candidates;
  assert.equal(candidate!.cvrNumber, "923609016");
  assert.equal(candidate!.registryCountry, "NO");
  assert.equal(candidate!.origin, "entered_cvr");
  assert.equal(candidate!.country, "Norge");
  assert.equal(result.autoSelectedId, null);
});

test("a name searches the register; an exact name is marked as a name match", async () => {
  const result = await findForeignCandidates(adapter(), { country: "NO", query: "Equinor ASA" });
  assert.deepEqual(
    result.candidates.map((c) => c.cvrNumber),
    ["923609016", "999999999"],
  );
  assert.deepEqual(result.candidates[0]!.matches, ["name"]);
  assert.deepEqual(result.candidates[1]!.matches, []);
});

test("an unknown number, a register without name search and a register that fails say so", async () => {
  const missing = await findForeignCandidates(adapter(), { country: "NO", query: "987654321" });
  assert.equal(missing.candidates.length, 0);
  assert.equal(missing.noteKeys[0]!.key, "intake.note.numberMissing");
  const numberOnly = await findForeignCandidates(adapter({ supportsNameSearch: false }), {
    country: "SE",
    query: "Klarna",
  });
  assert.equal(numberOnly.noteKeys[0]!.key, "intake.note.numberOnly");
  const down = await findForeignCandidates(
    adapter({
      searchByName: async () => {
        throw new Error("timeout");
      },
    }),
    { country: "NO", query: "Equinor" },
  );
  assert.equal(down.registryFailed, true);
  assert.equal(down.noteKeys[0]!.key, "intake.note.foreignRegistryDown");
  const notSetUp = await findForeignCandidates(adapter({ configured: () => false }), {
    country: "NO",
    query: "Equinor",
  });
  assert.equal(notSetUp.noteKeys[0]!.key, "intake.note.registryNotSetUp");
});
