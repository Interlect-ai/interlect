import assert from "node:assert/strict";
import { test } from "node:test";
import { groundFindings, normalizeSourceUrl, snapToRetrievedUrl } from "./source-grounding.ts";

// Real URLs from the live research test on Pleo.
const PLEO_FILING =
  "https://regnskaber.cvrapi.dk/xhtml/72141193/amNsb3VkczovLzAzLzgwLzUzL2I5L2FhLzUyYWUtNDRiMy1hM2U3LWY3MWY2NGQxYWU3MQ.pdf";
const OTHER_FILING =
  "https://regnskaber.cvrapi.dk/xhtml/68683563/amNsb3VkczovLzAzLzhmLzM5LzQyLzhlL2Q4YjUtNDBjNi1hMTg5LTQ1OTNlMTJmNjM2Ng.pdf";
const LASSO =
  "https://lasso.dk/api/company/report?id=68683563/amNsb3VkczovLzAzL2E0LzY0L2M0LzQ4LzBmYWYtNDUzMS1hMWM5LWYwZjlhZWUzZWQ1Yg.pdf";
// What the model wrote instead of PLEO_FILING: the token re-encoded with small slips.
const GARBLED_FILING =
  "https://regnskaber.cvrapi.dk/xhtml/72141193/amNsbG91ZHM6Ly8wMy84MC81My9iOS9hYS81MmFlLTQ0YjMtYTNlNy1mNzFmNjRkMWFlNzEucGRm";
const GARBLED_TWICE =
  "https://regnskaber.cvrapi.dk/xhtml/72141193/amNsbG91ZHM6Ly8wMy84MC81My9iOS9hYS81MmFlLTQ0YjMtYTNlNy1hM2U3LWY3MWY2NGQxYWU3MQ.pdf";

const retrieved = new Set(
  [
    PLEO_FILING,
    OTHER_FILING,
    LASSO,
    "https://www.pleo.io/en/about",
    "https://sacra.com/c/pleo",
  ].map(normalizeSourceUrl),
);

test("a retrieved URL is kept as it is, also with a trailing slash, tracking parameters or a fragment", () => {
  assert.equal(
    snapToRetrievedUrl("https://www.pleo.io/en/about/", retrieved),
    "https://www.pleo.io/en/about",
  );
  assert.equal(
    snapToRetrievedUrl("https://www.pleo.io/en/about?utm_source=x#top", retrieved),
    "https://www.pleo.io/en/about",
  );
});

test("a filing URL the model re-encoded with slips snaps to the filing it is a copy of", () => {
  assert.equal(snapToRetrievedUrl(GARBLED_FILING, retrieved), normalizeSourceUrl(PLEO_FILING));
  assert.equal(snapToRetrievedUrl(GARBLED_TWICE, retrieved), normalizeSourceUrl(PLEO_FILING));
});

test("a URL that was never retrieved is not made up into a retrieved one", () => {
  const techcrunch =
    "https://techcrunch.com/2021/07/05/pleo-raises-150m-at-1-7b-valuation-for-its-new-approach-to-managing-expenses-for-smbs/";
  assert.equal(snapToRetrievedUrl(techcrunch, retrieved), null);
  // Same host as a retrieved page, but another page: not a copy.
  assert.equal(
    snapToRetrievedUrl("https://sacra.com/research/ramp-for-europe-vs-ramp", retrieved),
    null,
  );
  assert.equal(snapToRetrievedUrl("https://www.pleo.io/en/careers", retrieved), null);
  assert.equal(snapToRetrievedUrl("not a url", retrieved), null);
});

test("a token of another company's filing is never snapped to this one's", () => {
  const unrelated =
    "https://regnskaber.cvrapi.dk/xhtml/99999999/amNsb3VkczovLzAzL2ZmL2ZmL2ZmL2ZmL2ZmLTExMTEtMjIyMi0zMzMzLTQ0NDQ1NTU1NjY2Ng.pdf";
  assert.equal(snapToRetrievedUrl(unrelated, retrieved), null);
});

test("when two retrieved URLs fit equally well nothing is guessed", () => {
  const base = "https://regnskaber.cvrapi.dk/xhtml/72141193/";
  const twinA = "amNsb3VkczovLzAzLzgwLzUzL2I5L2FhLzUyYWUtNDRiMy1hM2U3LWY3MWY2NGQxYWU3MQ.pdf";
  const twinB = "amNsb3VkczovLzAzLzgwLzUzL2I5L2FhLzUyYWUtNDRiMy1hM2U3LWY3MWY2NGQxYWU4MQ.pdf";
  const twins = new Set([`${base}${twinA}`, `${base}${twinB}`].map(normalizeSourceUrl));
  const garbled = `${base}amNsb3VkczovLzAzLzgwLzUzL2I5L2FhLzUyYWUtNDRiMy1hM2U3LWY3MWY2NGQxYWU5MQ.pdf`;
  assert.equal(snapToRetrievedUrl(garbled, twins), null);
});

test("a finding keeps its retrieved sources, with garbled ones corrected", () => {
  const result = groundFindings(
    [
      {
        statement: "Omsætning",
        sources: [
          { url: GARBLED_FILING, title: "Årsrapport" },
          { url: "https://techcrunch.com/x", title: "TC" },
        ],
      },
    ],
    retrieved,
  );
  assert.equal(result.dropped, 0);
  assert.equal(result.snapped, 1);
  assert.deepEqual(
    result.findings[0]?.sources.map((s) => s.url),
    [normalizeSourceUrl(PLEO_FILING)],
  );
  assert.equal(result.findings[0]?.sources[0]?.title, "Årsrapport");
});

test("a finding with no retrieved source is dropped, and the module's other findings survive", () => {
  const result = groundFindings(
    [
      { statement: "Rejse 150 mio.", sources: [{ url: "https://techcrunch.com/2021/07/05/pleo" }] },
      { statement: "Om os", sources: [{ url: "https://www.pleo.io/en/about" }] },
    ],
    retrieved,
  );
  assert.equal(result.dropped, 1);
  assert.deepEqual(
    result.findings.map((f) => f.statement),
    ["Om os"],
  );
});

test("two sources that snap to the same URL are not cited twice", () => {
  const result = groundFindings(
    [{ statement: "x", sources: [{ url: GARBLED_FILING }, { url: GARBLED_TWICE }] }],
    retrieved,
  );
  assert.equal(result.findings[0]?.sources.length, 1);
});

test("a readable URL that differs in a year or an id is never taken for the retrieved one (review finding)", () => {
  const readable = new Set(
    [
      "https://example.com/blog/annual-report-2023",
      "https://virk.dk/cvr/72141193/2023/aarsrapport.pdf",
      "https://proff.dk/regnskab/pleo/72141193/2023",
    ].map(normalizeSourceUrl),
  );
  assert.equal(snapToRetrievedUrl("https://example.com/blog/annual-report-2022", readable), null);
  assert.equal(
    snapToRetrievedUrl("https://virk.dk/cvr/72141193/2022/aarsrapport.pdf", readable),
    null,
  );
  assert.equal(snapToRetrievedUrl("https://proff.dk/regnskab/pleo/72141193/2020", readable), null);
});

test("only the opaque token may differ: the same token with another year in the path does not snap", () => {
  const token = "amNsb3VkczovLzAzLzgwLzUzL2I5L2FhLzUyYWUtNDRiMy1hM2U3LWY3MWY2NGQxYWU3MQ.pdf";
  const retrieved2023 = new Set(
    [`https://filings.example/2023/72141193/${token}`].map(normalizeSourceUrl),
  );
  assert.equal(
    snapToRetrievedUrl(`https://filings.example/2022/72141193/${token}`, retrieved2023),
    null,
  );
  assert.equal(
    snapToRetrievedUrl(
      "https://filings.example/2023/72141193/amNsbG91ZHM6Ly8wMy84MC81My9iOS9hYS81MmFlLTQ0YjMtYTNlNy1mNzFmNjRkMWFlNzEucGRm",
      retrieved2023,
    ),
    normalizeSourceUrl(`https://filings.example/2023/72141193/${token}`),
  );
});

test("the log counts rejected sources, not a garbled copy of a retrieved one", () => {
  const result = groundFindings(
    [
      { statement: "a", sources: [{ url: GARBLED_FILING }, { url: PLEO_FILING }] },
      { statement: "b", sources: [{ url: "https://techcrunch.com/x" }] },
    ],
    retrieved,
  );
  assert.equal(result.rejectedSources, 1);
  assert.equal(result.snapped, 1);
  assert.deepEqual(result.droppedStatements, ["b"]);
});
