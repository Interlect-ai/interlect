/**
 * A folded section under the Se view: the older panels (team suggestions, rescreening, past
 * investments) keep working, but stay out of the way until someone opens them. The content is
 * only mounted while open, so nothing is fetched for a section nobody looks at.
 */
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapse } from "@/components/ds/Collapse";
import { cn } from "@/lib/utils";

export function FoldSection({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <section className="rounded-lg bg-canvas">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-[22px] py-3 text-left font-[inherit] text-ink-1 transition-colors hover:bg-hover"
      >
        <span className="text-list font-semibold">{title}</span>
        {hint && <span className="hidden text-meta text-ink-3 md:inline">{hint}</span>}
        <ChevronDown
          aria-hidden
          className={cn(
            "ml-auto size-4 text-ink-4 transition-transform duration-[280ms] ease-standard",
            open && "rotate-180",
          )}
        />
      </button>
      <Collapse open={open} id={panelId}>
        {/* The older panels are written for the old text scale. */}
        <div data-legacy-scale="" className="px-[22px] pt-1 pb-[22px]">
          {children}
        </div>
      </Collapse>
    </section>
  );
}
