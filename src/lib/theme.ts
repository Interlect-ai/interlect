import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "pap-theme";

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * The theme on a first visit: light, as in the prototypes. Dark is still a choice, and
 * "system" (follow the computer) only applies when someone has chosen it.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";

/** Reads the stored preference. Missing, invalid or unreadable values fall back to light. */
function readPreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

function writePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* storage may be unavailable (private mode, blocked cookies) */
  }
}

function systemTheme(): EffectiveTheme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function resolve(preference: ThemePreference): EffectiveTheme {
  return preference === "system" ? systemTheme() : preference;
}

function applyToDocument(theme: EffectiveTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

/** Module-local store. Never touches browser globals during server rendering. */
let effective: EffectiveTheme | null = null;
const listeners = new Set<() => void>();
let teardown: (() => void) | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function setEffective(next: EffectiveTheme) {
  if (effective === next) return;
  effective = next;
  emit();
}

function start() {
  // The pre-paint script already applied the theme: read the DOM, do not guess.
  effective = document.documentElement.classList.contains("dark") ? "dark" : "light";

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    const next = resolve(readPreference());
    applyToDocument(next);
    setEffective(next);
  };
  window.addEventListener("storage", onStorage);

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    // Only follow the OS when the user has made no explicit choice.
    if (readPreference() !== "system") return;
    const next = systemTheme();
    applyToDocument(next);
    setEffective(next);
  };
  media.addEventListener("change", onMedia);

  teardown = () => {
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onMedia);
  };
}

function stop() {
  teardown?.();
  teardown = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) start();
  // The first snapshot becomes available only after start(): notify every
  // subscriber (including this one) so the placeholder swaps to the real icon.
  queueMicrotask(() => {
    if (listeners.has(listener)) listener();
  });
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

function getSnapshot(): EffectiveTheme | null {
  return effective;
}

function getServerSnapshot(): EffectiveTheme | null {
  return null;
}

export function setTheme(preference: ThemePreference) {
  writePreference(preference);
  const next = resolve(preference);
  applyToDocument(next);
  setEffective(next);
}

/**
 * Returns null until hydration has read the already-applied DOM theme, so the
 * first client render matches the server output exactly.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    theme,
    setTheme,
    toggle: () => setTheme(theme === "dark" ? "light" : "dark"),
  };
}

/** Inline pre-paint script. No eval, no external dependency, CSP-safe as an inline script. */
export const themePrePaintScript = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var p=${JSON.stringify(DEFAULT_THEME_PREFERENCE)};try{var s=localStorage.getItem(k);if(s==="light"||s==="dark"||s==="system"){p=s}}catch(e){}var t=p;if(p==="system"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}var r=document.documentElement;if(t==="dark"){r.classList.add("dark")}else{r.classList.remove("dark")}r.style.colorScheme=t}catch(e){}})();`;
