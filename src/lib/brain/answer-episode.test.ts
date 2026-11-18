/** "Gem i Brain": hvad der gemmes af et svar. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerEpisodeDraft, answerHeading } from "./answer-episode.ts";
import { saveAnswerEpisode } from "./answer-episode.server.ts";
import { translate } from "../i18n/translate.ts";

const citations = [
  { n: 1, kind: "chunk", id: "c1", label: "Pleo · Note", quote: null, ref: "case_notes:n1" },
] as unknown as Parameters<typeof answerEpisodeDraft>[0]["citations"];

test("episoden består af spørgsmålet, svaret uden henvisningstal og kilderne ved navn", () => {
  const draft = answerEpisodeDraft({
    question: "  Hvor mange kunder   har Pleo? ",
    answer: "Pleo har 100 kunder [1].",
    citations,
  });
  assert.equal(draft.title, "Hvor mange kunder har Pleo?");
  assert.ok(draft.content.startsWith(answerHeading()));
  assert.match(draft.content, /Spørgsmål: Hvor mange kunder har Pleo\?/);
  assert.match(draft.content, /Pleo har 100 kunder\./);
  assert.doesNotMatch(draft.content, /\[1\]/);
  assert.match(draft.content, /Kilder: Pleo · Note/);
  assert.match(draft.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(draft.tokenCount, Math.ceil(draft.content.length / 4));
});

test("samme svar giver samme aftryk, et andet svar et andet", () => {
  const a = answerEpisodeDraft({ question: "q", answer: "Svar A.", citations: [] });
  assert.equal(
    a.contentHash,
    answerEpisodeDraft({ question: "q", answer: "Svar A.", citations: [] }).contentHash,
  );
  assert.notEqual(
    a.contentHash,
    answerEpisodeDraft({ question: "q", answer: "Svar B.", citations: [] }).contentHash,
  );
});

test("uden spørgsmål får episoden en fast titel, og et meget langt svar holder sig under lofterne", () => {
  const draft = answerEpisodeDraft({ question: null, answer: "Ord. ".repeat(3000), citations: [] });
  assert.equal(draft.title, "Svar fra Brain");
  assert.ok(draft.content.length <= 4100);
});

// 0091 rebuilds the sources line of a saved answer when a source is forgotten: it looks for the
// last "\n\nKilder: " / "\n\nSources: " and writes the deleted-source marker in that language.
test("kildelinjen står sidst med den begyndelse og markør, 0091 leder efter, på begge sprog", () => {
  const draft = answerEpisodeDraft({ question: "q", answer: "Svar [1].", citations });
  assert.ok(draft.content.endsWith("\n\nKilder: Pleo · Note"), draft.content);
  assert.equal(translate("da", "brainServer.notes.sources", { sources: "X" }), "Kilder: X");
  assert.equal(translate("en", "brainServer.notes.sources", { sources: "X" }), "Sources: X");
  assert.equal(translate("da", "brainServer.notes.deletedSource"), "[kilde slettet]");
  assert.equal(translate("en", "brainServer.notes.deletedSource"), "[source deleted]");
});

function rpcReturning(reply: { data: unknown; error: { code?: string; message: string } | null }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const service = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return reply;
    },
  } as unknown as Parameters<typeof saveAnswerEpisode>[0];
  return { service, calls };
}

const saveInput = {
  fundId: "f1",
  messageId: "m1",
  caseId: null,
  companyId: null,
  storedCitations: [{ n: 1, kind: "chunk", id: "c1", label: "Pleo · Note" }],
  draft: answerEpisodeDraft({ question: "q", answer: "Svar [1].", citations }),
};

test("Gem i Brain skriver i ét kald med de citater, teksten er bygget af (T-734)", async () => {
  const { service, calls } = rpcReturning({ data: true, error: null });
  assert.equal(await saveAnswerEpisode(service, saveInput), "saved");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.fn, "brain_save_answer_episode");
  assert.deepEqual(calls[0]!.args["_citations"], saveInput.storedCitations);
  assert.equal(calls[0]!.args["_content"], saveInput.draft.content);
  assert.equal(calls[0]!.args["_content_hash"], saveInput.draft.contentHash);
});

test("et gemt svar giver 'exists', ændrede kilder 'sources_changed', alt andet en fejl (T-734)", async () => {
  assert.equal(
    await saveAnswerEpisode(rpcReturning({ data: false, error: null }).service, saveInput),
    "exists",
  );
  assert.equal(
    await saveAnswerEpisode(
      rpcReturning({ data: null, error: { code: "40001", message: "sources changed" } }).service,
      saveInput,
    ),
    "sources_changed",
  );
  await assert.rejects(
    saveAnswerEpisode(
      rpcReturning({ data: null, error: { code: "P0002", message: "unknown answer" } }).service,
      saveInput,
    ),
    /unknown answer/,
  );
  await assert.rejects(
    saveAnswerEpisode(rpcReturning({ data: null, error: null }).service, saveInput),
    /unexpected reply/,
  );
});
