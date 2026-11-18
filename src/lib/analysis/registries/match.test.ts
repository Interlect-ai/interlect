/** Valg af selskab i et udenlandsk register. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessIdentity } from "../identity.ts";
import { chooseRegistryMatch, registryMatchSignals } from "./match.ts";
import type { RegistryCompany } from "./types.ts";

function company(overrides: Partial<RegistryCompany>): RegistryCompany {
  return {
    country: "NO",
    registryNumber: "998209218",
    name: "SPOND AS",
    formerNames: [],
    active: true,
    status: "aktiv",
    website: null,
    registryUrl: "https://virksomhet.brreg.no/nb/oppslag/enheter/998209218",
    ...overrides,
  };
}

const spond = company({});
const spondylitt = company({ registryNumber: "912434443", name: "SPONDYLOARTRITTFORBUNDET NORGE" });

test("præcis samme navn vælges; et navn, der blot indeholder det, aldrig", () => {
  const result = chooseRegistryMatch({
    candidates: [spondylitt, spond],
    context: { brandName: "Spond" },
    websiteHost: "spond.com",
  });
  assert.equal(result.match?.registryNumber, "998209218");
  const none = chooseRegistryMatch({
    candidates: [spondylitt],
    context: { brandName: "Spond" },
    websiteHost: "spond.com",
  });
  assert.equal(none.match, null);
  assert.deepEqual(none.ambiguous, []);
});

test("ASA og AS er selskabsformer: KAHOOT! ASA er Kahoot", () => {
  const kahoot = company({ registryNumber: "997770234", name: "KAHOOT! ASA" });
  const result = chooseRegistryMatch({
    candidates: [kahoot],
    context: { brandName: "Kahoot!" },
    websiteHost: null,
  });
  assert.equal(result.match?.registryNumber, "997770234");
});

test("ASA fjernes kun fra registrets navn: et dansk navn, der starter med Asa, er uændret", () => {
  const asa = company({ registryNumber: "997770234", name: "ASA BRYG AS" });
  const result = chooseRegistryMatch({
    candidates: [asa],
    context: { brandName: "Bryg" },
    websiteHost: null,
  });
  assert.equal(result.match, null);
});

test("to selskaber med samme navn er flertydigt, medmindre hjemmesiden afgør det", () => {
  const other = company({ registryNumber: "923609016", website: "https://other.no" });
  const onSite = company({ website: "https://www.spond.com" });
  const ambiguous = chooseRegistryMatch({
    candidates: [spond, other],
    context: { brandName: "Spond" },
    websiteHost: "spond.com",
  });
  assert.equal(ambiguous.match, null);
  assert.equal(ambiguous.ambiguous.length, 2);
  const decided = chooseRegistryMatch({
    candidates: [onSite, other],
    context: { brandName: "Spond" },
    websiteHost: "spond.com",
  });
  assert.equal(decided.match?.registryNumber, "998209218");
});

test("et aktivt selskab går forud for et slettet med samme navn", () => {
  const deleted = company({ registryNumber: "923609016", active: false, status: "slettet" });
  const result = chooseRegistryMatch({
    candidates: [deleted, spond],
    context: { brandName: "Spond" },
    websiteHost: null,
  });
  assert.equal(result.match?.registryNumber, "998209218");
});

test("et navn, der kun ligner, tæller med registrets hjemmeside på casens domæne", () => {
  const renamed = company({ name: "SPOND GROUP NORGE AS", website: "www.spond.com" });
  const result = chooseRegistryMatch({
    candidates: [renamed],
    context: { brandName: "Spond" },
    websiteHost: "spond.com",
  });
  assert.equal(result.match?.name, "SPOND GROUP NORGE AS");
  const elsewhere = chooseRegistryMatch({
    candidates: [renamed],
    context: { brandName: "Spond" },
    websiteHost: "spond.io",
  });
  assert.equal(elsewhere.match, null);
});

test("signalerne: nummer i materialet + præcist navn + hjemmeside er sikkert", () => {
  const signals = registryMatchSignals({
    company: company({ website: "www.spond.com" }),
    registryName: "Brønnøysundregistrene",
    numberLabel: "Org.nr.",
    context: { brandName: "Spond" },
    websiteHost: "spond.com",
    fromMaterial: true,
  });
  assert.deepEqual(
    signals.map((signal) => signal.key),
    ["registry_number_in_material", "registry_name_exact", "registry_website_matches_domain"],
  );
  assert.equal(assessIdentity(signals).status, "confirmed");
});

test("signalerne: et navneopslag alene er ikke sikkert, og et slettet selskab trækker ned", () => {
  const byName = registryMatchSignals({
    company: spond,
    registryName: "Brønnøysundregistrene",
    numberLabel: "Org.nr.",
    context: { brandName: "Spond" },
    websiteHost: null,
    fromMaterial: false,
  });
  assert.deepEqual(
    byName.map((signal) => signal.key),
    ["registry_name_exact"],
  );
  assert.equal(assessIdentity(byName).status, "uncertain");
  const deleted = registryMatchSignals({
    company: company({ active: false, status: "konkurs" }),
    registryName: "Brønnøysundregistrene",
    numberLabel: "Org.nr.",
    context: { brandName: "Spond" },
    websiteHost: null,
    fromMaterial: false,
  });
  assert.equal(deleted.at(-1)?.key, "registry_inactive");
  assert.match(deleted.at(-1)?.label ?? "", /konkurs/);
});

test("et juridisk navn fra samme materiale som nummeret går ikke selv god for nummeret", () => {
  const signals = registryMatchSignals({
    company: company({ name: "ACCELERATOR AS" }),
    registryName: "Brønnøysundregistrene",
    numberLabel: "Org.nr.",
    context: { brandName: "Spond", anchoredLegalName: "Accelerator AS" },
    websiteHost: null,
    fromMaterial: true,
  });
  assert.deepEqual(
    signals.map((signal) => signal.key),
    ["registry_number_in_material"],
  );
});

test("estiske, lettiske og finske selskabsformer hindrer ikke et navnematch", async () => {
  const { comparableRegistryName } = await import("./match.ts");
  assert.equal(comparableRegistryName("Bolt Technology OÜ"), "Bolt Technology");
  assert.equal(comparableRegistryName('SIA "Printful Bits"'), '"Printful Bits"');
  assert.equal(comparableRegistryName("Wärtsilä Oyj"), "Wärtsilä");
  assert.equal(comparableRegistryName("Asa Bryg ApS"), "Asa Bryg ApS");
  const company = {
    country: "EE" as const,
    registryNumber: "12417834",
    name: "Bolt Technology OÜ",
    formerNames: [],
    active: true,
    status: "aktiv",
    website: null,
    registryUrl: "",
  };
  const chosen = chooseRegistryMatch({
    candidates: [company],
    context: { brandName: "Bolt Technology" },
    websiteHost: null,
  });
  assert.equal(chosen.match?.registryNumber, "12417834");
});
