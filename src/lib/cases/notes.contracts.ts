import { z } from "zod";

export const caseNoteBodySchema = z.string().trim().min(1).max(4000);

export const addCaseNoteInputSchema = z.object({
  fundId: z.guid(),
  caseId: z.guid(),
  body: caseNoteBodySchema,
});

export interface CaseNote {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string | null;
}
