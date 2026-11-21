/** Fingeraftryk af prompten pr. kørsel. Kør: npm test */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promptFingerprint, runPromptFingerprint } from "./prompt-fingerprint.ts";

describe("promptFingerprint (T-1039)", () => {
  const base = { system: "Du er Interlect.", user: "Tese: B2B SaaS i Norden." };

  it("is stable for the same prompt", () => {
    assert.equal(promptFingerprint(base), promptFingerprint({ ...base }));
    assert.match(promptFingerprint(base), /^[0-9a-f]{64}$/);
  });

  it("changes when the team's text in the prompt changes", () => {
    const changed = promptFingerprint({ ...base, user: "Tese: B2B SaaS i Baltikum." });
    assert.notEqual(changed, promptFingerprint(base));
  });

  it("does not mix up system and user text", () => {
    assert.notEqual(
      promptFingerprint({ system: "ab", user: "c" }),
      promptFingerprint({ system: "a", user: "bc" }),
    );
  });

  it("includes the answer schema when given", () => {
    const withSchema = promptFingerprint({ ...base, schema: { type: "object" } });
    assert.notEqual(withSchema, promptFingerprint(base));
  });
});

describe("runPromptFingerprint (T-1039)", () => {
  it("keeps a single call's fingerprint", () => {
    assert.equal(runPromptFingerprint([{ stepKey: "fund_screening", fingerprint: "abc" }]), "abc");
  });

  it("ignores the order the calls finished in", () => {
    const a = { stepKey: "market", fingerprint: "1" };
    const b = { stepKey: "team", fingerprint: "2" };
    assert.equal(runPromptFingerprint([a, b]), runPromptFingerprint([b, a]));
  });

  it("changes when one specialist's prompt changes", () => {
    const market = { stepKey: "market", fingerprint: "1" };
    assert.notEqual(
      runPromptFingerprint([market, { stepKey: "team", fingerprint: "2" }]),
      runPromptFingerprint([market, { stepKey: "team", fingerprint: "3" }]),
    );
  });

  it("is null without any call", () => {
    assert.equal(runPromptFingerprint([]), null);
    assert.equal(runPromptFingerprint([{ stepKey: "research", fingerprint: null }]), null);
  });
});
