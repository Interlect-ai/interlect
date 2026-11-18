/**
 * One row of "Skal afklares" (Case Screening v5 and Case Dyb analyse v5; v0.3, v0.4, "Ro på
 * overfladen" and "Dyb analyse v5": the same list in screening and deep analysis).
 *
 * Open row, measured in the prototype:
 * - Grid 34 px | 1fr | auto | 30 px, gap 14, min height 66, padding 10 12 10 16 (below 640 px:
 *   gap 10, padding 10 8 10 12, so the title keeps room at 390 px). The list (TaskList) draws
 *   the hairlines between rows.
 * - Tile 34 px, radius 10: the source colour (gate/criterion) at 14 % with the kind's 15 px
 *   icon in the source colour. AI task (Interlect is the assignee): the AiOrb (20, "ai") on
 *   --ai-wash; the prototype's orbit dots are a placeholder.
 * - Title 15/500 with "Fra dyb analyse" (11/500 --ai-ink, gap 8) for tasks the deep analysis
 *   wrote; below it "Ansvarlig, frist" in 12 px ink-3 ("Dig" for the signed-in user).
 * - "Udfyld": secondary pill 32 px, 14 px sides, 12/500. With the editor open it reads "Luk"
 *   without surface in ink-3. AI tasks have no "Udfyld".
 * - "…": a round 30 px button at 30 % opacity, full on row hover, on keyboard focus and while
 *   open. Menu (min 240 px, 34 px rows): Redigér opgave (title inline: 32 px field with a
 *   1.5 px --action ring, Gem/Annullér, Enter/Esc), Skift ansvarlig (the menu turns into the
 *   team list: "Ansvarlig", 40 px rows with a 24 px tile, name, description and a violet
 *   check), Slet opgave (critical, critical-wash hover; toast "Opgave slettet" + "Fortryd"
 *   for 5 s). v0.3 names the first item "Redigér opgave" (the prototype: "Omdøb").
 * - A click on the row folds it out (row background → canvas over 360 ms): description
 *   15/1.6, "Hvorfor" (12/600 ink-3 over 14/1.55 ink-2), the properties Type, Ansvarlig,
 *   Frist and Knyttet til (auto-fill grid, min 150 px: 11 px key over a 13 px value with a
 *   13 px icon), and the "Svar" box (canvas, radius md, 16 px) with the editor for the answer
 *   kind and "Gem svar" / "Luk". Padding 2 20 22 64 (16 px left on phones), gap 18, text at
 *   most 620 px. AI tasks show "Interlect arbejder på det …" on --ai-wash instead.
 * Resolved row (compact): 40 px ("Løst fylder mindre"; the prototype measures 42),
 *   grid 24 | 1fr | auto, gap 14, padding 0 12, radius sm with a hover tint; an 18 px green
 *   circle with a white check that draws in, title 13 px ink-2, value 12 px ink-4 (ellipsis),
 *   "Redigér" 28 px in --action with an action-wash hover.
 * Motion: the fold-out is `Collapse` (smooth spring, content 60 ms later from y 6). A task that
 * was just answered (`resolving`) fills its tile green and draws the check (260 ms ease-out);
 * TaskList collapses the row 900 ms later ("Checkbox og løs task").
 *
 * Presentational: every change goes out through a callback; nothing is fetched here. A
 * callback may return a promise; if it rejects, the page has to tell the user what went wrong
 * (e.g. showToast with tone "error"), and the editor stays open with the draft.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Calendar,
  Check,
  Circle,
  Ellipsis,
  FileUp,
  Pencil,
  Sparkles,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { DrawnCheck } from "@/components/ds/MandatfitCircles";
import { GateAnswerEditor } from "@/components/ds/GateAnswerEditor";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ds/Menu";
import { showToast } from "@/components/ds/Toast";
import {
  TASK_KIND_ICON,
  TASK_UNLINKED_COLOR,
  formatDueLabel,
  formatTaskAnswer,
  interlectDescription,
  isAiTask,
  taskKindLabel,
  taskTint,
  taskUnlinkedLabel,
  type TaskAnswerInput,
  type TaskItem,
  type TaskPerson,
} from "@/components/ds/task-types";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

type MaybePromise = void | Promise<unknown>;

/**
 * Fire-and-forget for a row action: the page's hook has already shown the failure as a toast
 * before it rethrows, so the rejection is swallowed here instead of becoming an unhandled one.
 */
function settle(action: () => MaybePromise): void {
  try {
    void Promise.resolve(action()).catch(() => undefined);
  } catch {
    // A synchronous throw is reported by the page too.
  }
}

export interface TaskRowProps {
  task: TaskItem;
  /**
   * `resolved` is the compact 40 px line. Defaults to the task's status; a resolved task that
   * is being edited again is shown as `open`.
   */
  variant?: "open" | "resolved" | undefined;
  /** Controlled fold-out; leave out to let the row keep its own state. */
  expanded?: boolean | undefined;
  onExpandedChange?: ((expanded: boolean) => void) | undefined;
  /** Choices for "Skift ansvarlig" (add Interlect to let it take the task). */
  people?: readonly TaskPerson[] | undefined;
  /** Saves the answer ("Gem svar"). Without it the row has no "Udfyld" and no editor. */
  onAnswer?: ((answer: TaskAnswerInput) => MaybePromise) | undefined;
  /** The answer is being saved elsewhere: "Gem svar" shows the orb. */
  answerPending?: boolean | undefined;
  /** "Redigér opgave": the new title (trimmed, changed). */
  onRename?: ((title: string) => MaybePromise) | undefined;
  /** "Skift ansvarlig": the chosen person. Choosing a person on an AI task takes it over. */
  onReassign?: ((person: TaskPerson) => MaybePromise) | undefined;
  /** "Slet opgave". The toast with "Fortryd" follows once it has succeeded. */
  onDelete?: (() => MaybePromise) | undefined;
  /** "Fortryd" in the delete toast. */
  onRestore?: (() => MaybePromise) | undefined;
  /** "Redigér" on a resolved row. */
  onEdit?: (() => void) | undefined;
  /** Just answered: the tile turns green and the check draws in. */
  resolving?: boolean | undefined;
  className?: string | undefined;
}

export function TaskRow(props: TaskRowProps) {
  const variant = props.variant ?? (props.task.status === "resolved" ? "resolved" : "open");
  return variant === "resolved" ? <ResolvedTaskRow {...props} /> : <OpenTaskRow {...props} />;
}

// ---------------------------------------------------------------------------
// Choice rows (the "Ansvarlig" menu here and the composer's lists)
// ---------------------------------------------------------------------------

/**
 * The inside of a 40 px choice row: a 24 px tile (radius 7), the label with an optional
 * 11 px ink-4 description, and a 13 px violet check on the right when selected.
 */
export function TaskChoiceContent({
  label,
  description,
  icon: Icon,
  tileBackground,
  tileColor,
  selected,
}: {
  label: ReactNode;
  description?: ReactNode | undefined;
  icon?: LucideIcon | undefined;
  /** Tile colours as tokens, e.g. "var(--bg-sunken)". */
  tileBackground: string;
  tileColor: string;
  selected: boolean;
}) {
  const t = useT();
  return (
    <span className="flex w-full min-w-0 items-center gap-2.5">
      <span
        className="grid size-6 shrink-0 place-items-center rounded-[7px]"
        style={{ background: tileBackground, color: tileColor }}
      >
        {Icon && <Icon className="size-3" strokeWidth={1.75} aria-hidden />}
      </span>
      <span className="flex min-w-0 flex-col leading-[1.2]">
        <span className="truncate">{label}</span>
        {description && <span className="truncate text-micro text-ink-4">{description}</span>}
      </span>
      <Check
        className="ml-auto size-[13px] shrink-0 text-action"
        style={{ opacity: selected ? 1 : 0 }}
        strokeWidth={2}
        aria-hidden
      />
      {selected && <span className="sr-only">{t("tasks.selected")}</span>}
    </span>
  );
}

/** Tile and texts for a person in a choice list (prototype teamItems). */
export function TaskPersonChoice({ person, selected }: { person: TaskPerson; selected: boolean }) {
  const language = useLanguage();
  const ai = person.isInterlect === true;
  return (
    <TaskChoiceContent
      label={person.name}
      description={person.description ?? (ai ? interlectDescription(language) : undefined)}
      icon={ai ? Sparkles : UserRound}
      tileBackground={ai ? "var(--ai-wash)" : "var(--bg-sunken)"}
      tileColor={ai ? "var(--ai)" : "var(--ink-3)"}
      selected={selected}
    />
  );
}

// ---------------------------------------------------------------------------
// Open row
// ---------------------------------------------------------------------------

/** Clicks from these elements are their own action, not a fold-out toggle. */
const INTERACTIVE = "button, a, input, textarea, select, label";

function OpenTaskRow({
  task,
  expanded,
  onExpandedChange,
  people = [],
  onAnswer,
  answerPending = false,
  onRename,
  onReassign,
  onDelete,
  onRestore,
  resolving = false,
  className,
}: TaskRowProps) {
  const t = useT();
  const language = useLanguage();
  const panelId = `${useId()}-svar`;
  const headerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** Set when a pointer-down on this row closed the menu: that click must not fold the row. */
  const swallowClickRef = useRef(false);
  /** "Skift ansvarlig" keeps the menu open and swaps its content. */
  const keepMenuOpenRef = useRef(false);
  const titleEditingRef = useRef(false);

  const [ownExpanded, setOwnExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<"main" | "people">("main");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [saving, setSaving] = useState(false);

  const isExpanded = expanded ?? ownExpanded;
  const setExpanded = (next: boolean) => {
    if (expanded === undefined) setOwnExpanded(next);
    onExpandedChange?.(next);
  };
  const toggle = () => setExpanded(!isExpanded);

  /** True (and reset) when this click only closed the menu. */
  const closedMenuOnly = () => {
    if (menuOpen) {
      // Touch: Radix closes the menu after the click, so close it here instead of folding.
      setMenuOpen(false);
      return true;
    }
    if (!swallowClickRef.current) return false;
    swallowClickRef.current = false;
    return true;
  };
  const onToggleClick = () => {
    if (!closedMenuOnly()) toggle();
  };

  const ai = isAiTask(task);
  const canAnswer = !ai && onAnswer !== undefined;
  const canReassign = onReassign !== undefined && people.length > 0;
  const hasMenu = onRename !== undefined || canReassign || onDelete !== undefined;
  const kindLabel = taskKindLabel(task.kind, language);
  const KindIcon = TASK_KIND_ICON[task.kind];
  const color = task.link?.color ?? TASK_UNLINKED_COLOR;
  const due = formatDueLabel(task.dueOn, language);
  const assigneeShort = task.assignee
    ? task.assignee.isMe
      ? t("tasks.me")
      : task.assignee.name
    : null;
  const subline = [assigneeShort, due].filter(Boolean).join(", ");

  useEffect(() => {
    titleEditingRef.current = titleEditing;
    if (titleEditing) titleInputRef.current?.focus();
  }, [titleEditing]);

  // The team list replaced the focused item: give focus to its first row (keyboard users).
  useEffect(() => {
    if (!menuOpen || menuView !== "people") return;
    // Radix marks every item with this attribute (the compact MenuItem drops its role).
    menuRef.current?.querySelector<HTMLElement>("[data-radix-collection-item]")?.focus();
  }, [menuOpen, menuView]);

  const onMenuOpenChange = (next: boolean) => {
    if (!next && keepMenuOpenRef.current) {
      keepMenuOpenRef.current = false;
      return;
    }
    setMenuOpen(next);
    if (next) setMenuView("main");
  };

  const onHeaderClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    // React events bubble out of the menu's portal; only clicks inside the row count, and
    // the row's own buttons handle their clicks themselves.
    if (!event.currentTarget.contains(target) || target.closest(INTERACTIVE)) return;
    if (titleEditing) return;
    onToggleClick();
  };

  const startRename = () => {
    setTitleDraft(task.title);
    setTitleEditing(true);
  };
  const saveTitle = () => {
    const next = titleDraft.trim();
    setTitleEditing(false);
    if (next && next !== task.title && onRename) settle(() => onRename(next));
  };
  const onTitleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveTitle();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setTitleEditing(false);
    }
  };

  const deleting = useRef(false);
  const remove = async () => {
    // One delete at a time: a second click while the first is in flight does nothing.
    if (!onDelete || deleting.current) return;
    deleting.current = true;
    try {
      await onDelete();
    } catch {
      return; // The page reports the failure; no "Opgave slettet" for a task that is still there.
    } finally {
      deleting.current = false;
    }
    showToast({
      message: t("tasks.row.deleted"),
      ...(onRestore ? { onUndo: () => settle(onRestore) } : {}),
    });
  };

  const submitAnswer = async (answer: TaskAnswerInput) => {
    if (!onAnswer) return;
    setSaving(true);
    try {
      await onAnswer(answer);
      setExpanded(false);
    } catch {
      // Keep the editor and the draft open; the page has told the user what went wrong.
    } finally {
      setSaving(false);
    }
  };

  const properties: Array<{ key: string; value: string; icon: LucideIcon; color: string }> = [
    { key: t("tasks.type"), value: kindLabel, icon: KindIcon, color: "var(--ink-3)" },
    {
      key: t("tasks.assignee"),
      value: task.assignee?.name ?? t("tasks.none"),
      icon: ai ? Sparkles : UserRound,
      color: ai ? "var(--ai)" : "var(--ink-3)",
    },
    {
      key: t("tasks.dueLabel"),
      value: due ?? t("tasks.none"),
      icon: Calendar,
      color: "var(--ink-3)",
    },
    {
      key: t("tasks.row.linkedTo"),
      value: task.link?.label ?? taskUnlinkedLabel(language),
      icon: Circle,
      color,
    },
  ];

  return (
    <div
      className={cn(
        "group/row relative transition-colors duration-[360ms] ease-standard",
        isExpanded ? "bg-canvas" : "bg-transparent",
        className,
      )}
      data-source={task.source}
    >
      <div
        ref={headerRef}
        onPointerDown={() => {
          swallowClickRef.current = false;
        }}
        onClick={onHeaderClick}
        className="grid min-h-[66px] cursor-pointer grid-cols-[34px_minmax(0,1fr)_auto_30px] items-center gap-2.5 py-2.5 pr-2 pl-3 sm:gap-3.5 sm:pr-3 sm:pl-4"
      >
        <span
          className="relative grid size-[34px] shrink-0 place-items-center overflow-hidden rounded-sm"
          style={{ background: ai ? "var(--ai-wash)" : taskTint(color), color }}
        >
          {ai ? (
            <AiOrb size={20} tone="ai" label={t("tasks.row.orbLabel")} paused />
          ) : (
            <KindIcon className="size-[15px]" strokeWidth={1.75} aria-hidden />
          )}
          <AnimatePresence>
            {resolving && (
              <motion.span
                key="resolved"
                className="absolute inset-0 grid place-items-center bg-positive text-ink-inverse"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.16, ease: EASE.out }}
              >
                <DrawnCheck size={16} />
                <span className="sr-only">{t("tasks.row.resolved")}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </span>

        <div className="flex min-w-0 flex-col gap-0.5">
          {titleEditing ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={onTitleKey}
                aria-label={t("tasks.titleLabel")}
                className="h-8 min-w-0 flex-1 rounded-[8px] bg-canvas px-2.5 text-[14px] font-medium text-ink-1 shadow-[inset_0_0_0_1.5px_var(--action)] outline-none"
              />
              <Button variant="primary" size="sm" className="h-[30px]" onClick={saveTitle}>
                {t("tasks.save")}
              </Button>
              <Button
                variant="quiet"
                size="sm"
                className="h-[30px] text-ink-3"
                onClick={() => setTitleEditing(false)}
              >
                {t("tasks.cancel")}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onToggleClick}
              aria-expanded={isExpanded}
              aria-controls={panelId}
              className="min-w-0 rounded-xs text-left text-[15px] font-medium break-words text-ink-1 outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {task.title}
              {/* Inline after the title (gap 8), so it wraps under a long title on phones. */}
              {task.fromDeepAnalysis && (
                <span className="ml-2 inline-block text-micro font-medium whitespace-nowrap text-ai-ink">
                  {t("tasks.row.fromDeep")}
                </span>
              )}
            </button>
          )}
          {subline && <span className="truncate text-meta text-ink-3">{subline}</span>}
        </div>

        <span
          className={cn(
            "transition-opacity duration-[var(--dur-quick)]",
            resolving && "pointer-events-none opacity-0",
          )}
        >
          {canAnswer && (
            <Button
              variant={isExpanded ? "quiet" : "secondary"}
              size="sm"
              onClick={onToggleClick}
              aria-expanded={isExpanded}
              aria-controls={panelId}
              className={cn("px-3.5", isExpanded && "text-ink-3")}
            >
              {isExpanded ? t("tasks.close") : t("tasks.row.fill")}
            </Button>
          )}
        </span>

        <span className={cn(resolving && "pointer-events-none opacity-0")}>
          {hasMenu && (
            <Menu open={menuOpen} onOpenChange={onMenuOpenChange}>
              <MenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("tasks.row.moreActions", { title: task.title })}
                  className="grid size-[30px] place-items-center rounded-full text-ink-3 opacity-30 outline-none transition-[opacity,background-color] duration-[180ms] hover:bg-hover focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-action group-hover/row:opacity-100 data-[state=open]:bg-hover data-[state=open]:opacity-100"
                >
                  <Ellipsis className="size-4" strokeWidth={1.75} aria-hidden />
                </button>
              </MenuTrigger>
              <MenuContent
                ref={menuRef}
                align="end"
                sideOffset={8}
                className="min-w-[240px]"
                onPointerDownOutside={(event) => {
                  if (headerRef.current?.contains(event.target as Node)) {
                    swallowClickRef.current = true;
                  }
                }}
                onCloseAutoFocus={(event) => {
                  // "Redigér opgave" moved focus to the title field; do not pull it back.
                  if (titleEditingRef.current) event.preventDefault();
                }}
              >
                {menuView === "main" ? (
                  <>
                    {onRename && (
                      <MenuItem icon={Pencil} className="h-[34px]" onSelect={startRename}>
                        {t("tasks.row.rename")}
                      </MenuItem>
                    )}
                    {canReassign && (
                      <MenuItem
                        icon={UserRound}
                        className="h-[34px]"
                        onSelect={() => {
                          keepMenuOpenRef.current = true;
                          setMenuView("people");
                        }}
                      >
                        {t("tasks.row.reassign")}
                      </MenuItem>
                    )}
                    {onDelete && (
                      <MenuItem
                        icon={Trash2}
                        destructive
                        className="h-[34px] data-[highlighted]:bg-critical-wash [&_svg]:text-critical"
                        onSelect={() => void remove()}
                      >
                        {t("tasks.row.delete")}
                      </MenuItem>
                    )}
                  </>
                ) : (
                  <>
                    <div className="px-2.5 pt-1.5 pb-1 text-micro text-ink-4">
                      {t("tasks.assignee")}
                    </div>
                    {people.map((person) => {
                      const selected = person.id === task.assignee?.id;
                      return (
                        <MenuItem
                          key={person.id}
                          className={cn("h-10", selected && "bg-hover")}
                          onSelect={() => {
                            if (!selected && onReassign) settle(() => onReassign(person));
                          }}
                        >
                          <TaskPersonChoice person={person} selected={selected} />
                        </MenuItem>
                      );
                    })}
                  </>
                )}
              </MenuContent>
            </Menu>
          )}
        </span>
      </div>

      <Collapse
        open={isExpanded}
        id={panelId}
        className="flex flex-col gap-[18px] pt-0.5 pr-5 pb-[22px] pl-4 sm:pl-16"
      >
        <p className="m-0 max-w-[620px] text-[15px] leading-[1.6] text-ink-1">
          {task.description || t("tasks.row.noDescription")}
        </p>
        {task.why && (
          <div className="flex max-w-[620px] flex-col gap-1">
            <span className="text-meta font-semibold text-ink-3">{t("tasks.row.why")}</span>
            <span className="text-[14px] leading-[1.55] text-ink-2">{task.why}</span>
          </div>
        )}
        <dl className="m-0 grid max-w-[680px] grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {properties.map((property) => {
            const Icon = property.icon;
            return (
              <div key={property.key} className="flex min-w-0 flex-col gap-[3px]">
                <dt className="text-micro text-ink-4">{property.key}</dt>
                <dd className="m-0 flex min-w-0 items-center gap-1.5 text-list text-ink-1">
                  <Icon
                    className="size-[13px] shrink-0"
                    style={{ color: property.color }}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{property.value}</span>
                </dd>
              </div>
            );
          })}
        </dl>
        {ai ? (
          <div className="flex max-w-[620px] items-center gap-2.5 rounded-md bg-ai-wash px-4 py-3.5 text-[14px] text-ink-1">
            {t("tasks.row.aiWorking")}
          </div>
        ) : (
          canAnswer &&
          (task.answerKind === "gate" ? (
            <div className="rounded-md bg-canvas p-4">
              <GateAnswerEditor
                showLabel
                closeLabel="close"
                passedNow={task.gate?.passedNow ?? null}
                canOverride={task.gate?.canOverride ?? false}
                initial={
                  task.answer && typeof task.answer.gatePassed === "boolean"
                    ? {
                        passed: task.answer.gatePassed,
                        text: task.answer.text ?? "",
                        override: task.answer.override === true,
                      }
                    : undefined
                }
                pending={answerPending || saving}
                onSave={(draft) => void submitAnswer({ kind: "gate", ...draft })}
                onClose={() => setExpanded(false)}
              />
            </div>
          ) : (
            <AnswerEditor
              task={task}
              pending={answerPending || saving}
              onSave={(answer) => void submitAnswer(answer)}
              onClose={() => setExpanded(false)}
            />
          ))
        )}
      </Collapse>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The "Svar" box
// ---------------------------------------------------------------------------

const FIELD_RING =
  "shadow-[inset_0_0_0_1px_var(--line-strong)] focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]";

function initialDraft(task: TaskItem): string {
  const answer = task.answer;
  if (!answer) return "";
  if (task.answerKind === "number" && typeof answer.number === "number") {
    return String(answer.number);
  }
  if (task.answerKind === "select") return answer.option ?? "";
  return answer.text ?? "";
}

function AnswerEditor({
  task,
  pending,
  onSave,
  onClose,
}: {
  task: TaskItem;
  pending: boolean;
  onSave: (answer: TaskAnswerInput) => void;
  onClose: () => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const fieldId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => initialDraft(task));
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const options = task.answerOptions ?? [];
  // A select without choices is answered in words.
  const mode = task.answerKind === "select" && options.length === 0 ? "text" : task.answerKind;
  const number = Number(draft);
  const ready =
    mode === "file"
      ? file !== null
      : mode === "number"
        ? draft.trim() !== "" && Number.isFinite(number)
        : draft.trim() !== "";

  const save = () => {
    if (!ready || pending) return;
    if (mode === "file") {
      if (file) onSave({ kind: "file", file });
    } else if (mode === "number") onSave({ kind: "number", number });
    else if (mode === "select") onSave({ kind: "select", option: draft });
    else onSave({ kind: "text", text: draft.trim() });
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const numberLabel = task.answerLabel || task.answerUnit || null;
  const fileName = task.answer?.fileName;
  const fileText = file
    ? t("tasks.fileReady", { name: file.name })
    : fileName
      ? t("tasks.row.replaceFile", { name: fileName })
      : t("tasks.row.chooseFile");

  return (
    <div className="flex max-w-[620px] flex-col gap-3 rounded-md bg-canvas p-4">
      <span className="text-meta font-semibold text-ink-3">{t("tasks.answer")}</span>

      {mode === "select" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("tasks.answer")}>
          {options.map((option) => {
            const selected = draft === option;
            return (
              <motion.button
                key={option}
                type="button"
                aria-pressed={selected}
                onClick={() => setDraft(option)}
                {...(reduced ? {} : { whileTap: { scale: 0.96 }, transition: SPRING.press })}
                className={cn(
                  "h-9 whitespace-nowrap rounded-sm px-[15px] text-list outline-none transition-[background-color,color] duration-[220ms] ease-standard focus-visible:ring-2 focus-visible:ring-action",
                  selected
                    ? "bg-inverse text-ink-inverse"
                    : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)]",
                )}
              >
                {option}
              </motion.button>
            );
          })}
        </div>
      )}

      {mode === "number" && (
        <label className="flex max-w-80 flex-col gap-1.5" htmlFor={fieldId}>
          {numberLabel && <span className="text-meta text-ink-3">{numberLabel}</span>}
          <input
            id={fieldId}
            type="number"
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
            }}
            placeholder={task.answerPlaceholder ?? undefined}
            {...(numberLabel ? {} : { "aria-label": t("tasks.answer") })}
            className={cn(
              "h-11 rounded-sm bg-surface px-3.5 text-[15px] text-ink-1 outline-none transition-shadow duration-[var(--dur-quick)]",
              FIELD_RING,
            )}
          />
        </label>
      )}

      {mode === "file" && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            tabIndex={-1}
            aria-hidden
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex items-center gap-3 rounded-md bg-surface p-3.5 text-left text-list text-ink-2 outline-none transition-shadow duration-[var(--dur-quick)] hover:shadow-[inset_0_0_0_1.5px_var(--action)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]",
              dragging
                ? "shadow-[inset_0_0_0_1.5px_var(--action)]"
                : "shadow-[inset_0_0_0_1px_var(--line-strong)]",
            )}
          >
            <FileUp className="size-[18px] shrink-0 text-action" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">{fileText}</span>
          </button>
        </>
      )}

      {mode === "text" && (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("tasks.foundPlaceholder")}
          aria-label={t("tasks.answer")}
          className={cn(
            "min-h-[72px] resize-y rounded-sm bg-surface px-3.5 py-3 text-[14px] leading-[1.5] text-ink-1 outline-none transition-shadow duration-[var(--dur-quick)]",
            FIELD_RING,
          )}
        />
      )}

      <div className="flex gap-1.5">
        <Button variant="primary" size="md" disabled={!ready} pending={pending} onClick={save}>
          {t("tasks.row.saveAnswer")}
        </Button>
        <Button variant="quiet" size="md" className="text-ink-3" onClick={onClose}>
          {t("tasks.close")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolved row
// ---------------------------------------------------------------------------

function ResolvedTaskRow({ task, onEdit: offeredEdit, className }: TaskRowProps) {
  const t = useT();
  const language = useLanguage();
  // A binding gate answer (not met, or an override) can only be changed by Admin or Lead; the
  // server refuses anyone else, so the row does not offer it.
  const binding = task.answer?.gatePassed === false || task.answer?.override === true;
  const onEdit = task.gate && binding && !task.gate.canOverride ? undefined : offeredEdit;
  const value = formatTaskAnswer(task, language);
  return (
    <div
      className={cn(
        "grid h-10 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-sm px-3 transition-colors duration-[var(--dur-quick)] hover:bg-hover",
        className,
      )}
      data-source={task.source}
    >
      <span className="ml-0.5 grid size-[18px] place-items-center rounded-full bg-positive text-ink-inverse">
        <DrawnCheck size={10} />
      </span>
      <span className="flex min-w-0 items-baseline gap-2.5 whitespace-nowrap">
        <span className="min-w-0 truncate text-list text-ink-2">{task.title}</span>
        {value && <span className="min-w-0 shrink-[3] truncate text-meta text-ink-4">{value}</span>}
      </span>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("tasks.row.editAria", { title: task.title })}
          className="h-7 whitespace-nowrap rounded-[8px] px-2.5 text-meta font-medium text-action outline-none transition-colors duration-[var(--dur-quick)] hover:bg-action-wash focus-visible:ring-2 focus-visible:ring-action"
        >
          {t("tasks.row.edit")}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
