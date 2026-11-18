import { test } from "node:test";
import assert from "node:assert/strict";
import { matrixCell, matrixRoles, matrixRows, roleMatrix, type MatrixCell } from "./role-matrix.ts";
import { hasCapability, strictFundSettings } from "./workflow.ts";

// The prototype's matrix (Brugere og adgang.dc.html): 1 = kan, 0 = kan ikke, 2 = kan slås til.
const PROTOTYPE: Record<string, [number, number, number, number]> = {
  "Se cases og analyser": [1, 1, 1, 1],
  "Skrive i Beskeder og noter": [1, 1, 1, 1],
  "Oprette cases og køre screening": [1, 1, 1, 0],
  "Løse og tildele tasks": [1, 1, 1, 0],
  "Køre dyb analyse og sende til komité": [1, 1, 1, 0],
  "Sætte på hold": [1, 1, 1, 0],
  "Beslutte: investeret eller luk": [1, 1, 2, 0],
  "Se tese og vægte": [1, 1, 1, 1],
  "Foreslå ændringer med Ret med AI": [1, 1, 1, 0],
  "Redigere kladde": [1, 1, 0, 0],
  // Beslutning 2: Medlem kan få lov at udgive, så cellen er "kan slås til".
  "Udgive en ny version": [1, 1, 2, 0],
  "Invitere og ændre roller": [1, 0, 0, 0],
  "Pladser og forbrug": [1, 0, 0, 0],
};
const WORD: Record<number, MatrixCell> = { 1: "yes", 0: "no", 2: "optin" };

test("matrix: the 16 prototype lines in order: 3 headings and 13 rows", () => {
  const rows = roleMatrix();
  assert.equal(rows.length, 16);
  assert.deepEqual(
    rows.filter((row) => row.head).map((row) => row.label),
    ["Cases", "Teamopsætning", "Administration"],
  );
  assert.deepEqual(
    rows.filter((row) => !row.head).map((row) => row.label),
    Object.keys(PROTOTYPE),
  );
});

test("matrix: every cell equals the prototype (strict settings)", () => {
  for (const row of roleMatrix(strictFundSettings)) {
    if (row.head) continue;
    const expected = PROTOTYPE[row.label];
    assert.ok(expected, row.label);
    assert.deepEqual(
      row.cells,
      expected.map((value) => WORD[value]),
      row.label,
    );
  }
});

test("matrix: derived from hasCapability, row by row, for every role and setting", () => {
  for (const memberCanDecide of [false, true]) {
    for (const memberCanPublish of [false, true]) {
      const settings = { memberCanDecide, memberCanPublish };
      for (const row of matrixRows) {
        if (row.head) continue;
        for (const role of matrixRoles) {
          const all: boolean = row.capabilities.every((c) => hasCapability([role], c, settings));
          assert.equal(
            matrixCell(role, row.capabilities, settings) === "yes",
            all,
            `${row.key} / ${role}`,
          );
        }
      }
    }
  }
});

test("matrix: the opt-in cells turn green when the Admin switches the setting on", () => {
  const rows = roleMatrix({ memberCanDecide: true, memberCanPublish: true });
  const find = (label: string) => rows.find((row) => row.label === label)!;
  assert.equal(find("Beslutte: investeret eller luk").cells[2], "yes");
  assert.equal(find("Udgive en ny version").cells[2], "yes");
  // Switching one on never changes Læser or a row without an opt-in.
  assert.equal(find("Beslutte: investeret eller luk").cells[3], "no");
  assert.equal(find("Redigere kladde").cells[2], "no");
});

test("matrix: only Admin can manage users, under every setting", () => {
  for (const settings of [strictFundSettings, { memberCanDecide: true, memberCanPublish: true }]) {
    for (const row of roleMatrix(settings)) {
      if (row.label !== "Invitere og ændre roller") continue;
      assert.deepEqual(row.cells, ["yes", "no", "no", "no"]);
    }
  }
});
