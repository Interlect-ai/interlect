/** Pure (de)serialisation of the stored Opret case draft. Tested in draft-storage.test.ts. */

export interface StoredDraft {
  query: string;
  website: string;
  notes: string;
  fundIds: string[];
}

export function serializeDraft(draft: StoredDraft): string {
  return JSON.stringify({
    query: draft.query.slice(0, 200),
    website: draft.website.slice(0, 300),
    notes: draft.notes.slice(0, 20_000),
    fundIds: draft.fundIds.slice(0, 20),
  });
}

/** null for anything that is not a draft with at least one non-empty field. */
export function parseStoredDraft(raw: string | null): StoredDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const text = (field: unknown) => (typeof field === "string" ? field : "");
    const fundIds = Array.isArray(value["fundIds"])
      ? value["fundIds"].filter((id): id is string => typeof id === "string")
      : [];
    const draft = {
      query: text(value["query"]),
      website: text(value["website"]),
      notes: text(value["notes"]),
      fundIds,
    };
    return draft.query || draft.website || draft.notes ? draft : null;
  } catch {
    return null;
  }
}
