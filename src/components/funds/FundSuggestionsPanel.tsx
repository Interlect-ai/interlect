/**
 * P3: forslag til fondsopsætningen. Et Medlem kan foreslå en ændring uden selv at kunne
 * ændre opsætningen; en Admin eller Lead markerer forslaget som løst, når det er
 * håndteret (eller afvist). Et forslag ændrer aldrig opsætningen eller analyser.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PendingLabel } from "@/components/ai/AiOrb";
import {
  addFundSuggestion,
  listFundSuggestions,
  setFundSuggestionStatus,
} from "@/lib/funds/suggestions.functions";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

export function FundSuggestionsPanel({ fundId }: { fundId: string }) {
  const t = useT();
  const relativeDate = (value: string) => {
    const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
    return days === 0
      ? t("fundSetup.suggestions.today")
      : days === 1
        ? t("fundSetup.suggestions.yesterday")
        : t("fundSetup.suggestions.daysAgo", { days });
  };
  const queryClient = useQueryClient();
  const load = useServerFn(listFundSuggestions);
  const add = useServerFn(addFundSuggestion);
  const setStatus = useServerFn(setFundSuggestionStatus);
  const [body, setBody] = useState("");
  const queryKey = ["fund-suggestions", fundId];
  const query = useQuery({
    queryKey,
    queryFn: () => load({ data: { fundId } }),
    retry: false,
  });
  const addMutation = useMutation({
    mutationFn: () => add({ data: { fundId, body } }),
    onSuccess: async () => {
      setBody("");
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: "open" | "resolved" }) =>
      setStatus({ data: { fundId, ...input } }),
    // Også ved fejl: status kan være skiftet, selv om revisionsloggen fejlede bagefter.
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (query.isError) {
    return (
      <section className="rounded-xl border border-hairline bg-surface px-5 py-4">
        <h2 className="text-section font-semibold text-ink">{t("fundSetup.suggestions.title")}</h2>
        <p className="mt-1 text-list text-ink-3">
          {t("fundSetup.suggestions.loadError")}{" "}
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="text-action hover:text-action-hover"
          >
            {t("common.retry")}
          </button>
        </p>
      </section>
    );
  }
  const data = query.data;
  if (!data) return null;
  const open = data.suggestions.filter((item) => item.status === "open");
  const resolved = data.suggestions.filter((item) => item.status === "resolved");

  return (
    <section className="rounded-xl border border-hairline bg-surface px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-section font-semibold text-ink">{t("fundSetup.suggestions.title")}</h2>
        <span className="text-meta text-ink-4">
          {t(
            open.length === 1 ? "fundSetup.suggestions.openOne" : "fundSetup.suggestions.openMany",
            { count: open.length },
          )}
        </span>
      </div>
      <p className="mt-1 text-list leading-5 text-ink-3">{t("fundSetup.suggestions.intro")}</p>

      {data.canSuggest && (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim().length >= 3) addMutation.mutate();
          }}
        >
          <label className="sr-only" htmlFor={`suggestion-${fundId}`}>
            {t("fundSetup.suggestions.yourSuggestion")}
          </label>
          <textarea
            id={`suggestion-${fundId}`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={2000}
            className="field-control w-full"
            placeholder={t("fundSetup.suggestions.placeholder")}
          />
          <div className="flex items-center justify-end gap-3">
            {addMutation.isError && (
              <span className="text-meta text-critical">
                {t("fundSetup.suggestions.saveFailed")}
              </span>
            )}
            <button
              type="submit"
              disabled={addMutation.isPending || body.trim().length < 3}
              className="control-button"
            >
              {addMutation.isPending ? (
                <PendingLabel>{t("fundSetup.suggestions.saving")}</PendingLabel>
              ) : (
                t("fundSetup.suggestions.submit")
              )}
            </button>
          </div>
        </form>
      )}

      {data.suggestions.length > 0 && (
        <ul className="mt-4 divide-y divide-hairline">
          {[...open, ...resolved].map((item) => (
            <li
              key={item.id}
              className="group flex flex-wrap items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p
                  id={`suggestion-text-${item.id}`}
                  className={cn(
                    "whitespace-pre-line text-list leading-5",
                    item.status === "resolved" ? "text-ink-3" : "text-ink",
                  )}
                >
                  {item.body}
                </p>
                <p className="mt-1 text-meta text-ink-4">
                  {item.isMine
                    ? t("fundSetup.suggestions.mine")
                    : t("fundSetup.suggestions.fromTeam")}{" "}
                  · {relativeDate(item.createdAt)}
                  {item.status === "resolved" && item.resolvedAt
                    ? ` · ${t("fundSetup.suggestions.resolved", { when: relativeDate(item.resolvedAt) })}`
                    : ""}
                </p>
              </div>
              {data.canResolve && (
                <button
                  type="button"
                  disabled={statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate({
                      id: item.id,
                      status: item.status === "open" ? "resolved" : "open",
                    })
                  }
                  aria-describedby={`suggestion-text-${item.id}`}
                  className="shrink-0 text-meta text-action hover:text-action-hover focus-visible:opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 pointer-coarse:opacity-100"
                >
                  {item.status === "open"
                    ? t("fundSetup.suggestions.markResolved")
                    : t("fundSetup.suggestions.reopen")}
                </button>
              )}
              {statusMutation.isError && statusMutation.variables?.id === item.id && (
                <p className="w-full text-meta text-critical">
                  {t("fundSetup.suggestions.updateFailed")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
