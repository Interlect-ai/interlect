/**
 * The case page while it loads: the screening's own shape in quiet sunken blocks
 * (phase switcher, name, summary, the score on the right, the tabs and the four cards) instead
 * of a blank page with "Henter case …" in the corner. Same container and gaps as `Page` in
 * ScreeningCaseView, so nothing jumps when the case arrives. The pulse is off with reduced
 * motion. After `slowAfterMs` a quiet line says it takes longer than usual; the route
 * itself stops waiting and shows an error with "Prøv igen" (CASE_LOAD_TIMEOUT_MS).
 */
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

function Block({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn("block rounded-md bg-sunken motion-safe:animate-pulse", className)}
    />
  );
}

export function CaseSkeleton({ slowAfterMs = 8_000 }: { slowAfterMs?: number }) {
  const t = useT();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(timer);
  }, [slowAfterMs]);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex max-w-[1120px] flex-col gap-8 px-4 pt-7 pb-[72px] md:px-11 md:pt-9"
    >
      <span className="sr-only">{t("caseView.route.loading")}</span>
      <div className="flex items-center gap-2.5">
        <Block className="h-10 w-[200px] rounded-pill" />
        <Block className="h-10 w-[150px] rounded-pill" />
      </div>
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
        <div className="flex flex-col gap-3">
          <Block className="h-3 w-28" />
          <Block className="h-11 w-[min(320px,70%)]" />
          <Block className="h-4 w-[min(520px,90%)]" />
          <div className="mt-2 flex flex-col gap-2.5">
            <Block className="h-4 w-full max-w-[680px]" />
            <Block className="h-4 w-full max-w-[640px]" />
            <Block className="h-4 w-[70%] max-w-[560px]" />
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <Block className="h-[84px] w-[140px]" />
          <Block className="h-2 w-[200px]" />
        </div>
      </div>
      <Block className="h-11 w-[min(460px,100%)] rounded-pill" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-3">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            aria-hidden
            className="flex h-[226px] flex-col justify-between rounded-xl bg-canvas p-[22px]"
          >
            <Block className="h-4 w-28" />
            <Block className="h-8 w-24" />
          </span>
        ))}
      </div>
      {slow && <p className="m-0 text-list text-ink-3">{t("caseView.route.loadingSlow")}</p>}
    </div>
  );
}
