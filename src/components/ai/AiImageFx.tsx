/**
 * Interlects udgave af `img-fx` (libraries.dev / image.jakubantalik.com, MIT): et levende
 * indlæsningsmosaik over en flade, mens Interlect læser en fil (pitch deck, billede). Personaliseret:
 * paletten er koral og neutrale toner fra appens tokens (ikke pakkens egne), dæmpet styrke, tema fra
 * appen, og stillestående under `prefers-reduced-motion`. Pakken (og `three`) hentes først, når
 * effekten bruges, så den ikke ligger i siden før. Uden `active` vises bare fladen.
 */
import { lazy, Suspense, useEffect, useState, type ReactElement } from "react";

const ImageGeneration = lazy(() => import("img-fx").then((m) => ({ default: m.ImageGeneration })));

function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function AiImageFx({ active, children }: { active: boolean; children: ReactElement }) {
  const [env, setEnv] = useState<{ theme: "light" | "dark"; reduced: boolean; colors: string[] }>({
    theme: "light",
    reduced: false,
    colors: [],
  });
  useEffect(() => {
    const update = () => {
      const root = document.documentElement;
      setEnv({
        theme:
          root.classList.contains("dark") || root.dataset["theme"] === "dark" ? "dark" : "light",
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        colors: [
          readToken("--ai", "#ff6a4d"),
          readToken("--ink-4", "#9b9b9b"),
          readToken("--series-3", "#d9608f"),
          readToken("--bg-sunken", "#ebe9e4"),
        ],
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);
  if (!active) return children;
  return (
    <Suspense fallback={children}>
      <ImageGeneration
        preset="sweep-gradient"
        theme={env.theme}
        strength={0.5}
        paused={env.reduced}
        {...(env.colors.length > 0 ? { colors: env.colors } : {})}
      >
        {children}
      </ImageGeneration>
    </Suspense>
  );
}
