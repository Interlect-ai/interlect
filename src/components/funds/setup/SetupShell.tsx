/**
 * (TS-17, §2): Teamopsætning for Admin and Lead. "Ny", "Redigér" and "Fortsæt
 * kladde" are the same page: four places (Jeres tese · Sådan screener vi · Sådan analyserer vi ·
 * Gennemse og udgiv) with every field the old eight-step editor had, grouped where they belong.
 *
 * - The chip in the header tells the truth: "Udgivet v4" or "Redigerer kladde v5".
 * - There is no "Redigér" button: before a draft exists the fields show the published version,
 *   and the first change starts the draft by itself (a change in a field, or a click on something
 *   that changes; folds, tabs and links only look). Nothing is written to the published version.
 * - The draft saves itself shortly after each change; one indicator says "Gemmer …" / "Gemt".
 * - A bar sticks to the bottom only while the draft differs from what is published.
 * - Leaving with unsaved changes (or an import in flight) asks first, as the old editor did.
 *
 * The steps' own components (BasicSteps, WeightsStep, MandateStep, ScreeningStep, specialists,
 * PublishStep) are used as they are. moved what only the editor had into the places
 * (versions and history in a sheet by the version line, the document import behind "Vis mere");
 * Deleted the old guide (`thesis/*`) and the old editor with its step list (`EditorShell`).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronDown, CloudCheck, CloudOff, Sparkles } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { scrollWorkspaceToTop } from "@/components/ds/AppShell";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import type { EditableFundConfig, SaveFundConfigInput } from "@/lib/funds/config.functions";
import { stepStatus, type GuideStepKey } from "@/lib/funds/editor-rules";
import { stagesWithOwnContent } from "@/lib/funds/setup-draft-apply";
import { stageTabs } from "@/lib/funds/stage-editor";
import {
  SETUP_PLACES,
  changedPlaces,
  clickStartsDraft,
  type SetupPlaceKey,
} from "@/lib/funds/setup-places";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SpecialistsStep,
  StartStep,
  mergeDocumentProposal,
} from "@/components/funds/editor/BasicSteps";
import { ThesisFrame } from "./ThesisFrame";
import { ScreeningPlace } from "./ScreeningPlace";
import { AnalysisPlace } from "./AnalysisPlace";
import { DraftBusy } from "./DraftBusy";
import { PublishPlace } from "./PublishPlace";
import { useSetupDraft } from "./use-setup-draft";
import { PageAskButton, SetupAssistantProvider } from "./SetupAssistant";
import { GUIDE_STEPS } from "@/components/funds/editor/guide-steps";
import { MandateStep } from "@/components/funds/editor/MandateStep";
import { proposalApplyKey, ProposalsPanel } from "@/components/funds/editor/proposals";
import { useDraftChanges } from "@/components/funds/editor/PublishStep";
import { ScreeningStep } from "@/components/funds/editor/ScreeningStep";
import { WeightsStep } from "@/components/funds/editor/WeightsStep";
import { SetupPlacesNav, placePanelProps } from "./SetupPlacesNav";

type EditorState = SaveFundConfigInput;

/** Wait this long after the last change before the draft saves itself. */
const AUTOSAVE_MS = 1200;

export interface SetupShellProps {
  fundId: string;
  value: EditorState;
  onChange: (value: EditorState) => void;
  /** The draft's version, or the version the first change will start. */
  draftVersion: number;
  /** A draft exists and `value.configId` is it; false while the fields show what is published. */
  hasDraft: boolean;
  /** A draft is being started right now. */
  startingDraft: boolean;
  /** Starts the draft (once); resolves to its id, or null when it could not be started. */
  onStartDraft: () => Promise<string | null>;
  active: EditableFundConfig | null;
  /** The published version as the editor holds it (gates in the team's language), to compare. */
  publishedForm: EditorState | null;
  moduleOverrides: EditableFundConfig["moduleOverrides"];
  researchModuleOverrides: EditableFundConfig["researchModuleOverrides"];
  /** The stages' own module texts (`moduleOverrides` holds the shared ones). */
  stageModuleOverrides: EditableFundConfig["stageModuleOverrides"];
  screeningSetup: Pick<EditableFundConfig, "screeningInstruction" | "screeningCards">;
  place: SetupPlaceKey;
  onPlaceChange: (place: SetupPlaceKey) => void;
  /** JSON of the draft as last saved, to tell whether there is anything unsaved. */
  savedSnapshot: string;
  saving: boolean;
  saveFailed: boolean;
  publishing: boolean;
  /** Saves the current draft; true when it is saved (also when there was nothing to save). */
  onSave: () => Promise<boolean>;
  onPublish: () => void;
  /** Loads the draft from the server into the editor; false when it could not. */
  onReload: () => Promise<boolean>;
  /** The draft changed on the server but could not be loaded: fields locked until reloaded. */
  stale: boolean;
  saveError: string | null;
  /** Admin and Lead: "Ret med AI" and laying proposals into the draft. */
  canAi: boolean;
  /** The row with the thesis's name; gets the chip and the save indicator. */
  renderHeader: (status: { chip: ReactNode; saveIndicator: ReactNode }) => ReactNode;
  /** What else lives in a place (history, suggestions, versions), shown under its fields. */
  extras?: Partial<Record<SetupPlaceKey, ReactNode>>;
}

function SaveIndicator({
  saving,
  failed,
  dirty,
  onRetry,
}: {
  saving: boolean;
  failed: boolean;
  dirty: boolean;
  /** A failed autosave is not retried by itself; this tries again. */
  onRetry: () => void;
}) {
  const t = useT();
  if (saving) {
    return (
      <span role="status" className="flex items-center gap-2 text-meta text-ink-3">
        <AiOrb size={20} tone="neutral" />
        {t("fundEditor.shell.saving")}
      </span>
    );
  }
  if (failed) {
    return (
      <span role="status" className="flex items-center gap-1.5 text-meta text-critical">
        <CloudOff className="size-3.5" aria-hidden />
        {t("fundEditor.shell.failed")}
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-meta font-medium text-ink-1 underline underline-offset-4"
        >
          {t("fundSetup.places.retrySave")}
        </button>
      </span>
    );
  }
  if (dirty) {
    return (
      <span role="status" className="flex items-center gap-1.5 text-meta text-ink-3">
        <span aria-hidden className="size-[7px] rounded-full bg-warning" />
        {t("fundEditor.shell.unsaved")}
      </span>
    );
  }
  return (
    <span role="status" className="flex items-center gap-1.5 text-meta text-ink-3">
      <CloudCheck className="size-3.5 text-positive" aria-hidden />
      {t("fundEditor.shell.saved")}
    </span>
  );
}

/** "Udgivet v4" (calm) or "Redigerer kladde v5" (orange dot), as §2.2. */
export function VersionChip({
  publishedVersion,
  draftVersion,
  hasDraft,
  starting,
}: {
  publishedVersion: number | null;
  draftVersion: number | null;
  hasDraft: boolean;
  starting?: boolean;
}) {
  const t = useT();
  // Status is plain text with a dot, never a pill (prototype Fondsopsaetning v2).
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-list text-ink-3 tabular-nums">
      <span>
        {publishedVersion === null
          ? t("fundSetup.places.chipNotPublished")
          : t("fundSetup.places.chipPublished", { version: publishedVersion })}
      </span>
      {(hasDraft || starting) && draftVersion !== null && (
        <>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5 font-medium text-ink-1">
            {starting && !hasDraft ? (
              <AiOrb size={20} tone="neutral" />
            ) : (
              <span aria-hidden className="size-[7px] rounded-full bg-warning" />
            )}
            {starting && !hasDraft
              ? t("fundSetup.places.chipStarting", { version: draftVersion })
              : t("fundSetup.places.chipEditing", { version: draftVersion })}
          </span>
        </>
      )}
    </span>
  );
}

const PLACE_TITLE: Record<Exclude<SetupPlaceKey, "publish">, MessageKey> = {
  thesis: "fundSetup.places.thesis.title",
  screening: "fundSetup.places.screening.title",
  analysis: "fundSetup.places.analysis.title",
};
const PLACE_LEAD: Record<Exclude<SetupPlaceKey, "publish">, MessageKey> = {
  thesis: "fundSetup.places.thesis.lead",
  screening: "fundSetup.places.screening.lead",
  analysis: "fundSetup.places.analysis.lead",
};

/** The headline and the one line under it, for a place ("Jeres tese" has no line). */
export function PlaceHeading({ title, lead }: { title: string; lead?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="flex flex-col gap-1.5"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.48, ease: EASE.out }}
    >
      <h2 className="m-0 text-[32px] leading-[1.1] font-semibold tracking-title">{title}</h2>
      {lead && <p className="m-0 text-[15px] text-ink-3">{lead}</p>}
    </motion.div>
  );
}

/** One of the old editor's steps as a section of its place: title, one line, "Kort fortalt". */
function StepSection({ step, children }: { step: GuideStepKey; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const guide = GUIDE_STEPS.find((entry) => entry.key === step)!;
  const id = `setup-step-${step}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 id={id} className="m-0 text-section font-semibold">
          {t(guide.heading ?? guide.title)}
        </h3>
        <p className="m-0 text-list text-ink-3">
          {t(guide.lead)}{" "}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-list font-medium text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink-1"
          >
            {t("fundSetup.places.briefly")}
          </button>
        </p>
        <Collapse open={open}>
          <p className="m-0 mt-1.5 max-w-[640px] rounded-md bg-canvas p-3.5 text-list leading-[1.6] text-ink-2">
            {t(guide.explain)}{" "}
            <span className="text-ink-3">
              {t("fundEditor.shell.affects", { affects: t(guide.affects) })}
            </span>
          </p>
        </Collapse>
      </div>
      {children}
    </section>
  );
}

export function SetupShell({
  fundId,
  value,
  onChange,
  draftVersion,
  hasDraft,
  startingDraft,
  onStartDraft,
  active,
  publishedForm,
  moduleOverrides,
  researchModuleOverrides,
  stageModuleOverrides,
  screeningSetup,
  place,
  onPlaceChange,
  savedSnapshot,
  saving,
  saveFailed,
  publishing,
  onSave,
  onPublish,
  onReload,
  stale,
  saveError,
  canAi,
  renderHeader,
  extras,
}: SetupShellProps) {
  const t = useT();
  const language = useLanguage();
  const latest = useRef(value);
  latest.current = value;
  const savedRef = useRef(savedSnapshot);
  savedRef.current = savedSnapshot;
  const hasDraftRef = useRef(hasDraft);
  hasDraftRef.current = hasDraft;

  const snapshot = useMemo(() => JSON.stringify(value), [value]);
  const dirty = hasDraft && snapshot !== savedSnapshot;
  // Every step counts as opened: the places show all their sections at once.
  const status = useMemo(
    () => stepStatus(value, new Set<GuideStepKey>(["basis", "screening", "specialists"]), language),
    [value, language],
  );
  const applying = useIsMutating({ mutationKey: proposalApplyKey(value.configId) }) > 0;
  // The draft run (Lav udkast til hvert stadie) holds the page while it writes.
  const draft = useSetupDraft({ fundId, latest, onStartDraft, onChange, onSave });
  const drafting = draft.running;
  const locked = saving || publishing || applying || drafting;
  const busy = locked || stale;
  const [importing, setImporting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [unsavedParts, setUnsavedParts] = useState<ReadonlySet<string>>(() => new Set());
  const setPartUnsaved = (part: string, unsaved: boolean) =>
    setUnsavedParts((previous) => {
      if (previous.has(part) === unsaved) return previous;
      const next = new Set(previous);
      if (unsaved) next.add(part);
      else next.delete(part);
      return next;
    });

  const { changes, specialistsChanged } = useDraftChanges({
    fundId,
    value,
    active,
    moduleOverrides,
    researchModuleOverrides,
    screeningSetup,
  });
  const changed = useMemo(
    () =>
      hasDraft
        ? changedPlaces(
            publishedForm && active
              ? {
                  ...publishedForm,
                  screeningInstruction: active.screeningInstruction,
                  screeningCards: active.screeningCards,
                  moduleOverrides: active.moduleOverrides,
                  researchModuleOverrides: active.researchModuleOverrides,
                }
              : null,
            {
              ...value,
              screeningInstruction: screeningSetup.screeningInstruction,
              screeningCards: screeningSetup.screeningCards,
              moduleOverrides,
              researchModuleOverrides,
            },
            specialistsChanged,
          )
        : new Set<SetupPlaceKey>(),
    [
      hasDraft,
      publishedForm,
      active,
      value,
      screeningSetup,
      moduleOverrides,
      researchModuleOverrides,
      specialistsChanged,
    ],
  );
  const draftDiffers = hasDraft && (changed.size > 0 || changes.length > 0 || !active);

  // --- Leaving with unsaved work asks first (the router's blocker and the browser's dialog). ---
  // A change made while the draft could not be started is not saved anywhere either.
  const unstartedChange =
    !hasDraft && publishedForm !== null && snapshot !== JSON.stringify(publishedForm);
  const unsafeToLeave =
    (dirty || unstartedChange || importing || drafting || unsavedParts.size > 0) && !publishing;
  const unsafeRef = useRef(unsafeToLeave);
  unsafeRef.current = unsafeToLeave;
  const isUnsafe = useCallback(() => unsafeRef.current, []);
  const blocker = useBlocker({
    shouldBlockFn: isUnsafe,
    enableBeforeUnload: isUnsafe,
    withResolver: true,
  });
  const [leaving, setLeaving] = useState(false);
  const [leaveFailed, setLeaveFailed] = useState(false);
  const leaveDialog = blocker.status === "blocked";
  const stay = () => {
    setLeaveFailed(false);
    if (blocker.status === "blocked") blocker.reset();
  };
  const leave = () => {
    setLeaveFailed(false);
    if (blocker.status === "blocked") blocker.proceed();
  };
  const saveAndLeave = async () => {
    setLeaving(true);
    setLeaveFailed(false);
    const saved = await onSave();
    setLeaving(false);
    if (saved) leave();
    else setLeaveFailed(true);
  };

  // --- The draft saves itself a moment after the last change. ---
  useEffect(() => {
    if (!dirty || busy || !status.canSave || importing) return;
    const timer = window.setTimeout(() => void onSave(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // onSave is the workspace's function for the current draft; the snapshot decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, dirty, busy, status.canSave, importing]);

  /** The draft as saved now (started first if there is none); false when it could not be. */
  const ensureSaved = async (): Promise<boolean> => {
    if (stale) return false;
    if (!hasDraftRef.current) {
      const id = await onStartDraft();
      if (!id) return false;
      // Saved straight away: the workspace's form already holds the new draft (no render needed).
      return onSave();
    }
    if (JSON.stringify(latest.current) === savedRef.current) return true;
    if (!status.canSave) return false;
    return onSave();
  };

  // --- Before a draft exists, the first click that changes something starts it. ---
  const replaying = useRef(false);
  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (hasDraftRef.current || replaying.current || !canAi) return;
    const target = event.target as Element | null;
    const control = target?.closest<HTMLElement>(
      'button, a, summary, input, [role="switch"], [role="slider"], [role="menuitem"], [role="tab"]',
    );
    if (!control || !event.currentTarget.contains(control)) return;
    const startsDraft = clickStartsDraft({
      tag: control.tagName,
      role: control.getAttribute("role"),
      type: control.getAttribute("type"),
      ariaExpanded: control.getAttribute("aria-expanded"),
      browse: Boolean(control.closest("[data-browse]")),
    });
    if (!startsDraft) return;
    event.preventDefault();
    event.stopPropagation();
    void onStartDraft().then((id) => {
      if (!id) return;
      // The click is repeated on the draft once the page shows it (and the control is enabled).
      let tries = 0;
      const replay = () => {
        if (!control.isConnected) return;
        if ((control as HTMLButtonElement).disabled && tries++ < 30) {
          window.setTimeout(replay, 50);
          return;
        }
        replaying.current = true;
        try {
          control.click();
        } finally {
          replaying.current = false;
        }
      };
      window.setTimeout(replay, 60);
    });
  };

  // Typing or pasting into a field starts the draft too (also in boxes that keep their own text).
  // Enter is held back until the draft exists, so an AI request is never sent for the published
  // version; the person presses it again once the chip says "Redigerer kladde".
  const onKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (hasDraftRef.current || !canAi || !isTextField(event.target)) return;
    // A sheet (Customise) renders in a portal: its typing starts nothing here.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void onStartDraft();
      return;
    }
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
      void onStartDraft();
    }
  };
  const onPasteCapture = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (
      !hasDraftRef.current &&
      canAi &&
      isTextField(event.target) &&
      event.currentTarget.contains(event.target as Node)
    )
      void onStartDraft();
  };

  const change = (next: EditorState) => {
    onChange(next);
    if (!hasDraftRef.current && canAi) void onStartDraft();
  };

  // A place stays mounted once opened, so unsaved specialist text or an import survive a switch.
  const [visited, setVisited] = useState<Set<SetupPlaceKey>>(() => new Set([place]));
  useEffect(() => {
    setVisited((previous) => (previous.has(place) ? previous : new Set(previous).add(place)));
  }, [place]);
  const go = (next: SetupPlaceKey) => {
    if (next === place) return;
    if (dirty && status.canSave && !busy) void onSave();
    onPlaceChange(next);
    scrollWorkspaceToTop();
  };

  // The stage on show in "Sådan screener vi" (and next to it in "Sådan analyserer vi").
  const [stage, setStage] = useState<SetupStage | null>(null);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  // (§2.3): the document import sits behind "Vis mere". A file picked with "+"
  // opens it, and it stays open while a document is read, so nothing in flight is unmounted.
  const [importOpen, setImportOpen] = useState(false);
  const importShown = importOpen || importing || pendingImport !== null;
  const reloadQuietly = async () => {
    await onReload();
  };
  const reload = async () => {
    setReloading(true);
    await onReload();
    setReloading(false);
  };

  const renderStep = (key: GuideStepKey) => {
    switch (key) {
      case "start":
        // the prototype's "Jeres tese" has no AI box (the Interlect-Assistent comes with); the
        // document import stays behind "Vis mere" under the six boxes.
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <button
                type="button"
                aria-expanded={importShown}
                aria-controls="setup-import"
                disabled={importing || pendingImport !== null}
                onClick={() => setImportOpen((open) => !open)}
                className="flex w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0 py-1 font-[inherit] text-list font-medium text-ink-2 hover:text-ink-1 disabled:cursor-default"
              >
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform duration-200",
                    importShown && "rotate-180",
                  )}
                  aria-hidden
                />
                {t("fundSetup.visual.showMoreImport")}
              </button>
              <Collapse open={importShown} id="setup-import">
                <StartStep
                  fundId={fundId}
                  configId={value.configId}
                  onProposal={(proposal) => {
                    setImportOpen(true);
                    change(mergeDocumentProposal(latest.current, proposal));
                  }}
                  onBusyChange={setImporting}
                  initialFile={pendingImport}
                  onInitialFileTaken={() => {
                    setImportOpen(true);
                    setPendingImport(null);
                  }}
                />
              </Collapse>
            </div>
          </div>
        );
      case "basis":
      case "thesis":
        // Both are the boxes of `ThesisFrame`, rendered once for the place.
        return null;
      case "weights":
        return (
          <WeightsStep
            fundId={fundId}
            value={value}
            onChange={change}
            canAi={canAi}
            ensureSaved={ensureSaved}
            onProposalApplied={reloadQuietly}
          />
        );
      case "mandate":
        return <MandateStep fundId={fundId} value={value} onChange={change} />;
      case "screening":
        return (
          <ScreeningStep
            fundId={fundId}
            configId={value.configId}
            saved={screeningSetup}
            canAi={canAi}
            ensureSaved={ensureSaved}
            onReload={reloadQuietly}
            onUnsavedChange={setPartUnsaved}
          />
        );
      case "specialists":
        return (
          <SpecialistsStep
            fundId={fundId}
            value={value}
            moduleOverrides={moduleOverrides}
            researchModuleOverrides={researchModuleOverrides}
            onUnsavedChange={setPartUnsaved}
          />
        );
      case "publish":
        // The prototype's "Klar til at udgive?" (PublishPlace).
        return hasDraft ? (
          <PublishPlace
            fundId={fundId}
            value={value}
            active={active}
            moduleOverrides={moduleOverrides}
            researchModuleOverrides={researchModuleOverrides}
            screeningSetup={screeningSetup}
            status={status}
            draftVersion={draftVersion}
            busy={busy || importing}
            publishing={publishing}
            onPublish={onPublish}
            onFix={(next, fixStage) => {
              if (fixStage) setStage(fixStage);
              go(next);
            }}
            onBack={() => go("analysis")}
          />
        ) : null;
    }
  };

  const placeHeading = (key: SetupPlaceKey) =>
    key === "publish" ? (
      hasDraft ? (
        // Prototype `publishView`: head("Klar til at udgive?"), no line under it.
        <PlaceHeading title={t("fundSetup.publishPage.title")} />
      ) : (
        <PlaceHeading
          title={t("fundSetup.places.publish.idleTitle")}
          lead={t("fundSetup.places.publish.idleLead")}
        />
      )
    ) : key === "thesis" ? (
      // Prototype `demoBody`: head("Jeres tese"), no line under it.
      <PlaceHeading title={t("fundSetup.places.thesis.label")} />
    ) : (
      <PlaceHeading
        title={t(PLACE_TITLE[key])}
        lead={t(PLACE_LEAD[key], { threshold: value.analysisThreshold })}
      />
    );

  const chip = (
    <VersionChip
      publishedVersion={active?.version ?? null}
      draftVersion={draftVersion}
      hasDraft={hasDraft}
      starting={startingDraft}
    />
  );
  const saveIndicator = hasDraft ? (
    <SaveIndicator
      saving={saving}
      failed={saveFailed && dirty}
      dirty={dirty}
      onRetry={() => void onSave()}
    />
  ) : null;

  const stageList = stageTabs(value.stages);
  const progressTabs = stageList.length > 0 ? stageList : null;
  const [confirmDraft, setConfirmDraft] = useState(false);
  const startDraftRun = async () => {
    setConfirmDraft(false);
    const ok = await draft.run();
    if (ok) {
      setStage(null);
      go("screening");
    }
  };

  const page = (
    <form
      onSubmit={(event) => event.preventDefault()}
      aria-label={t("fundEditor.shell.formLabel")}
      className="flex flex-col gap-[22px] pb-6"
    >
      {renderHeader({ chip, saveIndicator })}

      <SetupPlacesNav
        value={place}
        onChange={go}
        changed={changed}
        {...(drafting ? { only: place } : {})}
      />

      {!hasDraft && canAi && (
        <p className="m-0 -mt-1.5 text-list text-ink-3">
          {t("fundSetup.places.autoDraftNote", { version: draftVersion })}
        </p>
      )}

      <ProposalsPanel
        configId={value.configId}
        onApplied={reloadQuietly}
        beforeApply={ensureSaved}
      />

      {stale && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md bg-warning-wash p-3.5 text-list text-ink-2"
        >
          <span className="min-w-0 flex-1">{t("fundEditor.shell.staleNotice")}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void reload()}
            pending={reloading ? "ai" : false}
            pendingLabel={t("fundEditor.shell.reloading")}
          >
            {t("fundEditor.shell.reload")}
          </Button>
        </div>
      )}

      {draft.notice && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md bg-warning-wash p-3.5 text-list text-ink-2"
        >
          <span className="min-w-0 flex-1">{draft.notice.text}</span>
          <Button size="sm" variant="quiet" onClick={draft.clearNotice}>
            {t("fundSetup.screen.done")}
          </Button>
        </div>
      )}

      <div
        {...placePanelProps(place)}
        onClickCapture={onClickCapture}
        onKeyDownCapture={onKeyDownCapture}
        onPasteCapture={onPasteCapture}
      >
        <fieldset disabled={applying || stale} className="m-0 min-w-0 border-0 p-0">
          {SETUP_PLACES.map((entry) => {
            const shown = entry.key === place;
            if (!shown && (entry.key === "publish" || !visited.has(entry.key))) return null;
            return (
              <div
                key={entry.key}
                hidden={!shown}
                // Prototype: 22 px between a place's heading and its boxes.
                className={cn(
                  "flex flex-col",
                  entry.key === "thesis" ||
                    entry.key === "screening" ||
                    entry.key === "analysis" ||
                    entry.key === "publish"
                    ? "gap-[22px]"
                    : "gap-9",
                )}
              >
                {shown && drafting && progressTabs && draft.progress && (
                  <DraftBusy progress={draft.progress} tabs={progressTabs} />
                )}
                <div className={shown && drafting ? "hidden" : "contents"}>
                  {entry.key !== "screening" && entry.key !== "analysis" && placeHeading(entry.key)}
                  {entry.key === "screening" && (
                    // The prototype's screening page: stage pills, the score, four cards and
                    // what Interlect reads; each card opens its editing in a sheet.
                    <ScreeningPlace
                      fundId={fundId}
                      value={value}
                      onChange={change}
                      disabled={applying || stale}
                      stage={stage}
                      onStageChange={setStage}
                      onGoThesis={() => go("thesis")}
                      heading={(title) => <PlaceHeading title={title} />}
                    />
                  )}
                  {entry.key === "analysis" && (
                    // The prototype's analysis page: stage pills and one card per
                    // specialist; "Tilpas" opens its focus areas in a sheet.
                    <AnalysisPlace
                      fundId={fundId}
                      value={value}
                      stage={stage}
                      onStageChange={setStage}
                      onGoThesis={() => go("thesis")}
                      heading={(title) => <PlaceHeading title={title} />}
                      moduleOverrides={moduleOverrides}
                      stageModuleOverrides={stageModuleOverrides}
                      disabled={applying || stale}
                    />
                  )}
                  {entry.key === "thesis" && (
                    <ThesisFrame
                      value={value}
                      onChange={change}
                      ticketTooLarge={status.ticketTooLarge}
                    />
                  )}
                  {entry.steps.map((step) => {
                    if (entry.key === "screening" || entry.key === "analysis") return null;
                    const body = renderStep(step);
                    if (body === null) return null;
                    // The import ("start") sits under the frame without a step heading.
                    return entry.steps.length === 1 || step === "start" ? (
                      <div key={step}>{body}</div>
                    ) : (
                      <StepSection key={step} step={step}>
                        {body}
                      </StepSection>
                    );
                  })}
                  {entry.key === "thesis" && canAi && (
                    // The prototype's foot under "Hvad investerer I i?": the draft for every
                    // stage; once drafted it says "Fortsæt" and goes on to the stages.
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1.5">
                      <span className="text-list text-ink-3">
                        {stageList.length === 0 ? t("fundSetup.draft.needStage") : ""}
                      </span>
                      <Button
                        variant="primary"
                        disabled={stageList.length === 0 || busy || importing}
                        onClick={() => {
                          if (draft.drafted) {
                            go("screening");
                          } else if (stagesWithOwnContent(value).length > 0) {
                            setConfirmDraft(true);
                          } else {
                            void startDraftRun();
                          }
                        }}
                      >
                        {!draft.drafted && (
                          <Sparkles className="size-4" strokeWidth={1.75} aria-hidden />
                        )}
                        {draft.drafted
                          ? t("fundSetup.draft.continue")
                          : t("fundSetup.draft.button")}
                        <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
                      </Button>
                    </div>
                  )}
                  {extras?.[entry.key] && (
                    <div data-browse className="flex flex-col gap-3">
                      {extras[entry.key]}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </fieldset>
      </div>

      {status.ticketTooLarge && hasDraft && (
        <p role="alert" className="m-0 text-meta text-critical">
          {t("fundEditor.shell.cannotSave", { reason: t("fundEditor.shell.ticketTooLarge") })}
        </p>
      )}
      {hasDraft &&
        status.keyConflicts.map((conflict) => (
          <p key={conflict} role="alert" className="m-0 text-meta text-critical">
            {t("fundEditor.shell.cannotSave", { reason: conflict })}
          </p>
        ))}

      {draftDiffers && place !== "publish" && !drafting && (
        // The page fades out under the bar, so nothing reads through it; the pill sits left
        // (the "Spørg Interlect" bubble is bottom right).
        <div className="pointer-events-none sticky bottom-0 z-20 -mx-4 -mb-6 bg-[linear-gradient(to_top,var(--bg-surface)_55%,transparent)] px-4 pt-10 pb-4">
          <div className="pointer-events-auto flex w-fit max-w-full flex-wrap items-center gap-3 rounded-pill bg-surface py-2 pr-2 pl-5 shadow-overlay">
            <span aria-hidden className="size-[7px] rounded-full bg-warning" />
            <span className="text-list font-medium text-ink-1 tabular-nums">
              {!active
                ? t("fundSetup.places.barFirst", { version: draftVersion })
                : changes.length === 1
                  ? t("fundSetup.places.barChangesOne", { version: draftVersion })
                  : t("fundSetup.places.barChangesMany", {
                      version: draftVersion,
                      count: changes.length,
                    })}
            </span>
            <Button variant="primary" size="md" onClick={() => go("publish")}>
              {t("fundSetup.places.barReview")}
              <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmDraft} onOpenChange={setConfirmDraft}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("fundSetup.draft.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("fundSetup.draft.confirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("fundSetup.draft.confirmCancel")}</AlertDialogCancel>
            <Button variant="primary" size="md" onClick={() => void startDraftRun()}>
              {t("fundSetup.draft.confirmGo")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaveDialog} onOpenChange={(open) => !open && !leaving && stay()}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {importing
                ? t("fundEditor.shell.leave.importingTitle")
                : dirty
                  ? t("fundEditor.shell.leave.dirtyTitle")
                  : t("fundEditor.shell.leave.partsTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {importing
                ? t("fundEditor.shell.leave.importingBody")
                : dirty
                  ? t("fundEditor.shell.leave.dirtyBody")
                  : t("fundEditor.shell.leave.partsBody")}
              {!importing && dirty && unsavedParts.size > 0
                ? ` ${t("fundEditor.shell.leave.partsNote")}`
                : ""}
            </AlertDialogDescription>
            {leaveFailed && (
              <p role="alert" className="m-0 text-list text-critical">
                {saveError ?? t("fundEditor.shell.leave.saveFailed")}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>
              {t("fundEditor.shell.leave.stay")}
            </AlertDialogCancel>
            <Button variant="quiet" size="md" onClick={leave} disabled={leaving}>
              {dirty || unsavedParts.size > 0
                ? t("fundEditor.shell.leave.closeWithout")
                : t("fundEditor.shell.leave.closeAnyway")}
            </Button>
            {dirty && !importing && !stale && status.canSave && (
              <Button
                variant="primary"
                size="md"
                onClick={() => void saveAndLeave()}
                pending={leaving ? "ai" : false}
                pendingLabel={t("fundEditor.shell.leave.savingShort")}
              >
                {t("fundEditor.shell.leave.saveAndClose")}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
  // Admin and Lead get the Interlect-Assistent (one conversation for the page, only for
  // the session); its pill by the page title is drawn into the header (FundPageHeader).
  return canAi ? (
    <SetupAssistantProvider
      fundId={fundId}
      latest={latest}
      onChange={change}
      place={place}
      stage={stage}
      locked={applying || stale || drafting || publishing}
    >
      <PageAskButton />
      {page}
    </SetupAssistantProvider>
  ) : (
    page
  );
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
  if (target.tagName !== "INPUT") return false;
  const type = (target.getAttribute("type") ?? "text").toLowerCase();
  return !["checkbox", "radio", "range", "file", "button", "submit"].includes(type);
}
