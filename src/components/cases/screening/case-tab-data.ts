/**
 * The data behind the case tabs (Noter, Beskeder, Filer): queries, live messages and the
 * "unread" dot. Kept apart from the components so the component file only exports components.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCaseNotes } from "@/lib/cases/cases.functions";
import { listCaseMessages, type CaseMessage } from "@/lib/cases/messages.functions";
import { listCaseFiles } from "@/lib/cases/files.functions";
import { supabase } from "@/lib/supabase/client";
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";

const TIME_ZONE = "Europe/Copenhagen";
// "en-CA" is not the interface language: it only gives the day as yyyy-mm-dd to compare days.
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const formats = new Map<Language, { clock: Intl.DateTimeFormat; shortDate: Intl.DateTimeFormat }>();

function formatsFor(language: Language) {
  let found = formats.get(language);
  if (!found) {
    found = {
      clock: new Intl.DateTimeFormat(LANGUAGE_TAGS[language], {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
      }),
      shortDate: new Intl.DateTimeFormat(LANGUAGE_TAGS[language], {
        timeZone: TIME_ZONE,
        day: "numeric",
        month: "short",
      }),
    };
    formats.set(language, found);
  }
  return found;
}

/** "09:12" today, else "24. sep" (the prototype's notes and messages). */
export function when(iso: string, language: Language = DEFAULT_LANGUAGE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const { clock, shortDate } = formatsFor(language);
  if (dayKey.format(date) === dayKey.format(new Date())) return clock.format(date);
  return shortDate.format(date).replace(/\.$/, "");
}

/**
 * The case page fetches its parts ahead (`useCasePrefetch`); within this time a part uses
 * that answer instead of asking again when it appears. Changes invalidate the parts themselves.
 */
export const CASE_PANEL_STALE_MS = 15_000;

export function notesKey(caseId: string) {
  return ["case-notes", caseId] as const;
}

export function useCaseNotes(fundId: string, caseId: string) {
  const load = useServerFn(listCaseNotes);
  return useQuery({
    queryKey: notesKey(caseId),
    queryFn: () => load({ data: { fundId, caseId } }),
    staleTime: CASE_PANEL_STALE_MS,
  });
}

export function messagesKey(caseId: string, fundId: string) {
  return ["case-messages", caseId, fundId] as const;
}

const SEEN_KEY = (caseId: string) => `interlect.case-messages-seen.${caseId}`;

function readSeen(caseId: string): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY(caseId));
  } catch {
    return null;
  }
}

/**
 * The case's messages, kept live: a Realtime subscription on case_messages for this case
 * refetches the list (RLS decides who receives the change). If the channel fails, the list
 * still refreshes every 30 s.
 */
export function useCaseMessages(fundId: string, caseId: string) {
  const load = useServerFn(listCaseMessages);
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  const query = useQuery({
    queryKey: messagesKey(caseId, fundId),
    queryFn: () => load({ data: { fundId, caseId } }),
    staleTime: CASE_PANEL_STALE_MS,
    refetchInterval: live ? false : 30_000,
  });
  useEffect(() => {
    setLive(false);
    const channel = supabase
      .channel(`case-messages:${caseId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "case_messages", filter: `case_id=eq.${caseId}` },
        () => void queryClient.invalidateQueries({ queryKey: messagesKey(caseId, fundId) }),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLive(true);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLive(false);
          if (status !== "CLOSED") console.warn(`[case-messages] live updates off (${status})`);
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [caseId, fundId, queryClient]);
  return query;
}

/** A message from someone else that is newer than the last time this browser opened the tab. */
export function hasUnread(messages: readonly CaseMessage[] | undefined, caseId: string): boolean {
  if (!messages?.length) return false;
  const seen = typeof window === "undefined" ? null : readSeen(caseId);
  return messages.some((message) => !message.isMine && (!seen || message.createdAt > seen));
}

export function markMessagesSeen(messages: readonly CaseMessage[] | undefined, caseId: string) {
  const newest = messages?.at(-1)?.createdAt;
  if (!newest) return;
  try {
    window.localStorage.setItem(SEEN_KEY(caseId), newest);
  } catch {
    // A private window keeps the dot for this visit only.
  }
}

export function filesKey(caseId: string, fundId: string) {
  return ["case-files", caseId, fundId] as const;
}

export function useCaseFiles(fundId: string, caseId: string) {
  const load = useServerFn(listCaseFiles);
  return useQuery({
    queryKey: filesKey(caseId, fundId),
    queryFn: () => load({ data: { fundId, caseId } }),
    staleTime: CASE_PANEL_STALE_MS,
  });
}
