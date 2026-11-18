import {
  Activity,
  Brain,
  CirclePlus,
  Layers,
  LayoutGrid,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n/translate";

export interface NavItem {
  to: string;
  /** The label as a dictionary key, translated where the menu renders. */
  labelKey: MessageKey;
  icon: LucideIcon;
  /** Exact match only (used for the index route). */
  exact?: boolean;
  /** Only shown to admins (the server still checks the role itself). */
  adminOnly?: boolean;
  /** Only shown when `getBrainCapabilities` says chat works and the role may chat. */
  brainOnly?: boolean;
}

/**
 * The shell's main menu, in the prototypes' order and with their icons (Cases v4, Screening
 * v5 …). Brain sits between Cases and Opret case but is only shown when the capability probe
 * says chat is available (`brainOnly`): no dead links, no reads of missing tables.
 * The Traction Scanner and Pitch decks are no longer in the menu.
 */
export const primaryNavigation: NavItem[] = [
  { to: "/", labelKey: "nav.overview", icon: LayoutGrid, exact: true },
  { to: "/cases", labelKey: "nav.cases", icon: Layers },
  { to: "/brain", labelKey: "nav.brain", icon: Brain, brainOnly: true },
  { to: "/opret-case", labelKey: "nav.createCase", icon: CirclePlus },
  { to: "/fond", labelKey: "nav.fundSetup", icon: SlidersHorizontal },
  { to: "/brugere", labelKey: "nav.users", icon: Users, adminOnly: true },
];

/** Admin items at the bottom in smaller type (Designsystem "App-skal og navigation"). */
export const secondaryNavigation: NavItem[] = [
  { to: "/sikkerhed", labelKey: "nav.security", icon: ShieldCheck, adminOnly: true },
  { to: "/status", labelKey: "nav.status", icon: Activity, adminOnly: true },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
