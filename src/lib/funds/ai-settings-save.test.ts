import test from "node:test";
import assert from "node:assert/strict";
import type { FundAiSettingsRow } from "../analysis/run-plan.server.ts";
import {
  AI_SETTINGS_SAVE_ATTEMPTS,
  aiSettingsColumns,
  saveAiSettings,
  type AiSettingsChange,
  type AiSettingsSaveSteps,
} from "./ai-settings-save.ts";

const START: FundAiSettingsRow = {
  screeningTier: "light",
  deepTier: "medium",
  screeningCapDkk: null,
  deepCapDkk: null,
  limitAction: "shrink",
  monthlyCapDkk: null,
};

const COLUMN_FIELD: Record<string, keyof FundAiSettingsRow> = {
  screening_tier: "screeningTier",
  deep_tier: "deepTier",
  screening_cap_dkk: "screeningCapDkk",
  deep_cap_dkk: "deepCapDkk",
  analysis_limit_action: "limitAction",
  monthly_cap_dkk: "monthlyCapDkk",
};

/** The funds row in memory: a write lands only while the row still has the version that was read. */
function store() {
  const row = { settings: { ...START }, version: 0 };
  const audits: Array<{ action: string; payload: unknown }> = [];
  const steps = (gate?: Promise<void>): AiSettingsSaveSteps => {
    let first = true;
    return {
      read: async () => {
        const read = { settings: { ...row.settings }, version: String(row.version) };
        // The first read of a save waits at the gate, so two saves both read before either writes.
        if (first && gate) {
          first = false;
          await gate;
        }
        return read;
      },
      check: async () => {},
      audit: async (before, after) => {
        audits.push({ action: "changed", payload: { before, after } });
        return String(audits.length);
      },
      write: async (columns, version) => {
        if (version !== String(row.version)) return false;
        const settings = { ...row.settings } as Record<string, unknown>;
        for (const [column, value] of Object.entries(columns)) {
          settings[COLUMN_FIELD[column] as string] = value;
        }
        row.settings = settings as unknown as FundAiSettingsRow;
        row.version += 1;
        return true;
      },
      notSaved: async (after, auditId) => {
        audits.push({ action: "not_saved", payload: { after, undoes: auditId } });
      },
      busy: () => new Error("busy"),
    };
  };
  return { row, audits, steps };
}

test("T-1073 two saves at the same time keep both changes", async () => {
  const db = store();
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const level = saveAiSettings({ deepTier: "heavy" }, db.steps(gate));
  const month = saveAiSettings({ monthlyCapDkk: 500 }, db.steps(gate));
  open();
  const [first, second] = await Promise.all([level, month]);
  assert.equal(db.row.settings.deepTier, "heavy");
  assert.equal(db.row.settings.monthlyCapDkk, 500);
  // One save went first on the row as it was; the other was saved on top of it, and its "before"
  // holds the first one's change (the audit log is right).
  const onStart = [first, second].filter(
    (save) => JSON.stringify(save.before) === JSON.stringify(START),
  );
  assert.equal(onStart.length, 1);
  const later = onStart[0] === first ? second : first;
  assert.ok(later.before.deepTier === "heavy" || later.before.monthlyCapDkk === 500);
  // The save that lost the race records its first audit row as not saved.
  assert.equal(db.audits.filter((audit) => audit.action === "not_saved").length, 1);
});

test("T-1073 a save writes only the fields that are sent", () => {
  const change: AiSettingsChange = { deepTier: "heavy", monthlyCapDkk: null };
  assert.deepEqual(aiSettingsColumns(change), { deep_tier: "heavy", monthly_cap_dkk: null });
  assert.deepEqual(aiSettingsColumns({ screeningCapDkk: undefined }), {});
  assert.deepEqual(
    aiSettingsColumns({
      screeningTier: "medium",
      screeningCapDkk: 4,
      deepCapDkk: null,
      limitAction: "ask",
      monthlyCapDkk: 900,
    }),
    {
      screening_tier: "medium",
      screening_cap_dkk: 4,
      deep_cap_dkk: null,
      analysis_limit_action: "ask",
      monthly_cap_dkk: 900,
    },
  );
});

test("T-1073 a failed write is recorded as not saved before the error", async () => {
  const db = store();
  const steps = db.steps();
  await assert.rejects(
    saveAiSettings(
      { deepTier: "light" },
      {
        ...steps,
        write: async () => {
          throw new Error("write failed");
        },
      },
    ),
    /write failed/,
  );
  assert.deepEqual(
    db.audits.map((audit) => audit.action),
    ["changed", "not_saved"],
  );
  assert.equal(db.row.settings.deepTier, "medium");
});

test("T-1073 a row that keeps changing gives up after a few tries", async () => {
  const db = store();
  const steps = db.steps();
  let writes = 0;
  await assert.rejects(
    saveAiSettings(
      { deepTier: "light" },
      {
        ...steps,
        write: async () => {
          writes += 1;
          return false;
        },
      },
    ),
    /busy/,
  );
  assert.equal(writes, AI_SETTINGS_SAVE_ATTEMPTS);
});

test("T-1073 the check runs on the row as it is after another save", async () => {
  const db = store();
  db.row.settings = { ...START, deepCapDkk: 40 };
  const seen: Array<number | null> = [];
  await saveAiSettings(
    { deepTier: "heavy" },
    {
      ...db.steps(),
      check: async (_before, after) => {
        seen.push(after.deepCapDkk);
      },
    },
  );
  assert.deepEqual(seen, [40]);
});
