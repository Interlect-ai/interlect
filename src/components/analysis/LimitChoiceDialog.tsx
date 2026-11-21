/**
 * "Spørg mig først" (spec B.1 punkt 3): when the team has chosen to be asked and the full
 * analysis does not fit its limit, nothing has started yet. The person chooses: run a smaller
 * analysis, raise the limit once (Admin and Lead only; the server checks it too), or cancel. No
 * kroner here (beslutningslog 2. nov: no price on the case).
 *
 * `askLimitChoice` can be awaited from any start (case page, case list, Opret case); the one
 * `<LimitChoiceHost />` in the root renders the dialog. `startWithLimitChoice` wraps a start: it
 * asks only when the server answers `limit_choice_needed`, and returns null when cancelled.
 */
import { useSyncExternalStore } from "react";
import { Scale } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import { useT } from "@/lib/i18n/useT";
import { answer, currentLimitChoice, subscribe, type Pending } from "@/lib/analysis/limit-choice";

export function LimitChoiceHost() {
  const current = useSyncExternalStore(subscribe, currentLimitChoice, () => null);
  // Only mounted while a start is waiting, so no page pays for the access lookup otherwise.
  return current ? <LimitChoiceDialog current={current} /> : null;
}

function LimitChoiceDialog({ current }: { current: Pending }) {
  const t = useT();
  const access = useMyAccess(current.fundId);
  const canRaise = access.data?.capabilities?.includes("configure_fund") === true;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) answer(null);
      }}
      icon={Scale}
      title={t("fundSetup.limitChoice.title")}
      description={t(
        current.kind === "deep"
          ? "fundSetup.limitChoice.bodyDeep"
          : "fundSetup.limitChoice.bodyScreening",
      )}
      footer={
        <>
          <Button variant="quiet" size="md" onClick={() => answer(null)}>
            {t("common.cancel")}
          </Button>
          {canRaise && (
            <Button variant="secondary" size="md" onClick={() => answer("raise_once")}>
              {t("fundSetup.limitChoice.raiseOnce")}
            </Button>
          )}
          <Button variant="primary" size="md" onClick={() => answer("reduce")}>
            {t("fundSetup.limitChoice.reduce")}
          </Button>
        </>
      }
    >
      <p className="m-0 text-list text-ink-3">
        {t(canRaise ? "fundSetup.limitChoice.helpLead" : "fundSetup.limitChoice.helpMember")}
      </p>
    </Dialog>
  );
}
