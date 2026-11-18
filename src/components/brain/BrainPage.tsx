/**
 * `/brain` (batch 1): the shell around the conversation. It asks the capability probe
 * first and shows a calm "not available" page unless chat works for this fund AND this role;
 * only then does it read threads. Own private threads and the team's come from RLS; the thread
 * in the URL (`?traad=<id>`) is an id, never content.
 *
 * The engine (`/api/brain/chat`) is session B's: until `CHAT_ROUTE_READY` is true the probe says
 * "no" and this page never talks to it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense } from "react";
import { proposeBrainWebQueries } from "@/lib/brain/web.functions";
import { Brain as BrainIcon } from "lucide-react";
import { AppShell } from "@/components/ds/AppShell";
import { Button } from "@/components/ds/Button";
import { EmptyState, ErrorState, LoadingState, NoAccess } from "@/components/ds/States";
import { showToast } from "@/components/ds/Toast";
import { BrainChatPane, type AnswerActions } from "@/components/brain/BrainChatPane";
import { AnswerFindField } from "@/components/cases/deep/FindWithBrain";
import { fieldsAskedFor } from "@/lib/brain/field-question";
import { SOURCES_BUTTON_ID, ThreadList, type ThreadActions } from "@/components/brain/ThreadList";
import { BrainSourcesDrawer } from "@/components/brain/BrainSourcesDrawer";
import {
  deleteBrainThread,
  getBrainThread,
  listBrainThreads,
  renameBrainThread,
  saveBrainAnswerAsNote,
  saveBrainAnswerToBrain,
  searchBrainMentions,
  setBrainThreadVisibility,
  submitBrainFeedback,
} from "@/lib/brain/chat.functions";
import { createHttpChatTransport } from "@/lib/brain/chat-client";
import { turnsFromMessages } from "@/lib/brain/chat-model";
import { showBrain } from "@/lib/brain/capabilities";
import { useBrainCapabilities } from "@/lib/brain/useBrainCapabilities";
import { isAdminRole } from "@/lib/auth/is-admin";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { supabase } from "@/lib/supabase/client";
import type { BrainThreadSummary } from "@/lib/brain/chat-contract";
import { brainThreadsQueryKey } from "@/lib/brain/threads";
import { useT } from "@/lib/i18n/useT";
import { isServerRefusal } from "@/lib/errors/server-refusal";

const threadsKey = brainThreadsQueryKey;
const threadKey = (fundId: string | null, id: string | null) =>
  ["brain-thread", fundId, id] as const;

/** Hjernekortet er sin egen chunk: tegnekoden hentes først, når kortet åbnes. */
const BrainMap = lazy(() =>
  import("@/components/brain/BrainMap").then((m) => ({ default: m.BrainMap })),
);

export function BrainPage({
  threadId,
  map = false,
  sources = false,
}: {
  threadId: string | undefined;
  /** Hjernekortet er åbent (`?vis=kort`). */
  map?: boolean;
  /** Kilder er åben (`?vis=kilder`). */
  sources?: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { fundId, isLoading: fundsLoading } = useActiveFund();
  const access = useMyAccess(fundId);
  const caps = useBrainCapabilities();

  // Switching fund keeps the URL: the thread in it belongs to the fund we left. It is dropped
  // (never asked for under the new fund) and the URL is cleared once.
  const [seen, setSeen] = useState({ fundId, staleThread: null as string | null });
  if (seen.fundId !== fundId) {
    // The first fund to arrive (after loading) is not a switch: its URL thread is kept.
    setSeen({ fundId, staleThread: seen.fundId ? (threadId ?? null) : null });
  }
  const urlThread = threadId && threadId === seen.staleThread ? undefined : threadId;
  useEffect(() => {
    if (seen.staleThread && threadId === seen.staleThread) {
      void navigate({ to: "/brain", search: {}, replace: true });
    }
  }, [navigate, seen.staleThread, threadId]);

  if (fundsLoading || access.isLoading || caps.isLoading) {
    return (
      <AppShell title="Brain" redesigned ask={false}>
        <LoadingState title={t("brainChat.page.loading")} />
      </AppShell>
    );
  }
  if (!fundId || access.isError || !access.data) {
    return (
      <AppShell title="Brain" redesigned ask={false}>
        <ErrorState onRetry={() => void access.refetch()} />
      </AppShell>
    );
  }
  if (caps.isError) {
    return (
      <AppShell title="Brain" redesigned ask={false}>
        <ErrorState
          title={t("brainChat.page.loadFailedTitle")}
          body={t("brainChat.page.loadFailedBody")}
          onRetry={() => void caps.refetch()}
        />
      </AppShell>
    );
  }
  const capabilities = caps.data;
  if (!capabilities?.enabled || !capabilities.chat) {
    return (
      <AppShell title="Brain" redesigned ask={false}>
        <EmptyState
          icon={BrainIcon}
          title={t("brainChat.page.disabledTitle")}
          body={t("brainChat.page.disabledBody")}
        />
      </AppShell>
    );
  }
  if (!showBrain(capabilities)) {
    return (
      <AppShell title="Brain" redesigned ask={false}>
        <NoAccess title={t("brainChat.page.noRoleTitle")} body={t("brainChat.page.noRoleBody")} />
      </AppShell>
    );
  }
  return (
    <BrainWorkspace
      // A new fund is a new workspace: no turns, thread or cache from the fund we left.
      key={fundId}
      fundId={fundId}
      firstName={firstNameOf(access.data.fullName)}
      isAdmin={isAdminRole(access.data.roles)}
      threadId={urlThread}
      map={map}
      sources={sources}
    />
  );
}

function firstNameOf(fullName: string | null | undefined): string | null {
  return fullName?.trim().split(/\s+/)[0] || null;
}

function BrainWorkspace({
  fundId,
  firstName,
  isAdmin,
  threadId,
  map,
  sources,
}: {
  fundId: string;
  firstName: string | null;
  isAdmin: boolean;
  threadId: string | undefined;
  map: boolean;
  sources: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useServerFn(listBrainThreads);
  const get = useServerFn(getBrainThread);
  const rename = useServerFn(renameBrainThread);
  const share = useServerFn(setBrainThreadVisibility);
  const remove = useServerFn(deleteBrainThread);
  const mentions = useServerFn(searchBrainMentions);
  const proposeQueries = useServerFn(proposeBrainWebQueries);
  const rateAnswer = useServerFn(submitBrainFeedback);
  const noteAnswer = useServerFn(saveBrainAnswerAsNote);
  const brainAnswer = useServerFn(saveBrainAnswerToBrain);
  // Every role with Brain may write case notes (`write_notes`); the server checks both again.
  const answerActions = useMemo<AnswerActions>(
    () => ({
      feedback: async (messageId, rating, details) => {
        await rateAnswer({ data: { fundId, messageId, rating, ...details } });
      },
      saveNote: async (messageId, caseId) =>
        (await noteAnswer({ data: { fundId, messageId, caseId } })).caseName,
      saveToBrain: async (messageId) => (await brainAnswer({ data: { fundId, messageId } })).saved,
      findField: (caseId, question) => {
        const asked = fieldsAskedFor(question);
        return asked ? <AnswerFindField fundId={fundId} caseId={caseId} asked={asked} /> : null;
      },
    }),
    [brainAnswer, fundId, noteAnswer, rateAnswer],
  );

  // The pane remounts only when the user picks another conversation, never when the first
  // question creates the thread (that would cut the running answer).
  const [paneKey, setPaneKey] = useState(0);
  const createdHere = useRef<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(threadId ?? null);
  // Threads that got new messages here after they were loaded: their cached copy is old and is
  // dropped before the thread is opened again (otherwise the new answer looks lost).
  const changed = useRef(new Set<string>());
  const open = useCallback(
    (id: string | null) => {
      if (id && changed.current.delete(id)) {
        queryClient.removeQueries({ queryKey: threadKey(fundId, id) });
      }
      createdHere.current = null;
      setActiveId(id);
      setPaneKey((key) => key + 1);
    },
    [fundId, queryClient],
  );
  // The marks die with this page, but the query cache does not: leaving /brain (a source chip,
  // the menu) and coming back would show the old copy. Drop the changed threads on the way out.
  useEffect(() => {
    const marks = changed.current;
    return () => {
      for (const id of marks) queryClient.removeQueries({ queryKey: threadKey(fundId, id) });
      marks.clear();
    };
  }, [fundId, queryClient]);

  useEffect(() => {
    // The URL changed by something other than this page (back button, a link).
    if ((threadId ?? null) === activeId) return;
    if (threadId && threadId === createdHere.current) return;
    open(threadId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the URL only
  }, [threadId]);

  const threads = useQuery({
    queryKey: threadsKey(fundId),
    queryFn: () => list({ data: { fundId } }),
    retry: false,
  });
  const loaded = useQuery({
    queryKey: threadKey(fundId, activeId),
    queryFn: () => get({ data: { fundId, threadId: activeId! } }),
    enabled: Boolean(activeId) && activeId !== createdHere.current,
    retry: false,
    staleTime: Infinity,
  });

  const transport = useMemo(
    () =>
      createHttpChatTransport({
        getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      }),
    [],
  );
  const searchMentions = useCallback(
    (q: string) => mentions({ data: { fundId, q } }),
    [fundId, mentions],
  );
  const proposeWeb = useCallback(
    (input: { question: string; caseId: string | null; entityIds: string[] }) =>
      proposeQueries({ data: { fundId, ...input } }),
    [fundId, proposeQueries],
  );
  const refreshThreads = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: threadsKey(fundId) }),
    [fundId, queryClient],
  );

  const select = (id: string | null) => {
    open(id);
    // Open Kilder stays open beside the conversation the user picks.
    void navigate({
      to: "/brain",
      search: { ...(id ? { traad: id } : {}), ...(sources ? { vis: "kilder" as const } : {}) },
    });
  };

  const fail = (message: string) => showToast({ message, tone: "error" });
  const actions: ThreadActions = {
    onRename: async (thread, title) => {
      try {
        await rename({ data: { fundId, threadId: thread.id, title } });
        refreshThreads();
      } catch {
        fail(t("brainChat.page.renameFailed"));
      }
    },
    onToggleShare: async (thread) => {
      const next = thread.visibility === "team" ? "private" : "team";
      try {
        await share({ data: { fundId, threadId: thread.id, visibility: next } });
        refreshThreads();
        showToast({
          message:
            next === "team" ? t("brainChat.page.sharedToast") : t("brainChat.page.privateToast"),
        });
      } catch {
        fail(t("brainChat.page.shareFailed"));
      }
    },
    onDelete: async (thread) => {
      try {
        await remove({ data: { fundId, threadId: thread.id } });
        queryClient.removeQueries({ queryKey: threadKey(fundId, thread.id) });
        refreshThreads();
        if (thread.id === activeId) select(null);
        showToast({ message: t("brainChat.page.deletedToast") });
      } catch {
        fail(t("brainChat.page.deleteFailed"));
      }
    },
  };

  const toggleSources = () =>
    void navigate({
      to: "/brain",
      search: {
        ...(activeId ? { traad: activeId } : {}),
        ...(sources ? {} : { vis: "kilder" as const }),
      },
    });
  const closeSources = () => {
    toggleSources();
    document.getElementById(SOURCES_BUTTON_ID)?.focus();
  };

  const items: BrainThreadSummary[] = threads.data ?? [];
  const active = items.find((thread) => thread.id === activeId) ?? loaded.data?.thread ?? null;

  const rail = (
    <ThreadList
      threads={items}
      activeId={activeId}
      isAdmin={isAdmin}
      loading={threads.isLoading}
      failed={threads.isError}
      onNew={() => select(null)}
      onSelect={(thread) => select(thread.id)}
      actions={actions}
      sources={{ open: sources, onToggle: toggleSources }}
    />
  );

  const threadCase =
    active?.caseId && active.caseName ? { id: active.caseId, name: active.caseName } : null;
  const loadingThread = Boolean(activeId) && activeId !== createdHere.current && loaded.isLoading;
  // The server's "not found or not yours" refusal (getBrainThread); anything else is a failure.
  const notFound = isServerRefusal(loaded.error, "brainServer.chat.threadNotFound");
  return (
    <AppShell title="Brain" redesigned ask={false} railExtra={rail}>
      {map ? (
        <Suspense fallback={<LoadingState title={t("brainChat.page.loadingMap")} />}>
          <BrainMap
            fundId={fundId}
            onBack={() =>
              void navigate({ to: "/brain", search: activeId ? { traad: activeId } : {} })
            }
          />
        </Suspense>
      ) : loadingThread ? (
        <LoadingState title={t("brainChat.page.loadingThread")} />
      ) : loaded.isError && activeId !== createdHere.current ? (
        notFound ? (
          <ErrorState
            title={t("brainChat.page.threadOpenFailedTitle")}
            body={t("brainChat.page.threadOpenFailedBody")}
          >
            <Button variant="secondary" size="md" onClick={() => select(null)}>
              {t("brainChat.page.newThread")}
            </Button>
          </ErrorState>
        ) : (
          <ErrorState
            title={t("brainChat.page.threadLoadFailedTitle")}
            body={t("brainChat.page.threadLoadFailedBody")}
            onRetry={() => void loaded.refetch()}
          />
        )
      ) : (
        <BrainChatPane
          key={paneKey}
          fundId={fundId}
          firstName={firstName}
          threadId={activeId}
          sourcePanel
          initialTurns={loaded.data ? turnsFromMessages(loaded.data.messages, threadCase) : []}
          transport={transport}
          title={active?.title ?? null}
          searchMentions={searchMentions}
          proposeWeb={proposeWeb}
          onOpenMap={() =>
            void navigate({
              to: "/brain",
              search: activeId ? { traad: activeId, vis: "kort" } : { vis: "kort" },
            })
          }
          onThreadCreated={(id) => {
            createdHere.current = id;
            setActiveId(id);
            // The search as it is NOW (the answer arrives later than the click): an open Kilder
            // stays as the user left it.
            void navigate({
              to: "/brain",
              search: (prev) => ({ ...prev, traad: id }),
              replace: true,
            });
            refreshThreads();
          }}
          onAnswered={(id) => {
            if (id) changed.current.add(id);
            refreshThreads();
          }}
          readOnly={
            active && !active.isMine
              ? { ownerName: active.ownerName, onNewConversation: () => select(null) }
              : undefined
          }
          threadCase={threadCase}
          answerActions={answerActions}
        />
      )}
      {sources && <BrainSourcesDrawer fundId={fundId} onClose={closeSources} />}
    </AppShell>
  );
}
