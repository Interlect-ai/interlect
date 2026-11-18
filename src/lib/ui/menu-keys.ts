/**
 * Keyboard slips in menus (harden E9): a menu opens with focus on its first item, which can be
 * a paid step ("Kør screening"). A second Enter right after the one that opened the menu, or
 * a held Enter, must not choose it. Pure, so it is unit-tested.
 */

/** Enter or Space this soon after the menu opened is taken as the opening press repeating. */
export const MENU_KEY_GRACE_MS = 300;

export function ignoreMenuKey(key: string, repeat: boolean, msSinceOpen: number): boolean {
  if (key !== "Enter" && key !== " ") return false;
  return repeat || msSinceOpen < MENU_KEY_GRACE_MS;
}
