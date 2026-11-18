/**
 * Text field ("Felter", Designsystem "Knapper og kontroller"): 44 px, radius 10,
 * sunken fill, 14 px text; on focus a white surface with a 1.5 px --action ring and a 4 px
 * --action-wash halo. The label is 12/500 ink-2 with 7 px to the field.
 */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const fieldClass =
  "h-11 w-full min-w-0 rounded-sm bg-sunken px-3.5 text-[14px] text-ink-1 outline-none shadow-[inset_0_0_0_1px_transparent] transition-[box-shadow,background-color] duration-[var(--dur-quick)] placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)] disabled:opacity-50";

export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    label: ReactNode;
    /** Short help or error under the field. */
    hint?: ReactNode;
    invalid?: boolean;
  }
>(function TextField({ label, hint, invalid = false, className, id, ...props }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <label htmlFor={inputId} className="flex flex-col gap-[7px]">
      <span className="text-meta font-medium text-ink-2">{label}</span>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
        className={cn(
          fieldClass,
          invalid &&
            "shadow-[inset_0_0_0_1.5px_var(--critical)] focus:shadow-[inset_0_0_0_1.5px_var(--critical),0_0_0_4px_var(--critical-wash)]",
          className,
        )}
        {...props}
      />
      {hint && (
        <span id={hintId} className={cn("text-meta", invalid ? "text-critical" : "text-ink-3")}>
          {hint}
        </span>
      )}
    </label>
  );
});
