import { useEffect, useRef, useState } from "react";

/**
 * Tæller op mod en værdi over ~500ms i stedet for at springe direkte til den.
 * Ingen ny afhængighed -- ren requestAnimationFrame, og springer direkte til
 * målværdien for brugere der har bedt om reduceret bevægelse.
 */
export function useCountUp(target: number | null, durationMs = 550) {
  const [value, setValue] = useState(target);
  const prevTarget = useRef(target);

  useEffect(() => {
    if (target === null) {
      setValue(null);
      prevTarget.current = null;
      return;
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setValue(target);
      prevTarget.current = target;
      return;
    }
    const from = prevTarget.current ?? 0;
    prevTarget.current = target;
    if (from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}
