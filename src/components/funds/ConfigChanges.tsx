/**
 * E6: "Ændret siden vN" i læsevisningen af den aktive opsætning. Viser kun ændringer, der
 * påvirker analysen; eksisterende analyser er låst til den version, de blev kørt med.
 */
import { useState } from "react";
import type { EditableFundConfig } from "@/lib/funds/config.functions";
import { diffFundConfigs } from "@/lib/funds/config-diff";
import { useLanguage, useT } from "@/lib/i18n/useT";

const VISIBLE = 5;

export function ConfigChanges({
  active,
  previous,
}: {
  active: EditableFundConfig;
  previous: EditableFundConfig | null;
}) {
  const t = useT();
  const language = useLanguage();
  const [expanded, setExpanded] = useState(false);
  if (!previous) return null;
  const changes = diffFundConfigs(previous, active, language);
  const shown = expanded ? changes : changes.slice(0, VISIBLE);
  return (
    <section className="rounded-xl border border-hairline bg-surface px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-section font-semibold text-ink">
          {t("fundSetup.changes.heading", { version: previous.version })}
        </h2>
        <span className="text-meta text-ink-4">
          {t(changes.length === 1 ? "fundSetup.changes.countOne" : "fundSetup.changes.countMany", {
            count: changes.length,
          })}
        </span>
      </div>
      {changes.length === 0 ? (
        <p className="mt-2 text-list text-ink-3">{t("fundSetup.changes.none")}</p>
      ) : (
        <ul className="mt-2 grid gap-1.5 text-list text-ink-2">
          {shown.map((change) => (
            <li key={change} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-3" />
              {change}
            </li>
          ))}
        </ul>
      )}
      {changes.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-2 text-meta text-action hover:text-action-hover"
        >
          {expanded
            ? t("fundSetup.changes.showFewer")
            : t("fundSetup.changes.showAll", { count: changes.length })}
        </button>
      )}
      <p className="mt-3 text-meta text-ink-4">
        {t("fundSetup.changes.locked", { version: previous.version })}
      </p>
    </section>
  );
}
