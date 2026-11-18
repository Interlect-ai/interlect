import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FundLanguageProvider } from "@/lib/i18n/I18nProvider";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { themePrePaintScript } from "../lib/theme";
import { getPublicAppConfig } from "../lib/supabase/config.functions";
import { setPublicSupabaseConfig } from "../lib/supabase/client";
import { InterlectLogo } from "../components/brand/InterlectLogo";
import { ToastViewport } from "../components/ds/Toast";
import { useT } from "../lib/i18n/useT";
import { translate } from "../lib/i18n/translate";

function NotFoundComponent() {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="panel max-w-md p-8 text-center">
        <InterlectLogo size={26} className="mx-auto mb-6" />
        <p className="display-title text-display leading-none text-ink">404</p>
        <h1 className="mt-3 text-section font-semibold text-ink">
          {t("shell.root.notFoundTitle")}
        </h1>
        <p className="mt-2 text-list leading-5 text-ink-3">{t("shell.root.notFoundBody")}</p>
        <div className="mt-6">
          <Link to="/" className="pill-cta">
            {t("shell.root.goToOverview")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const t = useT();

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="panel max-w-md p-8 text-center">
        <InterlectLogo size={26} className="mx-auto mb-6" />
        <h1 className="text-section font-semibold text-ink">{t("shell.root.errorTitle")}</h1>
        <p className="mt-2 text-list leading-5 text-ink-3">{t("shell.root.errorBody")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="pill-cta"
          >
            {t("common.retry")}
          </button>
          <a href="/" className="control-button">
            {t("shell.root.goToOverview")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Interlect" },
      { name: "description", content: translate("da", "pages.root.description") },
      { property: "og:title", content: "Interlect" },
      { property: "og:description", content: translate("da", "pages.root.description") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),

  loader: () => getPublicAppConfig(),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="da" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themePrePaintScript }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { supabase: supabaseConfig, language: installationLanguage } = Route.useLoaderData();
  setPublicSupabaseConfig(supabaseConfig);

  return (
    <QueryClientProvider client={queryClient}>
      <script
        // Offentlig konfiguration (projekt-URL + publishable nøgle) til browserklienten.
        dangerouslySetInnerHTML={{
          __html: `window.__PAP_SUPABASE__=${JSON.stringify(supabaseConfig).replace(/</g, "\\u003c")}`,
        }}
      />
      {/* Brugerens "reducer bevægelse" gælder al motion i produktet (designrapport 08, P4). */}
      <MotionConfig reducedMotion="user">
        {/* The interface follows the active fund's language; before a team is
            known, the installation's. */}
        <FundLanguageProvider installationLanguage={installationLanguage}>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <ToastViewport />
        </FundLanguageProvider>
      </MotionConfig>
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast:
              "!rounded-md !border !border-hairline !bg-surface !text-ink !shadow-[var(--shadow-overlay)] !font-[family-name:var(--font-interface)]",
            title: "!text-body !font-semibold",
            description: "!text-list !text-ink-3",
          },
        }}
      />
    </QueryClientProvider>
  );
}
