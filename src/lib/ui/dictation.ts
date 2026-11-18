/** Dictation helpers for the composer microphone; pure, so it is tested with node --test. */

/** Joins a recognised phrase onto the draft with one space between. */
export function appendDictated(draft: string, phrase: string): string {
  const words = phrase.trim();
  if (!words) return draft;
  if (!draft.trim()) return words;
  return /\s$/.test(draft) ? `${draft}${words}` : `${draft} ${words}`;
}
