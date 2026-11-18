import { useMemo, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { getInternalPagesEnabled } from "@/lib/internal/internal-pages.functions";
import { FlaskConical } from "lucide-react";
import { BrainChatPane } from "@/components/brain/BrainChatPane";
import { AppShell } from "@/components/ds/AppShell";
import { Button } from "@/components/ds/Button";
import { ErrorState, LoadingState, NoAccess } from "@/components/ds/States";
import { isAdminRole } from "@/lib/auth/is-admin";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import type { ChatTransport } from "@/lib/brain/chat-contract";
import { TEST_ENGINE_LABEL, TEST_SCENARIOS, testEngine } from "@/lib/brain/test-engine";
import { useActiveFund } from "@/lib/funds/useActiveFund";

export const Route = createFileRoute("/intern/brain-test")({
  // Never in a customer installation (they run production); decided on the server.
  beforeLoad: async () => {
    if (!(await getInternalPagesEnabled())) throw notFound();
  },
  head: () => ({
    meta: [
      { title: "Brain · Testmotor (intern) — Interlect" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BrainTestRoute,
});

/**
 * Admin-only page that runs the Brain chat UI against the MARKED test engine, until
 * session B's `/api/brain/chat` exists. No customer page links here or imports the engine; no
 * database, model or network is used; every answer is invented and says so.
 */
function BrainTestRoute() {
  const { fundId, isLoading: fundsLoading } = useActiveFund();
  const access = useMyAccess(fundId);
  const [run, setRun] = useState(0);
  const transport = useMemo<ChatTransport>(
    () => (request, signal) => testEngine(request, signal),
    [],
  );
  return (
    <AppShell title="Brain · Testmotor" redesigned ask={false}>
      {fundsLoading || access.isLoading ? (
        <LoadingState />
      ) : access.isError || !fundId || !access.data ? (
        <ErrorState onRetry={() => void access.refetch()} />
      ) : !isAdminRole(access.data.roles) ? (
        <NoAccess body="Denne side er kun for admins." />
      ) : (
        <BrainChatPane
          key={run}
          fundId={fundId}
          firstName={access.data.fullName?.trim().split(/\s+/)[0] ?? null}
          threadId={null}
          transport={transport}
          title="Testmotor"
          banner={
            <div
              role="note"
              className="mx-5 mb-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] bg-warning-wash px-4 py-3 text-meta text-ink-1"
            >
              <FlaskConical
                className="size-4 shrink-0 text-warning"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="font-semibold">{TEST_ENGINE_LABEL}</span>
              <span className="min-w-0 flex-1">
                Alle svar er opdigtede og kommer ikke fra Brain. Skriv et af ordene:{" "}
                {TEST_SCENARIOS.map((scenario) => scenario.word).join(", ")}.
              </span>
              <Button variant="secondary" size="sm" onClick={() => setRun((n) => n + 1)}>
                Start forfra
              </Button>
            </div>
          }
        />
      )}
    </AppShell>
  );
}
