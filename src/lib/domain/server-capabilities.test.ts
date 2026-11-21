/**
 * Rights at the server-function level (every capability is tried through the server function as
 * well as directly in the database). Each server function in the areas must
 * check exactly the capability the rights matrix gives its action, as the first gate
 * (requireFundCapability). workflow.test.ts proves which roles hold each capability, and
 * npm run test:rls proves the database refuses the same actions on its own; together they cover
 * role × action for the server path. A new server function in these files fails this test until
 * it is added below with its capability (or a named custom check).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hasCapability, strictFundSettings } from "./workflow.ts";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

type Expected = string | { custom: string };

const EXPECTED: Record<string, Record<string, Expected>> = {
  "cases/transitions.functions.ts": {
    transitionCases: "move_process_stage",
    undoCaseTransitions: "move_process_stage",
    listReasonCodes: "view_case",
    getCaseStatusLine: "view_case",
  },
  "cases/tasks.functions.ts": {
    listCaseTasks: "view_case",
    createCaseTask: "manage_tasks",
    updateCaseTask: "manage_tasks",
    deleteCaseTask: "manage_tasks",
    restoreCaseTask: "manage_tasks",
    answerCaseTask: "manage_tasks",
    listTaskAssignees: "view_case",
  },
  "cases/messages.functions.ts": {
    listCaseMessages: "view_case",
    postCaseMessage: "write_messages",
    editCaseMessage: "write_messages",
    deleteCaseMessage: "write_messages",
  },
  "cases/files.functions.ts": {
    listCaseFiles: "view_case",
    registerCaseFile: "upload_document",
    getCaseFileUrl: "view_case",
  },
  "cases/cases.functions.ts": {
    getCaseDetail: { custom: "RLS-scoped read of one case in the active fund" },
    listCases: { custom: "RLS-scoped list of the active fund's cases" },
    createManualCase: "create_case",
    registerPitchDeck: { custom: "register_pitch_deck RPC checks membership in the database" },
    extractPitchDeck: "upload_document",
    listPitchDecks: { custom: "RLS-scoped read" },
    listCaseNotes: "view_case",
    addCaseNote: "write_notes",
  },
  "cases/find-candidates.functions.ts": {
    findCompanyCandidates: "create_case",
  },
  "cases/intake.functions.ts": {
    getIntakeCapabilities: "view_case",
    getIntakeMandate: "view_case",
    findExistingCases: "create_case",
    findScreeningRun: "view_case",
    setIntakeCaseOrigin: "create_case",
  },
  "auth/access.functions.ts": {
    getMyAccess: { custom: "the caller's own access" },
    listMembers: "manage_users",
    listInvitations: "manage_users",
    listAuditEvents: "manage_users",
    setMemberRoles: "manage_users",
    setMemberStatus: "manage_users",
    resetMemberMfa: "manage_users",
    getSeatUsage: "manage_users",
    getFundAdminNames: "view_case",
    setFundMemberSettings: "manage_users",
  },
  "auth/invitations.functions.ts": {
    createInvitation: "manage_users",
    revokeInvitation: "manage_users",
    resolveInvitation: { custom: "token holder, before sign-in" },
    acceptInvitationAsNewUser: { custom: "token holder, before sign-in" },
    acceptInvitationAsExistingUser: { custom: "token holder, signed in" },
  },
  "funds/funds.functions.ts": {
    listMemberFunds: { custom: "the caller's own memberships" },
    createFund: { custom: "Admin in at least one fund (harden S5-3)" },
    deleteFund: "manage_users",
  },
  // Spor B: the limits in kroner are for Admin and Lead only.
  "funds/ai-settings.functions.ts": {
    getFundAiSettings: "view_case",
    getFundAnalysisLimits: "configure_fund",
    updateFundAiSettings: "configure_fund",
  },
};

/** export const <name> = createServerFn ... up to the next export. */
function serverFunctions(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const parts = source.split(/export const (\w+) = createServerFn/);
  for (let index = 1; index < parts.length; index += 2) {
    found.set(parts[index]!, parts[index + 1]!.split(/\nexport /)[0]!);
  }
  return found;
}

/** The capability (last argument) of the first requireFundCapability(...) call, if any. */
function firstCapability(body: string): string | null {
  const call = /requireFundCapability\(([\s\S]*?)\);/.exec(body);
  const last = call ? /"([a-z_]+)"\s*,?\s*$/.exec(call[1]!) : null;
  return last?.[1] ?? null;
}

for (const [file, expected] of Object.entries(EXPECTED)) {
  test(`${file}: every server function checks the capability of its action`, () => {
    const source = readFileSync(join(ROOT, "src", "lib", file), "utf8");
    const functions = serverFunctions(source);
    assert.deepEqual(
      [...functions.keys()].sort(),
      Object.keys(expected).sort(),
      "a server function was added or removed; list it here with its capability",
    );
    for (const [name, want] of Object.entries(expected)) {
      const body = functions.get(name)!;
      assert.match(body, /requireSupabaseAuth|token/, `${name} has no auth middleware`);
      if (typeof want === "string") {
        assert.equal(firstCapability(body), want, `${name} checks the wrong capability`);
        // The service role passes RLS: no inline getServiceClient() before the first check
        // (helpers outside the body are not seen here).
        const serviceRead = body.indexOf("getServiceClient()");
        assert.ok(
          serviceRead === -1 || body.indexOf("requireFundCapability(") < serviceRead,
          `${name} reads with the service role before the capability check`,
        );
      }
    }
  });
}

// Spor B (spec B.1 punkt 3): going past the team's limit, also one time, is for Admin and
// Lead only. Medlem may start a screening and a deep analysis, so the start itself does not stop
// a direct call with atLimit "raise_once"; the choice needs its own configure_fund check, awaited
// before the run is planned or reserved.
// workflow.test.ts holds the full matrix; this keeps the premise of the gate next to it.
test("Medlem starts analyses; neither Medlem nor Læser holds configure_fund", () => {
  for (const settings of [strictFundSettings, { memberCanDecide: true, memberCanPublish: true }]) {
    for (const role of ["member", "reader"] as const) {
      assert.equal(hasCapability([role], "configure_fund", settings), false, role);
    }
    assert.equal(hasCapability(["member"], "start_analysis", settings), true);
    assert.equal(hasCapability(["member"], "approve_deep_analysis", settings), true);
    for (const role of ["admin", "lead"] as const) {
      assert.equal(hasCapability([role], "configure_fund", settings), true, role);
    }
  }
});

for (const [file, name] of [
  ["analysis/screening.functions.ts", "runInitialScreening"],
  ["analysis/deep.functions.ts", "approveAndRunDeepAnalysis"],
] as const) {
  test(`${file}: ${name} lets only configure_fund choose raise_once, before planning`, () => {
    const body = serverFunctions(readFileSync(join(ROOT, "src", "lib", file), "utf8")).get(name);
    assert.ok(body, `${name} not found`);
    const opening = 'if (data.atLimit === "raise_once") {';
    const gate = body.indexOf(opening);
    assert.ok(gate > 0, `${name} has no raise_once gate`);
    assert.equal(body.indexOf(opening, gate + 1), -1, `${name} has more than one raise_once gate`);
    const block = body.slice(gate, body.indexOf("}", gate));
    assert.match(block, /^\s*if[^{]*\{\s*await requireFundCapability\(/, "the gate is not awaited");
    assert.equal(firstCapability(block), "configure_fund", `${name} gates raise_once wrongly`);
    // Every place the choice reaches the plan or the reservation comes after the gate.
    for (const use of ["planNewRun(", "reservePlannedRun(", "choice: data.atLimit"]) {
      const first = body.indexOf(use);
      assert.ok(first > gate, `${use} comes before the raise_once gate in ${name}`);
    }
  });
}

// Server functions that call paid or slow outside services must also be rate limited per user.
// The limit is counted in the database, so it must be awaited.
for (const [file, names] of [
  ["cases/find-candidates.functions.ts", ["findCompanyCandidates"]],
] as const) {
  test(`${file}: ${names.join(", ")} is rate limited per user`, () => {
    const source = readFileSync(join(ROOT, "src", "lib", file), "utf8");
    const functions = serverFunctions(source);
    for (const name of names) {
      assert.match(
        functions.get(name) ?? "",
        /await (server\.)?rateLimit\(/,
        `${name} has no rateLimit`,
      );
    }
  });
}
