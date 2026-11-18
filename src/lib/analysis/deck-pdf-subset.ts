/**
 * B7-opfølgning: send kun de sider, der skal læses, til modellen i stedet for hele decket.
 * Et rent billed-deck med mange sider blev før sprunget over, fordi hele PDF'en talte med i
 * prisen. Siderne kopieres i den ønskede rækkefølge til en ny, lille PDF; side 1 i den nye
 * PDF er den første ønskede side osv. Oversættelsen tilbage til deckets sidenumre sker i
 * kode (`originalPage`), aldrig af modellen.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";

import { serverText } from "../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.deck.${key}` as MessageKey, vars);
}

export type PdfSubset =
  { ok: true; bytes: Uint8Array; pages: number[] } | { ok: false; reason: string };

/**
 * Kopiér deckets sider (1-baseret) til en ny PDF. Deckets sidetal kommer fra udtrækket
 * (pdf.js); ser pdf-lib et andet antal sider, kan numrene være forskudt, så udtrækket
 * afvises frem for at gemme tekst på en forkert slide.
 */
export async function pdfSubset(
  bytes: Uint8Array,
  pages: number[],
  expectedPageCount: number,
): Promise<PdfSubset> {
  if (!pages.length) return { ok: false, reason: msg("subset.noPages") };
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (cause) {
    return {
      ok: false,
      reason: msg("subset.notOpened", {
        reason: cause instanceof Error ? cause.message.slice(0, 80) : msg("subset.unknownError"),
      }),
    };
  }
  const count = source.getPageCount();
  if (count !== expectedPageCount) {
    return {
      ok: false,
      reason: msg("subset.countDiffers", { count, expected: expectedPageCount }),
    };
  }
  if (pages.some((page) => !Number.isInteger(page) || page < 1 || page > count)) {
    return { ok: false, reason: msg("subset.missingPages") };
  }
  try {
    // Link-annotationer (fx GoTo til andre sider) kan trække hele decket med ind i den lille
    // PDF og tegner intet. Andre annotationer (fx tekst tilføjet i Preview) kan bære den
    // eneste tekst på siden og beholdes.
    for (const page of pages) removeLinkAnnotations(source, page - 1);
    const target = await PDFDocument.create();
    const copied = await target.copyPages(
      source,
      pages.map((page) => page - 1),
    );
    for (const page of copied) target.addPage(page);
    return { ok: true, bytes: await target.save(), pages };
  } catch (cause) {
    return {
      ok: false,
      reason: msg("subset.notCopied", {
        reason: cause instanceof Error ? cause.message.slice(0, 80) : msg("subset.unknownError"),
      }),
    };
  }
}

function removeLinkAnnotations(source: PDFDocument, index: number) {
  const node = source.getPage(index).node;
  const annots = node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return;
  const kept = annots.asArray().filter((ref) => {
    const annot = source.context.lookup(ref);
    return !(annot instanceof PDFDict && annot.get(PDFName.of("Subtype")) === PDFName.of("Link"));
  });
  if (kept.length) node.set(PDFName.of("Annots"), source.context.obj(kept));
  else node.delete(PDFName.of("Annots"));
}

/** Side i den lille PDF (1-baseret) → sidenummer i det oprindelige deck. */
export function originalPage(subsetPages: number[], subsetPage: number): number | null {
  return Number.isInteger(subsetPage) && subsetPage >= 1 && subsetPage <= subsetPages.length
    ? subsetPages[subsetPage - 1]!
    : null;
}
