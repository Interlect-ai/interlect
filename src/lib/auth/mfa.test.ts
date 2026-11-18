import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasVerifiedFactor,
  isTotpCode,
  mfaSatisfied,
  mfaStep,
  normalizeTotpCode,
  tokenAal,
} from "./mfa.ts";

function token(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode(claims)}.signature`;
}

test("tokenAal reads the claim and never throws on a bad token", () => {
  assert.equal(tokenAal(token({ sub: "u", aal: "aal2" })), "aal2");
  assert.equal(tokenAal(token({ sub: "u", aal: "aal1" })), "aal1");
  assert.equal(tokenAal(token({ sub: "u" })), null);
  assert.equal(tokenAal("not-a-token"), null);
  assert.equal(tokenAal("a.%%%.c"), null);
});

test("only a verified factor demands aal2", () => {
  const aal1 = token({ aal: "aal1" });
  const aal2 = token({ aal: "aal2" });
  assert.equal(hasVerifiedFactor(undefined), false);
  assert.equal(hasVerifiedFactor([{ status: "unverified" }]), false);
  assert.equal(mfaSatisfied([], aal1), true);
  assert.equal(mfaSatisfied([{ status: "unverified" }], aal1), true);
  assert.equal(mfaSatisfied([{ status: "verified" }], aal1), false);
  assert.equal(mfaSatisfied([{ status: "verified" }], token({})), false);
  assert.equal(mfaSatisfied([{ status: "verified" }], aal2), true);
});

test("the next step follows the assurance levels", () => {
  assert.equal(mfaStep({ currentLevel: "aal2", nextLevel: "aal2" }), "ok");
  assert.equal(mfaStep({ currentLevel: "aal1", nextLevel: "aal2" }), "challenge");
  assert.equal(mfaStep({ currentLevel: "aal1", nextLevel: "aal1" }), "enroll");
  assert.equal(mfaStep({ currentLevel: null, nextLevel: null }), "enroll");
});

test("codes are six digits; spaces and dashes are ignored", () => {
  assert.equal(normalizeTotpCode(" 123 456 "), "123456");
  assert.equal(normalizeTotpCode("123-456"), "123456");
  assert.equal(isTotpCode("123456"), true);
  assert.equal(isTotpCode("12345"), false);
  assert.equal(isTotpCode("12345a"), false);
});
