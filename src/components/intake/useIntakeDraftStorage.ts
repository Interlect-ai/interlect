/**
 * Keeps the Opret case draft (name, website, notes, chosen funds) in sessionStorage per fund, so
 * a browser Back or a refresh does not lose it. The deck FILE is never stored (a file cannot be
 * kept in storage); the form says so by simply not having it any more. Every storage access is
 * wrapped: private windows and blocked storage must never break the page.
 */
import { useEffect, useRef } from "react";
import { parseStoredDraft, serializeDraft, type StoredDraft } from "@/lib/cases/intake-draft";

const key = (fundId: string) => `interlect.intake.draft.${fundId}`;

export function clearIntakeDraft(fundId: string) {
  try {
    window.sessionStorage.removeItem(key(fundId));
  } catch {
    // storage unavailable: nothing to clear
  }
}

export function useIntakeDraftStorage(
  fundId: string,
  current: StoredDraft,
  onRestore: (stored: StoredDraft) => void,
) {
  const restored = useRef(false);
  const restore = useRef(onRestore);
  restore.current = onRestore;

  useEffect(() => {
    try {
      const stored = parseStoredDraft(window.sessionStorage.getItem(key(fundId)));
      if (stored) restore.current(stored);
    } catch {
      // storage unavailable: start empty
    }
    restored.current = true;
  }, [fundId]);

  const serialized = serializeDraft(current);
  useEffect(() => {
    if (!restored.current) return;
    try {
      window.sessionStorage.setItem(key(fundId), serialized);
    } catch {
      // storage unavailable: the draft just is not kept
    }
  }, [fundId, serialized]);
}
