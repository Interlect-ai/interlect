import type { SupabaseClient } from "@supabase/supabase-js";
import { attachCallLog, type AiFlow } from "./call-log.ts";
import { MaskingUnavailableError } from "./model-call.ts";
import { createRedactor, type RedactionDictionary, type Redactor } from "./redact.ts";
import { buildRedactionDictionary, type DictionaryPerson } from "./redact-dictionary.ts";

/**
 * The masking dictionary of one fund: people with their roles from company_people,
 * Brain's person entities with their role facts, and the names of companies, investors and
 * funds. Built with the service role, so every query is scoped to the fund explicitly.
 */
const PAGE = 1000;

type Row = Record<string, unknown>;

async function allRows(
  label: string,
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    // i18n-keep: carries the database's own message, so userMessage shows the fallback.
    if (error)
      throw new Error(`Maskeringens ordbog (${label}) kunne ikke hentes: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((v): v is string => v !== null) : [];
}

export async function loadRedactionDictionary(
  service: SupabaseClient,
  fundId: string,
): Promise<RedactionDictionary> {
  const [people, entities, facts, companies] = await Promise.all([
    allRows("people", (from, to) =>
      service
        .from("people")
        .select("id, full_name, company_people(role_title, registry_role, is_founder)")
        .eq("fund_id", fundId)
        .order("id")
        .range(from, to),
    ),
    allRows("brain_entities", (from, to) =>
      service
        .from("brain_entities")
        .select("id, type, name, aliases, ref_table, ref_id")
        .eq("fund_id", fundId)
        .in("type", ["person", "company", "investor", "fund_vehicle"])
        .eq("status", "active")
        .order("id")
        .range(from, to),
    ),
    allRows("brain_facts", (from, to) =>
      service
        .from("brain_facts")
        .select("id, subject_id, object_id, predicate, value_text")
        .eq("fund_id", fundId)
        .in("predicate", ["founded_by", "board_member_of", "has_role"])
        .is("expired_at", null)
        // Proposed facts (web, chat notes) do not make anyone a key person.
        .eq("status", "active")
        .order("id")
        .range(from, to),
    ),
    allRows("companies", (from, to) =>
      service
        .from("companies")
        .select("id, name, legal_name")
        .eq("fund_id", fundId)
        .order("id")
        .range(from, to),
    ),
  ]);

  const byPerson = new Map<string, DictionaryPerson & { aliases: string[]; roles: string[] }>();
  for (const row of people) {
    const name = text(row["full_name"]);
    if (!name) continue;
    const links = Array.isArray(row["company_people"]) ? (row["company_people"] as Row[]) : [];
    byPerson.set(`people:${String(row["id"])}`, {
      name,
      aliases: [],
      roles: links
        .flatMap((l) => [text(l["role_title"]), text(l["registry_role"])])
        .filter((r): r is string => r !== null),
      keyPerson: links.some((l) => l["is_founder"] === true),
    });
  }

  // A Brain person linked to a row in people is the same person; others stand on their own.
  const personKeyByEntity = new Map<string, string>();
  const organisations: string[] = [];
  for (const row of entities) {
    const name = text(row["name"]);
    if (!name) continue;
    if (row["type"] !== "person") {
      organisations.push(name, ...texts(row["aliases"]));
      continue;
    }
    const linked =
      row["ref_table"] === "people" && row["ref_id"] ? `people:${String(row["ref_id"])}` : null;
    const key = linked && byPerson.has(linked) ? linked : `entity:${String(row["id"])}`;
    personKeyByEntity.set(String(row["id"]), key);
    const person = byPerson.get(key) ?? { name, aliases: [], roles: [], keyPerson: false };
    for (const alias of [name, ...texts(row["aliases"])]) {
      if (alias !== person.name && !person.aliases.includes(alias)) person.aliases.push(alias);
    }
    byPerson.set(key, person);
  }

  // The extractor does not always point founded_by company → person: the person is whichever side
  // is a person.
  for (const row of facts) {
    for (const side of [row["subject_id"], row["object_id"]]) {
      const person = byPerson.get(personKeyByEntity.get(String(side)) ?? "");
      if (!person) continue;
      if (row["predicate"] === "has_role") {
        const role = text(row["value_text"]);
        if (role) person.roles.push(role);
      } else {
        person.keyPerson = true;
      }
    }
  }

  for (const row of companies) {
    for (const name of [text(row["name"]), text(row["legal_name"])]) {
      if (name) organisations.push(name);
    }
  }

  return buildRedactionDictionary({ people: [...byPerson.values()], organisations });
}

/** A dictionary is reused this long per fund, so a run's many calls do not each reload it. */
const DICTIONARY_TTL_MS = 60_000;
const dictionaries = new Map<
  string,
  { loadedAt: number; dictionary: Promise<RedactionDictionary> }
>();

async function serviceClient(service?: SupabaseClient): Promise<SupabaseClient> {
  return service ?? (await import("@/lib/supabase/admin.server")).getServiceClient();
}

/**
 * A new Redactor for one model call, with the fund's dictionary, that also writes the
 * call to the fund's AI log under `flow`. The dictionary is cached for a minute per fund,
 * and calls that arrive together share one load. A failed load is not cached and stops the call
 * before anything is sent (MaskingUnavailableError, which background jobs retry): no dictionary,
 * no call.
 */
export async function redactorForFund(
  fundId: string,
  flow: AiFlow,
  service?: SupabaseClient,
): Promise<Redactor> {
  const now = Date.now();
  let entry = dictionaries.get(fundId);
  if (!entry || now - entry.loadedAt > DICTIONARY_TTL_MS) {
    const created = {
      loadedAt: now,
      dictionary: serviceClient(service).then((client) => loadRedactionDictionary(client, fundId)),
    };
    dictionaries.set(fundId, created);
    created.dictionary.catch(() => {
      if (dictionaries.get(fundId) === created) dictionaries.delete(fundId);
    });
    entry = created;
  }
  try {
    const dictionary = await entry.dictionary;
    return attachCallLog(createRedactor(dictionary), {
      fundId,
      flow,
      service: await serviceClient(service),
    });
  } catch (cause) {
    console.error(
      `[redact] masking dictionary unavailable (fund ${fundId})`,
      cause instanceof Error ? cause.message : cause,
    );
    throw new MaskingUnavailableError();
  }
}
