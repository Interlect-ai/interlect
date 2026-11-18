/**
 * The deep analysis reads the case's own material first, before it searches
 * the web. Veo had one uploaded PDF that no analysis had read (only a pitch deck is turned
 * into evidence) and one page of its website (the links in the menu were never followed). Free (no
 * AI): the case's unread PDF and PowerPoint files become evidence page by page, and a website with
 * fewer than three read pages is read again. Never stops a run: a file or a site that cannot be
 * read is logged and skipped.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureWebsiteForCase } from "@/lib/cases/website-capture.server";
import { extractPdfPages, extractPptxSlides } from "@/lib/cases/file-text.server";
import { isStoragePathIn } from "@/lib/security/storage-path";
import { clipCodePoints } from "@/lib/text";

/** A file larger than this is left to the person (the deck has its own path). */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 5;
/** A website with fewer read pages than this is read again. */
export const MIN_WEBSITE_PAGES = 3;
const PDF = "application/pdf";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export interface CaseMaterialOutcome {
  filesRead: number;
  filePages: number;
  websitePages: number;
}

export async function readCaseOwnMaterial(input: {
  service: SupabaseClient;
  fundId: string;
  caseId: string;
  actorId: string;
}): Promise<CaseMaterialOutcome> {
  const [files, website] = await Promise.all([
    readCaseFiles(input).catch((cause: unknown) => {
      console.warn("[case-material] files not read", errorText(cause));
      return { filesRead: 0, filePages: 0 };
    }),
    readMoreWebsite(input).catch((cause: unknown) => {
      console.warn("[case-material] website not read again", errorText(cause));
      return 0;
    }),
  ]);
  return { ...files, websitePages: website };
}

/** The case's uploaded files that no analysis has read yet (not the deck: it is read at intake). */
async function readCaseFiles(input: {
  service: SupabaseClient;
  fundId: string;
  caseId: string;
  actorId: string;
}): Promise<{ filesRead: number; filePages: number }> {
  const { service, fundId, caseId } = input;
  const { data, error } = await service
    .from("documents")
    .select("id, kind, file_name, storage_path, mime_type, size_bytes")
    .eq("fund_id", fundId)
    .eq("case_id", caseId)
    .eq("status", "uploaded")
    .neq("kind", "pitch_deck")
    .is("file_removed_at", null)
    .in("mime_type", [PDF, PPTX])
    .lte("size_bytes", MAX_FILE_BYTES)
    .order("created_at", { ascending: false })
    .limit(MAX_FILES);
  if (error) throw new Error(error.message);
  let filesRead = 0;
  let filePages = 0;
  for (const document of data ?? []) {
    const id = document["id"] as string;
    const path = document["storage_path"] as string;
    // Read with the service key, so the path must lie in this case's own folder.
    if (!isStoragePathIn(path, `${fundId}/${caseId}`)) continue;
    try {
      const { data: file, error: downloadError } = await service.storage
        .from("pitch-decks")
        .download(path);
      if (downloadError || !file) throw new Error(downloadError?.message ?? "no file");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { pages } =
        document["mime_type"] === PDF
          ? await extractPdfPages(bytes)
          : await extractPptxSlides(bytes);
      const name = document["file_name"] as string;
      if (pages.length) {
        const { error: insertError } = await service.from("evidence_items").insert(
          pages.map((page) => ({
            fund_id: fundId,
            case_id: caseId,
            document_id: id,
            // The file's own name and page, in no language (the team may be English or Danish).
            claim: `${name} · ${page.page}`,
            slide_ref: page.page,
            excerpt: clipCodePoints(page.text, 6000),
            status: "company_stated",
            confidence: 1,
            stated_by: name,
            created_by: input.actorId,
          })),
        );
        if (insertError) throw new Error(insertError.message);
      }
      // "ready" also when the file had no text, so it is not read again on every run.
      const { error: documentError } = await service
        .from("documents")
        .update({
          status: "ready",
          extracted_text: clipCodePoints(pages.map((page) => page.text).join("\n\n"), 200_000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("fund_id", fundId);
      if (documentError) throw new Error(documentError.message);
      filesRead += 1;
      filePages += pages.length;
    } catch (cause) {
      console.warn("[case-material] file not read", { id, message: errorText(cause) });
    }
  }
  return { filesRead, filePages };
}

/** The company's website again, when intake read fewer than MIN_WEBSITE_PAGES of its pages. */
async function readMoreWebsite(input: {
  service: SupabaseClient;
  fundId: string;
  caseId: string;
  actorId: string;
}): Promise<number> {
  const { service, fundId, caseId } = input;
  const { data: caseRow, error } = await service
    .from("cases")
    .select("company_id, companies(name, website)")
    .eq("id", caseId)
    .eq("fund_id", fundId)
    .single();
  if (error || !caseRow) throw new Error(error?.message ?? "case not found");
  const rawCompany = caseRow["companies"] as unknown;
  const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
    name: string;
    website: string | null;
  } | null;
  if (!company?.website) return 0;
  const { data: read, error: readError } = await service
    .from("sources")
    .select("url")
    .eq("fund_id", fundId)
    .eq("case_id", caseId)
    .eq("source_type", "company_website");
  if (readError) throw new Error(readError.message);
  const known = (read ?? []).map((row) => String(row["url"] ?? ""));
  if (new Set(known).size >= MIN_WEBSITE_PAGES) return 0;
  const { pageCount } = await captureWebsiteForCase({
    service,
    fundId,
    caseId,
    companyId: caseRow["company_id"] as string,
    existingName: company.name,
    website: company.website,
    actorId: input.actorId,
    skipUrls: known,
  });
  return pageCount;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message.slice(0, 200) : "unknown";
}
