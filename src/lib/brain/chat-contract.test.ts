/** Test af chat-kontrakten, tråde og sikker tekstvisning. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanFeedback,
  chatErrorFromStatus,
  chatErrorText,
  parseChatStreamEvent,
  parseChatStreamLine,
  parseCitation,
  splitNdjson,
} from "./chat-contract.ts";
import {
  cleanModelText,
  parseModelText,
  plainTextOf,
  safeExternalHref,
  safeInternalHref,
  trimStreamingTail,
  unmatchedCitationNumbers,
} from "./chat-text.ts";
import {
  canDeleteThread,
  canEditThread,
  deriveThreadTitle,
  groupThreads,
  threadTitle,
} from "./threads.ts";
import type { BrainThreadSummary } from "./chat-contract.ts";

// --- contract guards -------------------------------------------------------------------

test("gyldige hændelser parses", () => {
  assert.deepEqual(parseChatStreamEvent({ type: "delta", text: "Hej" }), {
    type: "delta",
    text: "Hej",
  });
  assert.deepEqual(parseChatStreamEvent({ type: "step", index: 1, text: "Leder" }), {
    type: "step",
    index: 1,
    text: "Leder",
  });
  assert.equal(
    parseChatStreamEvent({ type: "thread", threadId: "t1", title: "x" })?.type,
    "thread",
  );
  const done = parseChatStreamEvent({
    type: "done",
    messageId: "m1",
    confidence: "high",
    missing: ["Upload statusrapport", 3],
    unsourcedClaims: true,
  });
  assert.deepEqual(done, {
    type: "done",
    messageId: "m1",
    confidence: "high",
    missing: ["Upload statusrapport"],
    unsourcedClaims: true,
  });
});

test("ugyldige hændelser ignoreres", () => {
  for (const bad of [
    null,
    "tekst",
    [],
    { type: "delta" },
    { type: "delta", text: "" },
    { type: "delta", text: 5 },
    { type: "step", index: -1, text: "x" },
    { type: "step", index: 1.5, text: "x" },
    { type: "done" },
    { type: "ukendt" },
    { type: "thread" },
  ]) {
    assert.equal(parseChatStreamEvent(bad), null, JSON.stringify(bad));
  }
});

test("ukendt fejlkode bliver 'failed', og serverens besked tabes", () => {
  const event = parseChatStreamEvent({
    type: "error",
    code: "SQLSTATE 42P01",
    message: "raw db error",
  });
  assert.deepEqual(event, { type: "error", code: "failed" });
  assert.match(chatErrorText("failed"), /Prøv igen/);
  assert.deepEqual(parseChatStreamEvent({ type: "error", code: "blocked_by_policy" }), {
    type: "error",
    code: "blocked_by_policy",
  });
  assert.match(chatErrorText("blocked_by_policy"), /datasikkerhed/);
  assert.doesNotMatch(chatErrorText("budget_reached"), /error|exception|sql/i);
});

test("kilder: ugyldige elementer fjernes, gyldige beholdes", () => {
  const event = parseChatStreamEvent({
    type: "sources",
    citations: [
      { n: 1, kind: "case", id: "c1", label: "Pleo" },
      { n: 0, kind: "case", id: "c2", label: "nul" },
      { n: 2, kind: "script", id: "c3", label: "forkert slags" },
      { n: 3, kind: "fact", id: "f1", label: "Fakta", quote: "ordret", trust: "company_claim" },
      "streng",
    ],
  });
  assert.equal(event?.type, "sources");
  if (event?.type !== "sources") return;
  assert.deepEqual(
    event.citations.map((c) => c.n),
    [1, 3],
  );
  assert.equal(event.citations[1]?.trust, "company_claim");
  assert.equal(parseCitation({ n: 1, kind: "web", id: "w", label: "  " })?.label, "Kilde");
});

test("NDJSON: linjer delt midt i en chunk samles, ødelagte linjer ignoreres", () => {
  const first = splitNdjson('{"type":"delta","text":"A"}\n{"type":"del');
  assert.equal(first.lines.length, 1);
  const second = splitNdjson(first.rest + 'ta","text":"B"}\n');
  assert.equal(parseChatStreamLine(second.lines[0]!)?.type, "delta");
  assert.equal(second.rest, "");
  assert.equal(parseChatStreamLine("{ikke json"), null);
  assert.equal(parseChatStreamLine("   "), null);
});

test("HTTP-afvisninger før strømmen starter får en fast kode", () => {
  assert.equal(chatErrorFromStatus(401), "signed_out");
  assert.equal(chatErrorFromStatus(403), "forbidden");
  assert.equal(chatErrorFromStatus(429), "rate_limited");
  assert.equal(chatErrorFromStatus(500), "failed");
});

// --- safe text ---------------------------------------------------------------------------

const valid = new Set([1, 2]);

test("afsnit, lister og fed tekst; ingen HTML", () => {
  const blocks = parseModelText(
    "Første afsnit med **fed** tekst [1].\n\n- punkt a\n- punkt b [2]\n\n1. et\n2. to\n\n<script>alert(1)</script>",
    valid,
  );
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0]?.t, "p");
  assert.equal(blocks[1]?.t, "ul");
  assert.equal(blocks[2]?.t, "ol");
  const last = blocks[3];
  assert.equal(last?.t, "p");
  if (last?.t === "p")
    assert.deepEqual(last.inline, [{ t: "text", text: "<script>alert(1)</script>" }]);
});

test("[n] uden kilde vises ikke; med kilde bliver det en markør", () => {
  const [block] = parseModelText("Påstand [1] og [7] og [1, 2].", valid);
  assert.equal(block?.t, "p");
  if (block?.t !== "p") return;
  const cites = block.inline.filter((i) => i.t === "cite").map((i) => (i.t === "cite" ? i.n : 0));
  assert.deepEqual(cites, [1, 1, 2]);
  assert.deepEqual(unmatchedCitationNumbers("a [1] b [7] c [9, 1]", valid), [7, 9]);
});

test("et droppet [n] efterlader ikke et mellemrum før tegnsætning", () => {
  const [block] = parseModelText("Næste har ingen [9]. Og så [8], videre.", valid);
  assert.equal(block?.t, "p");
  if (block?.t === "p") {
    assert.equal(
      block.inline.map((i) => (i.t === "cite" ? "" : i.text)).join(""),
      "Næste har ingen. Og så, videre.",
    );
  }
});

test("billeder droppes, eksterne links bliver ren tekst, interne stier bliver links", () => {
  const [block] = parseModelText(
    "![spion](https://evil.test/x.png)Se [her](https://evil.test/a) og [casen](/cases/abc-123) og [js](javascript:alert).",
    valid,
  );
  assert.equal(block?.t, "p");
  if (block?.t !== "p") return;
  const links = block.inline.filter((i) => i.t === "link");
  assert.deepEqual(links, [{ t: "link", text: "casen", href: "/cases/abc-123" }]);
  const text = block.inline.map((i) => (i.t === "cite" ? "" : i.text)).join("");
  assert.doesNotMatch(text, /evil\.test|!\[|javascript:/);
  assert.match(text, /Se her og casen og js\./);
});

test("safeInternalHref og safeExternalHref", () => {
  assert.equal(safeInternalHref("/cases/abc"), "/cases/abc");
  assert.equal(safeInternalHref("//evil.test"), null);
  assert.equal(safeInternalHref("https://evil.test"), null);
  assert.equal(safeInternalHref("/admin/secret"), null);
  assert.equal(safeExternalHref("https://example.test/a"), "https://example.test/a");
  assert.equal(safeExternalHref("javascript:alert(1)"), null);
  assert.equal(safeExternalHref("data:text/html,x"), null);
  assert.equal(safeExternalHref(null), null);
});

test("kontroltegn og bidi-overstyring fjernes", () => {
  assert.equal(cleanModelText("a‮b\u0000c​d\r\ne"), "abcd\ne");
});

test("streaming: en uafsluttet markør i enden vises ikke", () => {
  assert.equal(trimStreamingTail("Svar [1"), "Svar ");
  assert.equal(trimStreamingTail("Svar [1, 2"), "Svar ");
  assert.equal(trimStreamingTail("Svar **fe"), "Svar **fe");
  assert.equal(trimStreamingTail("Svar *"), "Svar ");
  const [block] = parseModelText("Svar [1", valid, { streaming: true });
  assert.equal(block?.t, "p");
  if (block?.t === "p") assert.deepEqual(block.inline, [{ t: "text", text: "Svar " }]);
});

test("streaming: modeltekst med mange kommaer i en klamme fryser ikke fanen", () => {
  const hostile = `Svar: [${" , ".repeat(400)}] og mere tekst [${" , ".repeat(400)}`;
  const started = performance.now();
  trimStreamingTail(hostile);
  parseModelText(hostile, valid, { streaming: true });
  assert.ok(performance.now() - started < 50, "tail trimming must stay linear");
});

test("Kopiér: ingen markører eller markdown", () => {
  const text = plainTextOf("Hej **verden** [1].\n\n- a [2]\n- b", valid);
  assert.equal(text, "Hej verden.\n\n- a\n- b");
});

// --- threads -----------------------------------------------------------------------------

const thread = (over: Partial<BrainThreadSummary>): BrainThreadSummary => ({
  id: "t",
  title: "Titel",
  visibility: "private",
  caseId: null,
  caseName: null,
  isMine: true,
  ownerName: null,
  lastActivityAt: "2026-10-02T10:00:00Z",
  ...over,
});

test("grupper: I dag, Tidligere og Delt i team (kun når der er en)", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const groups = groupThreads(
    [
      thread({ id: "a", lastActivityAt: "2026-10-02T09:00:00Z" }),
      thread({ id: "b", lastActivityAt: "2026-10-01T09:00:00Z" }),
      thread({ id: "c", lastActivityAt: "2026-10-02T11:00:00Z" }),
      thread({ id: "d", isMine: false, visibility: "team", ownerName: "Mette" }),
      thread({ id: "e", isMine: true, visibility: "team", lastActivityAt: "2026-09-01T09:00:00Z" }),
    ],
    now,
  );
  assert.deepEqual(
    groups.map((g) => [g.key, g.threads.map((t) => t.id)]),
    [
      ["today", ["c", "a"]],
      ["earlier", ["b", "e"]],
      ["team", ["d"]],
    ],
  );
  assert.deepEqual(
    groupThreads([thread({ lastActivityAt: "2026-10-01T09:00:00Z" })], now).map((g) => g.key),
    ["earlier"],
  );
  assert.deepEqual(groupThreads([], now), []);
});

test("midnat følger dansk tid, ikke UTC", () => {
  // 21:30 UTC = 23:30 den 2. okt. i København; kl. 22:30 UTC er det allerede den 3. okt. dér.
  const item = [thread({ lastActivityAt: "2026-10-02T21:30:00Z" })];
  assert.equal(groupThreads(item, new Date("2026-10-02T21:45:00Z"))[0]?.key, "today");
  assert.equal(groupThreads(item, new Date("2026-10-02T22:30:00Z"))[0]?.key, "earlier");
});

test("titler: første ca. 60 tegn, hele ord, tom titel bliver 'Ny samtale'", () => {
  assert.equal(
    deriveThreadTitle("  Hvorfor sagde vi nej\n til de seneste cases? "),
    "Hvorfor sagde vi nej til de seneste cases?",
  );
  const long = deriveThreadTitle(
    "Hvorfor sagde vi nej til de seneste cases i år, og hvad havde de til fælles ud over stadiet?",
  );
  assert.ok(long.length <= 61 && long.endsWith("…"), long);
  assert.equal(threadTitle({ title: null }), "Ny samtale");
  assert.equal(threadTitle({ title: "  " }), "Ny samtale");
});

test("rettigheder: ejeren redigerer; Admin sletter kun andres team-tråde", () => {
  assert.equal(canEditThread({ isMine: true }), true);
  assert.equal(canEditThread({ isMine: false }), false);
  assert.equal(canDeleteThread({ isMine: true, visibility: "private" }, false), true);
  assert.equal(canDeleteThread({ isMine: false, visibility: "team" }, true), true);
  assert.equal(canDeleteThread({ isMine: false, visibility: "team" }, false), false);
  assert.equal(canDeleteThread({ isMine: false, visibility: "private" }, true), false);
});

test("T-104: feedback gemmer kun kilder, svaret citerer, og kun ved 'wrong'", () => {
  const cited = new Set<unknown>([1, 2, 5]);
  assert.deepEqual(cleanFeedback("wrong", [5, 1, 1, 9], "  for gammelt  ", cited), {
    wrongCitationNs: [1, 5],
    comment: "for gammelt",
  });
  assert.deepEqual(cleanFeedback("incomplete", [1], "mangler tal", cited), {
    wrongCitationNs: [],
    comment: "mangler tal",
  });
  assert.deepEqual(cleanFeedback("useful", [1], "fint", cited), {
    wrongCitationNs: [],
    comment: null,
  });
  assert.equal(cleanFeedback("wrong", undefined, "x".repeat(2000), cited).comment?.length, 1000);
  assert.deepEqual(cleanFeedback("wrong", [], "   ", cited).comment, null);
});
