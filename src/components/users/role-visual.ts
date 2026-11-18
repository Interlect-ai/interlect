/**
 * The four roles as the prototype draws them ("Brugere og adgang": RL): icon and colour. The
 * names and descriptions come from src/lib/auth/roles.ts. The tile tint has no wash token, so
 * it is the colour at 14 % (the prototype's `color-mix`).
 */
import { Eye, Shield, Star, UserRound, type LucideIcon } from "lucide-react";
import type { AppRole } from "@/lib/supabase/types";

export interface RoleVisual {
  icon: LucideIcon;
  /** CSS colour (a token). */
  color: string;
  /** Tile background: the colour at 14 %. */
  tint: string;
  /** The same tint for components that take it as a menu tone. */
  tone: { color: "series-7" | "ai" | "action" | "ink-3"; wash: `color-mix(${string}` };
}

const mix = (color: string) => `color-mix(in srgb,${color} 14%,transparent)` as const;

export const roleVisual: Record<AppRole, RoleVisual> = {
  admin: {
    icon: Shield,
    color: "var(--series-7)",
    tint: mix("var(--series-7)"),
    tone: { color: "series-7", wash: mix("var(--series-7)") },
  },
  lead: {
    icon: Star,
    color: "var(--ai)",
    tint: mix("var(--ai)"),
    tone: { color: "ai", wash: mix("var(--ai)") },
  },
  member: {
    icon: UserRound,
    color: "var(--action)",
    tint: mix("var(--action)"),
    tone: { color: "action", wash: mix("var(--action)") },
  },
  reader: {
    icon: Eye,
    color: "var(--ink-3)",
    tint: mix("var(--ink-3)"),
    tone: { color: "ink-3", wash: mix("var(--ink-3)") },
  },
};
