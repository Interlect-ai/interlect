/**
 * Interlects udgave af `border-beam` (libraries.dev, MIT): en glød om det, som AI
 * arbejder i, mens den arbejder: skrivefeltet, et svar der streames, et kørselskort. Personaliseret
 * til produktet: kun den varme (koral) palet, dæmpet styrke, tema fra appen (ikke styresystemet),
 * og ingen bevægelse under `prefers-reduced-motion` (pakkens roterende udgave respekterer ikke
 * det selv). Uden `active` tegnes intet, så en omgivelse ikke skifter udseende eller størrelse.
 * Højst ét "wow"-element pr. skærm; sæt det kun, hvor AI faktisk arbejder.
 */
import { useEffect, useState, type ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { cn } from "@/lib/utils";

function useAppTheme(): "light" | "dark" {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const update = () => {
      const root = document.documentElement;
      setDark(root.classList.contains("dark") || root.dataset["theme"] === "dark");
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);
  return dark ? "dark" : "light";
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function AiBeam({
  active,
  size = "md",
  strength = 0.9,
  className,
  children,
}: {
  /** AI arbejder nu. */
  active: boolean;
  /** `md` hele kanten (kort), `line` kun nederst (tekst der streames), `sm` små flader. */
  size?: "md" | "sm" | "line";
  strength?: number;
  className?: string;
  children: ReactNode;
}) {
  const theme = useAppTheme();
  const reduced = useReducedMotion();
  return (
    <BorderBeam
      active={active && !reduced}
      size={size}
      colorVariant="sunset"
      theme={theme}
      hueRange={14}
      saturation={theme === "dark" ? 1.1 : 0.95}
      strength={strength}
      className={cn("w-full min-w-0", className)}
    >
      {children}
    </BorderBeam>
  );
}
