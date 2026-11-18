/**
 * Safe reading of model text. Brain's answer is untrusted text: it is parsed here into a
 * tiny block structure (paragraphs, bullet and numbered lists, bold, citation markers [n]) that
 * the UI draws as React text nodes. There is no HTML, no `dangerouslySetInnerHTML`, no images
 * and no external links; `react-markdown` is not installed (not approved yet).
 *
 * - `[n]` becomes a citation marker only when the answer has a source number `n`; any other
 *   `[n]` is dropped (rule: only stored facts are cited).
 * - `![alt](url)` is dropped; `[text](url)` keeps only the text unless the url is an internal
 *   app path (`/cases/...`, `/fond`, `/brain`); http(s) links from the model are never links.
 * - Control and bidi-override characters are removed.
 * - While streaming, an unfinished marker at the very end (`[1`, `[1, 2`) is held back so it
 *   never flashes as text.
 */

export type Inline =
  | { t: "text"; text: string }
  | { t: "bold"; text: string }
  | { t: "cite"; n: number }
  | { t: "link"; text: string; href: string };

export type Block =
  { t: "p"; inline: Inline[] } | { t: "ul"; items: Inline[][] } | { t: "ol"; items: Inline[][] };

const UNSAFE_CHARS =
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

export function cleanModelText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(UNSAFE_CHARS, "");
}

const INTERNAL_PATH = /^\/(?:cases|fond|brain|brugere)(?:[/?#][\w\-./?=&%#]*)?$/i;

/** An internal app path the model may link to; everything else (http, javascript:, //host) is null. */
export function safeInternalHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return INTERNAL_PATH.test(trimmed) ? trimmed : null;
}

/** For source cards (web citations come from the server, not from model text): http(s) only. */
export function safeExternalHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

const INLINE =
  /(!\[[^\]]*\]\([^)]*\))|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

function inline(text: string, valid: ReadonlySet<number>, allowBold = true): Inline[] {
  const out: Inline[] = [];
  // After a dropped marker ("ingen [9]."), the space before the punctuation goes too.
  let afterDropped = false;
  const push = (item: Inline) => {
    const last = out[out.length - 1];
    if (afterDropped && item.t === "text" && last?.t === "text" && /^[.,;:!?]/.test(item.text)) {
      last.text = last.text.trimEnd();
    }
    afterDropped = false;
    if (item.t === "text" && last?.t === "text") last.text += item.text;
    else out.push(item);
  };
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > cursor) push({ t: "text", text: text.slice(cursor, index) });
    cursor = index + match[0].length;
    if (match[1] !== undefined) {
      // An image: dropped completely.
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const href = safeInternalHref(match[3]);
      push(href ? { t: "link", text: match[2], href } : { t: "text", text: match[2] });
    } else if (match[4] !== undefined) {
      if (allowBold) push({ t: "bold", text: match[4] });
      else push({ t: "text", text: match[4] });
    } else if (match[5] !== undefined) {
      for (const part of match[5].split(",")) {
        const n = Number(part.trim());
        if (valid.has(n)) push({ t: "cite", n });
        else afterDropped = true;
      }
    }
  }
  if (cursor < text.length) push({ t: "text", text: text.slice(cursor) });
  return out;
}

const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const NUMBERED = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

/**
 * Holds back an unfinished citation marker or bold marker at the end of a streaming answer.
 * One bounded character class, no nested quantifiers: model text is untrusted and this runs on
 * every delta, so the pattern must stay linear (a nested version froze the tab on "[ , , , …").
 */
export function trimStreamingTail(text: string): string {
  return text.replace(/\[[\d\s,]{0,24}$/, "").replace(/\*{1,2}$/, "");
}

export function parseModelText(
  text: string,
  validCitations: ReadonlySet<number>,
  options: { streaming?: boolean } = {},
): Block[] {
  let cleaned = cleanModelText(text);
  if (options.streaming) cleaned = trimStreamingTail(cleaned);
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ t: "p", inline: inline(paragraph.join("\n"), validCitations) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({
        t: list.kind,
        items: list.items.map((item) => inline(item, validCitations)),
      });
      list = null;
    }
  };

  for (const line of cleaned.split("\n")) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? "ul" : "ol";
      if (list && list.kind !== kind) flushList();
      list ??= { kind, items: [] };
      list.items.push((bullet ?? numbered)![1] ?? "");
      continue;
    }
    flushList();
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        t: "p",
        inline: [{ t: "bold", text: (heading[1] ?? "").replace(/\*\*/g, "") }],
      });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** The answer as plain text for "Kopiér": no markers, no citation numbers, no markdown. */
export function plainTextOf(text: string, validCitations: ReadonlySet<number>): string {
  const lines: string[] = [];
  const flat = (items: Inline[]) =>
    items
      .map((item) => (item.t === "cite" ? "" : item.text))
      .join("")
      .replace(/ +([.,;:])/g, "$1")
      .replace(/ {2,}/g, " ")
      .trim();
  for (const block of parseModelText(text, validCitations)) {
    if (block.t === "p") lines.push(flat(block.inline));
    else
      block.items.forEach((item, i) =>
        lines.push(`${block.t === "ol" ? `${i + 1}.` : "-"} ${flat(item)}`),
      );
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** Citation numbers that appear in the text but have no source ("Nogle påstande mangler kilde"). */
export function unmatchedCitationNumbers(text: string, valid: ReadonlySet<number>): number[] {
  const found = new Set<number>();
  for (const match of cleanModelText(text).matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g)) {
    for (const part of (match[1] ?? "").split(",")) {
      const n = Number(part.trim());
      if (!valid.has(n)) found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
}
