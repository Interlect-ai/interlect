/** Sidetitler og beskrivelser i fondens sprog. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageForRoutes, pageHead, pageMeta } from "./page-head.ts";

test("head() renders the Danish title and description as before", () => {
  assert.deepEqual(pageMeta("users"), [
    { title: "Brugere og adgang — Interlect" },
    {
      name: "description",
      content:
        "Inviterede brugere og roller: Admin, Lead, Medlem og Læser. Ingen offentlig registrering.",
    },
  ]);
  // A page without its own description keeps the app's (from the root route).
  assert.deepEqual(pageMeta("overview"), [{ title: "Overblik - Interlect" }]);
});

test("the browser shows the title and description in the fund's language", () => {
  assert.deepEqual(pageHead("fundSetup", "en"), {
    title: "Team setup — Interlect",
    description: "Choose and review the mandate Interlect uses for screening and deep analysis.",
  });
  assert.equal(
    pageHead("overview", "en").description,
    "Evidence-driven AI venture analyst configured for one investment thesis at a time.",
  );
});

test("the deepest matched route decides the page; internal pages have none", () => {
  assert.equal(pageForRoutes(["__root__", "/cases", "/cases/$caseId"]), "case");
  assert.equal(pageForRoutes(["__root__", "/fond", "/fond/ny"]), "newThesis");
  assert.equal(pageForRoutes(["__root__", "/intern/grafer"]), null);
});
