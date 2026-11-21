/**
 * Saving a change in Analysegrænser without losing another person's change. Two saves at
 * the same time (for example the AI level and the monthly limit) used to read the same row and
 * write all six columns back, so the second could set the first's change back and log a wrong
 * "before". Now only the fields that are sent are written, and only while the row is still the one
 * that was read; otherwise the save reads again, checks again and tries once more. Pure (the reads
 * and writes are passed in) and tested.
 */
import type { AiTier, LimitAction } from "../analysis/model-tiers.ts";
import type { FundAiSettingsRow } from "../analysis/run-plan.server.ts";

/** The fields a save may send; a field that is not sent is left as it is. */
export interface AiSettingsChange {
  screeningTier?: AiTier | undefined;
  deepTier?: AiTier | undefined;
  /** null = back to the level's standard cap. */
  screeningCapDkk?: number | null | undefined;
  deepCapDkk?: number | null | undefined;
  limitAction?: LimitAction | undefined;
  /** null = no monthly limit. */
  monthlyCapDkk?: number | null | undefined;
}

/** The settings after the change: the sent fields over what was read. */
export function mergeAiSettings(
  before: FundAiSettingsRow,
  change: AiSettingsChange,
): FundAiSettingsRow {
  return {
    screeningTier: change.screeningTier ?? before.screeningTier,
    deepTier: change.deepTier ?? before.deepTier,
    screeningCapDkk:
      change.screeningCapDkk !== undefined ? change.screeningCapDkk : before.screeningCapDkk,
    deepCapDkk: change.deepCapDkk !== undefined ? change.deepCapDkk : before.deepCapDkk,
    limitAction: change.limitAction ?? before.limitAction,
    monthlyCapDkk: change.monthlyCapDkk !== undefined ? change.monthlyCapDkk : before.monthlyCapDkk,
  };
}

/** Only the columns of the sent fields, so a save never writes back a field it did not change. */
export function aiSettingsColumns(change: AiSettingsChange): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  if (change.screeningTier !== undefined) columns["screening_tier"] = change.screeningTier;
  if (change.deepTier !== undefined) columns["deep_tier"] = change.deepTier;
  if (change.screeningCapDkk !== undefined) columns["screening_cap_dkk"] = change.screeningCapDkk;
  if (change.deepCapDkk !== undefined) columns["deep_cap_dkk"] = change.deepCapDkk;
  if (change.limitAction !== undefined) columns["analysis_limit_action"] = change.limitAction;
  if (change.monthlyCapDkk !== undefined) columns["monthly_cap_dkk"] = change.monthlyCapDkk;
  return columns;
}

/** How often a save reads again after another save got there first. */
export const AI_SETTINGS_SAVE_ATTEMPTS = 3;

export interface AiSettingsSaveSteps {
  /** The row as it is now, and a mark (updated_at) that changes with every write to it. */
  read(): Promise<{ settings: FundAiSettingsRow; version: string | null }>;
  /** Throws when the change may not be saved on top of `before` (limits, bottom of the level). */
  check(before: FundAiSettingsRow, after: FundAiSettingsRow): Promise<void>;
  /** Writes the audit row first; throws when it cannot, so nothing is changed. */
  audit(before: FundAiSettingsRow, after: FundAiSettingsRow): Promise<string | null>;
  /**
   * Writes the columns only while the row still has `version`; false when it did not. Throws when
   * the write fails; the audited change is then recorded as not saved first.
   */
  write(columns: Record<string, unknown>, version: string | null): Promise<boolean>;
  /** Records that the audited change was never saved. */
  notSaved(after: FundAiSettingsRow, auditId: string | null): Promise<void>;
  /** The error when the row kept changing under the save. */
  busy(): Error;
}

export async function saveAiSettings(
  change: AiSettingsChange,
  steps: AiSettingsSaveSteps,
): Promise<{ before: FundAiSettingsRow; after: FundAiSettingsRow }> {
  const columns = aiSettingsColumns(change);
  for (let attempt = 0; attempt < AI_SETTINGS_SAVE_ATTEMPTS; attempt += 1) {
    const { settings: before, version } = await steps.read();
    const after = mergeAiSettings(before, change);
    await steps.check(before, after);
    const auditId = await steps.audit(before, after);
    let saved: boolean;
    try {
      saved = await steps.write(columns, version);
    } catch (cause) {
      await steps.notSaved(after, auditId);
      throw cause;
    }
    if (saved) return { before, after };
    // Another save got there first: this one's audit row names a "before" that no longer holds.
    await steps.notSaved(after, auditId);
  }
  throw steps.busy();
}
