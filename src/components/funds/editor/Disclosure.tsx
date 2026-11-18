/** A folded block inside the editing flow (new design): title, one line, chevron, fold-out. */
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapse } from "@/components/ds/Collapse";
import { cn } from "@/lib/utils";

export function Disclosure({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
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
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-[18px] py-3 text-left font-[inherit] text-ink-1 transition-colors hover:bg-hover"
      >
        <span className="min-w-0">
          <span className="block text-list font-semibold">{title}</span>
          {description && <span className="mt-0.5 block text-meta text-ink-3">{description}</span>}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "ml-auto size-4 shrink-0 text-ink-4 transition-transform duration-[280ms] ease-standard",
            open && "rotate-180",
          )}
        />
      </button>
      <Collapse open={open} id={panelId}>
        <div className="px-[18px] pt-1 pb-[18px]">{children}</div>
      </Collapse>
    </section>
  );
}
