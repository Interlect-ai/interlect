/**
 * "Ny tese" opens Teamopsætning, not a separate eight-step guide. Only what a draft
 * cannot exist without is asked first: the thesis's name and what kind of investor the team is
 * (that picks the starting template, as the old guide's first step did). "Opret kladde" creates
 * the draft (the same `createFund` as before) and lands on the same four places as editing.
 *
 * The old guide kept its answers in the browser until it published. If one was left half-way,
 * they are carried into the new draft here, so nothing typed there is lost ("gamle kladder tabes
 * ikke"): a team the guide already created is opened with its answers saved into
 * its draft; answers without a team prefill this start and go into the draft it creates.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ds/Button";
import { Reveal } from "@/components/ds/Reveal";
import { WhoStep } from "./WhoStart";
import { saveFundConfigDraft } from "@/lib/funds/config.functions";
import { fundConfigTemplateIn } from "@/lib/funds/config-templates";
import { createFund } from "@/lib/funds/funds.functions";
import {
  clearLegacyThesisDraft,
  LEGACY_CREATED_KEY,
  readLegacyThesisDraft,
  type LegacyCreated,
} from "@/lib/funds/legacy-thesis-draft";
import { setStandardSpecialist } from "@/lib/funds/specialists.functions";
import {
  SPECIALISTS,
  buildDraftFields,
  initialWizardState,
  templateFor,
  type WizardState,
} from "@/lib/funds/thesis-wizard";
import { userMessage } from "@/lib/errors/user-message";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { PlaceHeading } from "./SetupShell";

function browserStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function NewThesisStart({
  onCreated,
  onCancel,
}: {
  /** The new draft exists: open Teamopsætning on it. `restored`: answers came from the old guide. */
  onCreated: (fundId: string, restored: boolean) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const create = useServerFn(createFund);
  const saveDraft = useServerFn(saveFundConfigDraft);
  const setStandard = useServerFn(setStandardSpecialist);
  const [state, setState] = useState<WizardState>(() => initialWizardState(language));
  // The old guide's answers, when it left any; they are written into the draft on create.
  const legacyAnswers = useRef<WizardState | null>(null);
  const [restored, setRestored] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  // A team made by an earlier press whose answers could not be saved: a retry only saves them.
  const madeRef = useRef<{ fundId: string; configId: string } | null>(null);
  const { funds, isLoading: fundsLoading } = useActiveFund();

  /** The old guide's answers into the draft, and the specialists it had switched off. */
  const carryAnswers = async (ids: { fundId: string; configId: string }, answers: WizardState) => {
    const template = fundConfigTemplateIn(templateFor(answers), language);
    await saveDraft({
      data: { configId: ids.configId, ...buildDraftFields(answers, template, language) },
    });
    for (const [index, spec] of SPECIALISTS.entries()) {
      if (answers.specialists[index] === false) {
        await setStandard({
          data: { fundId: ids.fundId, configId: ids.configId, moduleId: spec.id, enabled: false },
        });
      }
    }
  };

  useEffect(() => {
    if (handled.current || fundsLoading) return;
    handled.current = true;
    const storage = browserStorage();
    if (!storage) return;
    const legacy = readLegacyThesisDraft(storage);
    // Only a team that still exists for this user and was never published is opened; otherwise
    // the answers prefill a new start and the stale team is forgotten.
    const createdFund = legacy.created
      ? funds.find((candidate) => candidate.id === legacy.created!.fundId)
      : undefined;
    if (legacy.created && (!createdFund || createdFund.configStatus === "active")) {
      try {
        storage.removeItem(LEGACY_CREATED_KEY);
      } catch {
        // nothing to forget without storage
      }
      legacy.created = null;
    }
    if (legacy.created) {
      // The guide had already made the team (for an own specialist): open its draft.
      const created: LegacyCreated = legacy.created;
      setCreating(true);
      void (async () => {
        try {
          if (legacy.answers) await carryAnswers(created, legacy.answers.state);
          clearLegacyThesisDraft(storage);
          onCreated(created.fundId, true);
        } catch (cause) {
          // The team exists; open it anyway. The answers are not tried again (they would send
          // every later "Ny tese" back here), so the team's draft keeps its starting setup.
          console.error("[new-thesis] carry the old guide's answers", cause);
          clearLegacyThesisDraft(storage);
          onCreated(created.fundId, false);
        } finally {
          setCreating(false);
        }
      })();
      return;
    }
    if (legacy.answers) {
      legacyAnswers.current = legacy.answers.state;
      setState(legacy.answers.state);
      setRestored(true);
    }
    // Runs once, when the teams are known; the server functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundsLoading]);

  const submit = async () => {
    if (creating) return;
    if (state.name.trim().length < 2) {
      setError(t("fundSetup.newThesis.nameMissing"));
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const ids =
        madeRef.current ??
        (await create({
          data: { name: state.name.trim(), template: templateFor(state), language },
        }));
      madeRef.current = ids;
      const answers = legacyAnswers.current;
      if (answers) await carryAnswers(ids, { ...answers, name: state.name, type: state.type });
      const storage = browserStorage();
      if (storage) clearLegacyThesisDraft(storage);
      onCreated(ids.fundId, Boolean(answers));
    } catch (cause) {
      setError(userMessage(cause, t("fundSetup.newThesis.failed"), language));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <PlaceHeading title={t("fundSetup.newThesis.title")} lead={t("fundSetup.newThesis.lead")} />
      {restored && (
        <Reveal>
          <p role="status" className="m-0 rounded-md bg-positive-wash p-3 text-list text-positive">
            {t("fundSetup.newThesis.restored")}
          </p>
        </Reveal>
      )}
      <fieldset disabled={creating} className="m-0 min-w-0 border-0 p-0">
        <WhoStep
          state={state}
          patch={(change) =>
            setState((current) => ({
              ...current,
              ...(typeof change === "function" ? change(current) : change),
            }))
          }
        />
      </fieldset>
      {error && (
        <p role="alert" className="m-0 rounded-md bg-critical-wash p-3 text-list text-critical">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2.5">
        <Button variant="quiet" size="lg" onClick={onCancel} disabled={creating}>
          {t("fundSetup.newThesis.cancel")}
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => void submit()}
          pending={creating}
          pendingLabel={t("fundSetup.newThesis.creating")}
        >
          {t("fundSetup.newThesis.create")}
        </Button>
      </div>
    </div>
  );
}
