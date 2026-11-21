/**
 * The place "Sådan analyserer vi", ported 1:1 from the prototype `Teamopsaetning v3.dc.html`
 * (`specCards`, `specSheet`). One stage at a time (the pills on top, like "Sådan screener vi"):
 *
 *   Stage pills + "Sammenlign stadier"
 *   "Sådan analyserer I i <stadie>"
 *   One card per specialist: figure, on/off, name, its focus areas, "Tilpas"; "Lav jeres egen
 *   specialist". "Tilpas" opens a sheet: the focus areas (name and what to look into), added and
 *   removed, and "Sådan bliver der analyseret" (the text the analysis gets).
 *
 * What is written lives in the stage's own set (specialists.functions.ts: the rows of the stage,
 * the first change copies the shared set into it) and its own module texts
 * (module-prompt-override.functions.ts, with the stage). The focus areas of one specialist are the
 * lines of its mandate, "Name: text" (stage-specialists.ts). The specialists' texts are the team's
 * own rules and may be shown and edited (beslutningsloggen 15. nov 2026).
 */
import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Plus, Target, Trash2 } from "lucide-react";
import { SpecialistBot } from "@/components/ai/SpecialistBot";
import {
  SPECIALIST_KIND_COLOR,
  ownSpecialistKind,
  specialistKind,
  type SpecialistKind,
} from "@/components/ai/specialist-kind";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { Sheet } from "@/components/ds/Sheet";
import { showToast } from "@/components/ds/Toast";
import { Toggle } from "@/components/ds/Toggle";
import {
  fundSpecialistsKey,
  useFundSpecialists,
  useStageSpecialistCounts,
} from "@/components/funds/editor/use-fund-specialists";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import type { SpecialistModuleId } from "@/lib/analysis/specialist-prompts";
import type { EditableFundConfig, SaveFundConfigInput } from "@/lib/funds/config.functions";
import {
  resetModulePromptOverride,
  saveModulePromptOverride,
} from "@/lib/funds/module-prompt-override.functions";
import {
  deleteCustomSpecialist,
  saveCustomSpecialist,
  setCustomSpecialistEnabled,
  setStandardSpecialist,
  type FundSpecialistsView,
} from "@/lib/funds/specialists.functions";
import { stageText } from "@/lib/funds/basis-labels";
import { stageTabs } from "@/lib/funds/stage-editor";
import {
  FOCUS_MAX,
  FOCUS_TEXT_MAX,
  FOCUS_TITLE_MAX,
  focusAreasOf,
  focusLabel,
  focusProblems,
  purposeOf,
  sameFoci,
  specialistTextOf,
  type SpecialistFocus,
} from "@/lib/funds/stage-specialists";
import { standardSpecialistCardIn } from "@/lib/funds/specialist-cards";
import { userMessage } from "@/lib/errors/user-message";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { CompareTable, GetsBox, seriesPill } from "./ScreeningSheets";
import { StagePills } from "./StagePills";
import { AiBox, AskRow, useAssistantSheet } from "./SetupAssistant";

type EditorState = SaveFundConfigInput;
type CustomItem = FundSpecialistsView["custom"][number];
type Target = { kind: "standard"; id: SpecialistModuleId } | { kind: "custom"; key: string | null };

/** One specialist as the page shows it. */
interface Card {
  id: string;
  name: string;
  figure: SpecialistKind;
  enabled: boolean;
  foci: SpecialistFocus[];
  /** The risk areas as stored (named ones are kept when the focus areas are saved again). */
  risks: string[];
  /** The stage has its own text for this specialist (a standard specialist only). */
  ownText: boolean;
  custom: CustomItem | null;
}

const FIELD =
  "w-full rounded-[12px] border-0 bg-sunken px-3.5 py-3 font-[inherit] text-[14px] leading-[1.5] text-ink-1 outline-none placeholder:text-ink-4 focus-visible:shadow-[0_0_0_2px_var(--action)]";
const LABEL = "text-[13px] font-medium text-ink-1";

const customInput = (item: CustomItem) => ({
  name: item.name,
  purpose: item.purpose,
  mandate: item.mandate,
  evidenceTests: item.evidenceTests,
  riskAreas: item.riskAreas,
  questions: item.questions,
  deliverables: item.deliverables,
  categories: item.categories,
});

/** The prototype's bot glyph (`botGlyph`): the product's own figure for the specialist. */
function Figure({ kind, size = 42 }: { kind: SpecialistKind; size?: number }) {
  return <SpecialistBot kind={kind} size={size} />;
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

function SpecialistSheet({
  fundId,
  configId,
  stage,
  card,
  target,
  open,
  figure,
  onClose,
  onRemove,
  onSaved,
}: {
  fundId: string;
  configId: string;
  stage: SetupStage;
  /** The specialist being changed; null for a new one of the team's own. */
  card: Card | null;
  target: Target;
  open: boolean;
  figure: SpecialistKind;
  onClose: () => void;
  onRemove: (item: CustomItem) => void;
  onSaved: (view: FundSpecialistsView | null) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const saveOwn = useServerFn(saveCustomSpecialist);
  const saveText = useServerFn(saveModulePromptOverride);
  const resetText = useServerFn(resetModulePromptOverride);
  const standard = target.kind === "standard";
  const initial = useRef({ name: card?.name ?? "", foci: card?.foci ?? [] });
  const [name, setName] = useState(initial.current.name);
  const [foci, setFoci] = useState<SpecialistFocus[]>(initial.current.foci);
  const [openFocus, setOpenFocus] = useState(-1);
  const [showProblems, setShowProblems] = useState(false);

  const changed =
    (!standard && name.trim() !== initial.current.name.trim()) ||
    !sameFoci(foci, initial.current.foci);
  const problems = [
    ...(!standard && name.trim().length < 3 ? [t("fundSetup.analysis.problemSpecName")] : []),
    ...focusProblems(foci).map((problem) =>
      problem === "text"
        ? t("fundSetup.analysis.problemText")
        : problem === "none"
          ? t("fundSetup.analysis.problemNone")
          : problem === "long"
            ? t("fundSetup.analysis.problemLong")
            : t("fundSetup.analysis.problemTooMany", { max: FOCUS_MAX }),
    ),
  ];
  const nm = (standard ? card?.name : name.trim()) || t("fundSetup.analysis.newSpecialist");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["fund-config", fundId] });
  const save = useMutation({
    mutationFn: async (): Promise<FundSpecialistsView | null> => {
      if (target.kind === "standard") {
        const text = specialistTextOf(foci, card?.risks ?? [], initial.current.foci);
        await saveText({ data: { fundId, configId, moduleId: target.id, stage, ...text } });
        return null;
      }
      const text = specialistTextOf(foci, card?.custom?.riskAreas ?? [], initial.current.foci);
      const own = card?.custom;
      return saveOwn({
        data: {
          fundId,
          configId,
          stage,
          ...(own ? { key: own.key } : {}),
          specialist: {
            ...(own ? customInput(own) : { questions: [], deliverables: [], categories: [] }),
            name: name.trim(),
            purpose: own?.purpose ?? purposeOf(name, foci),
            mandate: text.mandate,
            evidenceTests: text.evidenceTests,
            riskAreas: text.riskAreas,
          },
        },
      });
    },
    onSuccess: async (view) => {
      onSaved(view);
      await refresh();
      showToast({ message: t("fundSetup.analysis.saved") });
      onClose();
    },
    onError: (cause) =>
      showToast({
        message: userMessage(cause, t("fundSetup.analysis.saveFailed"), language),
        tone: "error",
      }),
  });
  const reset = useMutation({
    mutationFn: () => {
      if (target.kind !== "standard") throw new Error("not a standard specialist");
      return resetText({ data: { fundId, configId, moduleId: target.id, stage } });
    },
    onSuccess: async () => {
      await refresh();
      showToast({ message: t("specialists.panel.resetDone") });
      onClose();
    },
    onError: (cause) =>
      showToast({
        message: userMessage(cause, t("specialists.panel.resetFailed"), language),
        tone: "error",
      }),
  });
  const busy = save.isPending || reset.isPending;

  const finish = () => {
    if (busy) return;
    if (!changed) {
      onClose();
      return;
    }
    if (problems.length) {
      setShowProblems(true);
      return;
    }
    save.mutate();
  };
  // The Interlect-Assistent reads and changes the focus areas as edited here (saved with
  // "Færdig" like any other edit).
  const fociRef = useRef(foci);
  fociRef.current = foci;
  useAssistantSheet(
    open
      ? {
          sheet: "spec",
          spec: { name: nm, foci: () => fociRef.current, setFoci: (next) => setFoci(next) },
        }
      : null,
  );
  const setFocus = (index: number, patch: Partial<SpecialistFocus>) =>
    setFoci((current) =>
      current.map((focus, at) => (at === index ? { ...focus, ...patch } : focus)),
    );

  const title: ReactNode = (
    <span className="flex min-w-0 items-center gap-3.5">
      <Figure kind={figure} />
      {standard ? (
        <span className="min-w-0 truncate">{nm}</span>
      ) : (
        <input
          type="text"
          value={name}
          maxLength={80}
          placeholder={t("fundSetup.analysis.namePlaceholder")}
          aria-label={t("fundSetup.analysis.nameAria")}
          onChange={(event) => setName(event.target.value)}
          className="-ml-1.5 min-w-0 flex-1 rounded-[8px] border-0 bg-transparent px-1.5 py-0.5 font-[inherit] text-[22px] font-semibold tracking-[-0.02em] text-ink-1 outline-none placeholder:text-ink-3 hover:bg-canvas focus:bg-canvas focus-visible:shadow-[0_0_0_2px_var(--action)]"
        />
      )}
    </span>
  );
  const lines = foci.flatMap((focus, index) => [
    ...(index ? [""] : []),
    { b: focusLabel(focus) || t("fundSetup.analysis.unnamed") },
    focus.text.trim() || "…",
  ]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) finish();
      }}
      title={title}
      className="w-[min(760px,calc(100vw-24px))]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex flex-wrap items-center gap-2">
            {card?.custom && (
              <Button
                size="sm"
                variant="quiet"
                icon={Trash2}
                disabled={busy}
                onClick={() => onRemove(card.custom!)}
                className="text-critical"
              >
                {t("fundSetup.analysis.removeSpecialist")}
              </Button>
            )}
            {standard && card?.ownText && (
              <Button size="sm" variant="quiet" disabled={busy} onClick={() => reset.mutate()}>
                {t("fundSetup.analysis.reset")}
              </Button>
            )}
            {changed && (
              <Button size="sm" variant="quiet" disabled={busy} onClick={onClose}>
                {t("fundSetup.analysis.discard")}
              </Button>
            )}
          </span>
          <Button onClick={finish} pending={save.isPending ? "ai" : false}>
            {t("fundSetup.screen.done")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-[22px]">
        <AiBox
          field="box:spec"
          title={t("fundSetup.assistant.box.specTitle")}
          placeholder={t("fundSetup.assistant.box.specPh", { name: nm })}
        />
        <h3 className="m-0 text-section font-semibold">
          {t("fundSetup.analysis.focusHeading", { name: nm })}
        </h3>
        <div className="flex flex-col gap-2.5">
          {foci.map((focus, index) => {
            const isOpen = openFocus === index;
            return (
              <div
                key={index}
                data-open={isOpen}
                className={cn(
                  "overflow-hidden rounded-[20px] bg-surface shadow-[inset_0_0_0_1px_var(--line-strong)]",
                  isOpen && "shadow-[inset_0_0_0_2px_var(--ink-1)]",
                )}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenFocus(isOpen ? -1 : index)}
                  className="flex w-full cursor-pointer items-center gap-3.5 rounded-[20px] border-0 bg-transparent px-4 py-3.5 text-left font-[inherit] text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action"
                >
                  <span
                    aria-hidden
                    className="grid size-[30px] shrink-0 place-items-center rounded-[9px] text-[14px] font-semibold text-ink-1"
                    style={{ background: "var(--series-2-wash)" }}
                  >
                    {index + 1}
                  </span>
                  <b className="min-w-0 flex-1 text-[15px] font-semibold">
                    {focusLabel(focus) || t("fundSetup.analysis.newFocus")}
                  </b>
                  <span className="text-ink-3" aria-hidden>
                    {isOpen ? (
                      <ChevronUp className="size-[18px]" />
                    ) : (
                      <ChevronDown className="size-[18px]" />
                    )}
                  </span>
                </button>
                <Collapse open={isOpen}>
                  <div className="flex flex-col gap-4 px-4 pb-[18px]">
                    <label className="flex flex-col gap-2">
                      <span className={LABEL}>{t("fundSetup.analysis.focusName")}</span>
                      <input
                        type="text"
                        value={focus.title}
                        maxLength={FOCUS_TITLE_MAX}
                        placeholder={t("fundSetup.analysis.focusNamePlaceholder")}
                        onChange={(event) => setFocus(index, { title: event.target.value })}
                        className={FIELD}
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className={LABEL}>{t("fundSetup.analysis.focusText")}</span>
                      <textarea
                        rows={5}
                        value={focus.text}
                        maxLength={FOCUS_TEXT_MAX}
                        onChange={(event) => setFocus(index, { text: event.target.value })}
                        className={cn(FIELD, "resize-none [field-sizing:content]")}
                      />
                    </label>
                    <AskRow field={`fm:${index}`} />
                    <div>
                      <Button
                        size="sm"
                        variant="quiet"
                        icon={Trash2}
                        className="text-critical"
                        onClick={() => {
                          setFoci((current) => current.filter((_, at) => at !== index));
                          setOpenFocus(-1);
                        }}
                      >
                        {t("fundSetup.analysis.removeFocus")}
                      </Button>
                    </div>
                  </div>
                </Collapse>
              </div>
            );
          })}
          <button
            type="button"
            disabled={foci.length >= FOCUS_MAX}
            onClick={() => {
              setFoci((current) => [...current, { title: "", text: "", evidence: "" }]);
              setOpenFocus(foci.length);
            }}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-[14px] border-0 bg-transparent px-4 py-3 font-[inherit] text-[14px] font-medium text-ink-1 shadow-[inset_0_0_0_1.5px_var(--line-strong)] outline-none hover:bg-canvas focus-visible:ring-2 focus-visible:ring-action disabled:cursor-default disabled:opacity-40"
          >
            <Plus className="size-[15px]" aria-hidden />
            {t("fundSetup.analysis.addFocus")}
          </button>
        </div>
        {(showProblems || (changed && foci.length > 0)) && problems.length > 0 && (
          <ul
            role="alert"
            className="m-0 flex list-none flex-col gap-1 p-0 text-list text-critical"
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <GetsBox
          id="gets-spec"
          title={t("fundSetup.analysis.getsTitle")}
          pills={[
            {
              label:
                foci.length === 1
                  ? t("fundSetup.analysis.pillFocusOne")
                  : t("fundSetup.analysis.pillFocus", { count: foci.length }),
              icon: Target,
              ...seriesPill(2),
            },
          ]}
          lines={lines}
        />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function AnalysisPlace({
  fundId,
  value,
  stage,
  onStageChange,
  onGoThesis,
  heading,
  moduleOverrides,
  stageModuleOverrides,
  readOnly,
  disabled,
}: {
  fundId: string;
  value: EditorState;
  /** The stage on show (the shell keeps it, so the next place opens on the same stage). */
  stage: SetupStage | null;
  onStageChange: (stage: SetupStage) => void;
  onGoThesis: () => void;
  /** The page title, drawn by the shell so every place has the same one. */
  heading: (title: string) => ReactNode;
  /** The shared module texts and the stages' own (`prompt_module_overrides`). */
  moduleOverrides: EditableFundConfig["moduleOverrides"];
  stageModuleOverrides: EditableFundConfig["stageModuleOverrides"];
  /** Member and Reader: the same page without the means to change it. */
  readOnly?: boolean | undefined;
  /** The shell holds the fields still (a proposal is applying, or the draft is out of date). */
  disabled?: boolean | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const configId = value.configId;
  const tabs = stageTabs(value.stages);
  const current = tabs.find((tab) => tab.stage === stage) ?? tabs[0];
  const active = current?.stage ?? null;
  const query = useFundSpecialists(fundId, current ? configId : null, active);
  const counts = useStageSpecialistCounts(
    fundId,
    configId,
    tabs.map((tab) => tab.stage),
  );
  const setStandard = useServerFn(setStandardSpecialist);
  const setCustom = useServerFn(setCustomSpecialistEnabled);
  const remove = useServerFn(deleteCustomSpecialist);
  const saveOwn = useServerFn(saveCustomSpecialist);
  const [sheet, setSheet] = useState<{ target: Target; nonce: number; open: boolean } | null>(null);
  const [compare, setCompare] = useState(false);
  const [removedAt, setRemoved] = useState<{ item: CustomItem; stage: SetupStage } | null>(null);
  const key = fundSpecialistsKey(fundId, configId, active);
  const afterWrite = (view: FundSpecialistsView) => {
    queryClient.setQueryData(key, view);
    void queryClient.invalidateQueries({
      queryKey: ["fund-config", fundId, "specialists", configId],
    });
  };
  const toggle = useMutation({
    onMutate: () => queryClient.cancelQueries({ queryKey: key }),
    mutationFn: (input: { id: string; custom: boolean; enabled: boolean }) =>
      input.custom
        ? setCustom({
            data: { fundId, configId, key: input.id, enabled: input.enabled, stage: active },
          })
        : setStandard({
            data: {
              fundId,
              configId,
              moduleId: input.id as SpecialistModuleId,
              enabled: input.enabled,
              stage: active,
            },
          }),
    onSuccess: afterWrite,
    onError: (cause) =>
      showToast({
        message: userMessage(cause, t("specialists.panel.toggleError"), language),
        tone: "error",
      }),
  });
  const removal = useMutation({
    mutationFn: (item: CustomItem) =>
      remove({ data: { fundId, configId, key: item.key, stage: active } }),
    onSuccess: (view, item) => {
      afterWrite(view);
      if (active) setRemoved({ item, stage: active });
      setSheet((open) => (open ? { ...open, open: false } : open));
    },
    onError: (cause) =>
      showToast({
        message: userMessage(cause, t("fundSetup.analysis.removeFailed"), language),
        tone: "error",
      }),
  });
  const restore = useMutation({
    mutationFn: (item: CustomItem) =>
      saveOwn({ data: { fundId, configId, stage: active, specialist: customInput(item) } }),
    onSuccess: (view) => {
      afterWrite(view);
      setRemoved(null);
    },
    onError: (cause) =>
      showToast({
        message: userMessage(cause, t("fundSetup.analysis.restoreFailed"), language),
        tone: "error",
      }),
  });

  if (!current || !active) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="m-0 max-w-[520px] text-[15px] text-ink-3">{t("fundSetup.screen.noStages")}</p>
        <Button variant="secondary" size="md" onClick={onGoThesis}>
          {t("fundSetup.screen.goThesis")}
        </Button>
      </div>
    );
  }
  const label = stageText(current.raw, language);
  const view = query.data;
  // "Fortryd" belongs to the stage the specialist was removed from.
  const removed = removedAt && removedAt.stage === active ? removedAt.item : null;
  const own = stageModuleOverrides[active];
  const cards: Card[] = view
    ? [
        ...view.standard.map((module): Card => {
          const id = module.id as SpecialistModuleId;
          const base = standardSpecialistCardIn(id, language);
          const ownOverride = own?.[id];
          const stored = ownOverride ?? moduleOverrides[id];
          // A text the person may not read (redacted) is empty: the standard focus areas show.
          const foci =
            stored && stored.mandate.length
              ? focusAreasOf(stored)
              : base.focus.map((title, index) => ({
                  title,
                  text: base.text[index] ?? "",
                  evidence: "",
                }));
          return {
            id,
            name: base.label,
            figure: specialistKind(id),
            enabled: module.enabled,
            foci,
            risks: stored?.riskAreas ?? [],
            ownText: Boolean(ownOverride),
            custom: null,
          };
        }),
        ...view.custom.map((item, index): Card => ({
          id: item.key,
          name: item.name,
          figure: ownSpecialistKind(index),
          enabled: item.enabled,
          foci: focusAreasOf(item),
          risks: item.riskAreas,
          ownText: false,
          custom: item,
        })),
      ]
    : [];
  const locked = toggle.isPending || removal.isPending || restore.isPending || Boolean(disabled);
  const target = sheet?.target ?? null;
  const sheetCard = !target
    ? null
    : target.kind === "standard"
      ? (cards.find((card) => card.id === target.id) ?? null)
      : target.key
        ? (cards.find((card) => card.id === target.key) ?? null)
        : null;
  const newFigure = ownSpecialistKind(view?.custom.length ?? 0);
  const openSheet = (next: Target) =>
    setSheet((previous) => ({ target: next, nonce: (previous?.nonce ?? 0) + 1, open: true }));

  return (
    <>
      <StagePills
        tabs={tabs}
        active={active}
        onPick={onStageChange}
        onCompare={() => setCompare(true)}
      />

      {heading(t("fundSetup.analysis.title", { stage: label }))}

      {query.isError && !view && (
        <p role="alert" className="m-0 text-list text-critical">
          {userMessage(query.error, t("specialists.panel.loadError"), language)}
        </p>
      )}
      {!view && !query.isError && (
        <p className="m-0 text-list text-ink-3">{t("fundSetup.analysis.loading")}</p>
      )}

      {view && (
        <div className="flex flex-col gap-3.5">
          {view.problems.map((line) => (
            <p
              key={line}
              role="alert"
              className="m-0 rounded-md bg-critical-wash px-4 py-3 text-list"
            >
              {line}
            </p>
          ))}
          {view.warnings.map((line) => (
            <p key={line} className="m-0 rounded-md bg-warning-wash px-4 py-3 text-list text-ink-2">
              {line}
            </p>
          ))}
          {removed && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-ai-wash px-4 py-3 text-list text-ink-1">
              <span>{t("fundSetup.analysis.removed", { name: removed.name })}</span>
              <Button
                size="sm"
                variant="quiet"
                className="text-ai-ink"
                disabled={locked}
                onClick={() => restore.mutate(removed)}
              >
                {t("fundSetup.analysis.undo")}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3.5 min-[1101px]:grid-cols-4 max-sm:grid-cols-1">
            {cards.map((card) => {
              const color = SPECIALIST_KIND_COLOR[card.figure];
              return (
                <div
                  key={card.id}
                  className="flex min-w-0 flex-col gap-2.5 rounded-[24px] bg-canvas p-[22px]"
                >
                  <div className="flex items-start justify-between">
                    <Figure kind={card.figure} />
                    <span className="flex items-center gap-1">
                      {!readOnly && card.custom && (
                        <button
                          type="button"
                          disabled={locked}
                          aria-label={t("fundSetup.analysis.removeAria", { name: card.name })}
                          onClick={() => removal.mutate(card.custom!)}
                          className="grid size-[30px] cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-ink-3 transition-colors hover:bg-critical-wash hover:text-critical disabled:cursor-default disabled:opacity-35"
                        >
                          <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                        </button>
                      )}
                      <Toggle
                        checked={card.enabled}
                        disabled={locked || readOnly === true}
                        label={t("fundSetup.analysis.onAria", { name: card.name })}
                        onCheckedChange={(enabled) =>
                          toggle.mutate({ id: card.id, custom: card.custom !== null, enabled })
                        }
                      />
                    </span>
                  </div>
                  <b className="text-section font-semibold">{card.name}</b>
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] text-ink-2">
                    {card.foci.map((focus, index) => (
                      <li key={index} className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-[7px] shrink-0 rounded-full"
                          style={{ background: color }}
                        />
                        {focusLabel(focus) || t("fundSetup.analysis.unnamed")}
                      </li>
                    ))}
                    {card.foci.length === 0 && (
                      <li className="text-meta text-ink-3">{t("fundSetup.analysis.noFocus")}</li>
                    )}
                  </ul>
                  {!readOnly && (
                    <div className="mt-auto pt-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={locked}
                        onClick={() =>
                          openSheet(
                            card.custom
                              ? { kind: "custom", key: card.id }
                              : { kind: "standard", id: card.id as SpecialistModuleId },
                          )
                        }
                      >
                        <InterlectMark size={12} tone="current" />
                        {t("fundSetup.analysis.tailor")}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {!readOnly && (
              <div className="flex min-w-0 flex-col gap-2.5 rounded-[24px] bg-transparent p-[22px] shadow-[inset_0_0_0_1.5px_var(--line-strong)]">
                <span
                  aria-hidden
                  className="grid size-[42px] place-items-center rounded-[13px] bg-ai-wash text-ai-ink"
                >
                  <Plus className="size-[18px]" strokeWidth={1.75} />
                </span>
                <b className="text-section font-semibold">{t("fundSetup.analysis.ownTitle")}</b>
                <div className="mt-auto pt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={locked}
                    onClick={() => openSheet({ kind: "custom", key: null })}
                  >
                    {t("fundSetup.analysis.create")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {sheet && view && (
        <SpecialistSheet
          key={sheet.nonce}
          fundId={fundId}
          configId={configId}
          stage={active}
          card={sheetCard}
          target={sheet.target}
          open={sheet.open}
          figure={sheetCard?.figure ?? newFigure}
          onClose={() => setSheet((open) => (open ? { ...open, open: false } : open))}
          onRemove={(item) => removal.mutate(item)}
          onSaved={(next) => {
            if (next) afterWrite(next);
          }}
        />
      )}

      <Sheet
        open={compare}
        onOpenChange={setCompare}
        title={t("fundSetup.screen.sheetCompare")}
        className="w-[min(860px,100vw)]"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setCompare(false)}>{t("fundSetup.screen.done")}</Button>
          </div>
        }
      >
        <CompareTable
          value={value}
          specialistCounts={counts}
          onPick={(next) => {
            onStageChange(next);
            setCompare(false);
          }}
        />
      </Sheet>
    </>
  );
}
