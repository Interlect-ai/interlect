/** Test af identitetsafgørelsen før casen findes. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorLegalName,
  buildNameAgrees,
  companyNameVariants,
  cvrNameSignals,
  parseCompanyQuery,
  resolveCompanyIdentity,
  shouldUseWebLookup,
  verifyWebCandidate,
  type RegistryHit,
} from "./identity-resolve.ts";

// Gyldige kontrolcifre (modulus 11); navnene er opfundne testdata.
const CVR_A = "26316804";
const CVR_B = "37561304";
const CVR_C = "10150817";

const hit = (over: Partial<RegistryHit> & { cvrNumber: string; name: string }): RegistryHit => ({
  status: "NORMAL",
  origin: "registry_name",
  ...over,
});

test("CVR genkendes med modulus 11, også med mellemrum og CVR-præfiks", () => {
  assert.deepEqual(parseCompanyQuery("26316804"), { kind: "cvr", cvrNumber: CVR_A });
  assert.deepEqual(parseCompanyQuery("CVR 26 31 68 04"), { kind: "cvr", cvrNumber: CVR_A });
  assert.deepEqual(parseCompanyQuery("cvr-nr.: 26316804"), { kind: "cvr", cvrNumber: CVR_A });
  assert.deepEqual(parseCompanyQuery("DK26316804"), { kind: "cvr", cvrNumber: CVR_A });
});

test("otte cifre uden gyldigt kontrolciffer er et navn, markeret som ugyldigt CVR", () => {
  assert.deepEqual(parseCompanyQuery("12345678"), {
    kind: "name",
    name: "12345678",
    invalidCvr: true,
  });
  assert.equal(parseCompanyQuery("   ").kind, "empty");
  assert.deepEqual(parseCompanyQuery("Havbrug Nord"), {
    kind: "name",
    name: "Havbrug Nord",
    invalidCvr: false,
  });
});

test("selskabsformer: navnet prøves som indtastet, uden form og med ApS, A/S og IVS", () => {
  assert.deepEqual(companyNameVariants("Havbrug Nord"), [
    "Havbrug Nord",
    "Havbrug Nord ApS",
    "Havbrug Nord A/S",
    "Havbrug Nord IVS",
  ]);
  const withForm = companyNameVariants("Havbrug Nord ApS");
  assert.equal(withForm[0], "Havbrug Nord ApS");
  assert.ok(withForm.includes("Havbrug Nord"));
  assert.ok(withForm.includes("Havbrug Nord A/S"));
  assert.equal(new Set(withForm).size, withForm.length);
  assert.deepEqual(companyNameVariants("  "), []);
});

test("entydigt: ét aktivt registernavn plus CVR på hjemmesiden med samme navn springer valget over", () => {
  const result = resolveCompanyIdentity({
    query: parseCompanyQuery("Havbrug Nord"),
    websiteHost: "havbrugnord.dk",
    hits: [
      hit({ cvrNumber: CVR_A, name: "Havbrug Nord ApS" }),
      hit({
        cvrNumber: CVR_A,
        name: "Havbrug Nord ApS",
        origin: "website_footer",
        host: "havbrugnord.dk",
      }),
    ],
  });
  assert.equal(result.outcome, "unique");
  assert.equal(result.autoSelected?.cvrNumber, CVR_A);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual([...result.candidates[0]!.matches].sort(), ["cvr", "name", "website"]);
});

test("kun et navnehit uden anden kilde er ikke sikkert nok: valget vises til et menneske", () => {
  const result = resolveCompanyIdentity({
    query: parseCompanyQuery("Havbrug Nord"),
    websiteHost: null,
    hits: [hit({ cvrNumber: CVR_A, name: "Havbrug Nord ApS" })],
  });
  assert.equal(result.outcome, "ambiguous");
  assert.equal(result.autoSelected, null);
  assert.equal(result.candidates.length, 1);
});

test("tvetydigt: to aktive selskaber vises begge, bedste match først, aldrig auto-valgt", () => {
  const result = resolveCompanyIdentity({
    query: parseCompanyQuery("Nord Havbrug"),
    websiteHost: "nordhavbrug.dk",
    hits: [
      hit({ cvrNumber: CVR_B, name: "Nord Havbrug Aqua ApS" }),
      hit({ cvrNumber: CVR_A, name: "Nord Havbrug ApS" }),
    ],
  });
  assert.equal(result.outcome, "ambiguous");
  assert.equal(result.autoSelected, null);
  assert.equal(result.candidates[0]!.cvrNumber, CVR_A);
  assert.ok(
    result.candidates[0]!.assessment.confidence > result.candidates[1]!.assessment.confidence,
  );
});

test("et ophørt selskab tæller ikke med i entydigheden og står nederst", () => {
  const result = resolveCompanyIdentity({
    query: parseCompanyQuery("Havbrug Nord"),
    websiteHost: "havbrugnord.dk",
    hits: [
      hit({ cvrNumber: CVR_B, name: "Havbrug Nord IVS", status: "OPLØST" }),
      hit({ cvrNumber: CVR_A, name: "Havbrug Nord ApS" }),
      hit({
        cvrNumber: CVR_A,
        name: "Havbrug Nord ApS",
        origin: "website_footer",
        host: "havbrugnord.dk",
      }),
    ],
  });
  assert.equal(result.outcome, "unique");
  assert.equal(result.candidates.at(-1)!.cvrNumber, CVR_B);
  assert.equal(result.candidates.at(-1)!.inactive, true);
});

test("ingen: tomt svar fra registret er 'none'", () => {
  const result = resolveCompanyIdentity({
    query: parseCompanyQuery("Findes Ikke"),
    websiteHost: null,
    hits: [],
  });
  assert.equal(result.outcome, "none");
  assert.deepEqual(result.candidates, []);
});

test("CVR på hjemmesiden, der tilhører et andet selskab (fx en accelerator), bruges aldrig", () => {
  const result = resolveCompanyIdentity({
    query: parseCompanyQuery("Havbrug Nord"),
    websiteHost: "havbrugnord.dk",
    hits: [
      hit({
        cvrNumber: CVR_C,
        name: "Accelerator Fonden",
        origin: "website_footer",
        host: "havbrugnord.dk",
      }),
    ],
  });
  assert.equal(result.outcome, "none");
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0]!, /tilhører Accelerator Fonden/);
});

test("indtastet CVR: ét kort med CVR-signal; sikkert først når hjemmesiden også bekræfter", () => {
  const alone = resolveCompanyIdentity({
    query: parseCompanyQuery(CVR_A),
    websiteHost: null,
    hits: [hit({ cvrNumber: CVR_A, name: "Havbrug Nord ApS", origin: "entered_cvr" })],
  });
  assert.equal(alone.outcome, "ambiguous");
  assert.equal(alone.candidates.length, 1);
  assert.deepEqual(alone.candidates[0]!.matches, ["cvr"]);

  const corroborated = resolveCompanyIdentity({
    query: parseCompanyQuery(CVR_A),
    websiteHost: "havbrugnord.dk",
    hits: [
      hit({ cvrNumber: CVR_A, name: "Havbrug Nord ApS", origin: "entered_cvr" }),
      hit({
        cvrNumber: CVR_A,
        name: "Havbrug Nord ApS",
        origin: "website_footer",
        host: "havbrugnord.dk",
      }),
    ],
  });
  assert.equal(corroborated.outcome, "unique");
});

test("et ugyldigt nummer i et hit bruges aldrig", () => {
  const result = resolveCompanyIdentity({
    query: parseCompanyQuery("Havbrug Nord"),
    websiteHost: null,
    hits: [hit({ cvrNumber: "12345678", name: "Havbrug Nord ApS" })],
  });
  assert.equal(result.outcome, "none");
  assert.equal(result.rejected.length, 1);
});

test("navnehit, der ikke ligner navnet, er ikke en kandidat", () => {
  const result = resolveCompanyIdentity({
    query: parseCompanyQuery("Havbrug Nord"),
    websiteHost: null,
    hits: [hit({ cvrNumber: CVR_C, name: "Zebra Logistik ApS" })],
  });
  assert.equal(result.outcome, "none");
});

test("websøgning bruges kun ved 0 eller flere end 1 uafklarede hit, aldrig ved sikkert match", () => {
  const none = resolveCompanyIdentity({
    query: parseCompanyQuery("Nordhav Aqua"),
    websiteHost: null,
    hits: [],
  });
  assert.equal(shouldUseWebLookup(none), true);
  const one = resolveCompanyIdentity({
    query: parseCompanyQuery("Havbrug Nord"),
    websiteHost: null,
    hits: [hit({ cvrNumber: CVR_A, name: "Havbrug Nord ApS" })],
  });
  assert.equal(shouldUseWebLookup(one), false);
  const two = resolveCompanyIdentity({
    query: parseCompanyQuery("Nord Havbrug"),
    websiteHost: null,
    hits: [
      hit({ cvrNumber: CVR_B, name: "Nord Havbrug Aqua ApS" }),
      hit({ cvrNumber: CVR_A, name: "Nord Havbrug ApS" }),
    ],
  });
  assert.equal(shouldUseWebLookup(two), true);
  const unique = resolveCompanyIdentity({
    query: parseCompanyQuery("Havbrug Nord"),
    websiteHost: "havbrugnord.dk",
    hits: [
      hit({ cvrNumber: CVR_A, name: "Havbrug Nord ApS" }),
      hit({
        cvrNumber: CVR_A,
        name: "Havbrug Nord ApS",
        origin: "website_footer",
        host: "havbrugnord.dk",
      }),
    ],
  });
  assert.equal(shouldUseWebLookup(unique), false);
});

test("kandidater fra websøgning vises kontrolleret og vælges aldrig automatisk", () => {
  const result = resolveCompanyIdentity({
    query: parseCompanyQuery("Nordhav Aqua"),
    websiteHost: null,
    hits: [],
    webHits: [
      {
        name: "Nordhav Aqua AS",
        website: "https://www.nordhav.no/om",
        country: "Norge",
        sourceUrl: "https://www.nordhav.no/",
      },
    ],
  });
  assert.equal(result.outcome, "ambiguous");
  assert.equal(result.autoSelected, null);
  assert.equal(result.candidates[0]!.source, "web");
  assert.equal(result.candidates[0]!.cvrNumber, null);
  assert.equal(result.candidates[0]!.website, "nordhav.no");
  assert.deepEqual(result.candidates[0]!.matches.sort(), ["name", "website"]);
});

test("verifyWebCandidate: registret eller en hentet side med navnet; kilden alene er aldrig nok", () => {
  const base = { registryHit: null, fetchedHost: null, pageText: null, website: null };
  assert.deepEqual(
    verifyWebCandidate({
      ...base,
      name: "Havbrug Nord",
      registryHit: { cvrNumber: CVR_A, name: "Havbrug Nord ApS" },
    }),
    { verified: true, via: "registry" },
  );
  // Registernavnet passer ikke: ikke verificeret ad den vej.
  assert.equal(
    verifyWebCandidate({
      ...base,
      name: "Havbrug Nord",
      registryHit: { cvrNumber: CVR_A, name: "Noget Helt Andet ApS" },
    }).verified,
    false,
  );
  const site = {
    name: "Nordhav Aqua",
    website: "https://nordhavaqua.no",
    registryHit: null,
    fetchedHost: "nordhavaqua.no",
    pageText: "Velkommen til Nordhav Aqua, oppdrett i Bergen",
  };
  assert.deepEqual(verifyWebCandidate(site), { verified: true, via: "website" });
  // www og underdomæne på samme registrerbare domæne er fint.
  assert.equal(verifyWebCandidate({ ...site, fetchedHost: "www.nordhavaqua.no" }).verified, true);
  // Siden nævner ikke navnet, eller domænet passer ikke til navnet.
  assert.equal(verifyWebCandidate({ ...site, pageText: "Cookie settings" }).verified, false);
  assert.equal(
    verifyWebCandidate({
      ...site,
      website: "https://helt-andet.com",
      fetchedHost: "helt-andet.com",
    }).verified,
    false,
  );
  assert.equal(verifyWebCandidate({ ...base, name: "X" }).verified, false);
});

test("verifyWebCandidate: lookalike-domæner og viderestillinger godkendes ikke", () => {
  const pleo = {
    name: "Pleo",
    registryHit: null,
    pageText: "Pleo is a spend management platform",
  };
  // Præfiks: 'pleo' må ikke godkende pleonasm.com (og omvendt).
  assert.equal(
    verifyWebCandidate({ ...pleo, website: "https://pleonasm.com", fetchedHost: "pleonasm.com" })
      .verified,
    false,
  );
  assert.equal(
    verifyWebCandidate({
      name: "Pleonasm",
      website: "https://pleo.io",
      registryHit: null,
      fetchedHost: "pleo.io",
      pageText: "Pleonasm",
    }).verified,
    false,
  );
  // Rigtigt domæne, men siden blev hentet et helt andet sted efter en viderestilling.
  assert.equal(
    verifyWebCandidate({ ...pleo, website: "https://pleo.io", fetchedHost: "evil-example.com" })
      .verified,
    false,
  );
  // Ukendt hentet vært er aldrig nok.
  assert.equal(
    verifyWebCandidate({ ...pleo, website: "https://pleo.io", fetchedHost: null }).verified,
    false,
  );
  // Det rigtige domæne virker.
  assert.equal(
    verifyWebCandidate({ ...pleo, website: "https://pleo.io", fetchedHost: "www.pleo.io" })
      .verified,
    true,
  );
  // For korte navne (under fire tegn) godkendes ikke på domænet alene.
  assert.equal(
    verifyWebCandidate({
      name: "AB",
      website: "https://ab.dk",
      registryHit: null,
      fetchedHost: "ab.dk",
      pageText: "AB",
    }).verified,
    false,
  );
});

test("fælles navneregler (screeningens trin 0): samme svar som før udtrækningen", () => {
  const agrees = buildNameAgrees({ brandName: "Too Good To Go", legalName: null });
  assert.equal(agrees("Too Good To Go ApS"), true);
  assert.equal(agrees("Accelerator Fonden"), false);

  assert.equal(
    anchorLegalName({
      extractedLegalName: "Accelerator Fonden",
      brandName: "Havbrug Nord",
      websiteHost: "havbrugnord.dk",
    }),
    null,
  );
  assert.equal(
    anchorLegalName({
      extractedLegalName: "Havbrug Nord ApS",
      brandName: "Havbrug Nord",
    }),
    "Havbrug Nord ApS",
  );

  const exact = cvrNameSignals({
    registryName: "Pleo ApS",
    context: { brandName: "Pleo" },
    fromMaterial: true,
  });
  assert.deepEqual(
    exact.map((s) => s.key),
    ["cvr_name_exact"],
  );
  const loose = cvrNameSignals({
    registryName: "Pleo Technologies A/S",
    context: { brandName: "Pleo" },
    fromMaterial: false,
  });
  assert.deepEqual(
    loose.map((s) => s.key),
    ["cvr_name_matches_brand"],
  );
  // Trin 0's juridiske navn tæller ikke som bevis, når nummeret stod i materialet.
  assert.deepEqual(
    cvrNameSignals({
      registryName: "Accelerator Fonden",
      context: { brandName: "Havbrug Nord", anchoredLegalName: "Accelerator Fonden" },
      fromMaterial: true,
    }).map((s) => s.key),
    ["cvr_name_matches_brand"],
  );
});
