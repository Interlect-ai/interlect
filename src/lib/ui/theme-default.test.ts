/** A first visit (nothing stored) is light, as in the prototypes; dark stays a choice. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEME_PREFERENCE, themePrePaintScript } from "../theme.ts";

function runPrePaint(stored: string | null, osDark: boolean) {
  const classes = new Set<string>();
  const root = {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    style: { colorScheme: "" },
  };
  const sandbox = {
    localStorage: { getItem: () => stored },
    window: { matchMedia: () => ({ matches: osDark }) },
    document: { documentElement: root },
  };
  new Function("localStorage", "window", "document", themePrePaintScript)(
    sandbox.localStorage,
    sandbox.window,
    sandbox.document,
  );
  return root.style.colorScheme;
}

test("the theme is light on a first visit, even when the computer is dark", () => {
  assert.equal(DEFAULT_THEME_PREFERENCE, "light");
  assert.equal(runPrePaint(null, true), "light");
  assert.equal(runPrePaint("nonsense", true), "light");
});

test("a stored choice still wins: dark, or following the computer", () => {
  assert.equal(runPrePaint("dark", false), "dark");
  assert.equal(runPrePaint("system", true), "dark");
  assert.equal(runPrePaint("system", false), "light");
});
