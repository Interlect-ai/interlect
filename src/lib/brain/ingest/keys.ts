/**
 * The queue key of an INGEST run (one job per fund, loop and key). The first run's key is
 * the source id; a retry from a failed step gets "<source id>+r<n>", because a finished job is
 * never taken again. A run that stops with facts left to read continues as "<source id>+c<n>". What a retry skips is read from the data (classification on the source,
 * chunks with an embedding), not from the old job's steps.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ingestKey(sourceId: string, run = 0): string {
  if (!UUID.test(sourceId)) throw new Error("ingestKey: the source id must be a uuid");
  if (!Number.isInteger(run) || run < 0 || run > 1_000)
    throw new Error("ingestKey: bad run number");
  return run === 0 ? sourceId.toLowerCase() : `${sourceId.toLowerCase()}+r${run}`;
}

/** The continuation of a run that stopped on its time or batch limit with facts left to read. */
export function ingestContinuationKey(sourceId: string, part: number): string {
  if (!UUID.test(sourceId)) throw new Error("ingestContinuationKey: the source id must be a uuid");
  if (!Number.isInteger(part) || part < 1 || part > 1_000)
    throw new Error("ingestContinuationKey: bad part number");
  return `${sourceId.toLowerCase()}+c${part}`;
}

export function parseIngestKey(
  key: string,
): { sourceId: string; run: number; part: number } | null {
  const match = /^([0-9a-f-]{36})(?:\+([rc])(\d{1,4}))?$/i.exec(key);
  if (!match?.[1] || !UUID.test(match[1])) return null;
  const number = match[3] ? Number(match[3]) : 0;
  return {
    sourceId: match[1].toLowerCase(),
    run: match[2]?.toLowerCase() === "r" ? number : 0,
    part: match[2]?.toLowerCase() === "c" ? number : 0,
  };
}
