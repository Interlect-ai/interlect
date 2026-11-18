/**
 * A run that has stood still for a long time: a calm message with one action instead
 * of the orb forever. Same layout as the failed state on the Dyb analyse, without the alarm.
 */
import type { ReactNode } from "react";
import { Hourglass } from "lucide-react";

export function RunStalled({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <section
      role="status"
      className="grid min-h-[320px] place-items-center rounded-xl bg-canvas p-6 text-center"
    >
      <div className="max-w-lg">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-sunken text-ink-3">
          <Hourglass className="size-5" aria-hidden />
        </span>
        <h2 className="mt-4 mb-0 text-section font-semibold text-ink-1">{title}</h2>
        <p className="mt-2 mb-0 text-list leading-5 text-ink-2">{body}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>
      </div>
    </section>
  );
}
