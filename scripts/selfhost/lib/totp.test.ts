import assert from "node:assert/strict";
import { test } from "node:test";
import { base32Decode, totp, totpMsLeft } from "./totp.ts";

// RFC 6238 appendix B: the SHA-1 key "12345678901234567890" in base32.
const RFC_KEY = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("base32 decodes the RFC key and ignores spaces and padding", () => {
  assert.equal(base32Decode(RFC_KEY).toString("ascii"), "12345678901234567890");
  assert.equal(
    base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq==").toString("ascii"),
    "12345678901234567890",
  );
  assert.throws(() => base32Decode("ABC1"), /not base32/);
  assert.throws(() => base32Decode("  "), /empty/);
});

test("totp matches the RFC 6238 SHA-1 test vectors", () => {
  assert.equal(totp(RFC_KEY, 59_000, 8), "94287082");
  assert.equal(totp(RFC_KEY, 1_111_111_109_000, 8), "07081804");
  assert.equal(totp(RFC_KEY, 1_234_567_890_000, 8), "89005924");
  assert.equal(totp(RFC_KEY, 20_000_000_000_000, 8), "65353130");
  assert.equal(totp(RFC_KEY, 59_000), "287082");
});

test("totpMsLeft counts down within the 30-second step", () => {
  assert.equal(totpMsLeft(0), 30_000);
  assert.equal(totpMsLeft(29_000), 1_000);
  assert.equal(totpMsLeft(30_000), 30_000);
});
