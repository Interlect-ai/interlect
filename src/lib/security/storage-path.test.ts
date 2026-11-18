import assert from "node:assert/strict";
import { test } from "node:test";
import { isSafeStoragePath, isStoragePathIn } from "./storage-path.ts";

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const CASE = "c0000000-0000-4000-8000-00000000000c";

test("the paths the app itself writes are safe", () => {
  for (const path of [
    `${A}/${CASE}/3f1c-deck.pdf`,
    `${A}/${CASE}/3f1c-..pdf`,
    `${A}/fund-config/${CASE}/3f1c-tese.pdf`,
    `${A}/forgotten/${CASE}`,
  ]) {
    assert.equal(isSafeStoragePath(path), true, path);
  }
});

test("a path that can climb out of its folders is refused", () => {
  for (const path of [
    `${A}/${CASE}/../../${B}/${CASE}/x.pdf`,
    `${A}/${CASE}/./x.pdf`,
    `${A}/${CASE}/%2e%2e/%2e%2e/${B}/x.pdf`,
    `${A}/${CASE}/..%2f..%2f${B}%2fx.pdf`,
    `${A}/${CASE}\\..\\..\\${B}\\x.pdf`,
    `${A}/${CASE}//x.pdf`,
    `/${A}/${CASE}/x.pdf`,
    `${A}/${CASE}/`,
    `${A}/${CASE}/x.pdf?/../../${B}`,
    `${A}/${CASE}/x.pdf#/../..`,
    `${A}/${CASE}/x\u0000.pdf`,
    "",
    `${A}/${"x".repeat(1000)}`,
  ]) {
    assert.equal(isSafeStoragePath(path), false, path);
  }
});

test("a path must lie in its folder", () => {
  assert.equal(isStoragePathIn(`${A}/${CASE}/x.pdf`, `${A}/${CASE}`), true);
  assert.equal(isStoragePathIn(`${A}/${CASE}x/x.pdf`, `${A}/${CASE}`), false);
  assert.equal(isStoragePathIn(`${A}/${CASE}/../${CASE}/x.pdf`, `${A}/${CASE}`), false);
});
