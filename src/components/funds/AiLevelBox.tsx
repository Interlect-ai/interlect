/**
 * The AI level on /fond: the fund's level (Let, Middel, Tung) for screening and
 * deep analysis. Everyone reads it; only Admin and Lead (`canEdit`) change it. A level is saved
 * at once and applies to later runs. No kroner here (P13): the cap per run is the
 * standard one or one already confirmed; only its warning is shown, with "Brug standard" to lift
 * an earlier cap. The balance stands in the credit meter.
 * Deep analysis does not offer Let (Let failed in the synthesis on Pleo).
 * The box is hidden until the database migration 0036 has run (`available: false`).
 */
import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ds/Button";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { showToast } from "@/components/ds/Toast";
import type { AiTier } from "@/lib/analysis/model-tiers";
import {
  getFundAiSettings,
  updateFundAiSettings,
  type AiKindSettings,
} from "@/lib/funds/ai-settings.functions";
import type { MessageKey } from "@/lib/i18n/translate";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { userMessage } from "@/lib/errors/user-message";

type Kind = "screening" | "deep";

const KIND_LABEL: Record<Kind, MessageKey> = {
  screening: "fundSetup.aiLevel.screening",
  deep: "fundSetup.aiLevel.deep",
};
const TIER_LABEL: Record<AiTier, MessageKey> = {
  light: "fundSetup.aiLevel.tierLight",
  medium: "fundSetup.aiLevel.tierMedium",
  heavy: "fundSetup.aiLevel.tierHeavy",
};
const TIER_THOROUGHNESS: Record<AiTier, MessageKey> = {
  light: "fundSetup.aiLevel.thoroughLight",
  medium: "fundSetup.aiLevel.thoroughMedium",
  heavy: "fundSetup.aiLevel.thoroughHeavy",
};

const aiSettingsKey = (fundId: string) => ["fund-ai-settings", fundId] as const;

export function AiLevelBox({ fundId }: { fundId: string }) {
  const t = useT();
  const language = useLanguage();
  const load = useServerFn(getFundAiSettings);
  const save = useServerFn(updateFundAiSettings);
  const queryClient = useQueryClient();
  const headingId = useId();
  const query = useQuery({
    queryKey: aiSettingsKey(fundId),
    queryFn: () => load({ data: { fundId } }),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (change: {
      screeningTier?: AiTier;
      deepTier?: AiTier;
      screeningCapDkk?: null;
      deepCapDkk?: null;
    }) => save({ data: { fundId, ...change } }),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: ["fund-change-history", fundId] });
      await queryClient.invalidateQueries({ queryKey: aiSettingsKey(fundId) });
      showToast({ message: t("fundSetup.aiLevel.appliesToast") });
    },
    onError: (error) => {
      showToast({
        message: userMessage(error, t("fundSetup.aiLevel.saveFailed"), language),
        tone: "error",
      });
    },
  });

  const settings = query.data;
  if (query.isLoading) {
    return (
      <section
        className="flex flex-col gap-2 rounded-lg bg-canvas p-[22px]"
        aria-busy="true"
        aria-label={t("fundSetup.aiLevel.label")}
      >
        <div className="h-5 w-72 max-w-full animate-pulse rounded-md bg-sunken" />
        <div className="h-4 w-48 animate-pulse rounded-md bg-sunken" />
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="flex flex-col gap-1 rounded-lg bg-canvas p-[22px]">
        <h2 className="m-0 text-list font-semibold">{t("fundSetup.aiLevel.heading")}</h2>
        <p className="m-0 text-list text-ink-3">{t("fundSetup.aiLevel.loadError")}</p>
        <div>
          <Button variant="secondary" size="md" onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      </section>
    );
  }
  if (!settings || !settings.available) return null;

  const canEdit = settings.canEdit;
  const rows: { kind: Kind; data: AiKindSettings }[] = [
    { kind: "screening", data: settings.screening },
    { kind: "deep", data: settings.deep },
  ];
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-[18px] rounded-lg bg-canvas p-[22px]"
    >
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="m-0 text-list font-semibold">
          {t("fundSetup.aiLevel.heading")}
        </h2>
        <p className="m-0 text-meta text-ink-3">
          {canEdit ? t("fundSetup.aiLevel.helpEdit") : t("fundSetup.aiLevel.helpReadOnly")}
        </p>
      </header>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-x-8 gap-y-6">
        {rows.map(({ kind, data }) => (
          <TierRow
            key={kind}
            kind={kind}
            data={data}
            canEdit={canEdit}
            busy={mutation.isPending}
            onTier={(tier) =>
              mutation.mutate(kind === "screening" ? { screeningTier: tier } : { deepTier: tier })
            }
            onStandardCap={() =>
              mutation.mutate(
                kind === "screening" ? { screeningCapDkk: null } : { deepCapDkk: null },
              )
            }
          />
        ))}
      </div>
    </section>
  );
}

function TierRow({
  kind,
  data,
  canEdit,
  busy,
  onTier,
  onStandardCap,
}: {
  kind: Kind;
  data: AiKindSettings;
  canEdit: boolean;
  busy: boolean;
  onTier: (tier: AiTier) => void;
  /** Back to the standard cap, the only way to lift an earlier, too low cap (no kroner here). */
  onStandardCap: () => void;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  const chosen = data.tiers.find((tier) => tier.tier === data.tier) ?? data.tiers[0]!;
  // Let is not offered for deep analysis; a fund that already has it keeps seeing it.
  const options = data.tiers
    .filter((tier) => kind !== "deep" || tier.tier !== "light" || data.tier === "light")
    .map((tier) => ({ value: tier.tier, label: t(TIER_LABEL[tier.tier]) }));
  // The arrow keys select as they move: a level is saved once the reader has stopped, not at
  // every step (a level changes what runs cost, and each save writes an audit row).
  const [pending, setPending] = useState<AiTier | null>(null);
  useEffect(() => setPending(null), [data.tier]);
  useEffect(() => {
    if (pending === null || pending === data.tier) return;
    const timer = setTimeout(() => onTier(pending), 700);
    return () => clearTimeout(timer);
    // onTier is a new function on every render; the timer restarts only when the choice changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, data.tier]);
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-[88px] text-list font-semibold">{t(KIND_LABEL[kind])}</span>
        {canEdit ? (
          <SegmentedControl<AiTier>
            aria-label={t("fundSetup.aiLevel.tierAria", {
              kind: t(KIND_LABEL[kind]).toLocaleLowerCase(localeTag),
            })}
            size="sm"
            value={pending ?? data.tier}
            options={options}
            onChange={setPending}
          />
        ) : (
          <span className="text-list text-ink-1">{t(TIER_LABEL[chosen.tier])}</span>
        )}
      </div>
      <p className="m-0 text-meta text-ink-3">{t(TIER_THOROUGHNESS[chosen.tier])}</p>
      {data.capWarning && (
        <p className="m-0 text-meta text-critical">{t("fundSetup.aiLevel.capBelowCost")}</p>
      )}
      {canEdit && data.confirmedCapDkk !== null && (
        <div>
          <Button variant="quiet" size="md" disabled={busy} onClick={onStandardCap}>
            {t("fundSetup.aiLevel.useStandard")}
          </Button>
        </div>
      )}
    </div>
  );
}
