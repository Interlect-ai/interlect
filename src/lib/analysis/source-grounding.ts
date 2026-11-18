/**
 * Kun hentede kilder må citeres (produktprincip 9). Research-modellen (Sonar) skriver dog
 * nogle gange en kilde-URL forkert af: lange, uigennemskuelige URL'er (fx de danske
 * regnskabs-PDF'er med et base64-agtigt token) genskrives med små fejl, og enkelte kilder
 * huskes fra hukommelsen i stedet for at være slået op. Målt live 1. okt 2026 på Pleo:
 * i ca. hver anden kørsel blev mindst ét modul kasseret, fordi en enkelt påstand havde en
 * forkert URL, og screeningen kræver 4 af 5 moduler.
 *
 * Reglen er derfor: en URL, der ikke er hentet, "snappes" til den hentede URL, den
 * åbenlyst er en forvansket udgave af (samme domæne og næsten samme afkodede adresse),
 * og en påstand uden nogen hentet kilde udelades (og noteres som et hul) i stedet for at
 * kassere hele modulet. Citeres kun hentede URL'er, er princippet uændret; og for officielle
 * dokumenter kontrolleres uddraget bagefter mod det hentede dokument.
 *
 * Ren fil uden database og netværk, så den kan testes med node --test.
 */

/** Same normalisation as the research step has always used for a cited or retrieved URL. */
export function normalizeSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "ref" || key === "source") {
        url.searchParams.delete(key);
      }
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{24,}(\.[a-z]{2,4})?$/;

function printable(text: string): boolean {
  if (text.length === 0) return false;
  let ok = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) ok += 1;
  }
  return ok / text.length >= 0.9;
}

/** The readable text behind a long opaque token (base64 of a storage path), or null if it is not one. */
function decodeOpaque(piece: string): string | null {
  if (!OPAQUE_TOKEN.test(piece)) return null;
  const token = piece
    .replace(/\.[a-z]{2,4}$/, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  try {
    const decoded = Buffer.from(token, "base64").toString("latin1");
    return printable(decoded) ? decoded.toLowerCase() : null;
  } catch {
    return null;
  }
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * A URL split into what is readable (host, path, company id, year, ...) and the opaque tokens.
 * Only the opaque tokens may differ between a cited and a retrieved URL: every readable piece
 * (a year, an id, a page name) must be identical, so a 2022 document is never taken for 2023.
 */
function parts(url: URL): { readable: string; opaque: string[] } {
  const readable: string[] = [hostOf(url)];
  const opaque: string[] = [];
  for (const piece of `${url.pathname}${url.search}`.split(/[/?&=]+/).filter(Boolean)) {
    const decoded = decodeOpaque(piece);
    if (decoded === null) readable.push(piece.toLowerCase());
    else opaque.push(decoded);
  }
  return { readable: readable.join("/"), opaque };
}

function grams(text: string, size = 4): Set<string> {
  const out = new Set<string>();
  const clean = text.replace(/\.(pdf|html?|xhtml)$/g, "");
  for (let index = 0; index + size <= clean.length; index += 1)
    out.add(clean.slice(index, index + size));
  return out;
}

function similarity(a: string, b: string): number {
  const left = grams(a);
  const right = grams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** How alike two opaque tokens must be once decoded, and how clearly the best candidate must win. */
export const SNAP_MIN_SIMILARITY = 0.7;
export const SNAP_MIN_MARGIN = 0.15;

/**
 * The retrieved URL a cited URL stands for: itself when it was retrieved, or the one retrieved URL
 * it is a garbled copy of. A URL is only ever corrected when it carries a long opaque token and
 * everything readable around the token is identical to the retrieved URL; otherwise null.
 */
export function snapToRetrievedUrl(cited: string, retrieved: ReadonlySet<string>): string | null {
  const normalized = normalizeSourceUrl(cited);
  if (retrieved.has(normalized)) return normalized;
  let citedUrl: URL;
  try {
    citedUrl = new URL(cited);
  } catch {
    return null;
  }
  const citedParts = parts(citedUrl);
  if (citedParts.opaque.length === 0) return null;
  const citedToken = citedParts.opaque.join("/");
  const scored: Array<{ url: string; score: number }> = [];
  for (const candidate of retrieved) {
    let candidateUrl: URL;
    try {
      candidateUrl = new URL(candidate);
    } catch {
      continue;
    }
    const candidateParts = parts(candidateUrl);
    if (candidateParts.readable !== citedParts.readable) continue;
    if (candidateParts.opaque.length !== citedParts.opaque.length) continue;
    scored.push({ url: candidate, score: similarity(citedToken, candidateParts.opaque.join("/")) });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < SNAP_MIN_SIMILARITY) return null;
  const second = scored[1];
  if (second && best.score - second.score < SNAP_MIN_MARGIN) return null;
  return best.url;
}

export interface GroundableFinding<S extends { url: string }> {
  statement: string;
  sources: S[];
}

export interface GroundingResult<F> {
  findings: F[];
  /** Findings left out because none of their sources was a retrieved URL (or a copy of one). */
  dropped: number;
  /** The statements of the dropped findings (for the gap note), in order. */
  droppedStatements: string[];
  /** Sources whose URL was corrected to the retrieved URL they are a garbled copy of. */
  snapped: number;
  /** Cited sources that were not retrieved and not a copy of a retrieved one. */
  rejectedSources: number;
}

/**
 * Keeps the findings that cite at least one retrieved source, with their sources corrected to
 * retrieved URLs. A finding without any retrieved source is dropped, never cited.
 */
export function groundFindings<S extends { url: string }, F extends GroundableFinding<S>>(
  findings: readonly F[],
  retrieved: ReadonlySet<string>,
): GroundingResult<F> {
  const kept: F[] = [];
  const droppedStatements: string[] = [];
  let snapped = 0;
  let rejectedSources = 0;
  for (const finding of findings) {
    const sources: S[] = [];
    const seen = new Set<string>();
    for (const source of finding.sources) {
      const url = snapToRetrievedUrl(source.url, retrieved);
      if (!url) {
        rejectedSources += 1;
        continue;
      }
      if (normalizeSourceUrl(source.url) !== url) snapped += 1;
      if (seen.has(url)) continue;
      seen.add(url);
      sources.push({ ...source, url });
    }
    if (sources.length === 0) droppedStatements.push(finding.statement);
    else kept.push({ ...finding, sources });
  }
  return {
    findings: kept,
    dropped: droppedStatements.length,
    droppedStatements,
    snapped,
    rejectedSources,
  };
}
