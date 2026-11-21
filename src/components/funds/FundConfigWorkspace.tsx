/**
 * Teamopsætning (`/fond`, §2): one page for "Ny", "Redigér" and "Fortsæt kladde".
 *
 * - Admin and Lead see the setup as the four places of `SetupShell`, with every field of the old
 *   editor. With a draft the fields are the draft; without one they show what is published, and
 *   the first change starts the draft by itself (nothing is ever written to a published version).
 * - Member and Reader see the same four places with the published version as read-only cards.
 * - "Ny tese" (`?ny=1`, `/fond/ny` redirects here) asks for a name and a type, creates the draft
 *   and lands on the same four places; the old guide's half-finished answers are carried over.
 * - Language, AI level, analysis limits and credits are about the team, not the thesis: they
 *   live in "Teamindstillinger" (the gear). Versions, the effect of the active version, the
 *   changes since the last one and the history live in the "Versioner" sheet next to the version
 *   line (§4.6); suggestions and re-screening under "Gennemse og udgiv", past
 *   investments under "Jeres tese".
 */
import { PendingLabel } from "@/components/ai/AiOrb";
import { isAdminRole } from "@/lib/auth/is-admin";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { History, Lock, SlidersHorizontal, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ds/Button";
import { Sheet } from "@/components/ds/Sheet";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { showToast } from "@/components/ds/Toast";
import { Reveal } from "@/components/ds/Reveal";
import { FundOverview, TeamSettingsContent, VersionCards } from "@/components/funds/FundOverview";
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
import { NewThesisStart } from "@/components/funds/setup/NewThesisStart";
import { ScreeningPlace } from "@/components/funds/setup/ScreeningPlace";
import { AnalysisMap } from "@/components/funds/setup/AnalysisMap";
import { AnalysisPlace } from "@/components/funds/setup/AnalysisPlace";
import { ThesisFrame } from "@/components/funds/setup/ThesisFrame";
import { SpecialistCards } from "@/components/funds/editor/SpecialistCards";
import { PlaceHeading, SetupShell, VersionChip } from "@/components/funds/setup/SetupShell";
import { SetupPlacesNav, placePanelProps } from "@/components/funds/setup/SetupPlacesNav";
import { deleteFund } from "@/lib/funds/funds.functions";
import { withBasisKeys } from "@/lib/funds/basis-labels";
import { gateInLanguage } from "@/lib/funds/gate-labels";
import { mergeKeptEdits, stepStatus } from "@/lib/funds/editor-rules";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import type { SetupPlaceKey } from "@/lib/funds/setup-places";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { useT, useLanguage } from "@/lib/i18n/useT";
import type { Language } from "@/lib/i18n/language";
import type { MessageKey } from "@/lib/i18n/translate";
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

const READ_TITLE: Record<Exclude<SetupPlaceKey, "publish">, MessageKey> = {
  thesis: "fundSetup.places.thesis.title",
  screening: "fundSetup.places.screening.title",
  analysis: "fundSetup.places.analysis.title",
};
const READ_LEAD: Record<Exclude<SetupPlaceKey, "publish">, MessageKey> = {
  thesis: "fundSetup.places.thesis.lead",
  screening: "fundSetup.places.screening.lead",
  analysis: "fundSetup.places.analysis.lead",
};

export function FundConfigWorkspace({
  place,
  onPlaceChange,
  creatingNew,
  onNew,
  onNewDone,
}: {
  place: SetupPlaceKey;
  onPlaceChange: (place: SetupPlaceKey) => void;
  /** `?ny=1`: start a new thesis on this page. */
  creatingNew: boolean;
  onNew: () => void;
  onNewDone: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const { fundId, fund, funds, selectFund, refreshFunds } = useActiveFund();
  const getConfigs = useServerFn(getFundConfigs);
  const createDraft = useServerFn(createFundConfigDraft);
  const saveDraft = useServerFn(saveFundConfigDraft);
  const publishDraft = useServerFn(publishFundConfigDraft);
  const removeFund = useServerFn(deleteFund);
  const [form, setForm] = useState<EditorState | null>(null);
  // The draft as last saved (JSON), to tell the editor whether anything is unsaved.
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [startingDraft, setStartingDraft] = useState(false);
  // The stage on show in the read-only "Sådan screener vi" (Member and Reader).
  const [readStage, setReadStage] = useState<SetupStage | null>(null);
  const formRef = useRef<EditorState | null>(null);
  formRef.current = form;
  const savedRef = useRef(savedSnapshot);
  savedRef.current = savedSnapshot;
  // The draft changed on the server (a proposal was laid in) but could not be loaded: the fields
  // are locked and nothing is saved from the old copy until it is loaded.
  const [reloadFailed, setReloadFailed] = useState(false);
  // Unsaved edits that had to be let go of when another fund was chosen and could not be saved,
  // by draft id. They come back when that draft is opened again in this session.
  const keptRef = useRef(new Map<string, { form: EditorState; base: EditorState }>());
  const fundIdRef = useRef(fundId);
  // Starting the draft (the first change): one request, shared by everyone who asks meanwhile.
  const startingRef = useRef<{ fundId: string; run: Promise<string | null> } | null>(null);

  const configQuery = useQuery({
    queryKey: ["fund-config", fundId],
    queryFn: () => getConfigs({ data: { fundId: fundId! } }),
    enabled: Boolean(fundId),
  });

  const data = configQuery.data;
  const active = data?.active ?? null;
  const draft = data?.draft ?? null;
  const previous = data?.previous ?? null;
  const editSource = draft ?? active;
  const canEditConfig = Boolean(fund && (active?.canEdit ?? draft?.canEdit ?? false));
  const hasDraft = Boolean(draft && form?.configId === draft.id);
  // Only an Admin can create a new thesis (the server checks it too, harden S5-3/G15).
  const canCreateFund = funds.some((candidate) => isAdminRole(candidate.roles));

  /** Loads a version into the editor and remembers that it is saved as it is. */
  const seed = (config: EditableFundConfig) => {
    const state = toEditorState(config, language);
    const kept = keptRef.current.get(config.id);
    const next = kept ? mergeKeptEdits(state, kept.form, kept.base) : state;
    formRef.current = next;
    setForm(next);
    setSavedSnapshot(JSON.stringify(state));
    setSaveFailed(false);
    setReloadFailed(false);
    if (kept) {
      keptRef.current.delete(config.id);
      setMessage(t("fundSetup.workspace.restored"));
    }
  };
  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    // Another fund was chosen while its draft had unsaved changes: save them to that draft first.
    // When that cannot be done, keep them in memory and say so; they come back when the draft is
    // opened again.
    const previousFundId = fundIdRef.current;
    fundIdRef.current = fundId;
    const unsaved = formRef.current;
    const wasDraft = Boolean(unsaved && savedRef.current && unsaved.configId);
    if (wasDraft && unsaved && JSON.stringify(unsaved) !== savedRef.current) {
      const name = unsaved.fundName.trim() || t("fundSetup.workspace.previousThesis");
      const base = JSON.parse(savedRef.current) as EditorState;
      const keep = (reason: string) => {
        keptRef.current.set(unsaved.configId, { form: unsaved, base });
        showToast({
          message: t("fundSetup.workspace.keptToast", { reason, name }),
          tone: "error",
          duration: 10000,
        });
      };
      // Only a draft is ever saved; the published version's fields are never written.
      const cachedDraft = previousFundId
        ? queryClient.getQueryData<{ draft: EditableFundConfig | null }>([
            "fund-config",
            previousFundId,
          ])?.draft
        : null;
      if (cachedDraft?.id === unsaved.configId) {
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
    }
    // A draft being started for the fund we left belongs to that fund, not this one.
    startingRef.current = null;
    setStartingDraft(false);
    formRef.current = null;
    setForm(null);
    setSavedSnapshot("");
    setReloadFailed(false);
    setMessage(null);
    setError(null);
    // saveDraft is a stable server function; only a new fund should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundId]);

  // The editor follows the version it should show: the draft, else the published version.
  const publishing = useRef(false);
  useEffect(() => {
    if (!canEditConfig || !editSource || startingRef.current || publishing.current) return;
    if (formRef.current?.configId === editSource.id) return;
    seedRef.current(editSource);
  }, [canEditConfig, editSource, startingDraft, form]);

  /** The fund's versions straight from the server, never a cached copy. */
  const fetchConfigs = (id: string) =>
    queryClient.fetchQuery({
      queryKey: ["fund-config", id],
      queryFn: () => getConfigs({ data: { fundId: id } }),
      staleTime: 0,
    });

  /**
   * The first change starts the draft: a copy of the published version, made once. The change the
   * person made meanwhile is laid onto it (only the fields they changed, so a draft someone else
   * started at the same moment keeps theirs). Resolves to the draft's id, or null.
   */
  const startDraft = (): Promise<string | null> => {
    const known = queryClient.getQueryData<{ draft: EditableFundConfig | null }>([
      "fund-config",
      fundId,
    ])?.draft;
    if (known && formRef.current?.configId === known.id) return Promise.resolve(known.id);
    if (startingRef.current?.fundId === fundId) return startingRef.current.run;
    if (!fundId || !active) return Promise.resolve(null);
    const forFund = fundId;
    const publishedForm = toEditorState(active, language);
    setStartingDraft(true);
    setError(null);
    const run = (async () => {
      try {
        try {
          await createDraft({ data: { activeConfigId: active.id } });
        } catch (cause) {
          // Someone else may have started one a moment ago; use theirs if it is there.
          console.warn("[fund-config] start draft", cause);
        }
        const fresh = await fetchConfigs(forFund);
        if (fundIdRef.current !== forFund) return null;
        if (!fresh.draft) {
          setError(t("fundSetup.places.startFailed"));
          return null;
        }
        const serverState = toEditorState(fresh.draft, language);
        const current = formRef.current;
        const next = current
          ? { ...mergeKeptEdits(serverState, current, publishedForm), configId: fresh.draft.id }
          : serverState;
        formRef.current = next;
        setForm(next);
        savedRef.current = JSON.stringify(serverState);
        setSavedSnapshot(savedRef.current);
        setSaveFailed(false);
        return fresh.draft.id;
      } catch (cause) {
        console.error("[fund-config] start draft", cause);
        setError(t("fundSetup.places.startFailed"));
        return null;
      } finally {
        if (startingRef.current?.fundId === forFund) {
          startingRef.current = null;
          setStartingDraft(false);
        }
      }
    })();
    startingRef.current = { fundId: forFund, run };
    return run;
  };

  const saveMutation = useMutation({
    mutationFn: (input: EditorState) => saveDraft({ data: input }),
    onSuccess: async (_result, input) => {
      if (formRef.current?.configId === input.configId) {
        savedRef.current = JSON.stringify(input);
        setSavedSnapshot(savedRef.current);
      }
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

  /** Saves what the editor shows now (only ever a draft); true when it is saved. */
  const saveNow = async (): Promise<boolean> => {
    const input = formRef.current;
    if (!input || reloadFailed) return false;
    const currentDraft = queryClient.getQueryData<{ draft: EditableFundConfig | null }>([
      "fund-config",
      fundId,
    ])?.draft;
    if (!currentDraft || currentDraft.id !== input.configId) return false;
    if (JSON.stringify(input) === savedRef.current) return true;
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
      // The draft is gone (published or discarded by someone else): show what is published.
      if (fresh.active) seed(fresh.active);
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
      // No re-seed from the cached draft while it is being published (it is gone afterwards).
      publishing.current = true;
      await saveDraft({ data: input });
      await publishDraft({ data: { configId: input.configId } });
    },
    onSettled: () => {
      publishing.current = false;
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["fund-config", fundId] });
      publishing.current = false;
      formRef.current = null;
      setForm(null);
      await queryClient.invalidateQueries({ queryKey: ["fund-config-versions", fundId] });
      await refreshFunds().catch(() => undefined);
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

  const publishedForm = useMemo(
    () => (active ? toEditorState(active, language) : null),
    [active, language],
  );

  const thesisName = active?.fundName ?? draft?.fundName ?? fund?.name;
  const canDelete = Boolean(fund && (active?.canDelete ?? draft?.canDelete ?? false));

  /** The row with the thesis's name, the version chip, the save indicator and the team gear. */
  const headerRow = (chip: ReactNode, saveIndicator: ReactNode) => (
    <Reveal delay={0.1} className="flex flex-wrap items-center gap-3">
      <h2 className="m-0 text-title font-semibold tracking-title">
        {thesisName ?? t("fundSetup.workspace.thesisName")}
      </h2>
      {chip}
      {fundId && active && (
        // Versions and history in one sheet, opened next to the version line.
        <button
          type="button"
          onClick={() => setVersionsOpen(true)}
          aria-haspopup="dialog"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill border-0 bg-transparent px-2 py-1 font-[inherit] text-list font-medium text-ink-2 underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink-1"
        >
          <History className="size-3.5" aria-hidden />
          {t("fundSetup.versions.open")}
        </button>
      )}
      <div className="flex-1" />
      {saveIndicator}
      {fundId && (
        <IconButton
          icon={SlidersHorizontal}
          size={36}
          aria-label={t("fundSetup.places.settingsOpen")}
          title={t("fundSetup.places.settingsOpen")}
          onClick={() => setSettingsOpen(true)}
        />
      )}
      {canDelete && (
        // Prototype `nameRow`: a round white button with the bin in red, next to the settings.
        <IconButton
          icon={Trash2}
          size={36}
          onClick={() => {
            setDeleteConfirmation("");
            setConfirmingDelete(true);
          }}
          className="text-critical hover:bg-critical-wash hover:text-critical"
          aria-label={t("fundSetup.workspace.deleteAria", { name: fund?.name ?? "" })}
          title={t("fundSetup.workspace.deleteTitle")}
        />
      )}
    </Reveal>
  );

  const notices = (
    <>
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
    </>
  );

  /** What else lives in "Gennemse og udgiv": the team's suggestions and re-screening. */
  const publishExtras =
    fundId && active ? (
      <>
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
      </>
    ) : null;
  /** The "Versioner" sheet: the effect of the active version, the versions, changes and history. */
  const versionsContent =
    fundId && active ? (
      <>
        <VersionCards fundId={fundId} threshold={active.analysisThreshold} />
        {previous && (
          <FoldSection title={t("fundSetup.changes.heading", { version: previous.version })}>
            <ConfigChanges active={active} previous={previous} />
          </FoldSection>
        )}
        {canEditConfig && (
          <FoldSection
            title={t("fundSetup.workspace.foldHistory")}
            hint={t("fundSetup.workspace.foldHistoryHint")}
          >
            <ChangeHistory fundId={fundId} />
          </FoldSection>
        )}
      </>
    ) : null;
  const thesisExtras =
    fundId && active ? (
      <FoldSection title={t("fundSetup.workspace.foldHistorical")}>
        <HistoricalInvestmentsPanel fundId={fundId} canEdit={active.canEdit} />
      </FoldSection>
    ) : null;

  let body: ReactNode;
  if (creatingNew && canCreateFund) {
    body = (
      <div className="flex flex-col gap-[22px]">
        <div {...placePanelProps("thesis")}>
          <NewThesisStart
            onCancel={onNewDone}
            onCreated={(newFundId, restored) => {
              void refreshFunds()
                .catch(() => undefined)
                .then(() => {
                  selectFund(newFundId);
                  onNewDone();
                  if (restored) setMessage(t("fundSetup.newThesis.restored"));
                });
            }}
          />
        </div>
      </div>
    );
  } else if (creatingNew) {
    body = <EmptyState title={t("fundSetup.newThesis.adminOnly")} body="" />;
  } else if (configQuery.isLoading) {
    body = <LoadingState title={t("fundSetup.workspace.loading")} />;
  } else if (!data) {
    // Only a first load that failed shows an error with a retry, never example data.
    body = configQuery.isError ? (
      <ErrorState onRetry={() => void configQuery.refetch()} />
    ) : (
      <EmptyState
        title={t("fundSetup.workspace.emptyTitle")}
        body={t("fundSetup.workspace.emptyBody")}
      />
    );
  } else if (canEditConfig && fundId && editSource && form) {
    body = (
      <SetupShell
        fundId={fundId}
        value={form}
        onChange={(next) =>
          setForm((current) => {
            const kept = current?.configId === next.configId ? next : current;
            formRef.current = kept;
            return kept;
          })
        }
        draftVersion={draft?.version ?? (active ? active.version + 1 : 1)}
        hasDraft={hasDraft}
        startingDraft={startingDraft}
        onStartDraft={startDraft}
        active={active}
        publishedForm={publishedForm}
        moduleOverrides={editSource.moduleOverrides}
        stageModuleOverrides={editSource.stageModuleOverrides}
        researchModuleOverrides={editSource.researchModuleOverrides}
        screeningSetup={editSource}
        place={place}
        onPlaceChange={onPlaceChange}
        savedSnapshot={savedSnapshot}
        saving={saveMutation.isPending}
        saveFailed={saveFailed}
        publishing={publishMutation.isPending}
        onSave={saveNow}
        onPublish={() => {
          const input = formRef.current;
          if (input && hasDraft) publishMutation.mutate(input);
        }}
        canAi={canEditConfig}
        onReload={reloadDraft}
        stale={reloadFailed}
        saveError={error}
        renderHeader={({ chip, saveIndicator }) => (
          <>
            {headerRow(chip, saveIndicator)}
            {notices}
          </>
        )}
        extras={{ thesis: thesisExtras, publish: publishExtras }}
      />
    );
  } else if (active && fundId) {
    // Member and Reader: the same four places, the published version as read-only cards.
    body = (
      <div className="flex flex-col gap-[22px]">
        {headerRow(
          <>
            <VersionChip publishedVersion={active.version} draftVersion={null} hasDraft={false} />
            <span className="inline-flex items-center gap-1.5 text-list text-ink-3">
              <Lock className="size-3.5" aria-hidden />
              {t("fundSetup.places.readOnlyNote")}
            </span>
          </>,
          null,
        )}
        {notices}
        <SetupPlacesNav value={place} onChange={onPlaceChange} />
        <div {...placePanelProps(place)} className="flex flex-col gap-9">
          {place === "publish" ? (
            <>
              <PlaceHeading
                title={t("fundSetup.places.publish.readOnlyTitle")}
                lead={t("fundSetup.places.publish.readOnlyLead")}
              />
              <div className="flex flex-col gap-3">{publishExtras}</div>
            </>
          ) : (
            <>
              {place === "thesis" ? (
                // Prototype head("Jeres tese"), no line under it.
                <PlaceHeading title={t("fundSetup.places.thesis.label")} />
              ) : (place === "screening" || place === "analysis") && publishedForm ? null : (
                <PlaceHeading
                  title={t(READ_TITLE[place])}
                  lead={t(READ_LEAD[place], { threshold: active.analysisThreshold })}
                />
              )}
              {/* The same visual blocks as Admin and Lead, only without editing. */}
              {publishedForm && place === "thesis" && (
                <ThesisFrame value={publishedForm} onChange={() => undefined} readOnly />
              )}
              {publishedForm && place === "screening" && (
                <>
                  <ScreeningPlace
                    fundId={fundId}
                    value={publishedForm}
                    onChange={() => undefined}
                    stage={readStage}
                    onStageChange={setReadStage}
                    onGoThesis={() => onPlaceChange("thesis")}
                    heading={(title) => <PlaceHeading title={title} />}
                    readOnly
                  />
                  <span id="setup-step-weights" />
                  <span id="setup-step-mandate" />
                  <span id="setup-step-screening" />
                  <FundOverview
                    key={place}
                    fundId={fundId}
                    active={active}
                    areas={["weights", "mandate", "screening"]}
                    onEdit={undefined}
                  />
                </>
              )}
              {place === "analysis" && publishedForm && (
                // The same page as Admin and Lead, without the means to change it.
                <AnalysisPlace
                  fundId={fundId}
                  value={publishedForm}
                  stage={readStage}
                  onStageChange={setReadStage}
                  onGoThesis={() => onPlaceChange("thesis")}
                  heading={(title) => <PlaceHeading title={title} />}
                  moduleOverrides={active.moduleOverrides}
                  stageModuleOverrides={active.stageModuleOverrides}
                  readOnly
                />
              )}
              {place === "analysis" && !publishedForm && (
                <AnalysisMap fundId={fundId} configId={active.id} />
              )}
              {place === "analysis" && !publishedForm && (
                <SpecialistCards
                  fundId={fundId}
                  configId={active.id}
                  moduleOverrides={active.moduleOverrides}
                />
              )}
              {place === "thesis" && thesisExtras}
            </>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <EmptyState
        title={t("fundSetup.workspace.draftStateTitle")}
        body={t("fundSetup.workspace.draftStateBody")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <FundThesisRow
        funds={funds}
        activeId={creatingNew ? null : fundId}
        onSelect={(id) => {
          selectFund(id);
          if (creatingNew) onNewDone();
        }}
        onCreate={canCreateFund ? onNew : undefined}
      />
      {body}

      {fundId && (
        <Sheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title={t("fundSetup.places.settingsTitle")}
          description={t("fundSetup.places.settingsDescription")}
        >
          <TeamSettingsContent fundId={fundId} />
        </Sheet>
      )}
      {versionsContent && (
        <Sheet
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
          title={t("fundSetup.versions.title")}
          description={t(
            canEditConfig
              ? "fundSetup.versions.description"
              : "fundSetup.versions.descriptionReadOnly",
          )}
          className="w-[min(520px,calc(100vw-24px))]"
        >
          {/* "Gendan" makes a draft: not while one is being started or the editor is out of date. */}
          <fieldset
            disabled={startingDraft || reloadFailed}
            className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
          >
            {versionsContent}
          </fieldset>
        </Sheet>
      )}

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

/**
 * The editor's copy of a version; old stage and geography names come in as keys, and the
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
    // A version with anything per stage is saved whole, with its setup (else the
    // server refuses rows with a stage); "Hvem er I, og hvordan tænker I?" lives in it.
    ...(config.perStage ? { setup: config.setup } : {}),
  });
}
