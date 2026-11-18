import assert from "node:assert/strict";
import { test } from "node:test";
import { createDisplayNamer } from "../../display/display-names.ts";
import {
  createIdentifierMasker,
  fakeRegisterNumber,
  withIdentifiers,
} from "../../display/demo-identifiers.ts";
import type { ChatStreamEvent } from "../chat-contract.ts";
import { createEventAliaser } from "./display-events.ts";

const namer = createDisplayNamer([
  { kind: "company", real: "Veo Technologies ApS", alias: "Alder Labs" },
  { kind: "person", real: "Maria Holmgaard", alias: "Elin Vester" },
]);

const run = (events: ChatStreamEvent[]) => {
  const show = createEventAliaser(namer);
  return events.flatMap(show);
};

test("deltas, steps, sources and the title show the invented names; ids are untouched", () => {
  const out = run([
    { type: "thread", threadId: "t1", title: "Veo Technologies ApS review" },
    { type: "step", index: 0, text: "Reading Veo Technologies" },
    { type: "delta", text: "Maria Holm" },
    { type: "delta", text: "gaard leads Veo Techno" },
    { type: "delta", text: "logies." },
    {
      type: "sources",
      citations: [{ id: "c1", label: "Veo Technologies ApS deck" } as never],
    },
    { type: "done", messageId: "m1", missing: ["Maria Holmgaard's CV"] },
  ]);
  assert.equal(out[0]!.type === "thread" && out[0]!.title, "Alder Labs review");
  assert.equal(out[1]!.type === "step" && out[1]!.text, "Reading Alder Labs");
  const text = out
    .filter((e) => e.type === "delta")
    .map((e) => (e.type === "delta" ? e.text : ""))
    .join("");
  assert.equal(text, "Elin Vester leads Alder Labs.");
  assert.equal(JSON.stringify(out[out.length - 2]).includes("Alder Labs deck"), true);
  const done = out[out.length - 1]!;
  assert.equal(done.type === "done" && done.messageId, "m1");
  assert.deepEqual(done.type === "done" && done.missing, ["Elin Vester's CV"]);
});

test("text held back is sent before the next event that is not a delta", () => {
  const out = run([
    { type: "delta", text: "see Ma" },
    { type: "done", messageId: "m1" },
  ]);
  assert.deepEqual(
    out.map((e) => e.type),
    ["delta", "delta", "done"],
  );
  assert.equal(out.map((e) => (e.type === "delta" ? e.text : "")).join(""), "see Ma");
});

test("the whole demo view also hides web addresses and register numbers (T-769)", () => {
  const view = withIdentifiers(
    namer,
    createIdentifierMasker("fund-1", [
      {
        alias: "Alder Labs",
        website: "https://veo.dk",
        domains: [],
        registerNumbers: ["12345678"],
      },
    ]),
  );
  const fake = fakeRegisterNumber("fund-1", "12345678");
  const show = createEventAliaser(view);
  const out = [
    { type: "thread", threadId: "t1", title: "veo.dk og CVR 12345678" },
    { type: "step", index: 0, text: "Søger på nettet: site:veo.dk regnskab 12345678" },
    { type: "delta", text: "Se https://ve" },
    { type: "delta", text: "o.dk/om og CVR 12 34 " },
    { type: "delta", text: "56 78." },
    {
      type: "sources",
      citations: [{ id: "c1", label: "veo.dk", url: "https://www.veo.dk/a" } as never],
    },
    { type: "done", messageId: "m1", missing: ["Årsrapport for 12345678"] },
  ].flatMap((event) => show(event as ChatStreamEvent));
  const text = JSON.stringify(out);
  assert.ok(!text.includes("veo.dk") && !text.includes("12345678"), text);
  assert.ok(!/12 34 56 78/.test(text), text);
  const answer = out
    .filter((e) => e.type === "delta")
    .map((e) => (e.type === "delta" ? e.text : ""))
    .join("");
  assert.equal(answer, `Se https://alder-labs.example/om og CVR ${fake}.`);
  assert.equal(out[0]!.type === "thread" && out[0]!.title, `alder-labs.example og CVR ${fake}`);
  assert.equal(out[out.length - 1]!.type, "done");
});

test("without a demo view every event passes unchanged", () => {
  const show = createEventAliaser(null);
  const event: ChatStreamEvent = { type: "delta", text: "Veo Technologies ApS" };
  assert.deepEqual(show(event), [event]);
});
