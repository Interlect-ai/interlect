/** No extra namesake searches without an identity anchor. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  identityAnchor,
  noIdentityAnchorGap,
  suggestedMatch,
  type StoredIdentity,
} from "./identity-anchor.ts";

const none: StoredIdentity = {
  website: null,
  domains: null,
  cvrNumber: null,
  registryNumber: null,
  identityStatus: "unverified",
};
const noMaterial = { domains: [], cvrNumbers: [] };

test("a website, a register number or the case's own material anchors the identity", () => {
  assert.equal(
    identityAnchor({ website: "https://kvantify.com", stored: none, extraction: null }),
    "website",
  );
  assert.equal(
    identityAnchor({ website: null, stored: { ...none, domains: ["pleo.io"] }, extraction: null }),
    "website",
  );
  assert.equal(
    identityAnchor({ website: null, stored: { ...none, cvrNumber: "54562519" }, extraction: null }),
    "registry",
  );
  assert.equal(
    identityAnchor({
      website: null,
      stored: { ...none, registryNumber: "559012-3456", identityStatus: "probable" },
      extraction: null,
    }),
    "registry",
  );
  assert.equal(
    identityAnchor({
      website: null,
      stored: none,
      extraction: { domains: ["acme.dk"], cvrNumbers: [] },
    }),
    "material",
  );
  assert.equal(
    identityAnchor({
      website: null,
      stored: null,
      extraction: { domains: [], cvrNumbers: ["12345678"] },
    }),
    "material",
  );
});

test("a name alone, blanks or a rejected register match is no anchor", () => {
  // The made-up "Nordlys Analytics": no website, no register number, no material.
  assert.equal(identityAnchor({ website: null, stored: none, extraction: null }), null);
  assert.equal(identityAnchor({ website: null, stored: null, extraction: noMaterial }), null);
  assert.equal(
    identityAnchor({
      website: "  ",
      stored: { ...none, website: "", domains: [" "] },
      extraction: { domains: [""], cvrNumbers: [" "] },
    }),
    null,
  );
  // A register match a human rejected anchors nothing (the number belongs to someone else).
  assert.equal(
    identityAnchor({
      website: null,
      stored: { ...none, cvrNumber: "54562519", identityStatus: "rejected" },
      extraction: null,
    }),
    null,
  );
  assert.match(noIdentityAnchorGap(), /foreslået match/);
});

test("the research gates the plan's questions, the follow-up and the entity mark on the anchor", () => {
  const source = readFileSync(new URL("./public-research.ts", import.meta.url), "utf8");
  const anchorAt = source.indexOf("const anchor = identityAnchor({");
  assert.ok(anchorAt > 0);
  // The anchor is known before the plan's questions are added to the tracks.
  const modulesAt = source.indexOf("const modules: readonly ResearchModule[] =");
  assert.ok(modulesAt > anchorAt);
  // The plan's questions reach the tracks only through the ZDR step (always),
  // and only with an anchor.
  const modulesCode = source.slice(modulesAt, modulesAt + 600);
  assert.match(
    modulesCode,
    /planCandidates: anchor \? \(neutral\?\.planCandidates \?\? \[\]\) : \[\]/,
  );
  assert.match(
    source,
    /if \(input\.researchPlan && followUpTier && input\.fundResearchBrief && maxRounds > 0 && anchor\)/,
  );
  assert.match(source, /\.\.\.\(anchor \? \[\] : \[noIdentityAnchorGap\(\)\]\)/);
  assert.match(source, /const isSuggested = suggestedMatch\(packets, anchor\);/);
  assert.match(
    source,
    /entity_match_status: isSuggested\(source\.url\) \? "suggested" : "confirmed"/,
  );
});

const track = (identityAmbiguity: string | null, ...urls: string[][]) => ({
  identityAmbiguity,
  findings: urls.map((sources) => ({ sources: sources.map((url) => ({ url })) })),
});

test("T-733: only the sources of the track that was unsure are a suggested match", () => {
  const tracks = [
    track(null, ["https://kvantify.com/about"], ["https://techcrunch.com/kvantify-raise"]),
    track("To selskaber hedder Kvantify: et dansk ApS og et svensk AB.", [
      "https://www.allabolag.se/kvantify-ab",
    ]),
    track("  ", ["https://borsen.dk/kvantify"]),
  ];
  const isSuggested = suggestedMatch(tracks, "website");
  assert.equal(isSuggested("https://kvantify.com/about"), false);
  assert.equal(isSuggested("https://techcrunch.com/kvantify-raise"), false);
  // A blank doubt is no doubt.
  assert.equal(isSuggested("https://borsen.dk/kvantify"), false);
  assert.equal(isSuggested("https://www.allabolag.se/kvantify-ab"), true);
  // The same source, written as the grounding normalizes it, is the same source.
  assert.equal(isSuggested("https://www.allabolag.se/kvantify-ab/?utm_source=x#top"), true);
});

test("T-733: a source cited by an unsure and a sure track stays suggested", () => {
  const shared = "https://www.proff.dk/firma/kvantify";
  const isSuggested = suggestedMatch(
    [track(null, [shared]), track("Navnet deles med et norsk AS.", [shared])],
    "registry",
  );
  assert.equal(isSuggested(shared), true);
});

test("T-733: no track in doubt means every source is confirmed; no anchor means none is (T-732)", () => {
  const sure = [track(null, ["https://pleo.io"], ["https://dealroom.co/pleo"])];
  assert.equal(suggestedMatch(sure, "material")("https://pleo.io"), false);
  assert.equal(suggestedMatch(sure, "material")("https://dealroom.co/pleo"), false);
  // The made-up "Nordlys Analytics": no anchor, so every source is suggested, also with no doubt.
  assert.equal(suggestedMatch(sure, null)("https://pleo.io"), true);
  assert.equal(suggestedMatch([], null)("https://nordlys.it"), true);
});
