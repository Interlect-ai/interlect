/**
 * The shell's menu (Designsystem "App-skal og navigation", Screening v5): logo, the fund
 * card, the main menu, admin items at the bottom in smaller type and the user area.
 *
 * Desktop: 236 px, folds to 68 px (icons with tooltips); the choice is remembered under
 * `interlect-sidebar` as before. The width switches without animation; the
 * labels fade in. Mobile: the same content in a drawer (`RailDrawer`).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, Moon, Plus, Sun } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ds/Menu";
import {
  FundCardView,
  LabelMotion,
  RailTip,
  RailView,
  UserAreaView,
} from "@/components/ds/RailView";
import { showToast } from "@/components/ds/Toast";
import { useSession } from "@/lib/auth/useSession";
import { getMyAccess, MY_ACCESS_STALE_MS, myAccessQueryKey } from "@/lib/auth/access.functions";
import { isAdminRole } from "@/lib/auth/is-admin";
import { roleValues } from "@/lib/auth/roles";
import type { AppRole } from "@/lib/supabase/types";
import { useBrainCapabilities } from "@/lib/brain/useBrainCapabilities";
import { showBrain } from "@/lib/brain/capabilities";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import type { MemberFund } from "@/lib/funds/funds.functions";
import { supabase } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { useTheme } from "@/lib/theme";
import { useHydrated } from "@/lib/ui/useHydrated";
import { primaryNavigation, secondaryNavigation, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "interlect-sidebar";

/**
 * Each page renders its own AppShell, so the rail remounts on navigation. The last known
 * state is kept here, so a folded menu does not flash open on every page change; the first
 * render after a full load follows the server (expanded) and then reads storage.
 */
let knownCollapsed: boolean | null = null;

/** Collapsed state, remembered per browser (same key as the old rail). */
export function useRailCollapsed() {
  const [collapsed, setCollapsed] = useState(knownCollapsed ?? false);
  // True only after a click in this mount, so labels fade in on unfold but not on every page.
  const [toggled, setToggled] = useState(false);
  useEffect(() => {
    if (knownCollapsed !== null) return;
    try {
      knownCollapsed = window.localStorage.getItem(SIDEBAR_KEY) === "collapsed";
    } catch {
      knownCollapsed = false; // storage unavailable: stay expanded
    }
    setCollapsed(knownCollapsed);
  }, []);
  const toggle = () => {
    const next = !collapsed;
    knownCollapsed = next;
    setToggled(true);
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "expanded");
    } catch {
      /* storage unavailable: the choice lasts until the next full load */
    }
  };
  return { collapsed, toggle, toggled };
}

/** Access for the active fund: name, e-mail and roles for the user area and admin items. */
function useRailAccess() {
  const { status } = useSession();
  const { fundId } = useActiveFund();
  return useQuery({
    queryKey: myAccessQueryKey(fundId),
    queryFn: () => getMyAccess({ data: { fundId: fundId! } }),
    staleTime: MY_ACCESS_STALE_MS,
    enabled: status === "signed_in" && Boolean(fundId),
  });
}

const ROLE_LABEL: Record<AppRole, MessageKey> = {
  admin: "shell.roles.admin",
  lead: "shell.roles.lead",
  member: "shell.roles.member",
  reader: "shell.roles.reader",
};

/** The highest role by the order in roles.ts (Admin first), as a dictionary key. */
function primaryRoleKey(roles: readonly string[] | undefined): MessageKey | null {
  if (!roles?.length) return null;
  const known = roleValues.find((role) => roles.includes(role));
  return known ? ROLE_LABEL[known] : null;
}

export function AppRail({ extra }: { extra?: ReactNode }) {
  const { collapsed, toggle, toggled } = useRailCollapsed();
  const t = useT();
  return (
    <aside
      aria-label={t("shell.rail.label")}
      data-collapsed={collapsed}
      className={cn(
        "hidden h-full shrink-0 flex-col pt-3.5 pr-2.5 pb-2.5 pl-3 md:flex print:hidden",
        collapsed ? "w-[68px]" : "w-[236px]",
      )}
    >
      <LabelMotion.Provider value={toggled}>
        <RailContent collapsed={collapsed} onToggle={toggle} extra={extra} />
      </LabelMotion.Provider>
    </aside>
  );
}

/**
 * Everything inside the menu, wired to the session, the active fund and the role.
 * `onNavigate` closes the mobile drawer after a choice; `onToggle` is the fold button
 * (desktop only).
 */
export function RailContent({
  collapsed = false,
  onToggle,
  onNavigate,
  extra,
}: {
  collapsed?: boolean;
  onToggle?: (() => void) | undefined;
  onNavigate?: (() => void) | undefined;
  extra?: ReactNode | undefined;
}) {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const access = useRailAccess();
  const roleKey = primaryRoleKey(access.data?.roles);
  const admin = isAdminRole(access.data?.roles);
  const brain = showBrain(useBrainCapabilities().data);
  const visible = (item: NavItem) => (!item.adminOnly || admin) && (!item.brainOnly || brain);

  return (
    <RailView
      collapsed={collapsed}
      pathname={pathname}
      main={primaryNavigation.filter(visible)}
      secondary={secondaryNavigation.filter(visible)}
      onToggle={onToggle}
      onNavigate={onNavigate}
      extra={extra}
      fund={<FundCard collapsed={collapsed} onNavigate={onNavigate} />}
      user={
        <UserArea
          collapsed={collapsed}
          name={access.data?.fullName ?? access.data?.email ?? null}
          role={roleKey ? t(roleKey) : null}
        />
      }
    />
  );
}

function versionLabel(t: ReturnType<typeof useT>, fund: MemberFund | null): string {
  if (!fund || fund.configVersion === null) return t("shell.fund.noSetup");
  return fund.configStatus === "active"
    ? t("shell.fund.thesisVersion", { version: fund.configVersion })
    : t("shell.fund.draftVersion", { version: fund.configVersion });
}

/**
 * The fund card. One thesis: name and version, no choice. Several: a menu to switch or
 * create one. None: "Opret investeringstese". Selecting keeps the same rules as before
 * (interlect.activeFundId).
 */
function FundCard({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { fund, fundId, funds, selectFund, refreshFunds, isLoading, isError } = useActiveFund();
  // The browser may already know the funds (cache) when it hydrates; the server never does.
  const hydrated = useHydrated();
  const openNewThesis = () => {
    onNavigate?.();
    void navigate({ to: "/fond/ny" });
  };

  if (!hydrated || isLoading) return <FundCardView collapsed={collapsed} loading />;
  // A failed fetch must not look like "no theses" (it would invite a duplicate fund).
  if (isError) {
    return (
      <RailTip label={t("shell.fund.loadFailed")} collapsed={collapsed}>
        <FundCardView
          collapsed={collapsed}
          name={t("shell.fund.loadFailed")}
          meta={t("shell.fund.reload")}
        />
      </RailTip>
    );
  }

  // Kun en Admin kan oprette en ny investeringstese (serveren tjekker det også, harden G15).
  const canCreate = funds.some((candidate) => isAdminRole(candidate.roles));

  if (funds.length === 0) {
    return (
      <RailTip label={t("shell.fund.none")} collapsed={collapsed}>
        <FundCardView
          collapsed={collapsed}
          name={t("shell.fund.none")}
          meta={t("shell.fund.askAdmin")}
        />
      </RailTip>
    );
  }

  const name = fund?.name ?? t("shell.fund.choose");
  if (funds.length === 1) {
    return (
      <RailTip label={name} collapsed={collapsed}>
        <FundCardView collapsed={collapsed} name={name} meta={versionLabel(t, fund)} />
      </RailTip>
    );
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <FundCardView
            as="button"
            collapsed={collapsed}
            chevron
            name={name}
            meta={versionLabel(t, fund)}
            aria-label={t("shell.fund.switchLabel", { name })}
          />
        </MenuTrigger>
        <MenuContent className="w-[260px]" side={collapsed ? "right" : "bottom"}>
          {funds.map((candidate) => (
            <MenuItem
              key={candidate.id}
              onSelect={() => {
                selectFund(candidate.id);
                onNavigate?.();
              }}
              checked={candidate.id === fundId}
              description={
                candidate.isDemo
                  ? t("shell.fund.demo", { version: versionLabel(t, candidate) })
                  : versionLabel(t, candidate)
              }
            >
              {candidate.name}
            </MenuItem>
          ))}
          {canCreate && (
            <>
              <MenuSeparator />
              <MenuItem icon={Plus} onSelect={openNewThesis}>
                {t("shell.fund.create")}
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
    </>
  );
}

/** Avatar, name and role; "…" opens the theme switch and "Log ud". */
function UserArea({
  collapsed,
  name,
  role,
}: {
  collapsed: boolean;
  name: string | null;
  role: string | null;
}) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, toggle } = useTheme();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    // This device only; "global" would sign the person out everywhere.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      console.error("[rail] sign out failed", error.message);
      setSigningOut(false);
      showToast({ message: t("shell.rail.signOutFailed"), tone: "error" });
      return;
    }
    // Nothing from this user may linger in the cache for the next one.
    queryClient.clear();
    await navigate({ to: "/login", replace: true });
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <UserAreaView collapsed={collapsed} userName={name} roleLabel={role} />
      </MenuTrigger>
      <MenuContent side="top" align={collapsed ? "start" : "end"} className="w-[220px]">
        <MenuItem icon={theme === "dark" ? Sun : Moon} onSelect={toggle} disabled={theme === null}>
          {theme === "dark" ? t("shell.rail.lightTheme") : t("shell.rail.darkTheme")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={LogOut} onSelect={() => void signOut()} disabled={signingOut}>
          {t("shell.rail.signOut")}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
