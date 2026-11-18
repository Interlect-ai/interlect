/**
 * Web search in the chat, the step before the question (B8): the user switches "Søg på
 * nettet" on, this proposes 1 to 3 queries, the UI shows them as editable chips, and the approved
 * ones go with the question (`ChatRequest.webQueries`). The proposal sees only the question and
 * the identity of the companies the user pointed to; it never searches and never saves.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { BrainUserError } from "./errors";
import { CHAT_QUESTION_MAX } from "./chat-contract";
import { QUESTIONS_PER_MINUTE } from "./chat/prompt";
import type { WebCompanyIdentity } from "./web/queries";
import { serverText } from "@/lib/i18n/server-text";

const uuid = z.guid();

export type ProposedWebQueries = { queries: string[]; rejected: number };

export const proposeBrainWebQueries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: uuid,
        question: z.string().trim().min(1).max(CHAT_QUESTION_MAX),
        caseId: uuid.nullable(),
        entityIds: z.array(uuid).max(10),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ProposedWebQueries> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_chat");
    const { isBrainEnabled } = await import("./flags");
    if (!isBrainEnabled()) throw new BrainUserError(serverText("brainServer.common.notAvailable"));
    try {
      const { getServiceClient } = await import("@/lib/supabase/admin.server");
      const service = getServiceClient();
      const { loadDemoView } = await import("@/lib/display/display-names.server");
      const namer = await loadDemoView(service, data.fundId);
      const { proposeWebQueries, recentWebProposals } = await import("./web/query-writer.server");
      // The same limit per minute as questions: each proposal is a paid call in the
      // chat budget, so a held-down button or a script cannot spend it.
      const since = new Date(Date.now() - 60_000);
      const recent = await recentWebProposals(service, {
        fundId: data.fundId,
        userId: context.userId,
        since,
      });
      if (recent >= QUESTIONS_PER_MINUTE) {
        throw new BrainUserError(serverText("brainServer.web.rateLimited"));
      }
      const companies: WebCompanyIdentity[] = [];
      if (data.caseId) {
        const { data: row, error } = await service
          .from("cases")
          .select("companies(name, domain, cvr_number)")
          .eq("fund_id", data.fundId)
          .eq("id", data.caseId)
          .maybeSingle();
        if (error) throw error;
        const company = Array.isArray(row?.["companies"])
          ? row["companies"][0]
          : row?.["companies"];
        if (company?.name) {
          companies.push({
            name: company.name as string,
            domain: (company.domain as string | null) ?? null,
            cvr: (company.cvr_number as string | null) ?? null,
          });
        }
      }
      if (data.entityIds.length > 0) {
        const { data: entities, error } = await service
          .from("brain_entities")
          .select("name")
          .eq("fund_id", data.fundId)
          .in("id", data.entityIds)
          .limit(10);
        if (error) throw error;
        for (const entity of entities ?? []) {
          const name = entity["name"] as string;
          if (name && !companies.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
            companies.push({ name, domain: null, cvr: null });
          }
        }
      }
      const proposal = await proposeWebQueries(service, {
        fundId: data.fundId,
        userId: context.userId,
        question: namer ? namer.reverse(data.question) : data.question,
        companies,
      });
      // Demo view: shown with the invented names, addresses and numbers; the chat
      // route turns them back before the search.
      return {
        queries: namer ? namer.applyJson(proposal.queries) : proposal.queries,
        rejected: proposal.rejected.length,
      };
    } catch (cause) {
      if (cause instanceof BrainUserError) throw cause;
      console.error("[brain-web] propose", cause instanceof Error ? cause.message : cause);
      throw new Error(serverText("brainServer.web.notSuggested"));
    }
  });
