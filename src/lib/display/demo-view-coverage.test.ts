import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Every server function that sends company or person names to a screen must pass its
 * result through the demo view. A function added later that reads names is listed here (or
 * judged not to carry names) so a screen never shows the real ones in a demo team by accident.
 */
const MUST_WRAP: Record<string, string[]> = {
  "src/lib/cases/cases.functions.ts": [
    "getCaseDetail",
    "listCases",
    "listPitchDecks",
    "listCaseNotes",
  ],
  "src/lib/cases/tasks.functions.ts": ["listCaseTasks"],
  "src/lib/cases/messages.functions.ts": ["listCaseMessages"],
  "src/lib/cases/files.functions.ts": ["listCaseFiles"],
  "src/lib/cases/financials.functions.ts": [
    "listFinancialStatements",
    "fetchCompanyFinancials",
    "fetchForeignCompanyFinancials",
    "lookupCvrByName",
  ],
  "src/lib/cases/transitions.functions.ts": ["getCaseStatusLine"],
  "src/lib/overview/overview.functions.ts": ["getOverviewSnapshot", "getOverviewRunning"],
  "src/lib/funds/rescreen.functions.ts": ["listRescreenCandidates"],
  "src/lib/overview/tasks.functions.ts": ["listFundOpenTasks"],
};

/**
 * Brain server functions judged to send none of the team's text to a screen (counts, ids,
 * states, a link to the stored file, the title just typed). Every other Brain function must show
 * its text through the demo view: the wrapper, or the team's namer inside it.
 */
const BRAIN_WITHOUT_TEAM_TEXT: Record<string, string[]> = {
  "capabilities.functions.ts": ["getBrainCapabilities"],
  "chat.functions.ts": [
    "renameBrainThread",
    "setBrainThreadVisibility",
    "deleteBrainThread",
    "submitBrainFeedback",
    "saveBrainAnswerToBrain",
  ],
  "forget-person.functions.ts": ["forgetBrainPerson"],
  "forget.functions.ts": ["forgetBrainSource"],
  "ingest.functions.ts": [
    "requestBrainUpload",
    "approveBrainIngest",
    "retryBrainIngest",
    "discardBrainUpload",
    "getBrainSourceDownloadUrl",
  ],
  "lessons.functions.ts": ["reviewBrainLesson", "reviewBrainInsight"],
  "merge.functions.ts": ["mergeBrainEntities", "splitBrainEntity"],
  "pages.functions.ts": ["editBrainPageSection"],
  "website.functions.ts": ["confirmWebsitePortfolio"],
};

/** Each exported server function of a file and its source, up to the next export. */
function serverFunctions(file: string): Map<string, string> {
  const source = readFileSync(file, "utf8");
  const out = new Map<string, string>();
  for (const m of source.matchAll(/export const (\w+) = createServerFn/g)) {
    const next = source.indexOf("\nexport const ", m.index + 1);
    out.set(m[1]!, source.slice(m.index, next === -1 ? undefined : next));
  }
  return out;
}

test("the screens' name-carrying server functions go through the demo view", () => {
  for (const [file, names] of Object.entries(MUST_WRAP)) {
    const functions = serverFunctions(file);
    for (const name of names) {
      const block = functions.get(name);
      assert.ok(block, `${name} not found in ${file}`);
      assert.match(block, /\.handler\(\s*withDemoView\(/, `${name} must use withDemoView`);
    }
  }
});

test("every Brain server function shows the team's text through the demo view (T-776)", () => {
  const dir = "src/lib/brain";
  const files = readdirSync(dir).filter((file) => file.endsWith(".functions.ts"));
  for (const file of Object.keys(BRAIN_WITHOUT_TEAM_TEXT)) {
    assert.ok(files.includes(file), `${file} is listed but does not exist`);
  }
  for (const file of files) {
    const functions = serverFunctions(`${dir}/${file}`);
    const judged = BRAIN_WITHOUT_TEAM_TEXT[file] ?? [];
    for (const name of judged) assert.ok(functions.has(name), `${name} not found in ${file}`);
    for (const [name, block] of functions) {
      if (judged.includes(name)) continue;
      assert.match(
        block,
        /withDemoView\(|inDemoView\(|loadDemoView\(|demoNamer\(/,
        `${file}: ${name} must show its text through the demo view, or be judged to carry none`,
      );
    }
  }
});
