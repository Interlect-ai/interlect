/**
 * Which orb may move (only one orb moves at a time on a screen): the biggest
 * one (a waiting screen's 64 px before its steps' 20 px), and between equal sizes the one shown
 * first. Pure, so AiOrb's registry and the tests share it.
 */
export interface OrbMover {
  size: number;
  /** Registration order: lower was shown first. */
  order: number;
}

export function chooseMover(movers: Iterable<[string, OrbMover]>): string | null {
  let best: [string, OrbMover] | null = null;
  for (const entry of movers) {
    const [, mover] = entry;
    if (
      !best ||
      mover.size > best[1].size ||
      (mover.size === best[1].size && mover.order < best[1].order)
    ) {
      best = entry;
    }
  }
  return best?.[0] ?? null;
}
