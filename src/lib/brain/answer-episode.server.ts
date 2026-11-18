import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnswerEpisodeDraft } from "./answer-episode";

/**
 * `saved`: written now. `exists`: the answer was already saved. `sources_changed`: the answer's
 * citations are no longer the ones the draft was built from (a source was forgotten meanwhile);
 * build the draft again from the stored answer and retry.
 */
export type SaveAnswerResult = "saved" | "exists" | "sources_changed";

/**
 * Writes the episode and its one chunk (no vector yet) in one call (0091,
 * `brain_save_answer_episode`). The episode is `answer` / `user_note`, extraction 'skipped' so no
 * loop ever reads facts out of it, and its raw row is the chat message, so saving the same answer
 * again finds it and does nothing. The call waits for a "Glem kilde" in progress and only writes
 * when the answer's citations are still `storedCitations`, the raw array the draft was built
 * from: a source forgotten meanwhile never has its labels saved in the sources line.
 */
export async function saveAnswerEpisode(
  service: SupabaseClient,
  input: {
    fundId: string;
    messageId: string;
    caseId: string | null;
    companyId: string | null;
    storedCitations: unknown;
    draft: AnswerEpisodeDraft;
  },
): Promise<SaveAnswerResult> {
  const { fundId, messageId, draft } = input;
  const { data, error } = await service.rpc("brain_save_answer_episode", {
    _fund_id: fundId,
    _message_id: messageId,
    _citations: Array.isArray(input.storedCitations) ? input.storedCitations : [],
    _case_id: input.caseId,
    _company_id: input.companyId,
    _title: draft.title,
    _content: draft.content,
    _content_hash: draft.contentHash,
    _token_count: draft.tokenCount,
  });
  if (error) {
    if (error.code === "40001") return "sources_changed";
    throw new Error(`answer episode: ${error.code ?? ""} ${error.message}`);
  }
  if (data === true) return "saved";
  if (data === false) return "exists";
  throw new Error(`answer episode: unexpected reply ${JSON.stringify(data)}`);
}
