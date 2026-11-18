/**
 * Interlects udgave af `metal-fx` (libraries.dev / metal.jakubantalik.com, MIT; shaderen er Paper
 * Shaders' `liquidMetal`, Apache-2.0, se `NOTICE` i pakken): en ring af flydende metal om
 * den ene primære AI-handling på en skærm ("Kør dyb analyse"). Personaliseret: den afdæmpede
 * `silver`-palet (ikke regnbuen), tema fra appen, og stillestående ring under
 * `prefers-reduced-motion`. Højst ét "wow"-element pr. skærm; brug den kun på den ene AI-handling.
 * Uden WebGL2 tegnes bare knappen. Ringen følger pillens runde form: `MetalFx` læser ellers hjørnerne
 * fra det yderste element, som i `SplitButton` er en firkantet indpakning, så radius er
 * altid halvdelen af pillens højde (`pillHeight`, standard 34 px som `SplitButton`).
 */
import { useEffect, useState, type ReactElement } from "react";
import { MetalFx } from "metal-fx";

export function AiMetal({
  children,
  on = true,
  pillHeight = 34,
}: {
  children: ReactElement;
  on?: boolean;
  /** The wrapped pill's height in px; the ring's radius is half of it. */
  pillHeight?: number;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const update = () => {
      const root = document.documentElement;
      setTheme(
        root.classList.contains("dark") || root.dataset["theme"] === "dark" ? "dark" : "light",
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => {
      observer.disconnect();
      query.removeEventListener("change", onChange);
    };
  }, []);
  if (!on) return children;
  return (
    <MetalFx
      variant="button"
      preset="silver"
      theme={theme}
      strength={0.85}
      paused={reduced}
      borderRadius={pillHeight / 2}
    >
      {children}
    </MetalFx>
  );
}
