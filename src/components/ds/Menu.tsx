/**
 * Menus ("Split-knap", "Case-status", Cases v4 filters and "Næste skridt").
 *
 * Three sizes measured in the prototypes:
 * - `compact` (filters, user menu, fund switcher): min 220 px, padding 6, radius 14,
 *   36 px rows, optional violet check on the left.
 * - `large` (Cases v4 "Næste skridt"): 320 px, padding 8, radius 20, 50 px rows with a
 *   34 px tinted icon tile, description, "Anbefalet" and a check on the current state.
 * - `status` (CaseStatus "Status v2"): 360 px, 60 px rows with a 38 px tile, 15 px label.
 *
 * Radix gives keyboard navigation, focus return, collision handling (menus never overlap
 * the edge) and close on outside click / Esc. Motion follows "Menuer og
 * popovers": in with the smooth spring (opacity, y −6, scale .97, blur 4), items stagger
 * 30 ms from y 4, out 140 ms ease-in without stagger. Transform origin is the trigger.
 */
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { Check, type LucideIcon } from "lucide-react";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE, SPRING, exitTransition } from "@/lib/motion";
import { ignoreMenuKey } from "@/lib/ui/menu-keys";
import { cn } from "@/lib/utils";

export type MenuSize = "compact" | "large" | "status";

const MenuOpenContext = createContext<boolean>(false);
const MenuSizeContext = createContext<MenuSize>("compact");
const ReducedContext = createContext(false);

export function Menu({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  modal = false,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Non-modal by default, so the page stays scrollable and a click outside closes it. */
  modal?: boolean;
  children: ReactNode;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };
  return (
    <MenuOpenContext.Provider value={open}>
      <MenuPrimitive.Root open={open} onOpenChange={setOpen} modal={modal}>
        {children}
      </MenuPrimitive.Root>
    </MenuOpenContext.Provider>
  );
}

/** Whether the surrounding menu is open (e.g. to rotate a chevron). */
export function useMenuOpen() {
  return useContext(MenuOpenContext);
}

export const MenuTrigger = MenuPrimitive.Trigger;

/** Shadows measured in the prototypes (styles.css --shadow-menu / --shadow-menu-lg). */
const contentClass: Record<MenuSize, string> = {
  compact: "min-w-[220px] rounded-md p-1.5 shadow-[var(--shadow-menu)]",
  large: "w-[320px] max-w-[calc(100vw-24px)] rounded-[20px] p-2 shadow-[var(--shadow-menu-lg)]",
  status: "w-[360px] max-w-[calc(100vw-24px)] rounded-[20px] p-2 shadow-[var(--shadow-menu-lg)]",
};

const contentVariants: Variants = {
  hidden: { opacity: 0, y: -6, scale: 0.97, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { ...SPRING.smooth, staggerChildren: 0.03 },
  },
  exit: { opacity: 0, transition: exitTransition },
};

const reducedContentVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: REDUCED_FADE },
  exit: { opacity: 0, transition: REDUCED_FADE },
};

/** Items fade up 4 px, staggered 30 ms by the content; no own exit. */
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE.out } },
};

const noVariants: Variants = {};

function useItemVariants(): Variants {
  return useContext(ReducedContext) ? noVariants : itemVariants;
}

export const MenuContent = forwardRef<
  HTMLDivElement,
  Omit<ComponentPropsWithoutRef<typeof MenuPrimitive.Content>, "asChild" | "forceMount"> & {
    size?: MenuSize;
  }
>(function MenuContent(
  {
    size = "compact",
    className,
    children,
    sideOffset = 6,
    align = "start",
    onKeyDownCapture,
    ...props
  },
  ref,
) {
  const open = useContext(MenuOpenContext);
  const reduced = useReducedMotion();
  // The menu opens with focus on its first item, which can be a paid step: a double or held
  // Enter must not choose it (harden E9).
  const openedAt = useRef(0);
  useEffect(() => {
    if (open) openedAt.current = performance.now();
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <MenuPrimitive.Portal forceMount>
          <MenuPrimitive.Content
            ref={ref}
            forceMount
            asChild
            sideOffset={sideOffset}
            align={align}
            collisionPadding={12}
            {...props}
            onKeyDownCapture={(event) => {
              if (ignoreMenuKey(event.key, event.repeat, performance.now() - openedAt.current)) {
                event.preventDefault();
                event.stopPropagation();
              }
              onKeyDownCapture?.(event);
            }}
          >
            <motion.div
              className={cn(
                "z-[110] max-h-[min(var(--radix-dropdown-menu-content-available-height),calc(100vh-40px))] overflow-auto bg-surface text-ink-1 outline-none",
                "origin-[var(--radix-dropdown-menu-content-transform-origin)]",
                contentClass[size],
                className,
              )}
              variants={reduced ? reducedContentVariants : contentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <MenuSizeContext.Provider value={size}>
                <ReducedContext.Provider value={Boolean(reduced)}>
                  {children}
                </ReducedContext.Provider>
              </MenuSizeContext.Provider>
            </motion.div>
          </MenuPrimitive.Content>
        </MenuPrimitive.Portal>
      )}
    </AnimatePresence>
  );
});

type ToneName =
  "action" | "ai" | "warning" | "positive" | "critical" | "ink-2" | "ink-3" | "series-7";
type WashName =
  | "action-wash"
  | "ai-wash"
  | "warning-wash"
  | "positive-wash"
  | "critical-wash"
  | "bg-sunken"
  /** A token tinted at 14 % (Brugere og adgang: the role tiles have no wash token). */
  | `color-mix(${string}`;

export interface MenuTone {
  color: ToneName;
  wash: WashName;
}

const cssVar = (name: string) => (name.startsWith("color-mix(") ? name : `var(--${name})`);

/**
 * The top of a large menu: the case with its phase and status (Cases v4), or the current
 * status with a 40 px tile and the history line (CaseStatus).
 */
export function MenuHeader({
  title,
  status,
  dot,
  icon: Icon,
  tone,
}: {
  title: ReactNode;
  status?: ReactNode;
  /** Status dot colour as a CSS colour (use a token: "var(--positive)"). */
  dot?: string;
  /** Status menu: tinted tile with the current status icon. */
  icon?: LucideIcon;
  tone?: MenuTone;
}) {
  if (Icon) {
    const colors = tone ?? { color: "ink-3", wash: "bg-sunken" };
    return (
      <div className="mb-1.5 flex items-center gap-3 border-b border-line px-3 pt-3 pb-3.5">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-[12px]"
          style={{ background: cssVar(colors.wash), color: cssVar(colors.color) }}
        >
          <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[17px] font-semibold tracking-[-0.01em]">{title}</span>
          {status && (
            // A long note or a URL wraps and stops after three lines (harden C12).
            <span className="line-clamp-3 text-meta leading-[1.4] [overflow-wrap:anywhere] text-ink-3">
              {status}
            </span>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className="mb-1 flex items-center gap-2.5 border-b border-line px-2.5 pt-2 pb-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold">{title}</span>
        {status && (
          <span className="flex items-center gap-1.5 text-meta text-ink-3">
            {dot && (
              <span className="size-[7px] shrink-0 rounded-full" style={{ background: dot }} />
            )}
            {status}
          </span>
        )}
      </span>
    </div>
  );
}

/** Group heading ("Fase", "Status", "Beslutning"): 11/600 ink-4. */
export function MenuLabel({ children }: { children: ReactNode }) {
  const size = useContext(MenuSizeContext);
  return (
    <MenuPrimitive.Label
      className={cn(
        "block pt-3 pb-1 text-micro font-semibold tracking-[0.02em] text-ink-4",
        size === "status" ? "px-3" : "px-2.5",
      )}
    >
      {children}
    </MenuPrimitive.Label>
  );
}

export function MenuSeparator() {
  return <MenuPrimitive.Separator className="mx-1.5 my-1.5 h-px bg-line" />;
}

export interface MenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  /** Lucide icon; in the large and status menus it sits in a tinted tile. */
  icon?: LucideIcon;
  /** Tile colours as token names (src/lib/copy/actions.ts tones). */
  tone?: MenuTone;
  /** Second line (11/12 px ink-3); in the compact menu the row grows to two lines. */
  description?: ReactNode;
  /** Marks the recommended next step ("Anbefalet" in ai-ink). */
  recommended?: boolean;
  /** Current state: dimmed with a check, not selectable. */
  current?: boolean;
  /** Compact menu: single choice with the violet check on the left (fund switcher). */
  checked?: boolean;
  disabled?: boolean;
  /** Destructive rows turn the text critical in the compact menu. */
  destructive?: boolean;
  className?: string;
}

const rowClass: Record<Exclude<MenuSize, "compact">, string> = {
  large: "min-h-[50px] gap-3 rounded-[12px] px-2.5 py-1.5",
  status: "min-h-[60px] gap-3.5 rounded-[14px] px-3 py-2",
};

export function MenuItem({
  children,
  onSelect,
  icon: Icon,
  tone = { color: "ink-3", wash: "bg-sunken" },
  description,
  recommended = false,
  current = false,
  checked,
  disabled = false,
  destructive = false,
  className,
}: MenuItemProps) {
  const t = useT();
  const size = useContext(MenuSizeContext);
  const variants = useItemVariants();
  const inactive = disabled || current;

  if (size !== "compact") {
    const status = size === "status";
    return (
      <MenuPrimitive.Item
        asChild
        disabled={inactive}
        onSelect={() => {
          if (!inactive) onSelect?.();
        }}
      >
        <motion.div
          variants={variants}
          className={cn(
            "flex w-full cursor-pointer items-center text-left outline-none transition-colors duration-[180ms]",
            rowClass[size],
            "data-[highlighted]:bg-hover",
            inactive && "cursor-default data-[highlighted]:bg-transparent",
            // "Handlinger v2": the current state is dimmed with a check. The dimming
            // sits on the children: motion writes an inline opacity on the row itself.
            current && "[&>*]:opacity-60",
            disabled && "[&>*]:opacity-45",
            className,
          )}
        >
          {Icon && (
            <span
              className={cn(
                "grid shrink-0 place-items-center",
                status ? "size-[38px] rounded-[11px]" : "size-[34px] rounded-sm",
              )}
              style={{ background: cssVar(tone.wash), color: cssVar(tone.color) }}
            >
              <Icon
                className={status ? "size-[17px]" : "size-[15px]"}
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-[1.3]">
            <span className={cn("font-medium text-ink-1", status ? "text-[15px]" : "text-[14px]")}>
              {children}
            </span>
            {description && (
              <span className={cn("text-ink-3", status ? "text-meta" : "text-micro")}>
                {description}
              </span>
            )}
          </span>
          {recommended && !current && (
            <span className="shrink-0 text-micro font-medium text-ai-ink">
              {t("shell.menu.recommended")}
            </span>
          )}
          {current && (
            <Check
              className="size-4 shrink-0 text-ink-3"
              strokeWidth={1.75}
              aria-label={t("shell.menu.current")}
            />
          )}
        </motion.div>
      </MenuPrimitive.Item>
    );
  }

  return (
    <MenuPrimitive.Item
      asChild
      disabled={disabled}
      onSelect={() => {
        if (!disabled) onSelect?.();
      }}
    >
      <motion.div
        variants={variants}
        // Only set when it is a choice: an explicit undefined would override Radix's role.
        {...(checked === undefined ? {} : { role: "menuitemradio", "aria-checked": checked })}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-left text-list text-ink-1 outline-none transition-colors duration-[var(--dur-quick)]",
          description ? "min-h-11 py-1.5" : "h-9",
          "data-[highlighted]:bg-hover",
          disabled && "cursor-default [&>*]:opacity-45 data-[highlighted]:bg-transparent",
          destructive && "text-critical",
          className,
        )}
      >
        {checked !== undefined && (
          <Check
            className="size-[13px] shrink-0 text-action"
            style={{ opacity: checked ? 1 : 0 }}
            strokeWidth={2}
            aria-hidden
          />
        )}
        {Icon && (
          <Icon className="size-[15px] shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
        )}
        {description ? (
          <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
            <span className="truncate font-medium">{children}</span>
            <span className="truncate text-micro text-ink-4">{description}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{children}</span>
        )}
      </motion.div>
    </MenuPrimitive.Item>
  );
}

/** Multi-select row with a violet check (Cases v4 filters). Keeps the menu open. */
export function MenuCheckItem({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  const variants = useItemVariants();
  return (
    <MenuPrimitive.CheckboxItem
      asChild
      checked={checked}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      onSelect={(event) => event.preventDefault()}
    >
      <motion.div
        variants={variants}
        className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-left text-list text-ink-1 outline-none transition-colors duration-[var(--dur-quick)] data-[highlighted]:bg-hover"
      >
        <Check
          className="size-[13px] shrink-0 text-action transition-opacity duration-[var(--dur-quick)]"
          style={{ opacity: checked ? 1 : 0 }}
          strokeWidth={2}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </motion.div>
    </MenuPrimitive.CheckboxItem>
  );
}
