/**
 * The editing flow for a draft ("Redigér opsætning", prototype Fondsopsaetning v2): a header with
 * the close button, the draft's version and the "Gemt" indicator; the step list to the left, the
 * step in the middle (max 720 px) and the box "Hvad betyder det for analysen?" to the right (under
 * the step when the room is narrow); and a footer with Tilbage, "Trin N af 8" and the next step
 * (on the last step "Udgiv"). Moving to another step saves the draft when it has changed (autosave).
 * A step stays mounted once it has been opened (hidden while another step is shown), so unsaved
 * specialist text, a "Ret med AI" answer or a document import in flight survive a step change; only
 * "Gennemgå og udgiv" is built afresh each time. Closing or leaving the page with unsaved changes
 * (or an import in flight) asks first. The draft never reaches an analysis before it is published.
 * The pure rules (which step is done, what blocks a publish, when to autosave) live in
 * lib/funds/editor-rules.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, CloudCheck, CloudOff, X } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { Button } from "@/components/ds/Button";
import { scrollWorkspaceToTop } from "@/components/ds/AppShell";
import type { EditableFundConfig, SaveFundConfigInput } from "@/lib/funds/config.functions";
import { shouldAutosave, stepStatus, type GuideStepKey } from "@/lib/funds/editor-rules";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { useLanguage, useT } from "@/lib/i18n/useT";
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
  BasisStep,
  SpecialistsStep,
  StartStep,
  ThesisStep,
  mergeDocumentProposal,
} from "./BasicSteps";
import { GUIDE_STEPS, stepIndex } from "./guide-steps";
import { MandateStep } from "./MandateStep";
import { proposalApplyKey, ProposalsPanel } from "./proposals";
import { PublishStep } from "./PublishStep";
import { ScreeningStep } from "./ScreeningStep";
import { ThesisComposer } from "./ThesisComposer";
import { WeightsStep } from "./WeightsStep";

type EditorState = SaveFundConfigInput;

export interface EditorShellProps {
  fundId: string;
  value: EditorState;
  onChange: (value: EditorState) => void;
  draftVersion: number;
  active: EditableFundConfig | null;
  moduleOverrides: EditableFundConfig["moduleOverrides"];
  researchModuleOverrides: EditableFundConfig["researchModuleOverrides"];
  /** The draft's screening instruction and cards, so the publish step lists changes. */
  screeningSetup: Pick<EditableFundConfig, "screeningInstruction" | "screeningCards">;
  initialStep: GuideStepKey | null;
  /** A document picked with "+" on the overview: the Start step imports it. */
  initialImport?: File | null | undefined;
  onInitialImportTaken?: (() => void) | undefined;
  /** JSON of the draft as last saved, to tell whether there is anything unsaved. */
  savedSnapshot: string;
  saving: boolean;
  saveFailed: boolean;
  publishing: boolean;
  /** Saves the current draft; true when it is saved (also when there was nothing to save). */
  onSave: () => Promise<boolean>;
  onPublish: () => void;
  onClose: () => void;
  /** The draft changed on the server (a proposal was laid in): load it into the editor. */
  /** Loads the draft from the server into the editor; false when it could not. */
  onReload: () => Promise<boolean>;
  /**
   * The draft changed on the server but could not be loaded into the editor: the fields are
   * locked and nothing is saved from the old copy until "Hent kladden igen" succeeds.
   */
  stale: boolean;
  /** Why the last save failed, in plain Danish (shown in the leave dialog too). */
  saveError: string | null;
  /** Admin and Lead: "Ret med AI" and laying proposals into the draft. */
  canAi: boolean;
}

function SaveIndicator({
  saving,
  failed,
  dirty,
}: {
  saving: boolean;
  failed: boolean;
  dirty: boolean;
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

function HelpBox({ text, affects }: { text: string; affects: string }) {
  const t = useT();
  return (
    <section
      aria-label={t("fundEditor.shell.helpTitle")}
      className="flex flex-col gap-2.5 rounded-lg bg-canvas p-5"
    >
      <h3 className="m-0 text-list font-semibold">{t("fundEditor.shell.helpTitle")}</h3>
      <p className="m-0 text-[14px] leading-[1.6] text-ink-2">{text}</p>
      <p className="m-0 text-meta text-ink-3">{t("fundEditor.shell.affects", { affects })}</p>
    </section>
  );
}

export function EditorShell({
  fundId,
  value,
  onChange,
  draftVersion,
  active,
  moduleOverrides,
  researchModuleOverrides,
  screeningSetup,
  initialStep,
  initialImport = null,
  onInitialImportTaken,
  savedSnapshot,
  saving,
  saveFailed,
  publishing,
  onSave,
  onPublish,
  onClose,
  onReload,
  stale,
  saveError,
  canAi,
}: EditorShellProps) {
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  const { fund } = useActiveFund();
  const [step, setStep] = useState(() => stepIndex(initialStep));
  const [visited, setVisited] = useState<Set<GuideStepKey>>(
    () => new Set<GuideStepKey>(["start", ...(initialStep ? [initialStep] : [])]),
  );
  // An import that takes a while must merge into the newest draft, not the one it started from.
  const latest = useRef(value);
  latest.current = value;
  const savedRef = useRef(savedSnapshot);
  savedRef.current = savedSnapshot;

  const snapshot = useMemo(() => JSON.stringify(value), [value]);
  const dirty = snapshot !== savedSnapshot;
  const status = useMemo(() => stepStatus(value, visited, language), [value, visited, language]);
  const current = GUIDE_STEPS[step]!;
  // "Læg i kladden" reloads the draft from the server when it is done: the fields hold still
  // until then, so nothing typed in that second is overwritten by the reload.
  const applying = useIsMutating({ mutationKey: proposalApplyKey(value.configId) }) > 0;
  const locked = saving || publishing || applying;
  const busy = locked || stale;
  const [importing, setImporting] = useState(false);
  const [reloading, setReloading] = useState(false);
  // Specialist texts are saved on their own (not with the draft); these are open and unsaved.
  const [unsavedParts, setUnsavedParts] = useState<ReadonlySet<string>>(() => new Set());
  const setPartUnsaved = (part: string, unsaved: boolean) =>
    setUnsavedParts((previous) => {
      if (previous.has(part) === unsaved) return previous;
      const next = new Set(previous);
      if (unsaved) next.add(part);
      else next.delete(part);
      return next;
    });

  // Leaving with unsaved changes or a paid import in flight asks first: the close button, a link
  // in the menu (the router's blocker) and closing the tab (the browser's own dialog).
  const unsafeToLeave = (dirty || importing || unsavedParts.size > 0) && !publishing;
  const unsafeRef = useRef(unsafeToLeave);
  unsafeRef.current = unsafeToLeave;
  // Stable functions (they only read the ref), so the blocker is not registered again per render.
  const isUnsafe = useCallback(() => unsafeRef.current, []);
  const blocker = useBlocker({
    shouldBlockFn: isUnsafe,
    enableBeforeUnload: isUnsafe,
    withResolver: true,
  });
  const [askingClose, setAskingClose] = useState(false);
  const leaveDialog = askingClose || blocker.status === "blocked";
  const [leaving, setLeaving] = useState(false);
  const [leaveFailed, setLeaveFailed] = useState(false);
  const stay = () => {
    setAskingClose(false);
    setLeaveFailed(false);
    if (blocker.status === "blocked") blocker.reset();
  };
  const leave = () => {
    setAskingClose(false);
    setLeaveFailed(false);
    if (blocker.status === "blocked") blocker.proceed();
    else onClose();
  };
  const saveAndLeave = async () => {
    setLeaving(true);
    setLeaveFailed(false);
    const saved = await onSave();
    setLeaving(false);
    // The dialog stays open on a failure and says why (the banner behind it is covered).
    if (saved) leave();
    else setLeaveFailed(true);
  };
  const reload = async () => {
    setReloading(true);
    await onReload();
    setReloading(false);
  };
  // The panels only need to know it ran; a failure shows as the stale notice.
  const reloadQuietly = async () => {
    await onReload();
  };
  // The proposal the Start step's composer shows inline, left out of the panel below.
  const [composerProposalId, setComposerProposalId] = useState<string | null>(null);
  const requestClose = () => {
    if (unsafeToLeave) setAskingClose(true);
    else onClose();
  };

  // Esc closes nothing here (a draft in progress); the close button is explicit.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.focus({ preventScroll: true });
  }, [step]);

  const ensureSaved = async (): Promise<boolean> => {
    if (stale) return false;
    if (JSON.stringify(latest.current) === savedRef.current) return true;
    if (!status.canSave) return false;
    return onSave();
  };

  const goTo = (next: number) => {
    const target = GUIDE_STEPS[next];
    if (!target || busy) return;
    if (
      shouldAutosave({
        canSave: status.canSave,
        busy,
        fromStep: step,
        toStep: next,
        snapshot,
        lastSavedSnapshot: savedSnapshot,
      })
    ) {
      void onSave();
    }
    setVisited((previous) => new Set(previous).add(target.key));
    setStep(next);
    scrollWorkspaceToTop();
  };

  const renderStep = (key: GuideStepKey) => {
    switch (key) {
      case "start":
        return (
          <div className="flex flex-col gap-8">
            {/* Editing starts like "Ny investeringstese": write what should
                change and Interlect lays it in the draft; the fields stay for fine-tuning. */}
            {canAi && (
              <ThesisComposer
                draftId={value.configId}
                draftVersion={draftVersion}
                criteria={value.criteria.map((criterion) => ({
                  key: criterion.key,
                  label: criterion.label,
                }))}
                ensureDraft={async () => {
                  // The proposal is made from the saved draft, so unsaved edits are saved first.
                  if (!(await ensureSaved())) throw new Error(t("fundEditor.composer.saveFirst"));
                  return value.configId;
                }}
                onReview={() => goTo(stepIndex("publish"))}
                onDraftChanged={async () => {
                  if (!(await onReload())) throw new Error(t("fundEditor.composer.reloadFailed"));
                }}
                beforeApply={ensureSaved}
                showPanel={false}
                onProposalShown={setComposerProposalId}
              />
            )}
            <StartStep
              fundId={fundId}
              configId={value.configId}
              onProposal={(proposal) => onChange(mergeDocumentProposal(latest.current, proposal))}
              onBusyChange={setImporting}
              initialFile={initialImport}
              onInitialFileTaken={onInitialImportTaken}
            />
          </div>
        );
      case "basis":
        return (
          <BasisStep value={value} onChange={onChange} ticketTooLarge={status.ticketTooLarge} />
        );
      case "thesis":
        return <ThesisStep value={value} onChange={onChange} />;
      case "weights":
        return (
          <WeightsStep
            fundId={fundId}
            value={value}
            onChange={onChange}
            canAi={canAi}
            ensureSaved={ensureSaved}
            onProposalApplied={reloadQuietly}
          />
        );
      case "mandate":
        return <MandateStep fundId={fundId} value={value} onChange={onChange} />;
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
            userRoles={fund?.roles}
            onUnsavedChange={setPartUnsaved}
          />
        );
      case "publish":
        return (
          <PublishStep
            fundId={fundId}
            value={value}
            active={active}
            moduleOverrides={moduleOverrides}
            researchModuleOverrides={researchModuleOverrides}
            screeningSetup={screeningSetup}
            status={status}
          />
        );
    }
  };

  const last = step === GUIDE_STEPS.length - 1;
  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      aria-label={t("fundEditor.shell.formLabel")}
      className="@container flex flex-col overflow-hidden rounded-lg bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line px-5 py-3.5 md:px-7">
        <button
          type="button"
          onClick={requestClose}
          disabled={locked}
          aria-label={t("fundEditor.shell.close")}
          title={t("fundEditor.shell.close")}
          className="grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-sunken text-ink-2 transition-transform active:scale-[.94] disabled:opacity-50"
        >
          <X className="size-4" aria-hidden />
        </button>
        <span className="text-[15px] font-semibold">{t("fundEditor.shell.formLabel")}</span>
        <span className="text-meta text-ink-4">
          {t("fundEditor.shell.draftNote", { version: draftVersion })}
        </span>
        <div className="flex-1" />
        <SaveIndicator saving={saving} failed={saveFailed && dirty} dirty={dirty} />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onSave()}
          disabled={!status.canSave || busy || !dirty}
        >
          {t("fundEditor.shell.saveDraft")}
        </Button>
      </div>

      <div className="grid grid-cols-1 @min-[900px]:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-label={t("fundEditor.shell.stepsLabel")}
          className="flex gap-0.5 overflow-x-auto border-b border-line px-4 py-2.5 @min-[900px]:flex-col @min-[900px]:self-start @min-[900px]:border-r @min-[900px]:border-b-0 @min-[900px]:px-3.5 @min-[900px]:py-[22px]"
        >
          {GUIDE_STEPS.map((guideStep, index) => {
            const isActive = index === step;
            const done = status.done[guideStep.key];
            return (
              <button
                key={guideStep.key}
                type="button"
                onClick={() => goTo(index)}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "flex h-11 shrink-0 cursor-pointer items-center gap-3 rounded-sm border-0 px-3 text-left font-[inherit] text-list font-medium whitespace-nowrap transition-[background,color] duration-200",
                  isActive ? "bg-canvas text-ink-1" : "bg-transparent text-ink-3 hover:text-ink-1",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-[22px] flex-none place-items-center rounded-full text-[11px] font-semibold",
                    isActive
                      ? "bg-inverse text-ink-inverse"
                      : done
                        ? "bg-positive text-white"
                        : "text-ink-3 shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
                  )}
                >
                  {done && !isActive ? <Check className="size-3" strokeWidth={3} /> : index + 1}
                </span>
                {t(guideStep.title)}
                {guideStep.optional && (
                  <span className="text-meta font-normal text-ink-4">
                    {t("fundEditor.shell.optional")}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div ref={bodyRef} tabIndex={-1} className="min-w-0 outline-none">
          <div className="flex max-w-[720px] flex-col gap-[22px] px-5 pt-7 pb-8 md:px-10 md:pt-8 md:pb-10">
            <motion.div
              key={current.key}
              className="flex flex-col gap-1.5"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, ease: EASE.out }}
            >
              <h2 className="m-0 text-[30px] leading-[1.1] font-semibold tracking-title">
                {t(current.heading ?? current.title)}
              </h2>
              <span className="text-[15px] text-ink-3">{t(current.lead)}</span>
            </motion.div>

            <ProposalsPanel
              configId={value.configId}
              onApplied={reloadQuietly}
              beforeApply={ensureSaved}
              excludeId={composerProposalId}
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

            <fieldset disabled={applying || stale} className="m-0 min-w-0 border-0 p-0">
              {GUIDE_STEPS.map((guideStep) => {
                const shown = guideStep.key === current.key;
                // Unopened steps are not built yet; "Gennemgå og udgiv" has no state of its own
                // and is built afresh each time it is shown.
                if (!shown && (guideStep.key === "publish" || !visited.has(guideStep.key))) {
                  return null;
                }
                const away = reduced ? { opacity: 0 } : { opacity: 0, y: 12 };
                return (
                  <motion.div
                    key={guideStep.key}
                    hidden={!shown}
                    initial={away}
                    animate={shown ? { opacity: 1, y: 0 } : away}
                    transition={{
                      duration: shown ? 0.52 : 0,
                      ease: EASE.out,
                      delay: shown ? 0.06 : 0,
                    }}
                  >
                    {renderStep(guideStep.key)}
                  </motion.div>
                );
              })}
            </fieldset>

            <HelpBox text={t(current.explain)} affects={t(current.affects)} />
            {status.ticketTooLarge && (
              <p role="alert" className="m-0 text-meta text-critical">
                {t("fundEditor.shell.cannotSave", {
                  reason: t("fundEditor.shell.ticketTooLarge"),
                })}
              </p>
            )}
            {status.keyConflicts.map((conflict) => (
              <p key={conflict} role="alert" className="m-0 text-meta text-critical">
                {t("fundEditor.shell.cannotSave", { reason: conflict })}
              </p>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 border-t border-line px-5 py-3.5 md:px-7">
        <Button
          variant="quiet"
          size="lg"
          onClick={() => goTo(step - 1)}
          disabled={step === 0 || busy}
        >
          {t("fundEditor.shell.back")}
        </Button>
        <div className="flex-1" />
        <span className="text-meta text-ink-4 tabular-nums">
          {t("fundEditor.shell.stepOf", { step: step + 1, total: GUIDE_STEPS.length })}
        </span>
        {last ? (
          <Button
            variant="primary"
            size="lg"
            onClick={onPublish}
            disabled={!status.valid || busy || importing}
            pending={publishing ? "ai" : false}
            pendingLabel={t("fundEditor.shell.publishing")}
          >
            {t("fundEditor.shell.publish")}
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={() => goTo(step + 1)} disabled={busy}>
            {t("fundEditor.shell.next", { title: t(GUIDE_STEPS[step + 1]!.title) })}
            <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
          </Button>
        )}
      </div>

      <AlertDialog
        open={leaveDialog}
        // While "Gem og luk" is saving, Esc does nothing: the save decides whether to close.
        onOpenChange={(open) => !open && !leaving && stay()}
      >
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
}
