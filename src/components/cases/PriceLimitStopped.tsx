/**
 * "Stoppet på prisgrænsen" (on the server, on the screen, spec B.1 punkt 4): the run
 * reached the team's limit on the way. What was finished is kept, and continuing pays only for
 * what is missing. Calm, not an error: no red, and never an amount on the case
 * (beslutningslog 2. nov). Only a member who may start analyses gets "Fortsæt".
 */
import { Gauge, RefreshCw } from "lucide-react";
import { PendingLabel } from "@/components/ai/AiOrb";
import { Link } from "@tanstack/react-router";
import { buttonClass } from "@/components/ds/Button";
import { useT } from "@/lib/i18n/useT";

export function PriceLimitStopped({
  kind,
  onContinue,
  continuing = false,
  canEditLimits = false,
}: {
  kind: "screening" | "deep";
  /** Absent for a member who may not start analyses. */
  onContinue?: (() => void) | undefined;
  continuing?: boolean;
  /** Admin and Lead get "Edit limits" next to it (Team setup → Analysis limits). */
  canEditLimits?: boolean;
}) {
  const t = useT();
  return (
    <section
      aria-labelledby="price-limit-stopped"
      className="grid min-h-[320px] place-items-center rounded-xl bg-canvas p-6 text-center"
    >
      <div className="max-w-lg">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-sunken text-ink-2">
          <Gauge className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <h2 id="price-limit-stopped" className="mt-4 mb-0 text-section font-semibold text-ink-1">
          {t("caseView.priceLimit.title")}
        </h2>
        <p className="mt-2 mb-0 text-list leading-5 text-ink-2">
          {t(
            kind === "deep" ? "caseView.priceLimit.bodyDeep" : "caseView.priceLimit.bodyScreening",
          )}
        </p>
        <p className="mt-1 mb-0 text-meta text-ink-3">
          {t(onContinue ? "caseView.priceLimit.helpRun" : "caseView.priceLimit.helpRead")}
        </p>
        {onContinue && !canEditLimits && (
          <p className="mt-1 mb-0 text-meta text-ink-3">{t("caseView.priceLimit.helpAskLead")}</p>
        )}
        {(onContinue || canEditLimits) && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {canEditLimits && (
              <Link to="/fond" className={buttonClass({ variant: "secondary", size: "md" })}>
                {t("fundSetup.analysisLimits.edit")}
              </Link>
            )}
            {onContinue && (
              <button type="button" className="pill-cta" disabled={continuing} onClick={onContinue}>
                {continuing ? (
                  <PendingLabel tone="ai" state="breathing" onDark>
                    {t("caseView.route.queueing")}
                  </PendingLabel>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" aria-hidden />
                    {t(
                      kind === "deep"
                        ? "caseView.priceLimit.continueDeep"
                        : "caseView.priceLimit.continueScreening",
                    )}
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
