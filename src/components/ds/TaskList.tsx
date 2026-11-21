/**
 * The "Skal afklares" box (Case Screening v5 and Case Dyb analyse v5; v0.3 "Sektioner lever i bokse", v0.4 and "Dyb
 * analyse v5": one list per case, the same in both phases).
 *
 * Measured in the prototype:
 * - Box: canvas, radius xl, padding 22 22 14 (18 14 14 below 640 px). Header (padding 0 4 14, gap 12): "Skal afklares"
 *   22/600 with title tracking, the number of open tasks in 13 px ink-4, and "+ Ny opgave" as a
 *   secondary 32 px pill on the right (the deep analysis shows a quiet 12 px ink-4 note there
 *   instead: pass `note` and leave out `onCreate`).
 * - The composer folds open under the header (TaskComposer). `prefill` opens it from elsewhere on
 *   the page with a task filled in ("Udfyld" on a card on Konklusion).
 * - Open tasks sit on one white surface (radius lg, 1 px --line ring) with hairlines between
 *   rows; never a card per row.
 * - Under the surface a 44 px line (pt 6) with "N løst" (34 px quiet pill, 13/500 ink-3, green
 *   circle-check, 12 px chevron turning 180°); it folds the resolved tasks out as compact
 *   40 px rows. says "N løst" (the prototype reads "N afklaret").
 * - "Redigér" on a resolved task opens it again in the list with its answer in the editor.
 * Motion: new rows rise in (y 8, 420 ms ease-out). A task that turns resolved keeps its place
 * for 900 ms with a green tile and a drawn check, then collapses with the smooth spring at
 * opacity.5 ("Checkbox og løs task"). Deleted rows collapse the same way; the
 * "Opgave slettet, Fortryd" toast comes from TaskRow. Reduced motion: short fades.
 *
 * Presentational: tasks and people come from the page, every change goes out through a
 * callback. A callback may return a promise; on rejection the page tells the user.
 */
import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, CircleCheck, Plus } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { TaskComposer } from "@/components/ds/TaskComposer";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { TaskRow } from "@/components/ds/TaskRow";
import type {
  TaskAnswerInput,
  TaskDraft,
  TaskDueChoice,
  TaskItem,
  TaskLink,
  TaskPerson,
  TaskPrefill,
  TaskStatus,
} from "@/components/ds/task-types";
import {
  groupTasksByLink,
  previewTasks,
  TASK_FOLD_THRESHOLD,
  TASK_GROUP_THRESHOLD,
} from "@/lib/cases/task-groups";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

type MaybePromise = void | Promise<unknown>;

/** How long a just-resolved task stays in place with its check. */
const RESOLVE_HOLD_MS = 900;

export interface TaskListProps {
  /** All the case's tasks, open and resolved, in the order to show them. */
  tasks: readonly TaskItem[];
  /** Team members for "Ansvarlig" (composer) and "Skift ansvarlig" (row menu). */
  people?: readonly TaskPerson[] | undefined;
  /** The fund's gates and criteria for "Knyt til". */
  links?: readonly TaskLink[] | undefined;
  dueChoices?: readonly TaskDueChoice[] | undefined;
  /** Shows "+ Ny opgave". Leave out for readers. */
  onCreate?: ((draft: TaskDraft) => MaybePromise) | undefined;
  /** The composer's task is being saved. */
  creating?: boolean | undefined;
  /** Opens "Ny opgave" with these fields filled in; each new `id` opens it again. */
  prefill?: TaskPrefill | null | undefined;
  /**
   * The composer has opened with `prefill`: the page clears it, so the list does not open it again
   * when it mounts anew (e.g. back on a tab).
   */
  onPrefillOpened?: (() => void) | undefined;
  /** Shows "Udfyld" and the answer editor. */
  onAnswer?: ((task: TaskItem, answer: TaskAnswerInput) => MaybePromise) | undefined;
  onRename?: ((task: TaskItem, title: string) => MaybePromise) | undefined;
  onReassign?: ((task: TaskItem, person: TaskPerson) => MaybePromise) | undefined;
  onDelete?: ((task: TaskItem) => MaybePromise) | undefined;
  /** "Fortryd" in the delete toast. */
  onRestore?: ((task: TaskItem) => MaybePromise) | undefined;
  /** Quiet text right of the title, e.g. "Samme liste som i screeningen". */
  note?: string | undefined;
  className?: string | undefined;
}

function statusSignature(tasks: readonly TaskItem[]): string {
  return tasks.map((task) => `${task.id}:${task.status}`).join("|");
}

export function TaskList({
  tasks,
  people,
  links,
  dueChoices,
  onCreate,
  creating = false,
  prefill = null,
  onPrefillOpened,
  onAnswer,
  onRename,
  onReassign,
  onDelete,
  onRestore,
  note,
  className,
}: TaskListProps) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const solvedId = `${useId()}-lost`;
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showSolved, setShowSolved] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [resolving, setResolving] = useState<ReadonlySet<string>>(() => new Set());
  // The request "Ny opgave" was last opened with; "+ Ny opgave" opens it empty again. A new
  // request opens the composer, derived during render like `seen` below.
  const [seed, setSeed] = useState<TaskPrefill | null>(null);
  const [seenPrefill, setSeenPrefill] = useState<number | null>(null);
  if (prefill && onCreate && prefill.id !== seenPrefill) {
    setSeenPrefill(prefill.id);
    setSeed(prefill);
    setAdding(true);
    setExpandedId(null);
  }
  // After the render that used the request (never during it: that would set the page's state
  // while the list renders).
  const seedId = seed?.id ?? null;
  useEffect(() => {
    if (seedId !== null) onPrefillOpened?.();
    // Only when a new request has been used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedId]);

  // Notice tasks that turned resolved since the last render (e.g. after "Gem svar"), so they
  // can hold their place with the check before they move to "N løst". Derived during render
  // (React's "storing information from previous renders"), so there is no flash.
  const signature = statusSignature(tasks);
  const [seen, setSeen] = useState(() => ({
    signature,
    statuses: new Map<string, TaskStatus>(tasks.map((task) => [task.id, task.status])),
  }));
  if (seen.signature !== signature) {
    const justResolved = tasks
      .filter((task) => task.status === "resolved" && seen.statuses.get(task.id) === "open")
      .map((task) => task.id);
    setSeen({ signature, statuses: new Map(tasks.map((task) => [task.id, task.status])) });
    if (justResolved.length) {
      setResolving((current) => new Set([...current, ...justResolved]));
    }
  }

  useEffect(() => {
    if (resolving.size === 0) return;
    const ids = [...resolving];
    const timer = setTimeout(() => {
      setResolving((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, RESOLVE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [resolving]);

  const inOpenList = (task: TaskItem) =>
    task.status === "open" || resolving.has(task.id) || task.id === expandedId;
  const allOpenRows = tasks.filter(inOpenList);
  // More than 4 open tasks show the 4 most important and fold the rest behind "Vis N
  // flere"; unfolded, a long list (Pleo's screening has 84) is grouped by its gate or criterion.
  const longList = allOpenRows.length > TASK_FOLD_THRESHOLD;
  const folded = longList && !showAll;
  const openRows = folded
    ? previewTasks(
        allOpenRows,
        // Tasks a person made stay in view (a new task must show up where it was made).
        (task) => resolving.has(task.id) || task.id === expandedId || task.source === "user",
      )
    : allOpenRows;
  const hiddenCount = allOpenRows.length - openRows.length;
  const groups =
    showAll && allOpenRows.length > TASK_GROUP_THRESHOLD
      ? groupTasksByLink(allOpenRows, language)
      : null;
  const solvedRows = tasks.filter((task) => !inOpenList(task));
  const openCount = tasks.filter((task) => task.status === "open").length;
  const doneCount = tasks.length - openCount;

  const rowEnter = reduced ? { opacity: 0 } : { opacity: 0, y: 8 };
  const rowExit = reduced
    ? { opacity: 0, transition: REDUCED_FADE }
    : { height: 0, opacity: 0.5, transition: SPRING.smooth };

  const renderRows = (rows: readonly TaskItem[]) => (
    <AnimatePresence initial={false}>
      {rows.map((task) => (
        <motion.div
          key={task.id}
          className="overflow-hidden border-line not-first:border-t"
          initial={rowEnter}
          animate={{ opacity: 1, y: 0 }}
          exit={rowExit}
          transition={reduced ? REDUCED_FADE : { duration: 0.42, ease: EASE.out }}
        >
          <TaskRow
            task={task}
            variant="open"
            expanded={task.id === expandedId}
            onExpandedChange={(next) =>
              setExpandedId((current) => (next ? task.id : current === task.id ? null : current))
            }
            people={people}
            resolving={resolving.has(task.id)}
            onAnswer={onAnswer && ((answer) => onAnswer(task, answer))}
            onRename={onRename && ((title) => onRename(task, title))}
            onReassign={onReassign && ((person) => onReassign(task, person))}
            onDelete={onDelete && (() => onDelete(task))}
            onRestore={onRestore && (() => onRestore(task))}
          />
        </motion.div>
      ))}
    </AnimatePresence>
  );

  return (
    <section
      className={cn(
        "relative flex flex-col rounded-xl bg-canvas px-3.5 pt-[18px] pb-3.5 sm:px-[22px] sm:pt-[22px]",
        className,
      )}
    >
      <div className="flex items-center gap-3 px-1 pb-3.5">
        <h2 className="m-0 text-title font-semibold tracking-title">{t("tasks.list.title")}</h2>
        <span className="text-list text-ink-4">{openCount}</span>
        <div className="flex-1" />
        {note && <span className="text-meta text-ink-4">{note}</span>}
        {onCreate && (
          <Button
            size="sm"
            icon={Plus}
            className="px-3.5"
            aria-expanded={adding}
            onClick={() => {
              setSeed(null);
              setAdding((current) => !current);
              setExpandedId(null);
            }}
          >
            {t("tasks.list.newTask")}
          </Button>
        )}
      </div>

      {onCreate && (
        <TaskComposer
          open={adding}
          onClose={() => setAdding(false)}
          onCreate={onCreate}
          people={people}
          links={links}
          dueChoices={dueChoices}
          pending={creating}
          initial={seed}
        />
      )}

      {openRows.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)]">
          {groups
            ? groups.map((group) => (
                <section
                  key={group.id}
                  aria-label={group.label}
                  className="not-first:border-t not-first:border-line"
                >
                  <h3 className="m-0 flex items-center gap-2 bg-canvas/60 px-3 py-2 text-meta font-medium text-ink-3">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: group.color ?? "var(--ink-4)" }}
                      aria-hidden
                    />
                    <span className="min-w-0 truncate">{group.label}</span>
                    <span className="text-ink-4">{group.tasks.length}</span>
                  </h3>
                  {renderRows(group.tasks)}
                </section>
              ))
            : renderRows(openRows)}
        </div>
      )}

      <div className="flex min-h-11 flex-wrap items-center gap-2.5 pt-1.5">
        {longList && (showAll || hiddenCount > 0) && (
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            aria-expanded={showAll}
            className="inline-flex h-[34px] items-center gap-2 rounded-pill px-3 text-list font-medium whitespace-nowrap text-ink-2 outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
          >
            {showAll
              ? t("tasks.list.showTop")
              : hiddenCount === 1
                ? t("tasks.list.showMoreOne")
                : t("tasks.list.showMore", { count: hiddenCount })}
            <motion.span
              className="inline-flex"
              animate={{ rotate: showAll ? 180 : 0 }}
              transition={reduced ? { duration: 0 } : SPRING.smooth}
            >
              <ChevronDown className="size-3" strokeWidth={1.75} aria-hidden />
            </motion.span>
          </button>
        )}
        {solvedRows.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSolved((current) => !current)}
            aria-expanded={showSolved}
            aria-controls={solvedId}
            className="inline-flex h-[34px] items-center gap-2 rounded-pill px-3 text-list font-medium whitespace-nowrap text-ink-3 outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
          >
            <CircleCheck className="size-[13px] text-positive" strokeWidth={1.75} aria-hidden />
            {t("tasks.list.solved", { count: doneCount })}
            <motion.span
              className="inline-flex"
              animate={{ rotate: showSolved ? 180 : 0 }}
              transition={reduced ? { duration: 0 } : SPRING.smooth}
            >
              <ChevronDown className="size-3" strokeWidth={1.75} aria-hidden />
            </motion.span>
          </button>
        )}
      </div>

      <Collapse open={showSolved && solvedRows.length > 0} id={solvedId}>
        {solvedRows.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            variant="resolved"
            onEdit={
              onAnswer &&
              (() => {
                setExpandedId(task.id);
                setAdding(false);
              })
            }
          />
        ))}
      </Collapse>
    </section>
  );
}
