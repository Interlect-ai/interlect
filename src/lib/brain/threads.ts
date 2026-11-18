/**
 * Thread rules for the Brain history (batch 1), pure: grouping in the left column, titles
 * and who may do what with a thread. The server functions enforce the same rules again.
 */
import type { BrainThreadSummary } from "./chat-contract.ts";
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

const TZ = "Europe/Copenhagen";
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface ThreadGroup {
  key: "today" | "earlier" | "team";
  label: string;
  threads: BrainThreadSummary[];
}

/** The cached thread list for one fund (`/brain`); Spørg Interlect refreshes it after an answer. */
export const brainThreadsQueryKey = (fundId: string | null) => ["brain-threads", fundId] as const;

/** The title shown for a thread without one; translate with `translate(language, NEW_THREAD_TITLE_KEY)`. */
export const NEW_THREAD_TITLE_KEY: MessageKey = "brainChat.threads.newThread";
export const TITLE_MAX = 60;

/** The title of a new thread: the first ca. 60 characters of the question (no model call). */
export function deriveThreadTitle(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  if (flat.length <= TITLE_MAX) return flat;
  const cut = flat.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function threadTitle(
  thread: Pick<BrainThreadSummary, "title">,
  language: Language = "da",
): string {
  return thread.title?.trim() || translate(language, NEW_THREAD_TITLE_KEY);
}

/**
 * "I dag" and "Tidligere" hold the user's own threads (a thread I shared stays here); "Delt i
 * team" holds other people's team threads and only exists when there is at least one. Newest
 * activity first; empty groups are left out.
 */
export function groupThreads(
  threads: readonly BrainThreadSummary[],
  now: Date = new Date(),
  language: Language = "da",
): ThreadGroup[] {
  const today = dayFormat.format(now);
  const sorted = [...threads].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const groups: Record<ThreadGroup["key"], BrainThreadSummary[]> = {
    today: [],
    earlier: [],
    team: [],
  };
  for (const thread of sorted) {
    if (!thread.isMine && thread.visibility === "team") {
      groups.team.push(thread);
      continue;
    }
    const at = new Date(thread.lastActivityAt);
    const isToday = !Number.isNaN(at.getTime()) && dayFormat.format(at) === today;
    (isToday ? groups.today : groups.earlier).push(thread);
  }
  const labels: Record<ThreadGroup["key"], string> = {
    today: translate(language, "brainChat.threads.today"),
    earlier: translate(language, "brainChat.threads.earlier"),
    team: translate(language, "brainChat.threads.team"),
  };
  return (["today", "earlier", "team"] as const)
    .filter((key) => groups[key].length > 0)
    .map((key) => ({ key, label: labels[key], threads: groups[key] }));
}

/** Rename and change visibility: only the owner. */
export function canEditThread(thread: Pick<BrainThreadSummary, "isMine">): boolean {
  return thread.isMine;
}

/**
 * Delete: the owner always (own threads, also shared ones); an Admin only for TEAM threads of
 * others (moderation), never for someone's private thread.
 */
export function canDeleteThread(
  thread: Pick<BrainThreadSummary, "isMine" | "visibility">,
  isAdmin: boolean,
): boolean {
  if (thread.isMine) return true;
  return isAdmin && thread.visibility === "team";
}
