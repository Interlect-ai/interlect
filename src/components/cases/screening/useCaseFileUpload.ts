/**
 * Adds a file to a case: the browser puts it in the private bucket under the case's folder
 * (the bucket's policy lets only the fund's team write there), then the server checks it and
 * writes the document row (registerCaseFile). Used by Filer and by task answers with a file.
 */
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase/client";
import { registerCaseFile } from "@/lib/cases/files.functions";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { caseFileProblemIn, caseFileStoragePath, caseFileType } from "@/lib/cases/case-files";

export function useCaseFileUpload(fundId: string, caseId: string) {
  const t = useT();
  const language = useLanguage();
  const register = useServerFn(registerCaseFile);
  return async function upload(file: File): Promise<{ documentId: string }> {
    const problem = caseFileProblemIn(file, language);
    if (problem) throw new Error(problem);
    const type = caseFileType(file.name)!;
    const storagePath = caseFileStoragePath(fundId, caseId, file.name, crypto.randomUUID());
    const { error } = await supabase.storage
      .from("pitch-decks")
      .upload(storagePath, file, { contentType: type.mimeType, upsert: false });
    if (error) {
      console.error("[case-file] upload", error.message);
      throw new Error(t("caseView.files.uploadFailed", { name: file.name }));
    }
    return register({
      data: { fundId, caseId, fileName: file.name, storagePath, sizeBytes: file.size },
    });
  };
}
