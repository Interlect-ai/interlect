/**
 * Toast (Cases v4, CaseStatus): a 48 px ink pill at the bottom centre with a green check,
 * the message and an optional "Fortryd" (5 s). One toast at a time: a new one replaces the
 * old with a crossfade instead of stacking ("Toast og bulk-bjælke"). In: y 24 → 0,
 * scale .96 → 1 with the smooth spring; out: y 12 and fade over 160 ms.
 *
 * `showToast()` can be called from anywhere; `<ToastViewport />` sits once in the root.
 */
import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleCheck, CircleAlert } from "lucide-react";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface ToastInput {
  message: string;
  /** Shows "Fortryd"; runs when clicked, then the toast closes. */
  onUndo?: () => void;
  /** "error" shows a critical icon (never raw error text: keep the message human). */
  tone?: "success" | "error";
  /** Milliseconds; 5 s with undo, otherwise 3 s. */
  duration?: number;
}

interface ToastState extends ToastInput {
  id: number;
}

let current: ToastState | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function showToast(input: ToastInput) {
  if (timer) clearTimeout(timer);
  current = { ...input, id: nextId++ };
  const duration = input.duration ?? (input.onUndo ? 5000 : 3000);
  const id = current.id;
  timer = setTimeout(() => dismissToast(id), duration);
  emit();
}

export function dismissToast(id?: number) {
  if (id !== undefined && current?.id !== id) return;
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ToastViewport() {
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const reduced = useReducedMotion();
  const t = useT();

  useEffect(() => () => dismissToast(), []);

  return (
    <div
      aria-live="polite"
      data-toast-viewport=""
      className="pointer-events-none fixed inset-x-0 bottom-7 z-[100] flex justify-center px-4"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {toast && (
          <motion.div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto flex h-12 max-w-full items-center gap-3 rounded-pill bg-inverse pl-[18px] text-[14px] whitespace-nowrap text-ink-inverse shadow-[0_24px_60px_-18px_rgba(23,21,28,.5)]",
              toast.onUndo ? "pr-2" : "pr-[18px]",
            )}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={
              reduced
                ? { opacity: 1, transition: REDUCED_FADE }
                : { opacity: 1, y: 0, scale: 1, transition: SPRING.smooth }
            }
            exit={
              reduced
                ? { opacity: 0, transition: REDUCED_FADE }
                : { opacity: 0, y: 12, transition: { duration: 0.16, ease: EASE.in } }
            }
          >
            {toast.tone === "error" ? (
              <CircleAlert
                className="size-4 shrink-0 text-critical"
                strokeWidth={1.9}
                aria-hidden
              />
            ) : (
              <CircleCheck
                className="size-4 shrink-0 text-positive"
                strokeWidth={1.9}
                aria-hidden
              />
            )}
            <span className="truncate">{toast.message}</span>
            {toast.onUndo && (
              <button
                type="button"
                onClick={() => {
                  const undo = toast.onUndo;
                  dismissToast(toast.id);
                  undo?.();
                }}
                className="h-[34px] shrink-0 rounded-pill bg-[color-mix(in_oklab,var(--ink-inverse)_14%,transparent)] px-3.5 text-meta font-semibold text-ink-inverse transition-colors hover:bg-[color-mix(in_oklab,var(--ink-inverse)_22%,transparent)]"
              >
                {t("shell.toast.undo")}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
