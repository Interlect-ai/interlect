import { useEffect, useRef } from "react";

/**
 * The sub-page's back pill: it gets focus once when the sub-page opens, focus returns to the
 * card that opened it when the sub-page closes, and Esc goes back. Also used by a sub-page that
 * stands inside its page instead of over it (the deep analysis's "Analyserne").
 */
export function useBackPill(onBack: () => void) {
  const backRef = useRef<HTMLButtonElement>(null);
  // The latest onBack, so callers may pass an inline arrow without re-running the effects.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    backRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onBackRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return backRef;
}
