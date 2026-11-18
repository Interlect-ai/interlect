import { serverText } from "../i18n/server-text.ts";

/**
 * The text of a case's PDF or PowerPoint file, page by page (at most 100 pages). Used by the deck
 * extraction (extractPitchDeck) and, by the deep analysis, which reads the case's other
 * files (memos, financials) before it searches the web.
 */
export async function extractPdfPages(bytes: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const proxy = await getDocumentProxy(bytes);
  const extracted = await extractText(proxy, { mergePages: false });
  const texts = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  return {
    totalPages: extracted.totalPages,
    pages: texts
      .map((text, index) => ({ text: text.trim(), page: index + 1 }))
      .filter((page) => page.text.length > 0)
      .slice(0, 100),
  };
}

/** A slide's XML is small text; a bigger entry, or a bigger total, is a zip bomb. */
const MAX_SLIDE_XML_BYTES = 5 * 1024 * 1024;
const MAX_UNPACKED_SLIDES_BYTES = 40 * 1024 * 1024;
const SLIDE_ENTRY = /^ppt\/slides\/slide(\d+)\.xml$/;

export async function extractPptxSlides(bytes: Uint8Array) {
  const [{ unzipSync, strFromU8 }, { load }] = await Promise.all([
    import("fflate"),
    import("cheerio"),
  ]);
  // Only the slide XML files are unpacked, and only when their declared size is sane (the images
  // and anything else in the file are never inflated).
  let declared = 0;
  const archive = unzipSync(bytes, {
    filter: (file) => {
      if (!SLIDE_ENTRY.test(file.name)) return false;
      declared += file.originalSize;
      if (file.originalSize > MAX_SLIDE_XML_BYTES || declared > MAX_UNPACKED_SLIDES_BYTES) {
        throw new Error(serverText("caseServer.cases.pptxTooLarge"));
      }
      return true;
    },
  });
  const slideEntries = Object.entries(archive)
    .flatMap(([path, value]) => {
      const match = path.match(SLIDE_ENTRY);
      return match ? [{ page: Number(match[1]), value }] : [];
    })
    .sort((a, b) => a.page - b.page)
    .slice(0, 100);
  const pages = slideEntries
    .map(({ page, value }) => {
      const $ = load(strFromU8(value), { xmlMode: true });
      const text = $("a\\:t")
        .toArray()
        .map((node) => $(node).text().trim())
        .filter(Boolean)
        .join(" ");
      return { page, text };
    })
    .filter((page) => page.text.length > 0);
  return { totalPages: slideEntries.length, pages };
}
