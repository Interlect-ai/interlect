/**
 * The Tasks sub-page's list (Overblik v2): overdue tasks on top, a row unfolds the description,
 * and "Udfyld" opens the case. The circle is NOT a "mark as done" (rule): an answer is
 * saved as evidence and recalculates the score in code (decision 6), so a task is never closed
 * without one. The circle is a link into the case instead, where the answer is written.
 * Everything shown comes from the task itself (description, why, due date): nothing invented.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  CircleDot,
  FileText,
  MessageCircle,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Collapse } from "@/components/ds/Collapse";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { dueText } from "@/lib/overview/dates";
import { SPRING } from "@/lib/motion";
import { isOverdue } from "@/lib/overview/task-view";
import type { FundTask } from "@/lib/overview/tasks.functions";
import { cn } from "@/lib/utils";

const KIND: Record<FundTask["kind"], { icon: LucideIcon; color: string }> = {
  question: { icon: MessageCircle, color: "var(--action)" },
  document: { icon: FileText, color: "var(--action)" },
  verification: { icon: ShieldCheck, color: "var(--series-5)" },
  research: { icon: Search, color: "var(--ai-ink)" },
  meeting: { icon: CalendarClock, color: "var(--warning)" },
  task: { icon: CircleDot, color: "var(--ink-3)" },
};

export function TasksList({ tasks, now }: { tasks: readonly FundTask[]; now: Date }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const t = useT();
  if (tasks.length === 0) {
    return (
      <p className="rounded-lg bg-surface px-5 py-8 text-center text-[15px] text-ink-3 shadow-card">
        {t("overview.tasks.none")}
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg bg-surface p-0 shadow-card">
      {tasks.map((task, index) => (
        <TaskRow
          key={task.id}
          task={task}
          first={index === 0}
          now={now}
          open={openId === task.id}
          onToggle={() => setOpenId((current) => (current === task.id ? null : task.id))}
        />
      ))}
    </ul>
  );
}

function TaskRow({
  task,
  first,
  now,
  open,
  onToggle,
}: {
  task: FundTask;
  first: boolean;
  now: Date;
  open: boolean;
  onToggle: () => void;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  const kind = KIND[task.kind];
  const Icon = kind.icon;
  const due = task.dueOn ? dueText(task.dueOn, now, language) : null;
  const late = isOverdue(task, now);
  const sub = [
    task.caseName,
    due?.text,
    task.assigneeId === null ? t("overview.tasks.unassigned") : task.assigneeName,
  ]
    .filter(Boolean)
    .join(", ");
  const details = [task.description, task.why].filter((text): text is string => Boolean(text));
  const foldable = details.length > 0;
  const bodyId = `task-${task.id}-body`;
  return (
    <li className={cn(!first && "border-t border-line")}>
      <div
        onClick={foldable ? onToggle : undefined}
        className={cn(
          "grid min-h-[66px] grid-cols-[22px_34px_minmax(0,1fr)_auto] items-center gap-3.5 px-4 py-2.5 transition-colors hover:bg-hover sm:grid-cols-[22px_34px_minmax(0,1fr)_auto_20px]",
          foldable && "cursor-pointer",
        )}
      >
        <Link
          to="/cases/$caseId"
          params={{ caseId: task.caseId }}
          search={{ view: task.caseView }}
          tabIndex={-1}
          aria-hidden
          onClick={(event) => event.stopPropagation()}
          className="group/circle grid size-[22px] place-items-center rounded-full text-ink-3 shadow-[inset_0_0_0_1.5px_var(--line-strong)] outline-none transition-colors hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
        >
          <ArrowUpRight
            className="size-[11px] opacity-0 transition-opacity group-hover/circle:opacity-100 group-focus-visible/circle:opacity-100"
            strokeWidth={2.2}
            aria-hidden
          />
        </Link>
        <span
          className="grid size-[34px] place-items-center rounded-[10px] text-[15px]"
          style={{
            background: `color-mix(in srgb, ${kind.color} 14%, transparent)`,
            color: kind.color,
          }}
          aria-hidden
        >
          <Icon className="size-[15px]" strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          {foldable ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
              aria-expanded={open}
              aria-controls={bodyId}
              className="line-clamp-2 text-left text-[15px] leading-5 font-medium outline-none focus-visible:underline"
            >
              {task.title}
            </button>
          ) : (
            <span className="line-clamp-2 text-[15px] leading-5 font-medium">{task.title}</span>
          )}
          <span className={cn("line-clamp-2 text-meta", late ? "text-critical" : "text-ink-3")}>
            {sub}
          </span>
        </span>
        <Link
          to="/cases/$caseId"
          params={{ caseId: task.caseId }}
          search={{ view: task.caseView }}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex h-8 items-center rounded-pill bg-surface px-3.5 text-meta font-medium whitespace-nowrap shadow-pill outline-none transition-transform active:scale-[.97] focus-visible:ring-2 focus-visible:ring-action"
        >
          {t("overview.tasks.fillIn")}
        </Link>
        {foldable && (
          <motion.span
            className="hidden text-ink-4 sm:block"
            animate={{ rotate: open ? 180 : 0 }}
            transition={reduced ? { duration: 0 } : SPRING.smooth}
            aria-hidden
          >
            <ChevronDown className="size-4" />
          </motion.span>
        )}
      </div>
      {foldable && (
        <Collapse open={open} id={bodyId}>
          <div className="flex max-w-[680px] flex-col gap-2 pr-5 pb-5 pl-[86px] max-sm:pl-5">
            {details.map((text) => (
              <p key={text} className="m-0 text-[15px] leading-[1.6] text-ink-2">
                {text}
              </p>
            ))}
          </div>
        </Collapse>
      )}
    </li>
  );
}
