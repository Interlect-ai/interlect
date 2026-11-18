/**
 * The app shell ("App-skal"): the menu on the canvas to the left and the work
 * area as one large card (surface, radius 20, card shadow) with 10 px of air around it.
 *
 * Rebuilt pages pass `redesigned` and draw their own header inside the card. Pages not yet
 * rebuilt get the title row at the top of the card (40 px title, the page's buttons to the
 * right) and keep the old text and radius scale (`data-legacy-scale`).
 *
 * Desktop: the card scrolls on its own (`#workspace`), the menu stays put. Mobile: a top
 * bar with the logo and a menu button that opens the same menu as a drawer; the page scrolls
 * normally.
 *
 * Spørg Interlect sits in the corner of every page with the page's context (`ask`):
 * a case page passes its case, every other page asks about all the fund's cases, and `false`
 * leaves it out (Brain itself). It is rendered outside the animated card: a transformed
 * ancestor would break its fixed position.
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { RequireSession } from "@/components/auth/RequireSession";
import { AskInterlect } from "@/components/brain/AskInterlect";
import { DemoDataBanner } from "@/components/demo/DemoDataBanner";
import { AppRail, RailContent } from "@/components/ds/AppRail";
import { MobileTopBar } from "@/components/ds/MobileTopBar";
import { ASK_ALL_CASES, type AskContext } from "@/lib/brain/ask";
import { useDemoData } from "@/lib/demo/useDemoData";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Id of the scrolling work area; use `scrollWorkspaceToTop()` instead of window.scrollTo. */
export const WORKSPACE_ID = "workspace";

/** Scrolls the work area to the top: the card on desktop, the window on mobile. */
export function scrollWorkspaceToTop(behavior: ScrollBehavior = "smooth") {
  const el = document.getElementById(WORKSPACE_ID);
  if (el && el.scrollHeight > el.clientHeight) el.scrollTo({ top: 0, behavior });
  else window.scrollTo({ top: 0, behavior });
}

export function AppShell({
  title,
  description,
  meta,
  actions,
  redesigned = false,
  railExtra,
  ask = ASK_ALL_CASES,
  children,
}: {
  title: string;
  description?: string | undefined;
  meta?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  /** The page is built to the redesign and draws its own header. */
  redesigned?: boolean;
  /** Extra content under the menu (Brain's conversation history). */
  railExtra?: ReactNode;
  /** What Spørg Interlect knows on this page; `false` hides it. */
  ask?: AskContext | false | undefined;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  // Self-host demo data (0900): the banner sits above the page while there is demo data.
  const demo = useDemoData();
  const page = redesigned ? (
    children
  ) : (
    <LegacyPage title={title} description={description} meta={meta} actions={actions}>
      {children}
    </LegacyPage>
  );
  return (
    <div className="min-h-screen bg-canvas text-ink-1 md:flex md:h-screen md:overflow-hidden md:p-2.5 print:block print:h-auto print:min-h-0 print:overflow-visible print:bg-transparent print:p-0">
      <AppRail extra={railExtra} />
      <MobileTopBar>{(close) => <RailContent onNavigate={close} extra={railExtra} />}</MobileTopBar>
      <main
        id={WORKSPACE_ID}
        style={{ viewTransitionName: "page" }}
        // The card scrolls on desktop; TanStack Router restores elements with this id.
        data-scroll-restoration-id={WORKSPACE_ID}
        className="relative mx-2 mb-2 min-w-0 rounded-lg bg-surface shadow-card md:m-0 md:flex-1 md:overflow-auto print:m-0 print:overflow-visible print:rounded-none print:bg-transparent print:shadow-none"
      >
        {/* Page change: crossfade 200 ms and y 8 → 0 on the content. */}
        <motion.div
          className={cn(redesigned && "h-full print:h-auto")}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          // Indgangen er 460 ms (sideskift) efter den gamle sides udtoning (160 ms).
          transition={reduced ? REDUCED_FADE : { duration: 0.46, delay: 0.1, ease: EASE.out }}
        >
          <RequireSession>
            {/* The same tree with and without the banner, so the page never remounts. */}
            <div className={cn("flex flex-col", redesigned && "h-full print:h-auto")}>
              {demo.visible && demo.fundId && (
                <DemoDataBanner fundId={demo.fundId} cases={demo.cases} />
              )}
              <div className={cn("min-w-0", redesigned && "min-h-0 flex-1")}>{page}</div>
            </div>
          </RequireSession>
        </motion.div>
      </main>
      {ask && <AskInterlect context={ask} />}
    </div>
  );
}

/** Title row in the card for pages not yet rebuilt; the content keeps the old scale. */
function LegacyPage({
  title,
  description,
  meta,
  actions,
  children,
}: {
  title: string;
  description?: string | undefined;
  meta?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
}) {
  return (
    <div className="max-w-[1240px] px-4 pt-6 pb-16 md:px-10 md:pt-[30px] md:pb-20">
      <header className="mb-[22px] flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="m-0 text-[30px] leading-[1.05] font-semibold tracking-display text-ink-1 md:text-[40px]">
            {title}
          </h1>
          {description && <p className="m-0 text-[15px] leading-snug text-ink-3">{description}</p>}
        </div>
        <div className="flex-1" />
        {(meta || actions) && (
          <div data-legacy-scale="" className="flex flex-wrap items-center gap-2">
            {meta && <div className="hidden items-center gap-4 lg:flex">{meta}</div>}
            {actions}
          </div>
        )}
      </header>
      <div data-legacy-scale="">{children}</div>
    </div>
  );
}
