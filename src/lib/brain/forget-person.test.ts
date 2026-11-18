import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRedactor } from "../ai/redact.ts";
import { BrainUserError } from "./errors.ts";
import {
  forgetPerson,
  nameHash,
  previewForgetPerson,
  type UnreadSource,
} from "./forget-person.server.ts";

const FUND = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const NAME = "Anders Nørregaard Jensen";

type RpcResult = { data?: unknown; error?: { code?: string; message: string } | null };

function fake(options: {
  who?: RpcResult;
  forget?: RpcResult;
  updateError?: { message: string } | null;
  clearError?: { message: string } | null;
  updateFailIds?: string[];
  lessons?: Array<{ id: string; text: string }>;
  files?: unknown[];
  filesToRemove?: unknown[];
  unread?: unknown[];
  args?: Record<string, unknown>;
  log: string[];
}) {
  const service = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      options.log.push(`rpc:${name}`);
      if (options.args) options.args[name] = args;
      if (name === "ai_call_log_forget") return { data: 2, error: null };
      if (name === "gdpr_unread_sources") return { data: options.unread ?? [], error: null };
      if (name === "gdpr_texts_name_person") {
        const texts = args["_texts"] as string[];
        return { data: texts.map((text) => text.includes(NAME)), error: null };
      }
      if (name === "gdpr_person_preview") {
        return { data: { name: NAME, files: options.files ?? [] }, error: null };
      }
      if (name === "gdpr_person_terms") {
        return (
          options.who ?? {
            data: {
              person_id: PERSON,
              entity_ids: ["e1"],
              terms: ["anders@x.dk", NAME],
              primary_name: NAME,
            },
            error: null,
          }
        );
      }
      return (
        options.forget ?? {
          data: {
            raw: {
              peopleDeleted: 1,
              rawMasked: { "evidence_items.claim": 2, "case_notes.body": 1 },
            },
            brain: {
              factsDeleted: 2,
              episodesMasked: 3,
              chunksMasked: 4,
              logRowsMasked: 5,
              memoryEntries: [{ id: "m1", text: "Afvist; [slettet person] manglede erfaring." }],
              episodesDeleted: 2,
              pagesDeleted: 1,
              pagesMasked: 2,
              lessonsMasked: 3,
              lessonsToEmbed: options.lessons ?? [],
            },
            filesToRemove: options.filesToRemove ?? [],
            filesKept: 0,
            notCovered: ["first_name_alone"],
          },
          error: null,
        }
      );
    },
    from: (table: string) => {
      // update(...).eq().eq() for a new vector; update({ embedding: null }) or delete() with
      // .in().eq() to clear the old one.
      const chain = (label: string, initial: { message: string } | null) => {
        let error = initial;
        const filters: string[] = [];
        const builder = {
          eq: (column: string, value: unknown) => {
            filters.push(`${column}=${value}`);
            if (column === "id" && options.updateFailIds?.includes(String(value))) {
              error = { message: "write failed" };
            }
            return builder;
          },
          in: (column: string, values: unknown[]) => (
            filters.push(`${column} in ${values.join(",")}`),
            builder
          ),
          then: (resolve: (value: unknown) => unknown) => {
            options.log.push(`${label}:${table}`);
            if (label !== "update") options.log.push(`${label}:${table}:${filters.join("&")}`);
            return Promise.resolve({ error }).then(resolve);
          },
        };
        return builder;
      };
      return {
        update: (values: Record<string, unknown>) =>
          values["embedding"] === null
            ? chain("clear", options.clearError ?? null)
            : chain("update", options.updateError ?? null),
        delete: () => chain("delete", options.clearError ?? null),
      };
    },
  } as unknown as SupabaseClient;
  return service;
}

function deps(
  log: string[],
  overrides: Parameters<typeof fake>[0] extends infer O ? Partial<O> : never = {},
) {
  const audits: Array<{ action: string; payload: Record<string, unknown> }> = [];
  return {
    audits,
    deps: {
      service: fake({ ...overrides, log }),
      embed: async (values: string[]) => {
        log.push(`embed:${values.length}`);
        return { embeddings: values.map(() => [0.1, 0.2]), tokens: 5 };
      },
      redactor: async () => createRedactor(),
      audit: async (event: { action: string; payload: Record<string, unknown> }) => {
        log.push(`audit:${event.action}`);
        audits.push(event);
      },
      removeFiles: async (bucket: string, paths: string[]) => {
        log.push(`remove:${bucket}:${paths.join(",")}`);
      },
      // The unread sources' text, by path; "throw" for a file that cannot be read now.
      readSource: async (source: UnreadSource) => {
        log.push(`read:${source.id}`);
        const text = TEXTS[source.path];
        if (text === "throw") throw new Error("storage down");
        return text ?? null;
      },
    },
  };
}

test("the audit event comes before the deletion and holds a hash, never the name", async () => {
  const log: string[] = [];
  const { deps: d, audits } = deps(log);
  await forgetPerson(d, FUND, { personId: PERSON });
  assert.deepEqual(log.slice(0, 5), [
    "rpc:gdpr_person_terms",
    "audit:person_forgotten",
    "rpc:gdpr_unread_sources",
    "rpc:ai_call_log_forget",
    "rpc:gdpr_forget_person",
  ]);
  const text = JSON.stringify(audits);
  assert.ok(!text.includes("Nørregaard") && !text.includes("anders@x.dk"));
  assert.equal(audits[0]?.payload["nameHash"], nameHash(NAME, FUND));
});

test("no audit, no deletion", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log);
  d.audit = async () => {
    throw new Error("audit down");
  };
  await assert.rejects(forgetPerson(d, FUND, { personId: PERSON }), /audit down/);
  assert.ok(!log.includes("rpc:gdpr_forget_person"));
});

test("an unknown person is a user error and nothing is audited or deleted", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log, {
    who: { data: null, error: { code: "P0002", message: "unknown" } },
  });
  await assert.rejects(forgetPerson(d, FUND, { personId: PERSON }), BrainUserError);
  assert.deepEqual(log, ["rpc:gdpr_person_terms"]);
});

test("the result sums the counts and the masked fund memory is embedded again", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log);
  const result = await forgetPerson(d, FUND, { personId: PERSON });
  assert.deepEqual(result, {
    peopleDeleted: 1,
    factsDeleted: 2,
    episodesMasked: 3,
    episodesDeleted: 2,
    chunksMasked: 4,
    rawRowsMasked: 3,
    logRowsMasked: 5,
    memoryEntriesReembedded: 1,
    pagesDeleted: 1,
    pagesMasked: 2,
    lessonsMasked: 3,
    lessonsReembedded: 0,
    aiLogPayloadsRemoved: 4,
    filesRemoved: 0,
    filesKept: 0,
    notCovered: ["first_name_alone"],
  });
  assert.ok(log.includes("embed:1") && log.includes("update:fund_memory_entries"));
});

test("a failed re-embed is retried once, then written to the audit trail and reported", async () => {
  const log: string[] = [];
  const { deps: d, audits } = deps(log);
  d.embed = async () => {
    log.push("embed:fail");
    throw new Error("gateway down");
  };
  await assert.rejects(forgetPerson(d, FUND, { personId: PERSON }), BrainUserError);
  assert.equal(log.filter((entry) => entry === "embed:fail").length, 2);
  assert.equal(audits.at(-1)?.action, "person_forget_reembed_failed");
  assert.deepEqual(audits.at(-1)?.payload["memoryEntryIds"], ["m1"]);
});

test("masked lessons get a new vector too (T-313)", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log, {
    lessons: [{ id: "b1", text: "Pas på stiftere som [slettet person]" }],
  });
  const result = await forgetPerson(d, FUND, { personId: PERSON });
  assert.equal(result.lessonsReembedded, 1);
  assert.equal(result.memoryEntriesReembedded, 1);
  assert.ok(log.includes("update:brain_playbook_bullets"));
});

test("a failed lesson re-embed does not stop the memory re-embed, and both are reported", async () => {
  const log: string[] = [];
  const { deps: d, audits } = deps(log, {
    lessons: [{ id: "b1", text: "Pas på stiftere som [slettet person]" }],
  });
  d.embed = async (values: string[]) => {
    if (values[0]?.startsWith("Pas på")) throw new Error("gateway down");
    log.push(`embed:${values.length}`);
    return { embeddings: values.map(() => [0.1, 0.2]), tokens: 5 };
  };
  await assert.rejects(forgetPerson(d, FUND, { personId: PERSON }), /men 1 lektion mangler/);
  assert.ok(log.includes("update:fund_memory_entries"));
  assert.ok(!log.includes("update:brain_playbook_bullets"));
  assert.deepEqual(audits.at(-1)?.payload["lessonIds"], ["b1"]);
});

test("the new vectors are written before the second AI log purge", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log, { lessons: [{ id: "b1", text: "[slettet person] gik" }] });
  await forgetPerson(d, FUND, { personId: PERSON });
  assert.ok(
    log.indexOf("update:brain_playbook_bullets") < log.lastIndexOf("rpc:ai_call_log_forget"),
  );
});

test("an embedder that returns too few vectors is a failed re-embed, never a silent gap", async () => {
  const log: string[] = [];
  const { deps: d, audits } = deps(log);
  d.embed = async () => ({ embeddings: [], tokens: 0 });
  await assert.rejects(forgetPerson(d, FUND, { personId: PERSON }), /1 hukommelsespunkt mangler/);
  assert.ok(!log.includes("update:fund_memory_entries"));
  assert.deepEqual(audits.at(-1)?.payload["memoryEntryIds"], ["m1"]);
});

test("a failed re-embed never leaves the old vector made from the name (T-823)", async () => {
  const log: string[] = [];
  const { deps: d, audits } = deps(log, { lessons: [{ id: "b1", text: "[slettet person] gik" }] });
  d.embed = async () => ({ embeddings: [], tokens: 0 });
  await assert.rejects(forgetPerson(d, FUND, { personId: PERSON }), /mangler en ny søgevektor/);
  // The memory entry (NOT NULL vector, rebuilt from its case) goes; the lesson keeps no vector.
  assert.ok(log.includes(`delete:fund_memory_entries:id in m1&fund_id=${FUND}`));
  assert.ok(log.includes(`clear:brain_playbook_bullets:id in b1&fund_id=${FUND}`));
  assert.ok(!log.includes("update:fund_memory_entries"));
  const failed = audits.filter((event) => event.action === "person_forget_reembed_failed");
  assert.equal(failed.length, 2);
  assert.ok(failed.every((event) => event.payload["oldVectorsCleared"] === true));
});

test("an old vector that cannot be cleared is said so in the audit trail", async () => {
  const log: string[] = [];
  const { deps: d, audits } = deps(log, { clearError: { message: "down" } });
  d.embed = async () => ({ embeddings: [], tokens: 0 });
  await assert.rejects(forgetPerson(d, FUND, { personId: PERSON }), /kunne ikke fjernes/);
  assert.equal(audits.at(-1)?.payload["oldVectorsCleared"], false);
});

test("only the rows without a new vector are cleared, not the ones that got one", async () => {
  const log: string[] = [];
  const lessons = [
    { id: "b1", text: "[slettet person] gik" },
    { id: "b2", text: "[slettet person] kom" },
  ];
  // b2's new vector can never be stored; b1's is stored on the first try.
  const { deps: d, audits } = deps(log, { lessons, updateFailIds: ["b2"] });
  await assert.rejects(forgetPerson(d, FUND, { personId: PERSON }), /1 lektion mangler/);
  assert.ok(log.includes(`clear:brain_playbook_bullets:id in b2&fund_id=${FUND}`));
  assert.deepEqual(audits.at(-1)?.payload["lessonIds"], ["b2"]);
  // The second try embeds only b2.
  assert.deepEqual(
    log.filter((line) => line.startsWith("embed:")),
    ["embed:1", "embed:2", "embed:1"],
  );
});

test("the name hash ignores case and surrounding spaces and differs per fund", () => {
  assert.equal(nameHash(` ${NAME.toUpperCase()} `, FUND), nameHash(NAME, FUND));
  assert.notEqual(nameHash(NAME, FUND), nameHash("Bente Holm", FUND));
  assert.notEqual(nameHash(NAME, FUND), nameHash(NAME, "other-fund"));
});

test("a person without a usable name is a user error", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log, { who: { data: null, error: { code: "GD001", message: "none" } } });
  await assert.rejects(forgetPerson(d, FUND, { personId: PERSON }), BrainUserError);
  assert.deepEqual(log, ["rpc:gdpr_person_terms"]);
});

const TEXTS: Record<string, string> = {
  [`${FUND}/s2/venter.pdf`]: `Bestyrelse: ${NAME}, formand.`,
  [`${FUND}/s3/andet.pdf`]: "Kvartalsrapport uden navne.",
  [`${FUND}/s4/laases-ikke.pdf`]: "throw",
};
const WAITING = {
  id: "s2",
  kind: "pdf",
  name: "venter.pdf",
  fileName: "venter.pdf",
  path: `${FUND}/s2/venter.pdf`,
  pageLimit: null,
};
const OTHER = { ...WAITING, id: "s3", name: "andet.pdf", path: `${FUND}/s3/andet.pdf` };
const UNREADABLE = { ...WAITING, id: "s4", name: "x.pdf", path: `${FUND}/s4/laases-ikke.pdf` };

const DECK = {
  kind: "document",
  id: "d1",
  name: "deck.pdf",
  bucket: "pitch-decks",
  path: `${FUND}/c1/deck.pdf`,
};
const REPORT = {
  kind: "brain_source",
  id: "s1",
  name: "rapport.pdf",
  bucket: "brain-sources",
  path: `${FUND}/s1/rapport.pdf`,
};

test("the preview gives the name and the files, never their bucket or path", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log, { files: [DECK, REPORT] });
  const preview = await previewForgetPerson(d.service, FUND, { personId: PERSON }, d.readSource);
  assert.deepEqual(preview, {
    name: NAME,
    files: [
      { kind: "document", name: "deck.pdf" },
      { kind: "brain_source", name: "rapport.pdf" },
    ],
  });
});

test("chosen files are deleted per bucket before anything is forgotten (T-805)", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log, { files: [DECK, REPORT], filesToRemove: [DECK, REPORT] });
  const result = await forgetPerson(d, FUND, { personId: PERSON }, { removeFiles: true });
  const removeDeck = log.indexOf(`remove:pitch-decks:${DECK.path}`);
  const removeReport = log.indexOf(`remove:brain-sources:${REPORT.path}`);
  assert.ok(removeDeck >= 0 && removeReport >= 0);
  assert.ok(removeDeck < log.indexOf("rpc:gdpr_forget_person"));
  // The same files are not deleted twice after the forgetting.
  assert.equal(log.filter((line) => line.startsWith("remove:")).length, 2);
  assert.equal(result.filesRemoved, 2);
});

test("without removeFiles no file is read or deleted", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log, { files: [DECK] });
  await forgetPerson(d, FUND, { personId: PERSON });
  assert.ok(!log.includes("rpc:gdpr_person_preview"));
  assert.ok(!log.some((line) => line.startsWith("remove:")));
});

test("a file that cannot be deleted stops before the forgetting, so it can be tried again", async () => {
  const log: string[] = [];
  const { deps: d, audits } = deps(log, { files: [DECK] });
  d.removeFiles = async () => {
    log.push("remove:fail");
    throw new Error("storage down");
  };
  await assert.rejects(
    forgetPerson(d, FUND, { personId: PERSON }, { removeFiles: true }),
    /Intet er glemt endnu/,
  );
  assert.equal(log.filter((line) => line === "remove:fail").length, 2);
  assert.ok(!log.includes("rpc:gdpr_forget_person"));
  assert.deepEqual(audits.at(-1), {
    action: "person_forget_files_failed",
    payload: { documentIds: ["d1"], sourceIds: [], personForgotten: false },
  });
});

test("a file added meanwhile is deleted after the forgetting; a failure is audited and said", async () => {
  const log: string[] = [];
  const { deps: d, audits } = deps(log, { files: [DECK], filesToRemove: [DECK, REPORT] });
  d.removeFiles = async (bucket: string, paths: string[]) => {
    log.push(`remove:${bucket}:${paths.join(",")}`);
    if (bucket === "brain-sources") throw new Error("storage down");
  };
  await assert.rejects(
    forgetPerson(d, FUND, { personId: PERSON }, { removeFiles: true }),
    /Personen er glemt, men filer/,
  );
  assert.ok(
    log.indexOf(`remove:brain-sources:${REPORT.path}`) > log.indexOf("rpc:gdpr_forget_person"),
  );
  assert.deepEqual(audits.at(-1)?.payload, {
    documentIds: [],
    sourceIds: ["s1"],
    personForgotten: true,
  });
});

test("a file outside the fund or the two buckets is never deleted", async () => {
  const log: string[] = [];
  const foreign = { ...DECK, id: "d2", path: "other-fund/c1/deck.pdf" };
  const bucket = { ...DECK, id: "d3", bucket: "avatars" };
  const { deps: d } = deps(log, { files: [foreign, bucket] });
  // Never deleted, and never reported or marked as deleted: the forgetting stops first.
  await assert.rejects(
    forgetPerson(d, FUND, { personId: PERSON }, { removeFiles: true }),
    /Intet er glemt endnu/,
  );
  assert.ok(!log.some((line) => line.startsWith("remove:")));
  assert.ok(!log.includes("rpc:gdpr_forget_person"));
});

test("a failed forgetting after the files went says that pressing again finishes it", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log, {
    files: [DECK],
    forget: { data: null, error: { code: "XX000", message: "boom" } },
  });
  await assert.rejects(
    forgetPerson(d, FUND, { personId: PERSON }, { removeFiles: true }),
    /Tryk "Glem person" igen/,
  );
});

test("an upload not read in yet that names the person is shown and deleted (T-786)", async () => {
  const log: string[] = [];
  const args: Record<string, unknown> = {};
  const { deps: d } = deps(log, { unread: [WAITING, OTHER, UNREADABLE], args });
  const preview = await previewForgetPerson(d.service, FUND, { personId: PERSON }, d.readSource);
  // The one naming the person, and the one that could not be read (it may name them).
  assert.deepEqual(
    preview.files.map((file) => file.name),
    ["venter.pdf", "x.pdf"],
  );
  log.length = 0;
  const result = await forgetPerson(d, FUND, { personId: PERSON }, { removeFiles: true });
  assert.ok(log.includes(`remove:brain-sources:${WAITING.path},${UNREADABLE.path}`));
  assert.ok(
    log.indexOf(`remove:brain-sources:${WAITING.path},${UNREADABLE.path}`) <
      log.indexOf("rpc:gdpr_forget_person"),
  );
  assert.deepEqual((args["gdpr_forget_person"] as Record<string, unknown>)["_unread_source_ids"], [
    "s2",
    "s4",
  ]);
  assert.equal(result.filesRemoved, 2);
});

test("kept, an unread upload that names the person is still sent to be approved again", async () => {
  const log: string[] = [];
  const args: Record<string, unknown> = {};
  const { deps: d } = deps(log, { unread: [WAITING, OTHER], args });
  await forgetPerson(d, FUND, { personId: PERSON });
  assert.ok(!log.some((line) => line.startsWith("remove:")));
  assert.deepEqual((args["gdpr_forget_person"] as Record<string, unknown>)["_unread_source_ids"], [
    "s2",
  ]);
});

test("an unread source already in the file list is not read twice", async () => {
  const log: string[] = [];
  const { deps: d } = deps(log, {
    files: [{ ...REPORT, id: "s2", path: WAITING.path }],
    unread: [WAITING],
  });
  await forgetPerson(d, FUND, { personId: PERSON }, { removeFiles: true });
  assert.ok(!log.includes("read:s2"));
  assert.equal(log.filter((line) => line.startsWith("remove:")).length, 1);
});
