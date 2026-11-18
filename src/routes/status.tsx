import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle } from "lucide-react";
import { InterlectLogo } from "@/components/brand/InterlectLogo";
import { installationHealth } from "@/lib/health.server";
import { serverSupabasePublishableKey, serverSupabaseUrl } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/useT";
import { pageMeta } from "@/lib/i18n/page-head";

interface StatusCheck {
  /** Text key under `system.status`. */
  label: "login" | "database" | "ai" | "cvr";
  ok: boolean;
  critical: boolean;
}

const getStatus = createServerFn({ method: "GET" }).handler(async (): Promise<StatusCheck[]> => {
  const hasSupabase = Boolean(serverSupabaseUrl() && serverSupabasePublishableKey());
  // The same check as /api/health: the database answers, not only that its settings are
  // there. Only up or down leaves the server.
  const health = await installationHealth();
  const hasCvrLookup = Boolean(process.env["DATAFORDELER_API_KEY"]?.trim());

  return [
    { label: "login", ok: hasSupabase, critical: true },
    { label: "database", ok: health.database, critical: true },
    { label: "ai", ok: health.ai, critical: true },
    { label: "cvr", ok: hasCvrLookup, critical: false },
  ];
});

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [...pageMeta("status"), { name: "robots", content: "noindex" }],
  }),
  loader: () => getStatus(),
  component: StatusPage,
});

function StatusPage() {
  const checks = Route.useLoaderData();
  const t = useT();
  const criticalDown = checks.some((check) => check.critical && !check.ok);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="panel w-full max-w-sm space-y-4 p-6">
        <div className="space-y-1">
          <InterlectLogo size={26} />
          <p className="text-list text-ink-3">{t("system.status.subtitle")}</p>
        </div>

        <ul className="space-y-2.5">
          {checks.map((check) => (
            <li key={check.label} className="flex items-start gap-2.5">
              {check.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
              ) : (
                <XCircle
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    check.critical ? "text-critical" : "text-ink-3",
                  )}
                  aria-hidden
                />
              )}
              <span className="text-list text-ink">
                {t(`system.status.${check.label}`)}
                {!check.ok && !check.critical && (
                  <span className="ml-1.5 text-meta text-ink-3">
                    {t("system.status.optionalNotSet")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {criticalDown && (
          <p className="border-t border-hairline pt-3 text-meta leading-4 text-critical">
            {t("system.status.criticalDown")}
          </p>
        )}
      </div>
    </div>
  );
}
