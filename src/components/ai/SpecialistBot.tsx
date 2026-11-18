/**
 * Interlects egne specialist-avatarer. Bygget på `bot-avatars` (libraries.dev, MIT), men
 * aldrig pakkens standardfigurer: hver specialist har sin egen form (tegnet til Interlect-mærkets
 * parallelle, afrundede former) og sin egen farve fra produktets serie-farver, med den dæmpede
 * `smooth`-skygge i stedet for pakkens plysfigurer. Figurerne står stille; de vågner (arbejder)
 * kun, mens markøren er over dem, så der aldrig bevæger sig mange på én gang. Under
 * `prefers-reduced-motion` tegner pakken selv den stille pose.
 */
import { useEffect, useRef, useState } from "react";
import { BotAvatar } from "bot-avatars";
import type { SpecialistKind } from "./specialist-kind";

/** 100 × 100, midt i (50, 50); massiv rundt om ansigtet, som pakken kræver. */
const SHAPES: Record<SpecialistKind, string> = {
  // Team: afrundet kvadrat.
  team: "M26 14H74Q86 14 86 26V74Q86 86 74 86H26Q14 86 14 74V26Q14 14 26 14Z",
  // Kunder og marked: cirkel.
  market: "M50 12A38 38 0 1 1 49.99 12Z",
  // Produkt og teknologi: sekskant.
  tech: "M50 9L85 29V71L50 91L15 71V29Z",
  // Økonomi: bred kapsel.
  finance: "M32 22H68A28 28 0 0 1 68 78H32A28 28 0 0 1 32 22Z",
  // Deal og vilkår: skråstillet firkant som Interlect-mærkets former.
  deal: "M34 14H88L68 86H14Z",
  // Fondens egne specialister, i rækkefølge: rombe, ottekant, høj kapsel, skjold.
  own1: "M50 8L92 50L50 92L8 50Z",
  own2: "M34 10H66L90 34V66L66 90H34L10 66V34Z",
  own3: "M50 10A30 30 0 0 1 80 40V60A30 30 0 0 1 20 60V40A30 30 0 0 1 50 10Z",
  own4: "M50 10L86 22V52Q86 78 50 92Q14 78 14 52V22Z",
};

const COLOR_TOKENS: Record<SpecialistKind, { token: string; fallback: string }> = {
  team: { token: "--series-2", fallback: "#c98f00" },
  market: { token: "--series-5", fallback: "#1f9ec4" },
  tech: { token: "--series-1", fallback: "#2a78d6" },
  finance: { token: "--series-8", fallback: "#1f9d77" },
  deal: { token: "--series-7", fallback: "#9b4fb0" },
  // De samme reservefarver som casens faner for egne specialister (deep-view.ts).
  own1: { token: "--series-3", fallback: "#d9608f" },
  own2: { token: "--series-4", fallback: "#8a7a1a" },
  own3: { token: "--series-6", fallback: "#3f8f1f" },
  own4: { token: "--series-9", fallback: "#8fb4ec" },
};

function readColor(kind: SpecialistKind): string {
  if (typeof window === "undefined") return COLOR_TOKENS[kind].fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(COLOR_TOKENS[kind].token)
    .trim();
  return /^#[0-9a-f]{3,8}$|^rgb/i.test(value) ? value : COLOR_TOKENS[kind].fallback;
}

export function SpecialistBot({
  kind,
  size = 40,
  label,
}: {
  kind: SpecialistKind;
  size?: number;
  /** Skærmlæsertekst; udelad, når navnet står ved siden af. */
  label?: string;
}) {
  const [color, setColor] = useState(COLOR_TOKENS[kind].fallback);
  const [awake, setAwake] = useState(false);
  // The package's `paused` freezes the current frame, which can leave a figure tilted mid-hop
  // . A new key each time it stops draws it fresh in its upright rest pose, with a short settle.
  const [rest, setRest] = useState(0);
  const wasAwake = useRef(false);
  useEffect(() => {
    if (wasAwake.current && !awake) setRest((n) => n + 1);
    wasAwake.current = awake;
  }, [awake]);
  useEffect(() => {
    const update = () => setColor(readColor(kind));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => observer.disconnect();
  }, [kind]);
  return (
    <span
      className="inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      onMouseEnter={() => setAwake(true)}
      onMouseLeave={() => setAwake(false)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <span
        key={rest}
        className={rest > 0 && !awake ? "figure-settle" : undefined}
        style={{ display: "inline-grid" }}
      >
        <BotAvatar
          type="circle"
          path={SHAPES[kind]}
          color={color}
          shading="smooth"
          state={awake ? "working" : "default"}
          paused={!awake}
          size={size}
        />
      </span>
    </span>
  );
}
