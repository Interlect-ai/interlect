import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Lock, RefreshCw } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { useT } from "@/lib/i18n/useT";

/**
 * Differentierede tilstande: indlæsning er en stille linje, tomhed er
 * venstrestillet med plads til én handling, fejl og manglende adgang er
 * afgrænsede. Ingen identisk centreret kasse overalt.
 */

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string | undefined;
  action?: ReactNode | undefined;
}) {
  return (
    <div className="max-w-xl py-10">
      <div className="flex items-start gap-3">
        <Inbox className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
        <div className="min-w-0">
          <p className="text-body font-medium text-ink">{title}</p>
          {body && <p className="mt-1 text-list leading-5 text-ink-2">{body}</p>}
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}

export function LoadingState({ title }: { title?: string }) {
  const t = useT();
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 py-8 text-list text-ink-2"
    >
      <AiOrb size={20} state="breathing" />
      {title ?? t("shell.blocks.loading")}
    </p>
  );
}

export function ErrorState({
  title,
  body,
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: (() => void) | undefined;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="max-w-xl rounded-sm border border-critical/40 bg-critical/5 px-4 py-3"
    >
      <p className="flex items-center gap-2 text-body font-medium text-critical">
        <AlertTriangle className="size-3.5" aria-hidden />
        {title ?? t("shell.states.errorTitle")}
      </p>
      <p className="mt-1 text-list leading-5 text-ink-2">{body ?? t("shell.blocks.errorBody")}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="control-button mt-3">
          <RefreshCw className="size-3.5" aria-hidden /> {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function PermissionDeniedState({ body }: { body?: string }) {
  const t = useT();
  return (
    <div className="surface max-w-xl px-4 py-4">
      <p className="flex items-center gap-2 text-body font-medium text-ink">
        <Lock className="size-3.5 text-ink-3" aria-hidden />
        {t("shell.blocks.noAccessTitle")}
      </p>
      <p className="mt-1 text-list leading-5 text-ink-2">
        {body ?? t("shell.blocks.noAccessBody")}
      </p>
    </div>
  );
}

/** Used where a surface will hold real data from a later milestone. */
export function NotWiredState({ area }: { area: string }) {
  const t = useT();
  return (
    <EmptyState
      title={t("shell.blocks.notWiredTitle", { area })}
      body={t("shell.blocks.notWiredBody")}
    />
  );
}
