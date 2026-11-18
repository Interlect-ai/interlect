/** Test af founder-verifikationen. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFounders, founderClaim, mentionsPerson } from "./founder-check.ts";

test("hele navnet, store/små bogstaver og accenter matcher", () => {
  assert.equal(mentionsPerson("Grundlagt af METTE LYKKE i 2016", "Mette Lykke"), true);
  assert.equal(mentionsPerson("Søren Åberg er CTO", "Soren Aberg"), true);
});

test("mellemnavn imellem matcher, men enkeltnavne og delord gør ikke", () => {
  assert.equal(mentionsPerson("Anne Sofie Hansen leder salg", "Anne Hansen"), true);
  assert.equal(mentionsPerson("Hansen & co", "Hansen"), false);
  assert.equal(mentionsPerson("Annette Hansenberg", "Anne Hansen"), false);
});

test("status: offentlig kilde = korroboreret, kun website = virksomhedsoplyst", () => {
  const results = checkFounders({
    founders: [
      { name: "Mette Lykke", role: "CEO" },
      { name: "Jens Jensen", role: "CTO" },
      { name: "Ukendt Person", role: "COO" },
    ],
    websiteText: "Vores team: Mette Lykke (CEO) og Jens Jensen (CTO).",
    publicSources: [
      { url: "https://borsen.dk/a", text: "Mette Lykke fortæller om vækst i Too Good To Go" },
      { url: "https://borsen.dk/a", text: "Mette Lykke igen hos Too Good To Go" },
    ],
    companyNames: ["Too Good To Go"],
  });
  assert.deepEqual(
    results.map((result) => result.status),
    ["corroborated", "company_stated", "claimed"],
  );
  assert.deepEqual(results[0]!.publicSourceUrls, ["https://borsen.dk/a"]);
  assert.match(founderClaim(results[2]!), /kun påstået/);
});

test("navne matches aldrig på tværs af listeled eller sætninger", () => {
  assert.equal(mentionsPerson("Stiftere: Anders Holm, Peter Jensen", "Anders Jensen"), false);
  assert.equal(mentionsPerson("Anders og Mette Jensen", "Anders Jensen"), false);
  assert.equal(
    mentionsPerson("Direktør er Anders. Jensen Holding ejer 40%.", "Anders Jensen"),
    false,
  );
});

test("en offentlig kilde tæller kun, når selskabet også nævnes", () => {
  const results = checkFounders({
    founders: [{ name: "Anders Jensen", role: "CEO" }],
    websiteText: "",
    publicSources: [{ url: "https://x.dk/a", text: "Anders Jensen vandt et løb i Aarhus" }],
    companyNames: ["Acme"],
  });
  assert.equal(results[0]!.status, "claimed");
});
