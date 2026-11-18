/** Test af oprettelsesorkestreringen på Opret case (ingen netværk). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canStartCreation,
  friendlyStepError,
  newJob,
  normalizeWebsiteInput,
  planSteps,
  runJob,
  screeningFinished,
  screeningUntracked,
  type CaseJob,
  type IntakeDeps,
  type IntakePlan,
} from "./intake-run.ts";

const company = {
  name: "Havbrug Nord ApS",
  website: "https://havbrugnord.dk",
  stage: "unknown",
  sector: "",
  geography: "Danmark",
  notes: "",
  sourceNote: "",
  cvrNumber: "26316804",
  humanChoseCompany: true,
};
const deck = (name: string) => ({ name }) as File;

function plan(patch: Partial<IntakePlan> = {}): IntakePlan {
  return {
    mode: "screen",
    company,
    origin: null,
    files: [],
    captureWebsite: true,
    ...patch,
  };
}

function deps(log: string[], overrides: Partial<IntakeDeps> = {}): IntakeDeps {
  return {
    findExisting: async () => null,
    createCase: async (fundId) => {
      log.push(`create:${fundId}`);
      return { caseId: `case-${fundId}` };
    },
    setOrigin: async (fundId) => void log.push(`origin:${fundId}`),
    confirmIdentity: async (fundId) => void log.push(`identity:${fundId}`),
    uploadFile: async (fundId, caseId, file) => {
      log.push(`upload:${fundId}:${file.name}`);
      return { documentId: `doc-${fundId}-${file.name}` };
    },
    extractFile: async (_caseId, documentId) => void log.push(`extract:${documentId}`),
    captureWebsite: async (caseId) => void log.push(`website:${caseId}`),
    startScreening: async (fundId) => {
      log.push(`screen:${fundId}`);
      return { runId: `run-${fundId}` };
    },
    findScreeningRun: async (fundId) => `run-existing-${fundId}`,
    ...overrides,
  };
}

const status = (job: CaseJob, key: string) => job.steps.find((s) => s.key === key)?.status;
const fund = { id: "f1", name: "Fond A" };

test("trin følger planen: kun det, der er valgt", () => {
  assert.deepEqual(
    planSteps(
      plan({ mode: "create", company: { ...company, cvrNumber: null }, captureWebsite: false }),
    ),
    ["intake_create"],
  );
  assert.deepEqual(
    planSteps(
      plan({ files: [deck("a.pdf")], origin: { sourceKind: "network", assignedTo: null } }),
    ),
    [
      "intake_create",
      "intake_origin",
      "intake_identity",
      "intake_upload",
      "intake_extract",
      "intake_website",
      "intake_screening",
    ],
  );
});

test("hele forløbet i rækkefølge og screeningen startes én gang", async () => {
  const log: string[] = [];
  const p = plan({ files: [deck("a.pdf")] });
  const done = await runJob(newJob(fund, p), p, deps(log), () => {});
  assert.deepEqual(log, [
    "create:f1",
    "identity:f1",
    "upload:f1:a.pdf",
    "extract:doc-f1-a.pdf",
    "website:case-f1",
    "screen:f1",
  ]);
  assert.equal(done.state, "done");
  assert.equal(done.runId, "run-f1");
});

test("Opret uden screening starter aldrig en kørsel", async () => {
  const log: string[] = [];
  const p = plan({ mode: "create" });
  const done = await runJob(newJob(fund, p), p, deps(log), () => {});
  assert.equal(
    log.some((line) => line.startsWith("screen:")),
    false,
  );
  assert.equal(done.state, "done");
  assert.equal(done.runId, null);
});

test("dublet i samme fond: venlig besked, ingen oprettelse", async () => {
  const log: string[] = [];
  const p = plan();
  const done = await runJob(
    newJob(fund, p),
    p,
    deps(log, { findExisting: async () => ({ caseId: "c9", companyName: "Havbrug Nord" }) }),
    () => {},
  );
  assert.equal(done.state, "attention");
  assert.equal(done.duplicate?.caseId, "c9");
  assert.equal(log.length, 0);
  assert.match(done.steps[0]!.message!, /findes allerede i Fond A/);
});

test("fejl i website og deck stopper ikke casen, og et genforsøg gentager kun det fejlede", async () => {
  const log: string[] = [];
  let websiteFails = true;
  let extractFails = true;
  const d = deps(log, {
    captureWebsite: async () => {
      log.push("website");
      if (websiteFails) throw new Error("Failed to fetch");
    },
    extractFile: async (_c, documentId) => {
      log.push(`extract:${documentId}`);
      if (extractFails)
        throw new Error("Pitch decket kunne ikke udtrækkes. Casen screenes på resten.");
    },
  });
  const p = plan({ files: [deck("a.pdf"), deck("b.pdf")] });
  let job = await runJob(newJob(fund, p), p, d, () => {});
  assert.equal(job.state, "attention");
  assert.equal(status(job, "intake_create"), "complete");
  assert.equal(status(job, "intake_website"), "failed");
  assert.equal(status(job, "intake_extract"), "failed");
  // M2: den betalte screening starter ikke, før decket er læst.
  assert.equal(status(job, "intake_screening"), "queued");
  assert.equal(log.includes("screen:f1"), false);
  // Rå netværkstekst vises aldrig.
  assert.doesNotMatch(job.steps.find((s) => s.key === "intake_website")!.message!, /fetch/i);

  log.length = 0;
  websiteFails = false;
  extractFails = false;
  job = await runJob(job, p, d, () => {});
  assert.deepEqual(log, ["extract:doc-f1-a.pdf", "extract:doc-f1-b.pdf", "website", "screen:f1"]);
  assert.equal(job.state, "done");
});

test("M2: fejlet upload stopper screeningen, og genforsøget går ind igen ved upload og kører den bagefter", async () => {
  const log: string[] = [];
  let fail = true;
  const d = deps(log, {
    uploadFile: async (fundId, _c, file) => {
      log.push(`upload:${file.name}`);
      if (fail) throw new Error("storage down");
      return { documentId: `doc-${file.name}` };
    },
  });
  const p = plan({ files: [deck("a.pdf")], captureWebsite: false });
  let job = await runJob(newJob(fund, p), p, d, () => {});
  assert.equal(job.state, "attention");
  assert.equal(status(job, "intake_upload"), "failed");
  assert.equal(
    status(job, "intake_extract"),
    "failed",
    "ikke 'skipped': genforsøget skal ind igen",
  );
  assert.equal(log.includes("screen:f1"), false);
  fail = false;
  log.length = 0;
  job = await runJob(job, p, d, () => {});
  assert.deepEqual(log, ["upload:a.pdf", "extract:doc-a.pdf", "screen:f1"]);
  assert.equal(job.state, "done");
});

test("M1: mistet svar på start giver 'screenes allerede', og den eksisterende kørsel følges", async () => {
  const log: string[] = [];
  const p = plan({ captureWebsite: false, company: { ...company, cvrNumber: null } });
  const d = deps(log, {
    startScreening: async () => {
      throw new Error("Denne case screenes allerede.");
    },
  });
  const job = await runJob(newJob(fund, p), p, d, () => {});
  assert.equal(job.runId, "run-existing-f1");
  assert.equal(job.state, "done");
});

test("M1: findes kørslen ikke, markeres det tydeligt og siden kan åbne casen", async () => {
  const p = plan({ captureWebsite: false, company: { ...company, cvrNumber: null } });
  const d = deps([], {
    startScreening: async () => {
      throw new Error("Denne case screenes allerede.");
    },
    findScreeningRun: async () => null,
  });
  const job = await runJob(newJob(fund, p), p, d, () => {});
  assert.equal(job.runId, null);
  assert.equal(screeningUntracked(job), true);
  assert.equal(screeningFinished(job, undefined), true);
  assert.match(job.steps.find((s) => s.key === "intake_screening")!.message!, /Åbn casen/);
});

test("m8: Opret uden screening henter ikke registeret (ingen identitetstrin)", async () => {
  const log: string[] = [];
  const p = plan({ mode: "create" });
  assert.equal(planSteps(p).includes("intake_identity"), false);
  await runJob(newJob(fund, p), p, deps(log), () => {});
  assert.equal(
    log.some((line) => line.startsWith("identity:")),
    false,
  );
});

test("genforsøg af upload tager kun filerne uden dokument", async () => {
  const log: string[] = [];
  let failB = true;
  const d = deps(log, {
    uploadFile: async (fundId, _caseId, file) => {
      log.push(`upload:${file.name}`);
      if (file.name === "b.pdf" && failB) throw new Error("storage down");
      return { documentId: `doc-${file.name}` };
    },
  });
  const p = plan({ files: [deck("a.pdf"), deck("b.pdf")], captureWebsite: false, mode: "create" });
  let job = await runJob(newJob(fund, p), p, d, () => {});
  assert.equal(status(job, "intake_upload"), "failed");
  assert.equal(job.files[0]!.documentId, "doc-a.pdf");
  assert.equal(job.files[1]!.documentId, null);
  log.length = 0;
  failB = false;
  job = await runJob(job, p, d, () => {});
  assert.deepEqual(
    log.filter((l) => l.startsWith("upload:")),
    ["upload:b.pdf"],
  );
  assert.equal(job.state, "done");
});

test("screeningen fejler: casen findes, og genforsøg starter kun screeningen", async () => {
  const log: string[] = [];
  let fail = true;
  const d = deps(log, {
    startScreening: async (fundId) => {
      log.push("screen");
      if (fail) throw new Error("boom");
      return { runId: `run-${fundId}` };
    },
  });
  const p = plan({ captureWebsite: false, company: { ...company, cvrNumber: null } });
  let job = await runJob(newJob(fund, p), p, d, () => {});
  assert.equal(job.state, "attention");
  assert.equal(job.caseId, "case-f1");
  assert.equal(status(job, "intake_screening"), "failed");
  log.length = 0;
  fail = false;
  job = await runJob(job, p, d, () => {});
  assert.deepEqual(log, ["screen"], "ingen ny case, ingen gentagne trin");
  assert.equal(job.state, "done");
});

test("to fonde: to isolerede cases, delvis fejl vises pr. case", async () => {
  const log: string[] = [];
  const p = plan({ files: [deck("a.pdf")] });
  const d = deps(log, {
    createCase: async (fundId) => {
      if (fundId === "f2") throw new Error("Stadiet bruges ikke af denne investeringstese.");
      return { caseId: `case-${fundId}` };
    },
  });
  const jobs = await Promise.all(
    [fund, { id: "f2", name: "Fond B" }].map((f) => runJob(newJob(f, p), p, d, () => {})),
  );
  assert.equal(jobs[0]!.state, "done");
  assert.equal(jobs[1]!.state, "attention");
  assert.equal(jobs[1]!.caseId, null);
  assert.match(jobs[1]!.steps[0]!.message!, /Stadiet bruges ikke/);
  // Hver case har sin egen deck-upload (ikke delt storage-objekt).
  assert.ok(log.includes("upload:f1:a.pdf"));
  assert.ok(!log.some((l) => l.startsWith("upload:f2")));
});

test("kilde og ansvarlig: en fejl mister ikke casen", async () => {
  const log: string[] = [];
  const p = plan({ origin: { sourceKind: "event", assignedTo: "u1" }, captureWebsite: false });
  const d = deps(log, {
    setOrigin: async () => {
      throw new Error("Den ansvarlige er ikke medlem af investeringstesen.");
    },
  });
  const job = await runJob(newJob(fund, p), p, d, () => {});
  assert.equal(status(job, "intake_origin"), "failed");
  assert.equal(job.caseId, "case-f1");
  assert.equal(status(job, "intake_screening"), "complete");
});

test("friendlyStepError og normalizeWebsiteInput", () => {
  assert.equal(friendlyStepError(new Error("TypeError: x is undefined"), "Reserve"), "Reserve");
  assert.equal(
    friendlyStepError(new Error("Casen kunne ikke oprettes."), "Reserve"),
    "Casen kunne ikke oprettes.",
  );
  assert.equal(normalizeWebsiteInput("havbrugnord.dk"), "https://havbrugnord.dk");
  assert.equal(normalizeWebsiteInput("https://a.dkhttps://a.dk"), "");
  assert.equal(normalizeWebsiteInput("ikke en adresse"), "");
  assert.equal(normalizeWebsiteInput(""), "");
});

test("m1: et match Interlect selv valgte gemmes ikke som bekræftet; et aktivt valg gør", async () => {
  const auto = plan({ company: { ...company, humanChoseCompany: false } });
  assert.equal(planSteps(auto).includes("intake_identity"), false);
  const log: string[] = [];
  await runJob(newJob(fund, auto), auto, deps(log), () => {});
  assert.equal(
    log.some((line) => line.startsWith("identity:")),
    false,
  );
  assert.equal(planSteps(plan()).includes("intake_identity"), true);
});

test("m3: to starter i træk giver kun ét job pr. fond (parallelle kald deler ikke tilstand)", async () => {
  const log: string[] = [];
  const p = plan({ company: { ...company, cvrNumber: null }, captureWebsite: false });
  const a = runJob(newJob(fund, p), p, deps(log), () => {});
  const b = runJob(newJob({ id: "f2", name: "Fond B" }, p), p, deps(log), () => {});
  await Promise.all([a, b]);
  assert.equal(log.filter((line) => line.startsWith("create:")).length, 2);
});

test("m3: dobbeltstart afvises, mens et job arbejder, og er tilladt bagefter", async () => {
  const p = plan({ company: { ...company, cvrNumber: null }, captureWebsite: false });
  assert.equal(canStartCreation([]), true);
  const job = newJob(fund, p);
  assert.equal(canStartCreation([job]), false, "idle (lige startet)");
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const seen: CaseJob[] = [];
  const running = runJob(
    job,
    p,
    deps([], { createCase: async () => (await gate, { caseId: "c1" }) }),
    (next) => seen.push(next),
  );
  assert.equal(canStartCreation([seen.at(-1)!]), false, "running");
  release();
  const done = await running;
  assert.equal(canStartCreation([done]), true, "done");
});
