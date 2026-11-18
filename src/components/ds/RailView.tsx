/**
 * The menu's look without data (AppRail wires it to the session, the fund and the role):
 * logo row, fund card, links, admin items and the user area. Pure, so the internal
 * component gallery and the visual harness can draw the real menu without signing in.
 * Measurements: Designsystem "App-skal og navigation" (see AppRail.tsx).
 */
import {
  createContext,
  forwardRef,
  useContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { ChevronsUpDown, Ellipsis, Landmark, PanelLeft, Plus, UserRound } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { isNavItemActive, type NavItem } from "@/lib/navigation";
import { useT } from "@/lib/i18n/useT";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The menu's look without data (also used by /intern/komponenter): logo row, the fund slot,
 * the main items, optional extra content, the admin items and the user slot.
 */
export function RailView({
  collapsed = false,
  pathname,
  main,
  secondary,
  onToggle,
  onNavigate,
  extra,
  fund,
  user,
}: {
  collapsed?: boolean;
  pathname: string;
  main: readonly NavItem[];
  secondary: readonly NavItem[];
  onToggle?: (() => void) | undefined;
  onNavigate?: (() => void) | undefined;
  extra?: ReactNode | undefined;
  fund: ReactNode;
  user: ReactNode;
}) {
  const t = useT();
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-0 flex-col">
        <div
          className={cn(
            "mb-[22px] flex h-6 items-center gap-[9px]",
            collapsed ? "justify-center px-0" : "px-2",
          )}
        >
          <Link
            to="/"
            onClick={onNavigate}
            aria-label={t("shell.rail.homeLink")}
            className="flex min-w-0 items-center gap-[3px] rounded-xs"
          >
            <InterlectMark size={20} />
            {!collapsed && (
              <FadeIn className="whitespace-nowrap text-[16px] leading-none font-semibold tracking-[-0.02em]">
                Interlect
              </FadeIn>
            )}
          </Link>
          {!collapsed && onToggle && (
            <button
              type="button"
              onClick={onToggle}
              className="ml-auto grid size-7 place-items-center rounded-xs text-ink-4 transition-colors duration-[var(--dur-quick)] hover:bg-hover hover:text-ink-1"
              aria-label={t("shell.rail.collapse")}
              title={t("shell.rail.collapse")}
            >
              <PanelLeft className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>

        {fund}

        <nav aria-label={t("shell.rail.pages")} className="flex flex-col gap-0.5">
          {main.map((item) => (
            <RailLink
              key={item.to}
              item={item}
              active={isNavItemActive(item, pathname)}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        {extra && !collapsed ? <div className="flex min-h-0 flex-1 flex-col">{extra}</div> : null}
        {!extra || collapsed ? <div className="flex-1" /> : null}

        {secondary.length > 0 && (
          <div className="mb-2.5 flex flex-col gap-0.5">
            {secondary.map((item) => (
              <RailLink
                key={item.to}
                item={item}
                active={isNavItemActive(item, pathname)}
                collapsed={collapsed}
                onNavigate={onNavigate}
                small
              />
            ))}
          </div>
        )}

        {collapsed && onToggle && (
          <RailTip label={t("shell.rail.expand")} collapsed>
            <button
              type="button"
              onClick={onToggle}
              className="mb-1 flex h-[38px] w-full items-center justify-center rounded-sm text-ink-3 transition-colors duration-[var(--dur-quick)] hover:bg-hover hover:text-ink-1"
              aria-label={t("shell.rail.expand")}
            >
              <PanelLeft className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          </RailTip>
        )}

        {user}
      </div>
    </TooltipProvider>
  );
}

/** Whether labels fade in: only after the user unfolded the menu in this mount. */
export const LabelMotion = createContext(false);

/** Labels fade in when the menu unfolds (the width itself does not animate). */
function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const animateIn = useContext(LabelMotion);
  return (
    <motion.span
      className={className}
      initial={animateIn ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0.12 } : { duration: DURATION.quick, ease: EASE.out }}
    >
      {children}
    </motion.span>
  );
}

export function RailTip({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  if (!collapsed) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function RailLink({
  item,
  active,
  collapsed,
  onNavigate,
  small = false,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: (() => void) | undefined;
  small?: boolean;
}) {
  const t = useT();
  const Icon = item.icon;
  const label = t(item.labelKey);
  return (
    <RailTip label={label} collapsed={collapsed}>
      <Link
        to={item.to}
        onClick={onNavigate}
        aria-label={collapsed ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center whitespace-nowrap rounded-sm transition-[background-color,color,box-shadow,transform] active:scale-[0.98]",
          "duration-[var(--dur-quick)] ease-standard",
          collapsed ? "justify-center px-0" : "px-3",
          small
            ? "h-8 gap-[11px] text-meta text-ink-3 hover:bg-hover hover:text-ink-1"
            : "h-[38px] gap-[11px] text-list font-medium",
          !small && (active ? "bg-surface text-ink-1 shadow-pill" : "text-ink-3 hover:text-ink-1"),
          small && active && "bg-hover text-ink-1",
        )}
      >
        <Icon className={small ? "size-[15px]" : "size-4"} strokeWidth={1.75} aria-hidden />
        {!collapsed && <FadeIn className="truncate">{label}</FadeIn>}
      </Link>
    </RailTip>
  );
}

/** The fund card's look: 28 px tile, name (13/500) and version (11 px ink-4). */
export const FundCardView = forwardRef<
  HTMLButtonElement,
  {
    collapsed?: boolean;
    name?: string;
    meta?: string;
    /** Several theses: chevrons and a pointer. */
    chevron?: boolean;
    /** No thesis yet: plus instead of the landmark. */
    create?: boolean;
    loading?: boolean;
    /** A button when it opens something (menu trigger, create dialog). */
    as?: "div" | "button";
  } & ButtonHTMLAttributes<HTMLButtonElement>
>(function FundCardView(
  {
    collapsed = false,
    name = "",
    meta = "",
    chevron = false,
    create = false,
    loading = false,
    as = "div",
    className,
    ...props
  },
  ref,
) {
  const Icon = create ? Plus : Landmark;
  const classes = cn(
    "mb-[18px] flex w-full items-center gap-2.5 rounded-md bg-surface text-left",
    loading ? "shadow-none" : "shadow-pill",
    collapsed ? "justify-center p-1.5" : "px-3 py-2.5",
    as === "button" && "cursor-pointer transition-transform active:scale-[0.98]",
    className,
  );
  const inner = (
    <>
      <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-sunken text-ink-2">
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
      </span>
      {!collapsed && !loading && (
        <FadeIn className="flex min-w-0 flex-col whitespace-nowrap leading-[1.25]">
          <span className="truncate text-list font-medium text-ink-1">{name}</span>
          <span className="truncate text-micro text-ink-4">{meta}</span>
        </FadeIn>
      )}
      {chevron && !collapsed && !loading && (
        <ChevronsUpDown
          className="ml-auto size-3.5 shrink-0 text-ink-4"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
    </>
  );
  if (as === "button") {
    return (
      <button ref={ref} type="button" {...props} className={classes}>
        {inner}
      </button>
    );
  }
  // A div when there is nothing to open; it still takes the tooltip's ref and handlers, and
  // is named (and focusable) when the menu is folded and only the tile shows.
  const { onClick: _unusedClick, type: _unusedType, ...divProps } = props;
  return (
    <div
      ref={ref as unknown as Ref<HTMLDivElement>}
      {...(divProps as HTMLAttributes<HTMLDivElement>)}
      className={classes}
      aria-hidden={loading || undefined}
      {...(collapsed && !loading
        ? { tabIndex: 0, role: "img", "aria-label": `${name}, ${meta}` }
        : {})}
    >
      {inner}
    </div>
  );
});

/** The user area's look: avatar, name (13/500), role (11 px ink-4) and "…". */
export const UserAreaView = forwardRef<
  HTMLButtonElement,
  { collapsed?: boolean; userName: string | null; roleLabel: string | null } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "name" | "role"
  >
>(function UserAreaView({ collapsed = false, userName, roleLabel, className, ...props }, ref) {
  const t = useT();
  return (
    <button
      ref={ref}
      type="button"
      aria-label={t("shell.rail.userMenu", { name: userName ?? t("shell.rail.you") })}
      {...props}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md text-left transition-colors duration-[var(--dur-quick)] hover:bg-hover data-[state=open]:bg-hover",
        collapsed ? "justify-center p-1.5" : "px-3 py-2.5",
        className,
      )}
    >
      <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-sunken text-ink-3">
        <UserRound className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      {!collapsed && (
        <>
          <FadeIn className="flex min-w-0 flex-col leading-[1.25]">
            <span className="truncate text-list font-medium text-ink-1">
              {userName ?? t("shell.rail.signedIn")}
            </span>
            {roleLabel && <span className="truncate text-micro text-ink-4">{roleLabel}</span>}
          </FadeIn>
          <Ellipsis className="ml-auto size-4 shrink-0 text-ink-4" strokeWidth={1.75} aria-hidden />
        </>
      )}
    </button>
  );
});
