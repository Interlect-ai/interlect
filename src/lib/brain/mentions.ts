/**
 * The @ menu's search in Brain chat (`searchBrainMentions`). Pure, tested in mentions.test.ts.
 */

/** The search text: what was typed, without the characters that mean something in an ilike pattern. */
export const mentionText = (q: string): string => q.replace(/[\\%_,()]/g, " ").trim();

/**
 * How many of the team's cases and Brain points the menu reads in the demo view, where it matches
 * on the names the screen shows (the demo team has a few dozen of each).
 */
export const DEMO_MENU_SCAN = 1000;

/**
 * Which names the menu keeps for `typed`. Without the demo view the database already matched the
 * real names. In the demo view the user types part of a name they see, an invented one
 * ("Alder" on the way to "Alder Labs"), so a name is kept when the screen shows it holding what
 * was typed: a real name typed finds nothing the screen would not show for it.
 */
export function mentionMatch(
  typed: string,
  view: { apply(text: string): string } | null,
): (name: string) => boolean {
  if (!view) return () => true;
  const wanted = mentionText(typed).toLowerCase();
  return (name) => view.apply(name).toLowerCase().includes(wanted);
}
