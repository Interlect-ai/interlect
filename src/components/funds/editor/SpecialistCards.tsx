/**
 * The step "Specialister" in "Redigér opsætning" ("Specialister" and v0.9, the cards of the prototype "Ny
 * investeringstese v3"): one card per specialist with its figure, name,
 * role, three focus points and a toggle, then a dashed card "Lav jeres egen specialist".
 * "Tilpas" on a standard specialist rewrites its mandate, evidence requirements and risk areas with
 * Interlect and shows before/after; "Tilpas" on the fund's own and the dashed card open the flow
 * beskriv → ret udkastet → aktivér (no trial run on the screen in 1.0, the quality check runs by itself
 * and shows only when it finds something). Everything lands in the draft and reaches
 * an analysis only when the draft is published. The customer sees no prices (P13).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, Check, Plus, X } from "lucide-react";
import { AiBeam } from "@/components/ai/AiBeam";
import { Velaris } from "@/components/ds/Velaris";
import { SpecialistBot } from "@/components/ai/SpecialistBot";
import {
  ownSpecialistKind,
  SPECIALIST_KIND_COLOR,
  specialistKind,
  type SpecialistKind,
} from "@/components/ai/specialist-kind";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { ComposerStatus } from "@/components/ds/AiComposer";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { fieldClass } from "@/components/ds/Field";
import { Reveal } from "@/components/ds/Reveal";
import { showToast } from "@/components/ds/Toast";
import { Toggle } from "@/components/ds/Toggle";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { specialistCatalog, type SpecialistModuleInfo } from "@/lib/analysis/specialist-catalog";
import { SCORE_CATEGORIES } from "@/lib/analysis/specialist-set";
import { scoreCategoryLabelIn } from "@/lib/domain/labels";
import type { ScoreCategory } from "@/lib/domain/types";
import {
  loadStandardModuleText,
  proposeModulePromptOverride,
  resetModulePromptOverride,
  saveModulePromptOverride,
} from "@/lib/funds/module-prompt-override.functions";
import {
  checkCustomSpecialist,
  draftCustomSpecialist,
  type SpecialistCheckView,
} from "@/lib/funds/specialist-assist.functions";
import { assistFieldLabel, type CustomSpecialistInput } from "@/lib/funds/specialist-assist";
import {
  areaList,
  cleanSpecialist,
  customSpecialistDiffs,
  emptySpecialist,
  fieldDiffs,
  issueAction,
  linesOf,
  issueActionLabel,
  moduleDiffLabels,
  moduleTextProblems,
  specialistFormProblems,
  standardSpecialistCardIn,
  STANDARD_SPECIALIST_CARDS,
  type FieldDiff,
  type IssueAction,
} from "@/lib/funds/specialist-cards";
import {
  deleteCustomSpecialist,
  saveCustomSpecialist,
  setCustomSpecialistEnabled,
  setStandardSpecialist,
  type FundSpecialistsView,
} from "@/lib/funds/specialists.functions";
import type { Language } from "@/lib/i18n/language";
import type { MessageKey } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { textareaClass } from "./fields";
import { fundSpecialistsKey, useFundSpecialists } from "./use-fund-specialists";
import { userMessage } from "@/lib/errors/user-message";

type ModuleText = { mandate: string[]; evidenceTests: string[]; riskAreas: string[] };
type CustomItem = FundSpecialistsView["custom"][number];
type Panel = { kind: "standard"; id: string } | { kind: "custom"; key: string | null };

const errorText = (cause: unknown, fallback: string, language: Language) =>
  userMessage(cause, fallback, language);

/** The standard specialist's card in the fund's language; undefined for an id without one. */
const knownCard = (id: string, language: Language) =>
  id in STANDARD_SPECIALIST_CARDS
    ? standardSpecialistCardIn(id as SpecialistModuleInfo["id"], language)
    : undefined;

export function SpecialistCards({
  fundId,
  configId,
  moduleOverrides,
  onUnsavedChange,
  openNew = false,
}: {
  fundId: string;
  configId: string;
  moduleOverrides: Record<string, ModuleText>;
  /** Opens "Lav jeres egen specialist" at once (the thesis wizard). */
  openNew?: boolean;
  /** A text or a draft is open and not saved (the editor asks before closing). */
  onUnsavedChange?: ((part: string, unsaved: boolean) => void) | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const query = useFundSpecialists(fundId, configId);
  const setStandard = useServerFn(setStandardSpecialist);
  const setCustom = useServerFn(setCustomSpecialistEnabled);
  const [panel, setPanel] = useState<Panel | null>(openNew ? { kind: "custom", key: null } : null);
  // The open panel's state: unsaved work is not thrown away without asking, and nothing else can
  // be opened, closed or switched while one of its calls (possibly a paid one) is running.
  const [panelUnsaved, setPanelUnsaved] = useState(false);
  const [panelBusy, setPanelBusy] = useState(false);
  const [confirmPanel, setConfirmPanel] = useState<{ next: Panel | null } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const key = fundSpecialistsKey(fundId, configId);
  const toggle = useMutation({
    // A refetch that started before the switch must not land after it.
    onMutate: () => queryClient.cancelQueries({ queryKey: key }),
    mutationFn: (input: { id: string; custom: boolean; enabled: boolean }) =>
      input.custom
        ? setCustom({ data: { fundId, configId, key: input.id, enabled: input.enabled } })
        : setStandard({
            data: {
              fundId,
              configId,
              moduleId: input.id as SpecialistModuleInfo["id"],
              enabled: input.enabled,
            },
          }),
    onSuccess: (view) => queryClient.setQueryData(key, view),
    onError: (cause) =>
      showToast({
        message: errorText(cause, t("specialists.panel.toggleError"), language),
        tone: "error",
      }),
  });

  useEffect(() => {
    if (panel) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [panel]);

  const view = query.data;
  // A failed background refetch keeps the cards (and an open panel) as they are.
  if (query.isError && !view) {
    return (
      <p role="alert" className="m-0 text-list text-critical">
        {errorText(query.error, t("specialists.panel.loadError"), language)}
      </p>
    );
  }
  if (!view) return <p className="m-0 text-list text-ink-3">{t("specialists.panel.loading")}</p>;

  const editable = view.editable;
  const assigned = new Map(view.assignment.map((item) => [item.id, item.categories]));
  /** Opens, switches or closes the panel; asks first when the open one has unsaved work. */
  const requestPanel = (wanted: Panel | null) => {
    if (panelBusy) return;
    const next = JSON.stringify(wanted) === JSON.stringify(panel) ? null : wanted;
    if (panel && panelUnsaved) setConfirmPanel({ next });
    else setPanel(next);
  };
  // One write at a time: each answer is the whole set, so two in flight could land out of order.
  const locked = toggle.isPending || panelBusy;
  const activeOwn = view.custom.filter((item) => item.enabled).length;
  const reportUnsaved = (part: string) => (unsaved: boolean) => {
    setPanelUnsaved(unsaved);
    onUnsavedChange?.(part, unsaved);
  };

  return (
    <div className="flex flex-col gap-3.5">
      {view.problems.map((line) => (
        <p key={line} role="alert" className="m-0 rounded-md bg-critical-wash px-4 py-3 text-list">
          {line}
        </p>
      ))}
      {view.warnings.map((line) => (
        <p key={line} className="m-0 rounded-md bg-warning-wash px-4 py-3 text-list text-ink-2">
          {line}
        </p>
      ))}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {view.standard.map((module, index) => {
          const card = knownCard(module.id, language);
          const kind = specialistKind(module.id);
          return (
            <SpecialistCard
              key={module.id}
              index={index}
              kind={kind}
              title={card?.label ?? module.title}
              role={card?.role ?? module.title}
              focus={card?.focus ?? []}
              badge={module.isCustomized ? t("specialists.panel.customized") : null}
              enabled={module.enabled}
              areas={module.enabled ? (assigned.get(module.id) ?? []) : null}
              editable={editable}
              locked={locked}
              open={panel?.kind === "standard" && panel.id === module.id}
              onToggle={(enabled) => toggle.mutate({ id: module.id, custom: false, enabled })}
              onTilpas={() => requestPanel({ kind: "standard", id: module.id })}
            />
          );
        })}
        {view.custom.map((item, index) => (
          <SpecialistCard
            key={item.key}
            index={view.standard.length + index}
            kind={ownSpecialistKind(index)}
            title={item.name}
            role={t("specialists.panel.ownRole")}
            focus={item.mandate.slice(0, 3)}
            badge={null}
            enabled={item.enabled}
            areas={item.enabled ? (assigned.get(item.key) ?? []) : null}
            editable={editable}
            locked={locked}
            open={panel?.kind === "custom" && panel.key === item.key}
            onToggle={(enabled) => toggle.mutate({ id: item.key, custom: true, enabled })}
            onTilpas={() => requestPanel({ kind: "custom", key: item.key })}
          />
        ))}
        {editable && (
          <NewSpecialistCard
            index={view.standard.length + view.custom.length}
            open={panel?.kind === "custom" && panel.key === null}
            disabled={panelBusy}
            onOpen={() => requestPanel({ kind: "custom", key: null })}
          />
        )}
      </div>

      <div ref={panelRef} className="scroll-mt-4">
        <Collapse open={panel !== null}>
          {panel?.kind === "standard" && (
            <StandardTilpas
              key={panel.id}
              fundId={fundId}
              configId={configId}
              module={specialistCatalog.find((module) => module.id === panel.id)!}
              override={moduleOverrides[panel.id] ?? null}
              editable={editable}
              onClose={() => requestPanel(null)}
              onDone={() => setPanel(null)}
              onBusyChange={setPanelBusy}
              onUnsavedChange={reportUnsaved(`module:${panel.id}`)}
            />
          )}
          {panel?.kind === "custom" && (
            <CustomSpecialistFlow
              key={panel.key ?? "new"}
              fundId={fundId}
              configId={configId}
              view={view}
              existing={view.custom.find((item) => item.key === panel.key) ?? null}
              kind={ownSpecialistKind(
                panel.key === null
                  ? view.custom.length
                  : view.custom.findIndex((item) => item.key === panel.key),
              )}
              activeOwn={activeOwn}
              owners={standardOwners(view, language)}
              onClose={() => requestPanel(null)}
              onSaved={(next) => {
                queryClient.setQueryData(key, next);
                setPanel(null);
              }}
              onBusyChange={setPanelBusy}
              onUnsavedChange={reportUnsaved("custom")}
            />
          )}
        </Collapse>
      </div>

      <AlertDialog
        open={confirmPanel !== null}
        onOpenChange={(open) => !open && setConfirmPanel(null)}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("specialists.panel.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("specialists.panel.confirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("specialists.panel.stay")}</AlertDialogCancel>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setPanel(confirmPanel?.next ?? null);
                setConfirmPanel(null);
              }}
            >
              {t("specialists.panel.confirmClose")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Who owns each score area among the active standard specialists (their own areas only): an area
 * a module has only inherited goes to the fund's own specialist that names it.
 */
function standardOwners(view: FundSpecialistsView, language: Language): Map<ScoreCategory, string> {
  const owners = new Map<ScoreCategory, string>();
  for (const module of view.standard) {
    if (!module.enabled) continue;
    const label = knownCard(module.id, language)?.label;
    for (const category of module.categories) owners.set(category, label ?? module.title);
  }
  return owners;
}

// ─── Cards ──────────────────────────────────────────────────────────────────────────────────

function SpecialistCard({
  index,
  kind,
  title,
  role,
  focus,
  badge,
  enabled,
  areas,
  editable,
  locked,
  open,
  onToggle,
  onTilpas,
}: {
  index: number;
  kind: SpecialistKind;
  title: string;
  role: string;
  focus: readonly string[];
  badge: string | null;
  enabled: boolean;
  /** The score areas it assesses in a run with this version; null when it is switched off. */
  areas: ScoreCategory[] | null;
  editable: boolean;
  /** A write or a panel's call is running: switches and "Tilpas" wait. */
  locked: boolean;
  open: boolean;
  onToggle: (enabled: boolean) => void;
  onTilpas: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const color = SPECIALIST_KIND_COLOR[kind];
  return (
    <Reveal delay={index * 0.04}>
      <article
        aria-label={title}
        className={cn(
          "flex h-full flex-col gap-3.5 rounded-lg bg-surface p-[18px] shadow-card transition-[opacity,box-shadow] duration-300",
          open && "shadow-[0_0_0_1.5px_var(--ink-1),var(--shadow-card)]",
        )}
        style={{ opacity: enabled ? 1 : 0.55 }}
      >
        <div className="flex shrink-0 items-start justify-between">
          <SpecialistBot kind={kind} size={48} />
          <Toggle
            checked={enabled}
            disabled={!editable || locked}
            label={t("specialists.panel.toggleLabel", { name: title })}
            onCheckedChange={onToggle}
          />
        </div>
        <div className="flex shrink-0 flex-col gap-[3px]">
          <span className="flex items-center gap-2 text-base font-semibold">
            <span className="min-w-0 truncate">{title}</span>
            {badge && (
              <span className="shrink-0 rounded-pill px-2 py-0.5 text-meta font-medium text-ink-3 shadow-[inset_0_0_0_1px_var(--line-strong)]">
                {badge}
              </span>
            )}
          </span>
          <span className="text-meta text-ink-3">{role}</span>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {focus.map((point) => (
            <span key={point} className="flex items-start gap-2 text-list leading-[1.4] text-ink-2">
              <span
                aria-hidden
                className="mt-[7px] size-[5px] shrink-0 rounded-full"
                style={{ background: color }}
              />
              <span className="line-clamp-2">{point}</span>
            </span>
          ))}
        </div>
        <p className="m-0 mt-auto text-meta leading-[1.45] text-ink-3">
          {areas === null
            ? t("specialists.panel.off")
            : areas.length
              ? t("specialists.panel.assesses", { areas: areaList(areas, language) })
              : t("specialists.panel.assessesNone")}
        </p>
        <button
          type="button"
          onClick={onTilpas}
          aria-expanded={open}
          disabled={locked}
          className="inline-flex h-8 cursor-pointer items-center gap-[7px] self-start rounded-pill border-0 bg-surface px-3 font-[inherit] text-meta font-medium whitespace-nowrap text-ink-1 shadow-pill transition-transform active:scale-[.96] disabled:cursor-default disabled:opacity-50"
        >
          <InterlectMark size={11} />
          {editable ? t("specialists.panel.tailor") : t("specialists.panel.seeMore")}
        </button>
      </article>
    </Reveal>
  );
}

function NewSpecialistCard({
  index,
  open,
  disabled,
  onOpen,
}: {
  index: number;
  open: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <Reveal delay={index * 0.04}>
      <div
        className={cn(
          "flex h-full min-h-[240px] flex-col gap-3.5 rounded-lg border-[1.5px] border-dashed p-[18px] transition-colors duration-300",
          open ? "border-ink-1" : "border-line-strong",
        )}
      >
        <span
          aria-hidden
          className="grid size-12 place-items-center rounded-[14px] bg-ai-wash text-ai"
        >
          <Plus className="size-5" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-[3px]">
          <span className="text-base font-semibold">{t("specialists.panel.newTitle")}</span>
          <span className="text-meta leading-[1.45] text-ink-3">
            {t("specialists.panel.newBody")}
          </span>
        </div>
        <button
          type="button"
          onClick={onOpen}
          aria-expanded={open}
          disabled={disabled}
          className="mt-auto inline-flex h-8 cursor-pointer items-center gap-[7px] self-start rounded-pill border-0 bg-inverse px-[13px] font-[inherit] text-meta font-medium whitespace-nowrap text-ink-inverse transition-transform active:scale-[.96] disabled:cursor-default disabled:opacity-50"
        >
          <Plus className="size-3.5" aria-hidden />
          {t("specialists.panel.newButton")}
        </button>
      </div>
    </Reveal>
  );
}

// ─── Shared pieces of the panels ────────────────────────────────────────────────────────────

function PanelFrame({
  kind,
  title,
  sub,
  onClose,
  children,
  aiBusy,
  busy,
}: {
  kind: SpecialistKind;
  title: string;
  sub: string;
  onClose: () => void;
  children: ReactNode;
  /** AI is working (the beam). */
  aiBusy: boolean;
  /** Any call is running: the panel cannot be closed until it answers. */
  busy: boolean;
}) {
  const t = useT();
  return (
    <AiBeam active={aiBusy} className="rounded-lg">
      <section
        aria-label={title}
        className="mt-0.5 flex flex-col gap-4 rounded-lg bg-surface p-5 shadow-raised"
      >
        <header className="flex items-start gap-3">
          <SpecialistBot kind={kind} size={36} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h3 className="m-0 text-section font-semibold">{title}</h3>
            <p className="m-0 text-meta text-ink-3">{sub}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("specialists.panel.close")}
            disabled={busy}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink-3 hover:bg-hover disabled:cursor-default disabled:opacity-40"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        {children}
      </section>
    </AiBeam>
  );
}

/** The pill where the user asks Interlect for a change (as "Ret med AI"). */
function AskPill({
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
  minLength = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  disabled: boolean;
  minLength?: number;
}) {
  const t = useT();
  const ready = !disabled && value.trim().length >= minLength;
  return (
    // The flowing AI ground where Interlect helps.
    <div className="relative isolate flex items-center gap-2 overflow-hidden rounded-pill py-1 pr-1 pl-3.5">
      <Velaris className="absolute inset-0 -z-10" />
      <InterlectMark size={12} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, 2000))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && ready) {
            event.preventDefault();
            onSend();
          }
        }}
        disabled={disabled}
        aria-label={placeholder}
        placeholder={placeholder}
        className={cn(
          fieldClass,
          // On the flowing ground the text stands on a light surface, so it stays readable.
          "h-8 flex-1 rounded-pill bg-surface/90 px-3 text-[14px] shadow-none focus:bg-surface focus:shadow-none",
        )}
      />
      <button
        type="button"
        onClick={onSend}
        disabled={!ready}
        aria-label={t("specialists.panel.send")}
        className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-inverse text-ink-inverse transition-[opacity,transform] active:scale-90 disabled:cursor-default disabled:opacity-35"
      >
        <ArrowUp className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Before/after per field: removed points struck through, new ones in bold (v0.7). */
function BeforeAfter({ diffs, onUndo }: { diffs: FieldDiff[]; onUndo?: () => void }) {
  const t = useT();
  return (
    <div
      aria-label={t("specialists.panel.beforeAfter")}
      className="overflow-hidden rounded-md bg-surface shadow-[inset_0_0_0_1px_var(--line)]"
    >
      {diffs.length === 0 ? (
        <p className="m-0 px-4 py-3 text-list text-ink-3">
          {t("specialists.panel.nothingChanged")}
        </p>
      ) : (
        diffs.map((diff, index) => (
          <div key={diff.field} className={cn("px-4 py-3", index > 0 && "border-t border-line")}>
            <p className="m-0 mb-1.5 text-meta text-ink-3">{diff.label}</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {diff.rows.map((row, rowIndex) => (
                <li
                  key={`${row.change}-${rowIndex}`}
                  className={cn(
                    "flex items-start gap-2 text-[14px] leading-[1.5]",
                    row.change === "removed" && "text-ink-4 line-through",
                    row.change === "added" && "font-semibold text-ink-1",
                    row.change === "same" && "text-ink-2",
                  )}
                >
                  <span
                    aria-hidden
                    className="mt-[8px] size-[6px] shrink-0 rounded-full"
                    style={{
                      background:
                        row.change === "added"
                          ? "var(--positive)"
                          : row.change === "removed"
                            ? "var(--critical)"
                            : "var(--line-strong)",
                    }}
                  />
                  <span>
                    <span className="sr-only">
                      {row.change === "added"
                        ? t("specialists.panel.srNew")
                        : row.change === "removed"
                          ? t("specialists.panel.srRemoved")
                          : ""}
                    </span>
                    {row.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {onUndo && diffs.length > 0 && (
        <div className="border-t border-line px-4 py-2">
          <button
            type="button"
            onClick={onUndo}
            className="h-[30px] cursor-pointer rounded-pill border-0 bg-transparent px-2.5 font-[inherit] text-meta font-medium text-ink-3 hover:bg-hover"
          >
            {t("specialists.panel.undo")}
          </button>
        </div>
      )}
    </div>
  );
}

function LinesField({
  label,
  hint,
  value,
  onChange,
  disabled,
  rows = 3,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-meta text-ink-3">
        {label}
        {hint && <span className="text-ink-4"> · {hint}</span>}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        disabled={disabled}
        className={cn(textareaClass, "min-h-0 text-[14px]")}
      />
    </label>
  );
}

// ─── Tilpas a standard specialist ───────────────────────────────────────────────────────────

const MODULE_FIELDS = ["mandate", "evidenceTests", "riskAreas"] as const;

type StandardTilpasProps = {
  fundId: string;
  configId: string;
  module: SpecialistModuleInfo;
  override: ModuleText | null;
  editable: boolean;
  onClose: () => void;
  onDone: () => void;
  onBusyChange: (busy: boolean) => void;
  onUnsavedChange: (unsaved: boolean) => void;
};

// The standard text is prompt text, so it is fetched from the server (Admin and Lead get it, the
// others empty lists, as with the fund's own texts) instead of being bundled with the page.
function StandardTilpas(props: StandardTilpasProps) {
  const t = useT();
  const load = useServerFn(loadStandardModuleText);
  const standard = useQuery({
    queryKey: ["standard-module-text", props.fundId, props.module.id],
    queryFn: () => load({ data: { fundId: props.fundId, moduleId: props.module.id } }),
    staleTime: Infinity,
  });
  if (standard.isPending)
    return <p className="m-0 text-list text-ink-3">{t("specialists.panel.textLoading")}</p>;
  if (standard.isError)
    return (
      <p role="alert" className="m-0 rounded-md bg-critical-wash px-4 py-3 text-list">
        {t("specialists.panel.textLoadFailed")}
      </p>
    );
  // Only Admin and Lead get the text; the others are told why the fields are empty.
  const hidden = standard.data.mandate.length === 0;
  return (
    <>
      {hidden && (
        <p className="m-0 mb-3 text-list text-ink-2">{t("specialists.panel.textHidden")}</p>
      )}
      <StandardTilpasEditor {...props} standard={standard.data} />
    </>
  );
}

function StandardTilpasEditor({
  fundId,
  configId,
  module,
  override,
  standard,
  editable,
  onClose,
  onDone,
  onBusyChange,
  onUnsavedChange,
}: {
  fundId: string;
  configId: string;
  module: SpecialistModuleInfo;
  override: ModuleText | null;
  /** The standard specialist's own text, from the server. */
  standard: ModuleText;
  editable: boolean;
  /** Close as the user asks (the list asks first when something is unsaved). */
  onClose: () => void;
  /** Close after the text was saved or set back. */
  onDone: () => void;
  onBusyChange: (busy: boolean) => void;
  onUnsavedChange: (unsaved: boolean) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const propose = useServerFn(proposeModulePromptOverride);
  const save = useServerFn(saveModulePromptOverride);
  const reset = useServerFn(resetModulePromptOverride);
  const saved: ModuleText = override ?? standard;
  const toTexts = (text: ModuleText) => ({
    mandate: text.mandate.join("\n"),
    evidenceTests: text.evidenceTests.join("\n"),
    riskAreas: text.riskAreas.join("\n"),
  });
  const [texts, setTexts] = useState(() => toTexts(saved));
  const [ask, setAsk] = useState("");
  const [revision, setRevision] = useState<{
    before: ReturnType<typeof toTexts>;
    diffs: FieldDiff[];
  } | null>(null);
  const current: ModuleText = {
    mandate: linesOf(texts.mandate),
    evidenceTests: linesOf(texts.evidenceTests),
    riskAreas: linesOf(texts.riskAreas),
  };
  const problems = moduleTextProblems(current, language);
  const changed = JSON.stringify(current) !== JSON.stringify(saved);
  const report = useRef(onUnsavedChange);
  report.current = onUnsavedChange;
  useEffect(() => report.current(changed || ask.trim() !== ""), [changed, ask]);
  useEffect(() => () => report.current(false), []);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["fund-config", fundId] });
  // The proposal rewrites the text in the editor (also the user's own edits), so before/after
  // shows exactly what Interlect changed and "Fortryd rettelsen" brings that text back.
  const proposal = useMutation({
    mutationFn: (input: { instructions: string; current: ModuleText }) =>
      propose({
        data: {
          fundId,
          configId,
          moduleId: module.id,
          instructions: input.instructions,
          current: input.current,
        },
      }),
    onSuccess: (next, input) => {
      setRevision({
        before: texts,
        diffs: fieldDiffs(input.current, next, moduleDiffLabels(language)),
      });
      setTexts(toTexts(next));
      setAsk("");
    },
    onError: (cause) =>
      showToast({
        message: errorText(cause, t("specialists.panel.proposalFailed"), language),
        tone: "error",
      }),
  });
  const saveMutation = useMutation({
    mutationFn: () => save({ data: { fundId, configId, moduleId: module.id, ...current } }),
    onSuccess: async () => {
      await refresh();
      showToast({ message: t("specialists.panel.savedDraft") });
      onDone();
    },
    onError: (cause) =>
      showToast({
        message: errorText(cause, t("specialists.panel.textSaveFailed"), language),
        tone: "error",
      }),
  });
  const resetMutation = useMutation({
    mutationFn: () => reset({ data: { fundId, configId, moduleId: module.id } }),
    onSuccess: async () => {
      await refresh();
      showToast({ message: t("specialists.panel.resetDone") });
      onDone();
    },
    onError: (cause) =>
      showToast({
        message: errorText(cause, t("specialists.panel.resetFailed"), language),
        tone: "error",
      }),
  });
  const busy = proposal.isPending || saveMutation.isPending || resetMutation.isPending;
  const reportBusy = useRef(onBusyChange);
  reportBusy.current = onBusyChange;
  useEffect(() => reportBusy.current(busy), [busy]);
  useEffect(() => () => reportBusy.current(false), []);
  const card = standardSpecialistCardIn(module.id, language);

  return (
    <PanelFrame
      kind={specialistKind(module.id)}
      title={t("specialists.panel.tailorTitle", { name: card.label })}
      sub={override ? t("specialists.panel.subCustomized") : t("specialists.panel.subStandard")}
      aiBusy={proposal.isPending}
      busy={busy}
      onClose={onClose}
    >
      {editable && (
        <AskPill
          value={ask}
          onChange={setAsk}
          onSend={() => proposal.mutate({ instructions: ask.trim(), current })}
          disabled={busy || problems.length > 0}
          placeholder={t("specialists.panel.askPlaceholder", { name: card.label })}
        />
      )}
      {proposal.isPending && (
        <ComposerStatus>{t("specialists.panel.rewriting", { name: card.label })}</ComposerStatus>
      )}
      {revision && !proposal.isPending && (
        <BeforeAfter
          diffs={revision.diffs}
          onUndo={() => {
            setTexts(revision.before);
            setRevision(null);
          }}
        />
      )}
      <div className="flex flex-col gap-3">
        {MODULE_FIELDS.map((field) => (
          <LinesField
            key={field}
            label={t(`specialists.cards.module.${field}`)}
            hint={t("specialists.panel.perLine")}
            value={texts[field]}
            onChange={(next) => setTexts((previous) => ({ ...previous, [field]: next }))}
            disabled={!editable || busy}
            rows={field === "riskAreas" ? 3 : 4}
          />
        ))}
      </div>
      {editable && problems.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 rounded-md bg-canvas px-4 py-3 text-meta text-ink-2">
          <li className="font-medium text-ink-1">{t("specialists.panel.beforeSaveText")}</li>
          {problems.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={() => saveMutation.mutate()}
            disabled={busy || !changed || problems.length > 0}
            pending={saveMutation.isPending}
            pendingLabel={t("specialists.panel.saving")}
          >
            {t("specialists.panel.saveDraft")}
          </Button>
          <Button variant="quiet" size="md" onClick={onClose} disabled={busy}>
            {t("specialists.panel.cancel")}
          </Button>
          {override && (
            <Button
              variant="danger"
              size="md"
              className="ml-auto"
              onClick={() => resetMutation.mutate()}
              disabled={busy}
              pending={resetMutation.isPending}
              pendingLabel={t("specialists.panel.resetting")}
            >
              {t("specialists.panel.reset")}
            </Button>
          )}
        </div>
      )}
    </PanelFrame>
  );
}

// ─── The fund's own specialist ──────────────────────────────────────────────────────────────

/** Three steps, no trial run on the screen in 1.0. */
const FLOW_STEPS = [
  "specialists.panel.stepDescribe",
  "specialists.panel.stepEdit",
  "specialists.panel.stepActivate",
] as const;
/** How long the user must pause typing before the automatic quality check runs (a paid call). */
const CHECK_PAUSE_MS = 4000;

type ListKey = "mandate" | "evidenceTests" | "riskAreas" | "questions" | "deliverables";
type Form = Pick<CustomSpecialistInput, "name" | "purpose" | "categories"> &
  Record<ListKey, string>;

const LIST_FIELDS: Array<{ key: ListKey; label: MessageKey; hint: MessageKey; rows: number }> = [
  {
    key: "mandate",
    label: "specialists.cards.diff.mandate",
    hint: "specialists.panel.hintMandate",
    rows: 4,
  },
  {
    key: "evidenceTests",
    label: "specialists.cards.diff.evidenceTests",
    hint: "specialists.panel.hintEvidenceTests",
    rows: 4,
  },
  {
    key: "riskAreas",
    label: "specialists.cards.diff.riskAreas",
    hint: "specialists.panel.hintRiskAreas",
    rows: 3,
  },
  {
    key: "questions",
    label: "specialists.cards.diff.questions",
    hint: "specialists.panel.hintQuestions",
    rows: 3,
  },
  {
    key: "deliverables",
    label: "specialists.cards.diff.deliverables",
    hint: "specialists.panel.hintDeliverables",
    rows: 2,
  },
];

function toForm(specialist: CustomSpecialistInput): Form {
  return {
    name: specialist.name,
    purpose: specialist.purpose,
    categories: [...specialist.categories],
    mandate: specialist.mandate.join("\n"),
    evidenceTests: specialist.evidenceTests.join("\n"),
    riskAreas: specialist.riskAreas.join("\n"),
    questions: specialist.questions.join("\n"),
    deliverables: specialist.deliverables.join("\n"),
  };
}

function fromForm(form: Form): CustomSpecialistInput {
  return cleanSpecialist({
    name: form.name,
    purpose: form.purpose,
    categories: SCORE_CATEGORIES.filter((category) => form.categories.includes(category)),
    mandate: linesOf(form.mandate),
    evidenceTests: linesOf(form.evidenceTests),
    riskAreas: linesOf(form.riskAreas),
    questions: linesOf(form.questions),
    deliverables: linesOf(form.deliverables),
  });
}

function FlowSteps({ done, current }: { done: number; current: number }) {
  const t = useT();
  return (
    <ol
      aria-label={t("specialists.panel.steps")}
      className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0"
    >
      {FLOW_STEPS.map((labelKey, index) => {
        const finished = index < done;
        const here = index === current;
        return (
          <li key={labelKey} className="flex items-center gap-1.5">
            {index > 0 && <span aria-hidden className="h-px w-3 bg-line-strong" />}
            <span
              aria-current={here ? "step" : undefined}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-meta font-medium",
                here ? "bg-inverse text-ink-inverse" : finished ? "text-ink-1" : "text-ink-4",
              )}
            >
              {finished && !here && <Check className="size-3 text-positive" strokeWidth={2.5} />}
              {t(labelKey)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CustomSpecialistFlow({
  fundId,
  configId,
  view,
  existing,
  kind,
  activeOwn,
  owners,
  onClose,
  onSaved,
  onBusyChange,
  onUnsavedChange,
}: {
  fundId: string;
  configId: string;
  view: FundSpecialistsView;
  existing: CustomItem | null;
  kind: SpecialistKind;
  /** Active own specialists in the draft now. */
  activeOwn: number;
  /** The active standard specialist that owns a score area (its own areas only). */
  owners: ReadonlyMap<ScoreCategory, string>;
  onClose: () => void;
  onSaved: (view: FundSpecialistsView) => void;
  onBusyChange: (busy: boolean) => void;
  onUnsavedChange: (unsaved: boolean) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const draft = useServerFn(draftCustomSpecialist);
  const check = useServerFn(checkCustomSpecialist);
  const save = useServerFn(saveCustomSpecialist);
  const remove = useServerFn(deleteCustomSpecialist);
  const editable = view.editable;
  const key = existing?.key;
  const savedSpecialist = useMemo(() => (existing ? cleanSpecialist(existing) : null), [existing]);

  const [stage, setStage] = useState<"describe" | "edit">(existing ? "edit" : "describe");
  const [description, setDescription] = useState("");
  const [form, setForm] = useState<Form>(() => toForm(savedSpecialist ?? emptySpecialist()));
  const [drafted, setDrafted] = useState(Boolean(existing));
  const [revise, setRevise] = useState("");
  const [revision, setRevision] = useState<{ before: Form; diffs: FieldDiff[] } | null>(null);
  const [checked, setChecked] = useState<{
    result: SpecialistCheckView;
    snapshot: string;
    /** Issues whose suggestion is laid in (by their place in the list). */
    applied: number[];
  } | null>(null);
  /** The text an automatic check failed on (not retried until the text changes) and why. */
  const [checkFailed, setCheckFailed] = useState<{ snapshot: string; message: string } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const specialist = fromForm(form);
  const snapshot = JSON.stringify(specialist);
  const problems = specialistFormProblems(specialist, language);
  const changed = savedSpecialist
    ? snapshot !== JSON.stringify(savedSpecialist)
    : drafted || description.trim() !== "" || snapshot !== JSON.stringify(emptySpecialist());
  const report = useRef(onUnsavedChange);
  report.current = onUnsavedChange;
  useEffect(() => report.current(changed), [changed]);
  useEffect(() => () => report.current(false), []);

  const fail = (fallback: string) => (cause: unknown) =>
    showToast({ message: errorText(cause, fallback, language), tone: "error", duration: 6000 });
  const draftMutation = useMutation({
    mutationFn: (input: { description: string; current: CustomSpecialistInput | null }) =>
      draft({
        data: {
          fundId,
          configId,
          ...(key ? { key } : {}),
          description: input.description,
          ...(input.current ? { current: input.current } : {}),
        },
      }),
    onSuccess: (next, input) => {
      if (input.current) {
        setRevision({ before: form, diffs: customSpecialistDiffs(input.current, next, language) });
        setRevise("");
      } else {
        setStage("edit");
        setDrafted(true);
      }
      setForm(toForm(next));
    },
    onError: fail(t("specialists.panel.draftFailed")),
  });
  const checkMutation = useMutation({
    mutationFn: (input: CustomSpecialistInput) =>
      check({ data: { fundId, configId, ...(key ? { key } : {}), specialist: input } }),
    onSuccess: (result, input) => {
      setChecked({ result, snapshot: JSON.stringify(input), applied: [] });
      setCheckFailed(null);
    },
    // The check runs by itself; a failure is a quiet line, and it is not retried for this text.
    onError: (cause, input) =>
      setCheckFailed({
        snapshot: JSON.stringify(input),
        message: errorText(cause, t("specialists.panel.checkFailedFallback"), language),
      }),
  });
  const saveMutation = useMutation({
    mutationFn: (input: CustomSpecialistInput) =>
      save({ data: { fundId, configId, ...(key ? { key } : {}), specialist: input } }),
    onSuccess: (next, input) => {
      // A new one is saved switched off when the limit on active own specialists is reached.
      const added = next.custom.find((item) => !view.custom.some((old) => old.key === item.key));
      showToast({
        message:
          added && !added.enabled
            ? t("specialists.panel.savedOff", { name: input.name })
            : t("specialists.panel.savedOwn", { name: input.name }),
        duration: 6000,
      });
      onSaved(next);
    },
    onError: fail(t("specialists.panel.ownSaveFailed")),
  });
  const deleteMutation = useMutation({
    mutationFn: () => remove({ data: { fundId, configId, key: key! } }),
    onSuccess: (next) => {
      showToast({
        message: t("specialists.panel.removed", {
          name: existing?.name ?? t("specialists.panel.theSpecialist"),
        }),
      });
      setConfirmDelete(false);
      onSaved(next);
    },
    onError: fail(t("specialists.panel.deleteFailed")),
  });
  // The automatic check is advice: it never holds the fields, the save or the panel.
  const busy = draftMutation.isPending || saveMutation.isPending || deleteMutation.isPending;
  const aiBusy = draftMutation.isPending;
  const reportBusy = useRef(onBusyChange);
  reportBusy.current = onBusyChange;
  useEffect(() => reportBusy.current(busy), [busy]);
  useEffect(() => () => reportBusy.current(false), []);
  const ready = problems.length === 0;
  // A new one is saved switched off when the installation's limit on active own ones is reached.
  const willBeOff = !existing && activeOwn >= view.maxCustom;
  const patch = (next: Partial<Form>) => setForm((previous) => ({ ...previous, ...next }));
  const doneSteps = stage === "describe" ? 0 : 1;
  const currentStep = stage === "describe" ? 0 : 1;

  // The quality check runs by itself when the draft has changed and the user has paused,
  // once per text (each check is a paid call); an unchanged saved specialist is not checked.
  const unchangedSaved = savedSpecialist !== null && snapshot === JSON.stringify(savedSpecialist);
  const runCheck = useRef(checkMutation.mutate);
  runCheck.current = checkMutation.mutate;
  const checkDue =
    editable &&
    stage === "edit" &&
    ready &&
    !busy &&
    !checkMutation.isPending &&
    !unchangedSaved &&
    snapshot !== checked?.snapshot &&
    snapshot !== checkFailed?.snapshot;
  useEffect(() => {
    if (!checkDue) return;
    const timer = setTimeout(
      () => runCheck.current(JSON.parse(snapshot) as CustomSpecialistInput),
      CHECK_PAUSE_MS,
    );
    return () => clearTimeout(timer);
  }, [checkDue, snapshot]);

  return (
    <PanelFrame
      kind={kind}
      title={
        existing
          ? t("specialists.panel.tailorTitle", { name: existing.name })
          : t("specialists.panel.newTitle")
      }
      sub={
        existing
          ? existing.enabled
            ? t("specialists.panel.subActive")
            : t("specialists.panel.subOff")
          : t("specialists.panel.subNew")
      }
      aiBusy={aiBusy}
      busy={busy}
      onClose={onClose}
    >
      <FlowSteps done={doneSteps} current={currentStep} />

      {stage === "describe" ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-meta text-ink-3">{t("specialists.panel.describeLabel")}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, 2000))}
              rows={4}
              disabled={busy}
              placeholder={t("specialists.panel.describePlaceholder")}
              className={cn(textareaClass, "min-h-0")}
            />
          </label>
          {draftMutation.isPending && (
            <ComposerStatus>{t("specialists.panel.drafting")}</ComposerStatus>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={() =>
                draftMutation.mutate({ description: description.trim(), current: null })
              }
              disabled={busy || description.trim().length < 10}
              pending={draftMutation.isPending ? "ai" : false}
              pendingLabel={t("specialists.panel.draftingPending")}
            >
              {t("specialists.panel.makeDraft")}
            </Button>
            <Button variant="quiet" size="md" onClick={() => setStage("edit")} disabled={busy}>
              {t("specialists.panel.writeOwn")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {editable && (
            <div className="flex flex-col gap-2.5">
              <AskPill
                value={revise}
                onChange={setRevise}
                onSend={() =>
                  draftMutation.mutate({ description: revise.trim(), current: specialist })
                }
                disabled={busy || !ready}
                minLength={10}
                placeholder={t("specialists.panel.revisePlaceholder")}
              />
              {draftMutation.isPending && (
                <ComposerStatus>{t("specialists.panel.revising")}</ComposerStatus>
              )}
              {revision && !draftMutation.isPending && (
                <BeforeAfter
                  diffs={revision.diffs}
                  onUndo={() => {
                    setForm(revision.before);
                    setRevision(null);
                  }}
                />
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-meta text-ink-3">{t("specialists.cards.diff.name")}</span>
              <input
                value={form.name}
                onChange={(event) => patch({ name: event.target.value.slice(0, 80) })}
                disabled={!editable || busy}
                className={fieldClass}
              />
            </label>
            <LinesField
              label={t("specialists.cards.diff.purpose")}
              value={form.purpose}
              onChange={(purpose) => patch({ purpose: purpose.slice(0, 600) })}
              disabled={!editable || busy}
              rows={2}
            />
            {LIST_FIELDS.map((field) => (
              <LinesField
                key={field.key}
                label={t(field.label)}
                hint={t("specialists.panel.listHint", { hint: t(field.hint) })}
                value={form[field.key]}
                onChange={(next) => patch({ [field.key]: next } as Partial<Form>)}
                disabled={!editable || busy}
                rows={field.rows}
              />
            ))}
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1.5 p-0 text-meta text-ink-3">
                {t("specialists.panel.areasLegend")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {SCORE_CATEGORIES.map((category) => {
                  const on = form.categories.includes(category);
                  const owner = owners.get(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={on}
                      disabled={!editable || busy}
                      onClick={() =>
                        patch({
                          categories: on
                            ? form.categories.filter((item) => item !== category)
                            : [...form.categories, category],
                        })
                      }
                      className={cn(
                        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-pill border-0 px-3 font-[inherit] text-meta font-medium transition-colors disabled:cursor-default",
                        on
                          ? "bg-inverse text-ink-inverse"
                          : "bg-surface text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)]",
                      )}
                    >
                      {scoreCategoryLabelIn(category, language) ?? category}
                      {owner && <span className={on ? "opacity-70" : "text-ink-4"}>· {owner}</span>}
                    </button>
                  );
                })}
              </div>
              <p className="m-0 text-meta text-ink-3">{t("specialists.panel.areasHelp")}</p>
            </fieldset>
          </div>

          {editable && problems.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 rounded-md bg-canvas px-4 py-3 text-meta text-ink-2">
              <li className="font-medium text-ink-1">{t("specialists.panel.beforeCheck")}</li>
              {problems.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          {editable && (
            <CheckSection
              checked={checked}
              stale={checked !== null && checked.snapshot !== snapshot}
              failed={checkFailed?.snapshot === snapshot ? checkFailed.message : null}
              busy={busy}
              actionFor={(issue) => issueAction(specialist, issue)}
              onAction={(index, action) => {
                const next = fromForm(toForm(action.next));
                setForm(toForm(next));
                // Replacing a point keeps the others' places, so the check still fits; removing
                // one moves the points after it, so the check is then out of date.
                setChecked((previous) =>
                  previous && action.label === "Brug forslaget"
                    ? {
                        ...previous,
                        snapshot: JSON.stringify(next),
                        applied: [...previous.applied, index],
                      }
                    : previous,
                );
              }}
            />
          )}

          {editable && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => saveMutation.mutate(specialist)}
                  disabled={busy || !ready || (existing !== null && !changed)}
                  pending={saveMutation.isPending}
                  pendingLabel={t("specialists.panel.saving")}
                >
                  {existing
                    ? t("specialists.panel.saveChanges")
                    : willBeOff
                      ? t("specialists.panel.saveOff")
                      : t("specialists.panel.activate")}
                </Button>
                <Button variant="quiet" size="md" onClick={onClose} disabled={busy}>
                  {t("specialists.panel.cancel")}
                </Button>
                {existing && (
                  <Button
                    variant="danger"
                    size="md"
                    className="ml-auto"
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                  >
                    {t("specialists.panel.delete")}
                  </Button>
                )}
              </div>
              <p className="m-0 text-meta text-ink-3">
                {willBeOff
                  ? t("specialists.panel.limitNote", { active: activeOwn, max: view.maxCustom })
                  : t("specialists.panel.savedNote")}
              </p>
            </div>
          )}
        </>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("specialists.panel.deleteTitle", { name: existing?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("specialists.panel.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t("specialists.panel.keep")}
            </AlertDialogCancel>
            <Button
              variant="primary"
              size="md"
              onClick={() => deleteMutation.mutate()}
              pending={deleteMutation.isPending}
              pendingLabel={t("specialists.panel.deleting")}
            >
              {t("specialists.panel.deleteConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PanelFrame>
  );
}

/**
 * The quality check's findings: shown only when the automatic check found something, with
 * the model's better wording laid in by one click and a repeated point removed.
 */
function CheckSection({
  checked,
  stale,
  failed,
  busy,
  actionFor,
  onAction,
}: {
  checked: { result: SpecialistCheckView; applied: number[] } | null;
  stale: boolean;
  /** Why the check could not run on the current text, if it failed. */
  failed: string | null;
  /** A call is running: nothing is laid into the editor meanwhile. */
  busy: boolean;
  actionFor: (issue: SpecialistCheckView["issues"][number]) => IssueAction | null;
  onAction: (index: number, action: IssueAction) => void;
}) {
  const t = useT();
  const language = useLanguage();
  if (failed) {
    return (
      <p className="m-0 text-meta text-ink-3">
        {t("specialists.panel.checkFailed", { message: failed })}
      </p>
    );
  }
  const result = checked?.result;
  if (!result || result.issues.length === 0) return null;
  const toFix = result.issues.filter((issue) => issue.severity === "fix").length;
  return (
    <section
      aria-label={t("specialists.panel.checkTitle")}
      className="flex flex-col gap-2 rounded-md bg-canvas p-4"
    >
      <p className="m-0 flex items-center gap-2 text-list font-medium text-ink-1">
        <InterlectMark size={12} />
        {toFix === 0
          ? t("specialists.panel.lookedAt")
          : toFix === 1
            ? t("specialists.panel.fixOne")
            : t("specialists.panel.fixMany", { count: toFix })}
      </p>
      <p className="m-0 text-meta text-ink-3">
        {result.assessedAreas.length
          ? t("specialists.panel.assessed", { areas: areaList(result.assessedAreas, language) })
          : t("specialists.panel.assessedNone")}
        {!result.aiChecked && t("specialists.panel.aiNoAnswer")}
        {stale && t("specialists.panel.stale")}
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {result.issues.map((issue, index) => (
          <li
            key={`${issue.field}-${issue.index ?? "x"}-${index}`}
            className="flex flex-col gap-1 rounded-md bg-surface px-3.5 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <span className="flex items-center gap-2 text-meta text-ink-3">
              <span
                aria-hidden
                className="size-[7px] shrink-0 rounded-full"
                style={{
                  background: issue.severity === "fix" ? "var(--warning)" : "var(--line-strong)",
                }}
              />
              {assistFieldLabel(issue.field, language)}
              {issue.index !== null && t("specialists.panel.point", { number: issue.index + 1 })}
            </span>
            <span className="text-list text-ink-1">{issue.message}</span>
            {issue.suggestion && (
              <span className="text-list text-ink-2">
                <span className="font-medium">
                  {issue.source === "ai"
                    ? t("specialists.panel.suggestion")
                    : t("specialists.panel.advice")}
                </span>{" "}
                {issue.suggestion}
              </span>
            )}
            <IssueButton
              applied={checked!.applied.includes(index)}
              action={stale ? null : actionFor(issue)}
              disabled={busy}
              onClick={(action) => onAction(index, action)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function IssueButton({
  applied,
  action,
  disabled,
  onClick,
}: {
  applied: boolean;
  action: IssueAction | null;
  disabled: boolean;
  onClick: (action: IssueAction) => void;
}) {
  const t = useT();
  const language = useLanguage();
  if (applied) {
    return (
      <span className="flex items-center gap-1.5 text-meta font-medium text-positive">
        <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
        {t("specialists.panel.used")}
      </span>
    );
  }
  if (!action) return null;
  return (
    <button
      type="button"
      onClick={() => onClick(action)}
      disabled={disabled}
      className="h-7 cursor-pointer self-start rounded-pill border-0 bg-transparent px-2.5 font-[inherit] text-meta font-medium text-action hover:bg-action-wash disabled:cursor-default disabled:opacity-40"
    >
      {issueActionLabel(action, language)}
    </button>
  );
}
