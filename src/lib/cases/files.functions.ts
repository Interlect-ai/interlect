import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { isStoragePathIn } from "@/lib/security/storage-path";
import { CASE_FILE_MAX_BYTES, caseFileType } from "./case-files";
import { serverText } from "@/lib/i18n/server-text";
import { fromDemoView, withDemoView } from "@/lib/display/display-names.server";

/**
 * Fanen Filer (0035): casens dokumenter med typefilter og søgning i filnavn og tekst.
 * "Fra task" er filer, der er vedhæftet et task-svar.
 */

const fundIdSchema = z.guid();
export const caseFileTypes = ["pitch_deck", "financials", "memo", "other", "task"] as const;
export type CaseFileType = (typeof caseFileTypes)[number];

export interface CaseFile {
  id: string;
  caseId: string;
  fileName: string;
  kind: string;
  taskId: string | null;
  createdAt: string;
  /** Who added the file (null when the name could not be read). */
  uploadedByName: string | null;
  /** Only when searching: the matching passage with the hits marked «like this». */
  snippet: string | null;
}

/** Uploader names for a list of files; cosmetic, so a failed lookup is logged, not thrown. */
async function withUploaders(
  supabase: SupabaseClient,
  fundId: string,
  files: Omit<CaseFile, "uploadedByName">[],
): Promise<CaseFile[]> {
  if (!files.length) return [];
  const { data: rows, error } = await supabase
    .from("documents")
    .select("id, uploaded_by")
    .eq("fund_id", fundId)
    .in(
      "id",
      files.map((file) => file.id),
    );
  if (error) console.error("[listCaseFiles] uploaders", error.message);
  const uploaderOf = new Map(
    (rows ?? []).map((row) => [row["id"] as string, row["uploaded_by"] as string]),
  );
  const userIds = [...new Set(uploaderOf.values())];
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, email_normalized")
      .in("id", userIds);
    if (profileError) console.error("[listCaseFiles] profiles", profileError.message);
    for (const profile of profiles ?? []) {
      names.set(
        profile["id"] as string,
        (profile["full_name"] as string | null) ?? (profile["email_normalized"] as string | null),
      );
    }
  }
  return files.map((file) => {
    const uploader = uploaderOf.get(file.id);
    return { ...file, uploadedByName: uploader ? (names.get(uploader) ?? null) : null };
  });
}

export const listCaseFiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        caseId: z.guid().nullable().default(null),
        type: z.enum(caseFileTypes).nullable().default(null),
        query: z.string().trim().max(200).default(""),
      })
      .parse(input),
  )
  .handler(
    withDemoView(async ({ data, context }): Promise<CaseFile[]> => {
      await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
      const matchesType = (file: { kind: string; taskId: string | null }) =>
        data.type === null ||
        (data.type === "task" ? file.taskId !== null : file.kind === data.type);

      if (data.query) {
        const { data: rows, error } = await context.supabase.rpc("search_case_documents", {
          _fund_id: data.fundId,
          _query: await fromDemoView(data.fundId, data.query),
          _case_id: data.caseId,
          // With a type filter, fetch the function's maximum first so fewer matches of the chosen
          // type are cut off by other types (the filter runs here, not in SQL).
          _limit: data.type === null ? 100 : 200,
        });
        if (error) {
          console.error("[listCaseFiles] search", error.message);
          throw new Error(serverText("caseServer.files.searchFailed"));
        }
        const found = ((rows ?? []) as Array<Record<string, unknown>>)
          .map((row) => ({
            id: row["id"] as string,
            caseId: row["case_id"] as string,
            fileName: row["file_name"] as string,
            kind: row["kind"] as string,
            taskId: (row["task_id"] as string | null) ?? null,
            createdAt: row["created_at"] as string,
            snippet: (row["snippet"] as string | null) ?? null,
          }))
          .filter(matchesType)
          .slice(0, 100);
        return withUploaders(context.supabase, data.fundId, found);
      }

      let query = context.supabase
        .from("documents")
        .select("id, case_id, file_name, kind, task_id, created_at")
        .eq("fund_id", data.fundId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (data.caseId) query = query.eq("case_id", data.caseId);
      if (data.type === "task") query = query.not("task_id", "is", null);
      else if (data.type) query = query.eq("kind", data.type);
      const { data: rows, error } = await query;
      if (error) {
        console.error("[listCaseFiles]", error.message);
        throw new Error(serverText("caseServer.files.notLoaded"));
      }
      return withUploaders(
        context.supabase,
        data.fundId,
        (rows ?? []).map((row) => ({
          id: row["id"] as string,
          caseId: row["case_id"] as string,
          fileName: row["file_name"] as string,
          kind: row["kind"] as string,
          taskId: (row["task_id"] as string | null) ?? null,
          createdAt: row["created_at"] as string,
          snippet: null,
        })),
      );
    }),
  );

/**
 * Registers a file the browser has put in the private bucket under
 * `<fund>/<case>/<random>-<name>` (the bucket's own policy lets only the fund's team write
 * there). The server checks that the object exists with the stated size before the document
 * row is written (documents are written by the server only, 0035).
 */
export const registerCaseFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        caseId: z.guid(),
        fileName: z.string().trim().min(1).max(240),
        storagePath: z.string().trim().min(1).max(1000),
        sizeBytes: z.number().int().positive().max(CASE_FILE_MAX_BYTES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ documentId: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "upload_document");
    const type = caseFileType(data.fileName);
    if (!type) throw new Error(serverText("caseServer.files.typeNotAllowed"));
    const folder = `${data.fundId}/${data.caseId}`;
    const objectName = data.storagePath.slice(folder.length + 1);
    if (
      !isStoragePathIn(data.storagePath, folder) ||
      !objectName ||
      objectName.includes("/") ||
      caseFileType(objectName)?.extension !== type.extension
    ) {
      throw new Error(serverText("caseServer.files.notInFolder"));
    }
    const service = getServiceClient();
    // The case must belong to the fund (the path alone is the client's word).
    const { data: caseRow, error: caseError } = await service
      .from("cases")
      .select("id")
      .eq("id", data.caseId)
      .eq("fund_id", data.fundId)
      .maybeSingle();
    if (caseError) {
      console.error("[registerCaseFile] case", caseError.message);
      throw new Error(serverText("caseServer.files.notRegistered"));
    }
    if (!caseRow) throw new Error(serverText("caseServer.common.caseNotFoundInThesis"));
    const { data: objects, error: listError } = await service.storage
      .from("pitch-decks")
      .list(folder, { search: objectName, limit: 10 });
    if (listError) {
      console.error("[registerCaseFile] storage", listError.message);
      throw new Error(serverText("caseServer.files.notRegistered"));
    }
    const object = (objects ?? []).find((entry) => entry.name === objectName);
    const storedSize = Number((object?.metadata as { size?: unknown } | null)?.size);
    if (!object || storedSize !== data.sizeBytes) {
      throw new Error(serverText("caseServer.files.notInStorage"));
    }
    const { data: row, error } = await service
      .from("documents")
      .insert({
        fund_id: data.fundId,
        case_id: data.caseId,
        kind: "other",
        file_name: data.fileName,
        storage_path: data.storagePath,
        mime_type: type.mimeType,
        size_bytes: data.sizeBytes,
        status: "uploaded",
        uploaded_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !row) {
      console.error("[registerCaseFile] insert", error?.message);
      throw new Error(serverText("caseServer.files.notRegistered"));
    }
    return { documentId: row["id"] as string };
  });

/** A short-lived download link for one of the fund's files (members only, RLS decides). */
export const getCaseFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: fundIdSchema, documentId: z.guid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
    const { data: document, error } = await context.supabase
      .from("documents")
      .select("storage_path, file_name, file_removed_at")
      .eq("id", data.documentId)
      .eq("fund_id", data.fundId)
      .maybeSingle();
    if (error) {
      console.error("[getCaseFileUrl]", error.message);
      throw new Error(serverText("caseServer.files.notFetched"));
    }
    if (!document) throw new Error(serverText("caseServer.files.notFound"));
    // "Glem person" deleted the file itself; its masked text stays.
    if (document["file_removed_at"]) throw new Error(serverText("caseServer.files.removedForget"));
    // The link is signed with the service key: only for a path in this fund's own folder.
    if (!isStoragePathIn(document["storage_path"] as string, data.fundId)) {
      throw new Error(serverText("caseServer.files.notFound"));
    }
    const { data: signed, error: signError } = await getServiceClient()
      .storage.from("pitch-decks")
      .createSignedUrl(document["storage_path"] as string, 60, {
        download: document["file_name"] as string,
      });
    if (signError || !signed?.signedUrl) {
      console.error("[getCaseFileUrl] sign", signError?.message);
      throw new Error(serverText("caseServer.files.notFetched"));
    }
    return { url: signed.signedUrl };
  });
