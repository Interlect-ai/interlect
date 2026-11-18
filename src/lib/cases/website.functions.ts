import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { captureWebsiteForCase } from "@/lib/cases/website-capture.server";
import { serverText } from "@/lib/i18n/server-text";

export const captureCompanyWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ caseId: z.guid(), website: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: caseRow, error: caseError } = await context.supabase
      .from("cases")
      .select("id, fund_id, company_id, companies(name)")
      .eq("id", data.caseId)
      .single();
    if (caseError || !caseRow) throw new Error(serverText("caseServer.common.caseNotFound"));
    const fundId = caseRow["fund_id"] as string;
    await requireFundCapability(context.supabase, context.userId, fundId, "upload_document");
    const relatedCompany = caseRow["companies"] as unknown;
    const existingName = (
      (Array.isArray(relatedCompany) ? relatedCompany[0] : relatedCompany) as {
        name?: string;
      } | null
    )?.name;
    return captureWebsiteForCase({
      service: getServiceClient(),
      fundId,
      caseId: data.caseId,
      companyId: caseRow["company_id"] as string,
      existingName,
      website: data.website,
      actorId: context.userId,
    });
  });
