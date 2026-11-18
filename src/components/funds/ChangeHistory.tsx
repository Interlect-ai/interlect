/**
 * "Historik" on the Se page, for Admin and Lead: who changed the setup, newest first, in
 * plain Danish. Folded away until opened; nothing is fetched before then (FoldSection mounts the
 * content only while open).
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LoadingState } from "@/components/ds/States";
import { listFundChangeHistory } from "@/lib/funds/change-history.functions";
import { useLocaleTag, useT } from "@/lib/i18n/useT";

function when(iso: string, localeTag: string): string {
  return new Date(iso).toLocaleString(localeTag, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChangeHistory({ fundId }: { fundId: string }) {
  const t = useT();
  const localeTag = useLocaleTag();
  const list = useServerFn(listFundChangeHistory);
  const query = useQuery({
    queryKey: ["fund-change-history", fundId],
    queryFn: () => list({ data: { fundId } }),
  });
  if (query.isLoading) return <LoadingState title={t("fundSetup.history.loading")} />;
  if (query.isError || !query.data) {
    return <p className="m-0 text-list text-ink-3">{t("fundSetup.history.loadError")}</p>;
  }
  if (query.data.length === 0) {
    return <p className="m-0 text-list text-ink-3">{t("fundSetup.history.empty")}</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {query.data.map((entry, index) => (
        <li
          key={entry.id}
          className={`grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-2.5 text-list ${index > 0 ? "border-t border-line" : ""}`}
        >
          <span className="text-meta text-ink-3 tabular-nums">{when(entry.at, localeTag)}</span>
          <span className="min-w-0">
            {entry.text}
            <span className="block text-meta text-ink-3">{entry.actor ?? "Interlect"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
