import { PendingLabel } from "@/components/ai/AiOrb";
import { isAdminRole } from "@/lib/auth/is-admin";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { showToast } from "@/components/ds/Toast";
import { Reveal } from "@/components/ds/Reveal";
import { motion } from "motion/react";
import { PRESS } from "@/lib/motion";
import { FundOverview } from "@/components/funds/FundOverview";
import { FoldSection } from "@/components/funds/FoldSection";
import { FundSuggestionsPanel } from "@/components/funds/FundSuggestionsPanel";
import { FundThesisRow } from "@/components/funds/FundThesisRow";
import {
  createFundConfigDraft,
  getFundConfigs,
  publishFundConfigDraft,
  saveFundConfigDraft,
  type EditableFundConfig,
  type SaveFundConfigInput,
} from "@/lib/funds/config.functions";
import { HistoricalInvestmentsPanel } from "@/components/funds/HistoricalInvestmentsPanel";
import { RescreenPanel } from "@/components/funds/RescreenPanel";
import { ChangeHistory } from "@/components/funds/ChangeHistory";
import { ConfigChanges } from "@/components/funds/ConfigChanges";
import { EditorShell } from "@/components/funds/editor/EditorShell";
import type { GuideStepKey } from "@/components/funds/editor/guide-steps";
import { anyProposalApplyKey } from "@/components/funds/editor/proposals";
import { ThesisComposer } from "@/components/funds/editor/ThesisComposer";
import { deleteFund } from "@/lib/funds/funds.functions";
import { withBasisKeys } from "@/lib/funds/basis-labels";
import { gateInLanguage } from "@/lib/funds/gate-labels";
import { mergeKeptEdits, stepStatus } from "@/lib/funds/editor-rules";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { useT, useLanguage } from "@/lib/i18n/useT";
import type { Language } from "@/lib/i18n/language";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { userMessage } from "@/lib/errors/user-message";

type EditorState = SaveFundConfigInput;

export function FundConfigWorkspace() {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const { fundId, fund, funds, selectFund, refreshFunds } = useActiveFund();
  const navigate = useNavigate();
  const getConfigs = useServerFn(getFundConfigs);
  const createDraft = useServerFn(createFundConfigDraft);
  const saveDraft = useServerFn(saveFundConfigDraft);
  const publishDraft = useServerFn(publishFundConfigDraft);
  const removeFund = useServerFn(deleteFund);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditorState | null>(null);
  // The draft as last saved (JSON), to tell the editor whether anything is unsaved.
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  // E6b: "Redigér" på et kort i læsevisningen åbner guiden på samme trin.
  const [editStep, setEditStep] = useState<GuideStepKey | null>(null);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  // The draft is being fetched fresh before the editor opens.
  const [opening, setOpening] = useState(false);
  const formRef = useRef<EditorState | null>(null);
  formRef.current = form;
  const savedRef = useRef(savedSnapshot);
  savedRef.current = savedSnapshot;
  // The draft changed on the server (a proposal was laid in) but could not be loaded: the editor
  // is locked and nothing is saved from the old copy until it is loaded.
  const [reloadFailed, setReloadFailed] = useState(false);
  // Unsaved edits the editor had to let go of when another fund was chosen and they could not be
  // saved, by draft id. They come back when that draft is opened again in this session.
  const keptRef = useRef(new Map<string, { form: EditorState; base: EditorState }>());
  const fundIdRef = useRef(fundId);
  // A result that arrives after the editor closed (a document import, a "Fortryd") is dropped.
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const configQuery = useQuery({
    queryKey: ["fund-config", fundId],
    queryFn: () => getConfigs({ data: { fundId: fundId! } }),
    enabled: Boolean(fundId),
  });
  // A proposal being laid in from the composer changes the draft on the server.
  const applyingProposal = useIsMutating({ mutationKey: anyProposalApplyKey }) > 0;

  /** Loads a draft into the editor and remembers that it is saved as it is. */
  const seed = (config: EditableFundConfig) => {
    const state = toEditorState(config, language);
    const kept = keptRef.current.get(config.id);
    setForm(kept ? mergeKeptEdits(state, kept.form, kept.base) : state);
    setSavedSnapshot(JSON.stringify(state));
    setSaveFailed(false);
    setReloadFailed(false);
    if (kept) {
      keptRef.current.delete(config.id);
      setMessage(t("fundSetup.workspace.restored"));
    }
  };

  useEffect(() => {
    // Another fund was chosen (here, in the menu or in another tab) while a draft had unsaved
    // changes: save them to that draft before the editor closes. When that cannot be done, keep
    // them in memory and say so; they come back when the draft is opened again.
    const previousFundId = fundIdRef.current;
    fundIdRef.current = fundId;
    const unsaved = formRef.current;
    if (editingRef.current && unsaved && JSON.stringify(unsaved) !== savedRef.current) {
      const name = unsaved.fundName.trim() || t("fundSetup.workspace.previousThesis");
      const base = (savedRef.current ? JSON.parse(savedRef.current) : {}) as EditorState;
      const keep = (reason: string) => {
        keptRef.current.set(unsaved.configId, { form: unsaved, base });
        showToast({
          message: t("fundSetup.workspace.keptToast", { reason, name }),
          tone: "error",
          duration: 10000,
        });
      };
      if (!stepStatus(unsaved, new Set()).canSave) {
        keep(t("fundSetup.workspace.notSavedError", { name }));
      } else {
        saveDraft({ data: unsaved })
          .then(() => {
            if (previousFundId) {
              void queryClient.invalidateQueries({ queryKey: ["fund-config", previousFundId] });
            }
          })
          .catch((cause: unknown) => {
            console.error("[fund-config] save on fund switch", cause);
            const reason = userMessage(cause, "", language);
            keep(
              reason
                ? t("fundSetup.workspace.saveFailedWithMessage", { name, message: reason })
                : t("fundSetup.workspace.saveFailedPlain", { name }),
            );
          });
      }
    }
    setReloadFailed(false);
    setEditing(false);
    setForm(null);
    setEditStep(null);
    setPendingImport(null);
    setMessage(null);
    setError(null);
    // saveDraft is a stable server function; only a new fund should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundId]);

  const pendingEditConfig = configQuery.data
    ? (configQuery.data.draft ?? configQuery.data.active)
    : null;
  // `seed` is a new function each render; the effect reads the latest through a ref.
  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    if (editing && !form && pendingEditConfig) {
      seedRef.current(pendingEditConfig);
    }
  }, [editing, form, pendingEditConfig]);

  /** The fund's versions straight from the server, never a cached copy. */
  const fetchConfigs = (id: string) =>
    queryClient.fetchQuery({
      queryKey: ["fund-config", id],
      queryFn: () => getConfigs({ data: { fundId: id } }),
      staleTime: 0,
    });

  const draftMutation = useMutation({
    mutationFn: (activeConfigId: string) => createDraft({ data: { activeConfigId } }),
    onSuccess: async () => {
      // A failed fetch must not open the editor on the cached active version.
      await queryClient
        .refetchQueries({ queryKey: ["fund-config", fundId] }, { throwOnError: true })
        .catch((cause: unknown) => {
          console.error("[fund-config] fetch of the new draft", cause);
          throw new Error(t("fundSetup.workspace.openFailed"));
        });
      // Clear any old form first, so the editor is seeded with the new draft.
      setForm(null);
      setEditing(true);
    },
    onError: (cause: Error) => {
      setPendingImport(null);
      setMessage(null);
      setError(userMessage(cause, t("system.actionFailed"), language));
    },
  });

  const saveMutation = useMutation({
    mutationFn: (input: EditorState) => saveDraft({ data: input }),
    onSuccess: async (_result, input) => {
      setSavedSnapshot(JSON.stringify(input));
      setSaveFailed(false);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["fund-config", fundId] });
    },
    onError: (cause: Error) => {
      setMessage(null);
      setSaveFailed(true);
      setError(userMessage(cause, t("system.actionFailed"), language));
    },
  });

  /** Saves what the editor shows now; true when it is saved. */
  const saveNow = async (): Promise<boolean> => {
    const input = formRef.current;
    if (!input || reloadFailed) return false;
    try {
      await saveMutation.mutateAsync(input);
      return true;
    } catch {
      return false;
    }
  };

  /** The draft changed on the server (a proposal was laid in): load it into the editor. */
  const reloadDraft = async (): Promise<boolean> => {
    if (!fundId) return false;
    try {
      const fresh = await fetchConfigs(fundId);
      if (fresh.draft) {
        seed(fresh.draft);
        return true;
      }
      // The draft is gone (published or discarded by someone else): close and say so.
      setReloadFailed(false);
      setEditing(false);
      setForm(null);
      setEditStep(null);
      setMessage(null);
      setError(t("fundSetup.workspace.draftGone"));
      return true;
    } catch (cause) {
      console.error("[fund-config] reload of the draft", cause);
      setReloadFailed(true);
      return false;
    }
  };

  const publishMutation = useMutation({
    mutationFn: async (input: EditorState) => {
      await saveDraft({ data: input });
      await publishDraft({ data: { configId: input.configId } });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["fund-config", fundId] });
      await queryClient.invalidateQueries({ queryKey: ["fund-config-versions", fundId] });
      setEditing(false);
      setForm(null);
      setEditStep(null);
      setMessage(t("fundSetup.workspace.published"));
      setError(null);
    },
    onError: (cause: Error) => {
      setMessage(null);
      setError(userMessage(cause, t("system.actionFailed"), language));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ fundId: targetFundId, name }: { fundId: string; name: string }) =>
      removeFund({ data: { fundId: targetFundId, confirmationName: name } }),
    onSuccess: async ({ deletedFundId, filesNotRemoved, sweepComplete, cleanupRecorded }) => {
      const nextFund = funds.find((candidate) => candidate.id !== deletedFundId);
      await refreshFunds();
      if (nextFund) selectFund(nextFund.id);
      await queryClient.invalidateQueries();
      setConfirmingDelete(false);
      setDeleteConfirmation("");
      const leftover =
        filesNotRemoved > 0
          ? filesNotRemoved === 1
            ? t("fundSetup.workspace.leftoverFilesOne")
            : t("fundSetup.workspace.leftoverFilesMany", { count: filesNotRemoved })
          : !sweepComplete
            ? t("fundSetup.workspace.leftoverFolder")
            : null;
      setMessage(
        leftover === null
          ? t("fundSetup.workspace.deleted")
          : t("fundSetup.workspace.deletedPartial", {
              leftover,
              tail: cleanupRecorded
                ? t("fundSetup.workspace.tailRecorded")
                : t("fundSetup.workspace.tailSupport"),
            }),
      );
      setError(null);
    },
    onError: (cause: Error) => {
      setMessage(null);
      setError(userMessage(cause, t("system.actionFailed"), language));
    },
  });

  // Kun en Admin kan oprette en ny investeringstese (serveren tjekker det også, harden S5-3/G15).
  const canCreateFund = funds.some((candidate) => isAdminRole(candidate.roles));

  const data = configQuery.data;
  const active = data?.active ?? null;
  const draft = data?.draft ?? null;
  const previous = data?.previous ?? null;

  // "Fortsæt kladde" and "Redigér" wait while a proposal is laid in or the draft is fetched:
  // opened on the copy from before, the editor would publish it over the proposal.
  const editLocked = opening || applyingProposal || draftMutation.isPending;

  const beginEditing = (step: GuideStepKey | null = null) => {
    if (!fundId || opening || draftMutation.isPending) return;
    setError(null);
    setEditStep(step);
    setOpening(true);
    // The draft is fetched fresh, never taken from the cache, which may be from before a proposal.
    void fetchConfigs(fundId)
      .then((fresh) => {
        // Another fund was chosen meanwhile: this fund's draft is not opened over it, and the
        // document picked for it is not imported into the other one.
        if (fundIdRef.current !== fundId) {
          setPendingImport(null);
          return;
        }
        if (fresh.draft) {
          seed(fresh.draft);
          setEditing(true);
        } else if (fresh.active) {
          draftMutation.mutate(fresh.active.id);
        } else {
          setPendingImport(null);
        }
      })
      .catch((cause: unknown) => {
        console.error("[fund-config] fetch before editing", cause);
        setPendingImport(null);
        if (fundIdRef.current !== fundId) return;
        setMessage(null);
        setError(t("fundSetup.workspace.openFailed"));
      })
      .finally(() => setOpening(false));
  };

  /**
   * A proposal was laid in from the composer. The editor, if it opened meanwhile (on the copy from
   * before), loads the new draft; otherwise the cache is fetched again, and a failed fetch is
   * reported to the composer instead of swallowed, so "Gennemse kladde" is not offered.
   */
  const onComposerDraftChanged = async () => {
    if (!fundId) return;
    if (fundIdRef.current !== fundId) {
      void queryClient.invalidateQueries({ queryKey: ["fund-config", fundId] });
      return;
    }
    if (editingRef.current) {
      await reloadDraft();
      return;
    }
    await queryClient.refetchQueries({ queryKey: ["fund-config", fundId] }, { throwOnError: true });
  };

  /** A draft for the composer: the existing one, or a new one made from the active version. */
  const ensureDraft = async (): Promise<string> => {
    if (draft) return draft.id;
    if (!active) throw new Error(t("fundSetup.workspace.noPublishedVersion"));
    const created = await createDraft({ data: { activeConfigId: active.id } });
    await queryClient.invalidateQueries({ queryKey: ["fund-config", fundId] });
    return created.draftId;
  };

  const displayed = editing && form ? form : null;
  const canEditConfig = Boolean(fund && (active?.canEdit ?? draft?.canEdit ?? false));
  const editSource = draft ?? active;

  let body: ReactNode;
  if (configQuery.isLoading) {
    body = <LoadingState title={t("fundSetup.workspace.loading")} />;
  } else if (!data) {
    // Only a first load that failed: a failed fetch later keeps the page (and an open editor) on
    // the data it has, so its error and the editor's stale notice can be shown.
    // A failed load is an error with a retry, never example data in its place.
    body = configQuery.isError ? (
      <ErrorState onRetry={() => void configQuery.refetch()} />
    ) : (
      <EmptyState
        title={t("fundSetup.workspace.emptyTitle")}
        body={t("fundSetup.workspace.emptyBody")}
      />
    );
  } else {
    body = (
      <>
        {!displayed && canEditConfig && fundId && editSource && (
          <ThesisComposer
            draftId={draft?.id ?? null}
            draftVersion={draft?.version ?? null}
            criteria={editSource.criteria.map((criterion) => ({
              key: criterion.key,
              label: criterion.label,
            }))}
            ensureDraft={ensureDraft}
            onFiles={(files) => {
              // "+" picks the document itself; the Start step imports it.
              const file = files[0];
              if (!file || !fundId || opening || draftMutation.isPending) return;
              setPendingImport(file);
              beginEditing("start");
            }}
            onReview={() => beginEditing("publish")}
            onDraftChanged={onComposerDraftChanged}
          />
        )}
        <Reveal delay={0.1} className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 text-title font-semibold tracking-title">
            {active?.fundName ?? fund?.name ?? t("fundSetup.workspace.thesisName")}
          </h2>
          <span className="text-list text-ink-3 tabular-nums">
            {active
              ? t("fundSetup.workspace.activeVersion", { version: active.version })
              : t("fundSetup.workspace.noVersion")}
          </span>
          {draft && (
            <span className="flex items-center gap-1.5 text-list text-ink-3 tabular-nums">
              <span aria-hidden className="size-[7px] rounded-full bg-warning" />
              {t("fundSetup.workspace.draftVersion", { version: draft.version })}
            </span>
          )}
          <div className="flex-1" />
          {fund && (active?.canDelete ?? draft?.canDelete ?? false) && !editing && (
            <button
              type="button"
              onClick={() => {
                setDeleteConfirmation("");
                setConfirmingDelete(true);
              }}
              className="grid size-10 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-critical transition-colors hover:bg-critical-wash"
              aria-label={t("fundSetup.workspace.deleteAria", { name: fund.name })}
              title={t("fundSetup.workspace.deleteTitle")}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
          {canEditConfig && !editing && (
            <motion.button
              type="button"
              onClick={() => beginEditing()}
              disabled={editLocked}
              whileTap={PRESS.whileTap}
              transition={PRESS.transition}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-pill border-0 bg-inverse px-4 font-[inherit] text-[14px] font-medium whitespace-nowrap text-ink-inverse disabled:opacity-60"
            >
              <Pencil className="size-4" aria-hidden />
              {draft ? t("fundSetup.workspace.continueDraft") : t("fundSetup.workspace.editSetup")}
            </motion.button>
          )}
        </Reveal>

        {error && (
          <p role="alert" className="m-0 rounded-md bg-critical-wash p-3 text-list text-critical">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="m-0 rounded-md bg-positive-wash p-3 text-list text-positive">
            {message}
          </p>
        )}

        {displayed && fundId && editSource ? (
          <EditorShell
            fundId={fundId}
            value={displayed}
            onChange={(next) =>
              setForm((previous) =>
                editingRef.current && previous?.configId === next.configId ? next : previous,
              )
            }
            draftVersion={draft?.version ?? editSource.version}
            active={active}
            moduleOverrides={editSource.moduleOverrides}
            researchModuleOverrides={editSource.researchModuleOverrides}
            screeningSetup={editSource}
            initialStep={editStep}
            initialImport={pendingImport}
            onInitialImportTaken={() => setPendingImport(null)}
            savedSnapshot={savedSnapshot}
            saving={saveMutation.isPending}
            saveFailed={saveFailed}
            publishing={publishMutation.isPending}
            onSave={saveNow}
            onPublish={() => publishMutation.mutate(displayed)}
            canAi={canEditConfig}
            onReload={reloadDraft}
            stale={reloadFailed}
            saveError={error}
            onClose={() => {
              setReloadFailed(false);
              setEditing(false);
              setForm(null);
              setEditStep(null);
              setPendingImport(null);
              setError(null);
              void queryClient.invalidateQueries({ queryKey: ["fund-config", fundId] });
            }}
          />
        ) : active && fundId ? (
          <>
            <FundOverview
              fundId={fundId}
              active={active}
              onEdit={canEditConfig && !editLocked ? beginEditing : undefined}
            />
            <div className="flex flex-col gap-3">
              {previous && (
                <FoldSection title={t("fundSetup.changes.heading", { version: previous.version })}>
                  <ConfigChanges active={active} previous={previous} />
                </FoldSection>
              )}
              <FoldSection
                title={t("fundSetup.workspace.foldSuggestions")}
                hint={t("fundSetup.workspace.foldSuggestionsHint")}
              >
                <FundSuggestionsPanel fundId={fundId} />
              </FoldSection>
              <FoldSection
                title={t("fundSetup.workspace.foldRescreen")}
                hint={t("fundSetup.workspace.foldRescreenHint")}
              >
                <RescreenPanel fundId={fundId} />
              </FoldSection>
              <FoldSection title={t("fundSetup.workspace.foldHistorical")}>
                <HistoricalInvestmentsPanel fundId={fundId} canEdit={active.canEdit} />
              </FoldSection>
              {canEditConfig && (
                <FoldSection
                  title={t("fundSetup.workspace.foldHistory")}
                  hint={t("fundSetup.workspace.foldHistoryHint")}
                >
                  <ChangeHistory fundId={fundId} />
                </FoldSection>
              )}
            </div>
          </>
        ) : (
          <EmptyState
            title={t("fundSetup.workspace.draftStateTitle")}
            body={t("fundSetup.workspace.draftStateBody")}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-[26px]">
      <FundThesisRow
        funds={funds}
        activeId={fundId}
        onSelect={selectFund}
        onCreate={canCreateFund ? () => void navigate({ to: "/fond/ny" }) : undefined}
      />
      {body}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("fundSetup.workspace.dialogTitle", {
                name: fund?.name ?? t("fundSetup.workspace.dialogThesisFallback"),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("fundSetup.workspace.dialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block text-list text-ink-3">
            {t("fundSetup.workspace.typeName")} <strong className="text-ink">{fund?.name}</strong>
            <input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              className="field-control mt-1.5 w-full"
              autoComplete="off"
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t("fundSetup.workspace.keep")}
            </AlertDialogCancel>
            <button
              type="button"
              className="control-button border-critical/30 text-critical"
              disabled={
                deleteMutation.isPending || deleteConfirmation.trim() !== (fund?.name ?? "").trim()
              }
              onClick={() => {
                if (!fund) return;
                deleteMutation.mutate({ fundId: fund.id, name: deleteConfirmation });
              }}
            >
              {deleteMutation.isPending ? (
                <PendingLabel>{t("fundSetup.workspace.deleting")}</PendingLabel>
              ) : (
                <>
                  <Trash2 className="size-3.5" aria-hidden />
                  {t("fundSetup.workspace.deletePermanent")}
                </>
              )}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function Disclosure({
  title,
  description,
  defaultOpen,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="panel group px-[19px]" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 marker:content-none">
        <span className="min-w-0">
          <span className="block text-body font-semibold text-ink">{title}</span>
          <span className="mt-0.5 block text-list text-ink-3">{description}</span>
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-ink-4 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-hairline py-3">{children}</div>
    </details>
  );
}

/**
 * The editor's copy of a draft; old stage and geography names come in as keys, and the
 * mandate's own rules in the team's language.
 */
function toEditorState(config: EditableFundConfig, language: Language): EditorState {
  return withBasisKeys({
    configId: config.id,
    fundName: config.fundName,
    strategyType: config.strategyType,
    thesis: config.thesis,
    stages: config.stages,
    geographies: config.geographies,
    sectors: config.sectors,
    fundSizeEur: config.fundSizeEur,
    ticketMinEur: config.ticketMinEur,
    ticketMaxEur: config.ticketMaxEur,
    ticketNote: config.ticketNote,
    analysisThreshold: config.analysisThreshold,
    approvalMode: config.approvalMode,
    riskPosture: config.riskPosture,
    stageExpectations: config.stageExpectations,
    dealbreakers: config.dealbreakers,
    gates: config.gates.map((gate) => gateInLanguage(gate, language)),
    criteria: config.criteria,
  });
}
