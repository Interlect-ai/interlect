import { test } from "node:test";
import assert from "node:assert/strict";
import { answerNoteBody, NOTE_MAX, noteHeading } from "./answer-note.ts";
import type { ChatCitation } from "./chat-contract.ts";

const UUID = "00000000-0000-4000-8000-000000000001";
const citations: ChatCitation[] = [
  { n: 2, kind: "fact", id: "f1", label: "Omsætningen steg 40 % i 2025" },
  { n: 1, kind: "case", id: UUID, label: "Pleo" },
];

test("noten er mærket Brain, har spørgsmålet og kilderne ved navn, ingen [n]", () => {
  const body = answerNoteBody({
    question: "Hvorfor  sagde vi nej?",
    answer:
      "I sagde nej på grund af kundekoncentration [1]. Væksten var god [2].\n\n- første\n- anden",
    citations,
  });
  assert.ok(body.startsWith(`${noteHeading()}\nSpørgsmål: Hvorfor sagde vi nej?`));
  assert.ok(!/\[\d+\]/.test(body), "ingen citatmærker i noten");
  assert.ok(body.includes("- første"));
  assert.ok(body.endsWith("Kilder: Pleo; Omsætningen steg 40 % i 2025"), "kilder i rækkefølge");
});

test("en slettet kilde nævnes ikke ved navn", () => {
  const body = answerNoteBody({
    question: null,
    answer: "Svar [1].",
    citations: [{ n: 1, kind: "fact", id: "f", label: "Hemmeligt navn", deleted: true }],
  });
  assert.ok(!body.includes("Hemmeligt navn"));
  assert.ok(body.includes("[kilde slettet]"));
  assert.ok(!body.includes("Spørgsmål:"));
});

test("et langt svar forkortes ved et afsnit og siger det, under notens grænse", () => {
  const paragraph = "Dette er en lang sætning om casen, som gentages. ".repeat(20).trim();
  const answer = Array.from({ length: 12 }, () => paragraph).join("\n\n");
  const body = answerNoteBody({ question: "Kort?", answer, citations });
  assert.ok(body.length <= NOTE_MAX, `længde ${body.length}`);
  assert.ok(body.includes("(Forkortet. Hele svaret står i samtalen i Brain.)"));
  assert.ok(body.endsWith("Kilder: Pleo; Omsætningen steg 40 % i 2025"), "kilderne bevares");
});

test("et svar uden kilder har ingen kildelinje", () => {
  const body = answerNoteBody({
    question: "Q",
    answer: "Det ved Brain ikke endnu.",
    citations: [],
  });
  assert.equal(body, `${noteHeading()}\nSpørgsmål: Q\n\nDet ved Brain ikke endnu.`);
});
