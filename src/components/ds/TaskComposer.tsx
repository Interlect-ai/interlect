/**
 * "Ny opgave" composer (Case Screening v5, top of "Skal afklares"; v0.4 "Ny opgave" and v0.3 "Tilføj-feltet har både Tilføj
 * og Annullér").
 *
 * Measured in the prototype:
 * - Folds open above the list (Collapse; the prototype's grid rows 0fr → 1fr, 460 ms) with
 *   12 px to the list. The box: surface, radius lg, shadow raised, padding 18 18 14, gap 10.
 * - Title field 17/600, tracking −0.01em, no frame, "Opgavens titel". Description 14/1.55
 *   ink-2, min 64 px, resizes vertically.
 * - Property line under a hairline (pt 8, gap 2, wraps): Type, Ansvarlig, Frist and Knyt til
 *   as 30 px text buttons (radius 8, 12 px ink-2, 13 px ink-3 icon; Knyt til a 7 px dot in the
 *   link's colour), then "Annullér" (quiet pill, ink-3) and "Opret opgave" (ink pill, 35 %
 *   until there is a title).
 * - Each property opens its choice list under the line: canvas, radius md, padding 6, gap 2,
 *   at most 360 px; 40 px rows with a 24 px tile, label, description and a violet check.
 *   It rises in from y 8 (the prototype's `rise` 260 ms; keeps distances small).
 * - Keys: Enter in the title creates the task, Esc closes the open list or else the composer.
 *
 * Presentational: `onCreate` gets the draft; the page saves it. If it rejects, the page tells
 * the user and the draft stays. `initial` opens it with a title, description, type and link
 * filled in ("Udfyld" on a card) and brings it into view. "Frist" defaults to Ingen frist, I dag, I morgen, the coming
 * Friday and Næste uge from the user's own calendar.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Calendar, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { TaskChoiceContent, TaskPersonChoice } from "@/components/ds/TaskRow";
import {
  TASK_KIND_ICON,
  TASK_KIND_ORDER,
  TASK_UNLINKED_COLOR,
  defaultDueChoices,
  taskKindLabel,
  type TaskDraft,
  type TaskDueChoice,
  type TaskKind,
  type TaskLink,
  type TaskPerson,
  type TaskPrefill,
} from "@/components/ds/task-types";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";

type MaybePromise = void | Promise<unknown>;
type Picker = "type" | "who" | "due" | "link";

export interface TaskComposerProps {
  open: boolean;
  /** "Annullér", Esc and a created task all close the composer through this. */
  onClose: () => void;
  onCreate: (draft: TaskDraft) => MaybePromise;
  /** "Ansvarlig" choices; the signed-in user (`isMe`) is chosen from the start. */
  people?: readonly TaskPerson[] | undefined;
  /** "Knyt til" choices (the fund's gates and criteria). */
  links?: readonly TaskLink[] | undefined;
  /** "Frist" choices; leave out for the default list. */
  dueChoices?: readonly TaskDueChoice[] | undefined;
  /** The task is being created elsewhere: "Opret opgave" shows the orb. */
  pending?: boolean | undefined;
  /** Opens with these fields filled in; a new `id` starts the form again. */
  initial?: TaskPrefill | null | undefined;
  className?: string | undefined;
}

export function TaskComposer({ open, className, ...form }: TaskComposerProps) {
  return (
    <Collapse open={open} className={cn("pb-3", className)}>
      <ComposerForm key={form.initial?.id ?? "blank"} {...form} />
    </Collapse>
  );
}

const linkId = (link: TaskLink) => `${link.kind}:${link.key}`;

function ComposerForm({
  onClose,
  onCreate,
  people = [],
  links = [],
  dueChoices,
  pending = false,
  initial = null,
}: Omit<TaskComposerProps, "open" | "className">) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const pickerId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState<TaskKind>(initial?.kind ?? "task");
  const [assigneeId, setAssigneeId] = useState<string | null>(
    () => people.find((person) => person.isMe)?.id ?? null,
  );
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [linkKey, setLinkKey] = useState<string | null>(() => {
    const wanted = initial?.link;
    return wanted && links.some((link) => linkId(link) === linkId(wanted)) ? linkId(wanted) : null;
  });
  const [picker, setPicker] = useState<Picker | null>(null);
  const [busy, setBusy] = useState(false);
  // The composer only mounts after a click, so "today" is the user's own day.
  const [fallbackDues] = useState(() => defaultDueChoices(new Date(), language));
  const dues = dueChoices ?? fallbackDues;

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    // Asked for from elsewhere on the page (a card's "Udfyld"): bring the form into view.
    if (initial) {
      titleRef.current?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }
    // Only when the form mounts; a new request remounts it (its key is the request's id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assignee = people.find((person) => person.id === assigneeId) ?? null;
  const link = links.find((candidate) => linkId(candidate) === linkKey) ?? null;
  const due = dues.find((choice) => choice.value === dueOn && choice.value !== null) ?? null;
  const canCreate = title.trim() !== "";

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy || pending) return;
    setBusy(true);
    try {
      await onCreate({
        kind,
        title: trimmed,
        description: description.trim() || null,
        assignee,
        dueOn,
        link,
        answerKind: assignee?.isInterlect ? "ai" : "text",
      });
    } catch {
      setBusy(false);
      return; // The page reports the failure; keep the draft.
    }
    setBusy(false);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (picker) setPicker(null);
    else onClose();
  };

  const toggle = (next: Picker) => setPicker((current) => (current === next ? null : next));
  const choose = (apply: () => void) => {
    apply();
    setPicker(null);
  };

  const choices: Array<{
    key: string;
    selected: boolean;
    onSelect: () => void;
    content: ReactNode;
  }> =
    picker === "type"
      ? TASK_KIND_ORDER.map((option) => {
          return {
            key: option,
            selected: option === kind,
            onSelect: () => choose(() => setKind(option)),
            content: (
              <TaskChoiceContent
                label={taskKindLabel(option, language)}
                icon={TASK_KIND_ICON[option]}
                tileBackground="var(--bg-sunken)"
                tileColor="var(--ink-2)"
                selected={option === kind}
              />
            ),
          };
        })
      : picker === "who"
        ? people.map((person) => ({
            key: person.id,
            selected: person.id === assigneeId,
            onSelect: () => choose(() => setAssigneeId(person.id)),
            content: <TaskPersonChoice person={person} selected={person.id === assigneeId} />,
          }))
        : picker === "due"
          ? dues.map((choice) => ({
              key: choice.value ?? "none",
              selected: choice.value === dueOn,
              onSelect: () => choose(() => setDueOn(choice.value)),
              content: (
                <TaskChoiceContent
                  label={choice.label}
                  icon={Calendar}
                  tileBackground="var(--bg-sunken)"
                  tileColor="var(--ink-2)"
                  selected={choice.value === dueOn}
                />
              ),
            }))
          : picker === "link"
            ? [
                {
                  key: "none",
                  selected: linkKey === null,
                  onSelect: () => choose(() => setLinkKey(null)),
                  content: (
                    <TaskChoiceContent
                      label={t("tasks.composer.linkTo")}
                      description={t("tasks.composer.standalone")}
                      tileBackground={TASK_UNLINKED_COLOR}
                      tileColor={TASK_UNLINKED_COLOR}
                      selected={linkKey === null}
                    />
                  ),
                },
                ...links.map((candidate) => {
                  const id = linkId(candidate);
                  return {
                    key: id,
                    selected: id === linkKey,
                    onSelect: () => choose(() => setLinkKey(id)),
                    content: (
                      <TaskChoiceContent
                        label={candidate.label}
                        description={
                          candidate.description ??
                          t(
                            candidate.kind === "gate"
                              ? "tasks.composer.linkGate"
                              : "tasks.composer.linkCriterion",
                          )
                        }
                        tileBackground={candidate.color}
                        tileColor={candidate.color}
                        selected={id === linkKey}
                      />
                    ),
                  };
                }),
              ]
            : [];

  const whoLabel = assignee ? (assignee.isMe ? t("tasks.me") : assignee.name) : t("tasks.assignee");
  const pickerLabel: Record<Picker, string> = {
    type: t("tasks.type"),
    who: t("tasks.assignee"),
    due: t("tasks.dueLabel"),
    link: t("tasks.composer.linkTo"),
  };

  return (
    <div
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2.5 rounded-lg bg-surface px-[18px] pt-[18px] pb-3.5 shadow-raised"
    >
      <input
        ref={titleRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={t("tasks.titleLabel")}
        aria-label={t("tasks.titleLabel")}
        className="min-w-0 border-0 bg-transparent text-[17px] font-semibold tracking-[-0.01em] text-ink-1 outline-none placeholder:text-ink-4"
      />
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder={t("tasks.composer.descriptionPlaceholder")}
        aria-label={t("tasks.composer.descriptionLabel")}
        className="min-h-16 resize-y border-0 bg-transparent text-[14px] leading-[1.55] text-ink-2 outline-none placeholder:text-ink-4"
      />
      <div className="flex flex-wrap items-center gap-0.5 border-t border-line pt-2">
        <PropertyButton
          label={taskKindLabel(kind, language)}
          name={pickerLabel.type}
          icon={TASK_KIND_ICON[kind]}
          expanded={picker === "type"}
          controls={pickerId}
          onClick={() => toggle("type")}
        />
        <PropertyButton
          label={whoLabel}
          name={pickerLabel.who}
          icon={assignee?.isInterlect ? Sparkles : UserRound}
          expanded={picker === "who"}
          controls={pickerId}
          onClick={() => toggle("who")}
        />
        <PropertyButton
          label={due?.label ?? pickerLabel.due}
          name={pickerLabel.due}
          icon={Calendar}
          expanded={picker === "due"}
          controls={pickerId}
          onClick={() => toggle("due")}
        />
        <PropertyButton
          label={link?.label ?? pickerLabel.link}
          name={pickerLabel.link}
          dot={link?.color ?? TASK_UNLINKED_COLOR}
          expanded={picker === "link"}
          controls={pickerId}
          onClick={() => toggle("link")}
        />
        {/* One group, so the two actions wrap together and stay on the right on phones. */}
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="quiet" size="sm" className="px-3 text-ink-3" onClick={onClose}>
            {t("tasks.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="px-3.5"
            disabled={!canCreate}
            pending={busy || pending}
            onClick={() => void submit()}
          >
            {t("tasks.composer.create")}
          </Button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {picker && (
          <motion.div
            key="picker"
            id={pickerId}
            role="group"
            aria-label={pickerLabel[picker]}
            className="flex max-w-[360px] flex-col gap-0.5 rounded-md bg-canvas p-1.5"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: reduced ? REDUCED_FADE : { duration: 0.14 } }}
            transition={reduced ? REDUCED_FADE : { duration: 0.26, ease: EASE.out }}
          >
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                aria-pressed={choice.selected}
                onClick={choice.onSelect}
                className={cn(
                  "flex h-10 w-full items-center rounded-[8px] px-2.5 text-left text-list whitespace-nowrap text-ink-1 outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action",
                  choice.selected && "bg-hover",
                )}
              >
                {choice.content}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PropertyButton({
  label,
  name,
  icon: Icon,
  dot,
  expanded,
  controls,
  onClick,
}: {
  label: string;
  /** The property's name for screen readers ("Ansvarlig: Dig"). */
  name: string;
  icon?: LucideIcon | undefined;
  /** Colour of the 7 px dot (Knyt til) instead of an icon. */
  dot?: string | undefined;
  expanded: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label === name ? name : `${name}: ${label}`}
      className="inline-flex h-[30px] max-w-full items-center gap-1.5 rounded-[8px] px-2.5 text-meta whitespace-nowrap text-ink-2 outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action"
    >
      {Icon && <Icon className="size-[13px] shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />}
      {dot && (
        <span
          className="size-[7px] shrink-0 rounded-full"
          style={{ background: dot }}
          aria-hidden
        />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
