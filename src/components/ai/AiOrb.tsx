/**
 * Interlects orbital "thinking orb" (alle loading-signaler bruger den).
 *
 * `tone="ai"` er AI'ens arbejde (research, screening, analyse) og tegnes i koral.
 * `tone="neutral"` er almindelig ventetid (hentning, gemning) og tegnes i temaets blæk.
 * Pakken forstår kun `#hex` og `rgb()`, ikke CSS-variabler, så koral aflæses fra tokens
 * og følger lyst/mørkt tema.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { chooseMover, type OrbMover } from "@/lib/ai/orb-turn";
import { cn } from "@/lib/utils";

export type { OrbState };
export type OrbTone = "ai" | "neutral";

function readCoral(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--ai").trim();
  return /^#[0-9a-f]{3,8}$|^rgb/i.test(value) ? value : undefined;
}

function usePrefersReducedMotion() {
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

/** Koral fra design-tokens og om temaet er mørkt, opdateret når tema eller OS-tema skifter. */
function useThemeInk(enabled: boolean) {
  const [coral, setCoral] = useState<string | undefined>(undefined);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const update = () => {
      setCoral(readCoral());
      const root = document.documentElement;
      setDark(root.classList.contains("dark") || root.dataset["theme"] === "dark");
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", update);
    return () => {
      observer.disconnect();
      scheme.removeEventListener("change", update);
    };
  }, [enabled]);
  return { coral, dark };
}

/**
 * Only one orb moves at a time on a screen: every orb that wants to move
 * registers here and `chooseMover` picks it; the rest stand still until it is gone.
 */
const movers = new Map<string, OrbMover>();
const listeners = new Set<() => void>();
let registered = 0;
let current: string | null = null;

function pickMover() {
  const next = chooseMover(movers);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribeMover(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Orbs inside a part of the screen that is mounted but not seen (a minimized panel) stand still
 * and never take the turn from a visible orb.
 */
const OrbPausedContext = createContext(false);
export const OrbPause = OrbPausedContext.Provider;

/** Whether this orb is the one allowed to move. */
function useMoverTurn(wantsToMove: boolean, size: number) {
  const id = useId();
  // The place in line is kept when the orb's size or state changes.
  const order = useRef<number | null>(null);
  useEffect(() => {
    if (!wantsToMove) return;
    order.current ??= registered++;
    movers.set(id, { size, order: order.current });
    pickMover();
    return () => {
      movers.delete(id);
      pickMover();
    };
  }, [id, wantsToMove, size]);
  return useSyncExternalStore(
    subscribeMover,
    () => current === id,
    () => false,
  );
}

/** Speed on top of the package's own per size (1 = the package's default). */
const ORB_SPEED: Record<20 | 32 | 64, number> = { 20: 0.75, 32: 0.7, 64: 0.55 };

export function AiOrb({
  state = "working",
  size = 20,
  tone = "neutral",
  label,
  className,
  onDark = false,
  paused = false,
}: {
  /** På en omvendt flade (primærknappen er blæk): orben tegnes i temaets modsatte blæk. */
  onDark?: boolean;
  /** Står altid stille (fx en orb, der kun er et ikon). Ellers bevæger kun én orb sig ad gangen. */
  paused?: boolean;
  state?: OrbState;
  size?: 20 | 32 | 64;
  tone?: OrbTone;
  /** Skærmlæsertekst på dansk. Udelad, når synlig tekst står ved siden af. */
  label?: string;
  className?: string;
}) {
  const { coral, dark } = useThemeInk(true);
  const reduced = usePrefersReducedMotion();
  const hidden = useContext(OrbPausedContext);
  const moving = useMoverTurn(!reduced && !paused && !hidden, size);
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <ThinkingOrb
        size={size}
        state={state}
        // Calmer, like a brain moving slowly but visibly; the big orbs
        // on waiting screens and empty states (Brain) the calmest.
        speed={ORB_SPEED[size]}
        paused={!moving}
        aria-hidden
        {...(onDark ? { theme: dark ? ("light" as const) : ("dark" as const) } : {})}
        {...(tone === "ai" && coral && !onDark ? { color: coral } : {})}
      />
    </span>
  );
}

/** Orb + tekst til knapper og korte ventetilstande, så knappen ikke skifter bredde. */
export function PendingLabel({
  children,
  tone = "neutral",
  state = "working",
  onDark = false,
}: {
  onDark?: boolean;
  children: ReactNode;
  tone?: OrbTone;
  state?: OrbState;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <AiOrb size={20} tone={tone} state={state} onDark={onDark} />
      <span>{children}</span>
    </span>
  );
}
