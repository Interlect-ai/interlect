/** Small boxes the Dyb analyse tabs share (moved unchanged from the old DeepCaseView). */
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function Figure({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-section font-semibold text-ink">{title}</h2>
        {meta && <span className="mono-num text-meta text-ink-4">{meta}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Fold({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className="group scroll-mt-24 rounded-md border border-hairline bg-surface p-4"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 marker:content-none">
        <span>
          <strong className="block text-body text-ink">{title}</strong>
          <span className="mt-1 block text-meta text-ink-3">{summary}</span>
        </span>
        <ChevronDown
          className="size-3.5 text-ink-4 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="mt-5 border-t border-hairline pt-4">{children}</div>
    </details>
  );
}
