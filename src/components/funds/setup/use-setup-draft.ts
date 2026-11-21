/**
 * Runs the setup draft from the thesis place: starts the draft version if there
 * is none, reads the stream into the waiting screen's progress, and when it ends lays the finished
 * stages into the editor, saves the specialists' texts per stage and the setup, and says in one
 * line what did and did not happen. Nothing the team has not asked for is written: the run starts
 * only from "Lav udkast til hvert stadie", and a stage that did not finish is left as it was.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { saveModulePromptOverride } from "@/lib/funds/module-prompt-override.functions";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import { applyStageDrafts, draftFrameOf, draftModuleTexts } from "@/lib/funds/setup-draft-apply";
import {
  collectDrafts,
  reduceProgress,
  startProgress,
  streamSetupDraft,
  type DraftProgress,
  type SetupDraftClientEvent,
} from "@/lib/funds/setup-draft-client";
import { draftStages } from "@/lib/funds/setup-draft";
import type { MessageKey } from "@/lib/i18n/translate";
import { useT } from "@/lib/i18n/useT";
import { supabase } from "@/lib/supabase/client";

type EditorState = SaveFundConfigInput;

export interface DraftNotice {
  tone: "warning" | "info";
  text: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useSetupDraft({
  fundId,
  latest,
  onStartDraft,
  onChange,
  onSave,
}: {
  fundId: string;
  /** The editor's state as the shell holds it now. */
  latest: MutableRefObject<EditorState>;
  /** Starts the draft version (once); resolves to its id, or null. */
  onStartDraft: () => Promise<string | null>;
  onChange: (next: EditorState) => void;
  onSave: () => Promise<boolean>;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const saveText = useServerFn(saveModulePromptOverride);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DraftProgress | null>(null);
  const [notice, setNotice] = useState<DraftNotice | null>(null);
  /** Some stage was drafted in this session: the button says "Fortsæt" afterwards. */
  const [drafted, setDrafted] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(async (): Promise<boolean> => {
    if (running) return false;
    setRunning(true);
    setNotice(null);
    const warn = (text: string) => setNotice({ tone: "warning", text });
    const controller = new AbortController();
    abort.current = controller;
    try {
      const stages = draftStages(draftFrameOf(latest.current));
      if (!stages.length) {
        warn(t("fundSetup.draft.refused.no_stage"));
        return false;
      }
      // The waiting screen is up at once, also while the draft version is being made.
      let state = startProgress(stages);
      setProgress(state);
      const configId = await onStartDraft();
      // The workspace says why the draft could not be started; nothing more to add here.
      if (!configId) return false;
      const frame = draftFrameOf(latest.current);
      const events: SetupDraftClientEvent[] = [];
      let refusal: MessageKey | null = null;
      let stopped = false;
      for await (const event of streamSetupDraft(
        { fundId, configId, frame },
        {
          getToken: async () =>
            (await supabase.auth.getSession()).data.session?.access_token ?? null,
          signal: controller.signal,
        },
      )) {
        events.push(event);
        if (event.type === "refused") {
          refusal = `fundSetup.draft.refused.${event.code}`;
        } else if (event.type === "error") {
          refusal = "fundSetup.draft.refused.failed";
        } else if (event.type === "stopped") {
          stopped = true;
        } else {
          state = reduceProgress(state, event);
          setProgress(state);
        }
      }
      // Left the page mid-run: nothing is written half-way (the credits are settled by the server).
      if (controller.signal.aborted) return false;
      const drafts = collectDrafts(events);
      if (!drafts.length) {
        warn(t(refusal ?? "fundSetup.draft.noneDone"));
        return false;
      }

      // The finished stages go into the editor; the specialists' texts are saved per stage.
      const next = applyStageDrafts(latest.current, drafts);
      onChange(next);
      for (let tries = 0; tries < 40 && latest.current !== next; tries += 1) await sleep(50);
      const texts = draftModuleTexts(drafts);
      const results = await Promise.allSettled(
        texts.map((text) =>
          saveText({
            data: {
              fundId,
              configId,
              moduleId: text.moduleId,
              stage: text.stage,
              mandate: text.mandate,
              evidenceTests: text.evidenceTests,
              riskAreas: text.riskAreas,
            },
          }),
        ),
      );
      const textsFailed = results.some((result) => result.status === "rejected");
      const saved = await onSave();
      await queryClient.invalidateQueries({ queryKey: ["fund-config", fundId] });
      setDrafted(true);
      if (!saved) warn(t("fundSetup.draft.saveFailed"));
      else if (textsFailed) warn(t("fundSetup.draft.textsFailed"));
      else if (stopped || drafts.length < stages.length) {
        warn(t("fundSetup.draft.stopped", { done: drafts.length, total: stages.length }));
      } else if (refusal) warn(t(refusal));
      return true;
    } finally {
      abort.current = null;
      setRunning(false);
      setProgress(null);
    }
  }, [fundId, latest, onChange, onSave, onStartDraft, queryClient, running, saveText, t]);

  return { run, running, progress, notice, clearNotice: () => setNotice(null), drafted };
}
