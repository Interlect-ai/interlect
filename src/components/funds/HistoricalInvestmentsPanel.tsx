import { PendingLabel } from "@/components/ai/AiOrb";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import {
  deleteHistoricalInvestment,
  listHistoricalInvestments,
  saveHistoricalInvestment,
} from "@/lib/funds/config.functions";
import { LoadingState } from "@/components/states/StateBlocks";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { userMessage } from "@/lib/errors/user-message";

/**
 * Investeringsteamets egne tidligere investeringer, logget manuelt -- for
 * eksempel historik fra før Interlect.ai blev taget i brug. Uafhængig af
 * draft/publish-cyklen: dette er fondens egen historie, ikke en del af
 * analyseopsætningen.
 */
export function HistoricalInvestmentsPanel({
  fundId,
  canEdit,
}: {
  fundId: string;
  canEdit: boolean;
}) {
  const t = useT();
  const dateFormat = new Intl.DateTimeFormat(useLocaleTag(), { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const loadList = useServerFn(listHistoricalInvestments);
  const save = useServerFn(saveHistoricalInvestment);
  const remove = useServerFn(deleteHistoricalInvestment);
  const [adding, setAdding] = useState(false);

  const query = useQuery({
    queryKey: ["historical-investments", fundId],
    queryFn: () => loadList({ data: { fundId } }),
  });

  const saveMutation = useMutation({
    mutationFn: (input: {
      companyName: string;
      website: string;
      investedAt: string;
      stage: string;
      sector: string;
      geography: string;
      note: string;
    }) => save({ data: { fundId, ...input } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["historical-investments", fundId] });
      setAdding(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { fundId, id } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["historical-investments", fundId] }),
  });

  const investments = query.data ?? [];

  return (
    <section className="rounded-md border border-border-subtle p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-body font-semibold text-ink">{t("fundSetup.historical.title")}</h3>
          <p className="mt-1 max-w-2xl text-list leading-5 text-ink-3">
            {t("fundSetup.historical.intro")}
          </p>
        </div>
        {canEdit && !adding && (
          <button type="button" className="control-button" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden />
            {t("fundSetup.historical.add")}
          </button>
        )}
      </div>

      {adding && (
        <AddInvestmentForm
          isPending={saveMutation.isPending}
          error={saveMutation.isError ? saveMutation.error : null}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => saveMutation.mutate(input)}
        />
      )}

      {query.isLoading && <LoadingState title={t("fundSetup.historical.loading")} />}

      {!query.isLoading && investments.length === 0 && (
        <p className="mt-4 text-list text-ink-3">{t("fundSetup.historical.empty")}</p>
      )}

      {investments.length > 0 && (
        <ul className="mt-4 divide-y divide-border-subtle">
          {investments.map((investment) => (
            <li key={investment.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-list text-ink">
                  {investment.companyName}
                  {investment.sector && (
                    <span className="ml-1.5 text-ink-3">· {investment.sector}</span>
                  )}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-meta text-ink-3">
                  {investment.investedAt && (
                    <span>{dateFormat.format(new Date(investment.investedAt))}</span>
                  )}
                  {investment.stage && <span>{investment.stage}</span>}
                  {investment.geography && <span>{investment.geography}</span>}
                </p>
                {investment.note && (
                  <p className="mt-1 max-w-prose text-list leading-5 text-ink-2">
                    {investment.note}
                  </p>
                )}
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="icon-control text-ink-3 hover:text-critical"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(investment.id)}
                  aria-label={t("fundSetup.historical.removeAria", {
                    name: investment.companyName,
                  })}
                  title={t("fundSetup.historical.remove")}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddInvestmentForm({
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  isPending: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (input: {
    companyName: string;
    website: string;
    investedAt: string;
    stage: string;
    sector: string;
    geography: string;
    note: string;
  }) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [investedAt, setInvestedAt] = useState("");
  const [stage, setStage] = useState("");
  const [sector, setSector] = useState("");
  const [geography, setGeography] = useState("");
  const [note, setNote] = useState("");

  return (
    <form
      className="mt-4 space-y-3 rounded-sm border border-border-subtle bg-surface-subtle p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ companyName, website, investedAt, stage, sector, geography, note });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-list text-ink-3">
          {t("fundSetup.historical.company")}
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            required
            className="field-control mt-1 w-full"
          />
        </label>
        <label className="block text-list text-ink-3">
          {t("fundSetup.historical.website")}
          <input
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="https://"
            className="field-control mt-1 w-full"
          />
        </label>
        <label className="block text-list text-ink-3">
          {t("fundSetup.historical.date")}
          <input
            type="date"
            value={investedAt}
            onChange={(event) => setInvestedAt(event.target.value)}
            className="field-control mt-1 w-full"
          />
        </label>
        <label className="block text-list text-ink-3">
          {t("fundSetup.historical.stage")}
          <input
            value={stage}
            onChange={(event) => setStage(event.target.value)}
            className="field-control mt-1 w-full"
          />
        </label>
        <label className="block text-list text-ink-3">
          {t("fundSetup.historical.sector")}
          <input
            value={sector}
            onChange={(event) => setSector(event.target.value)}
            className="field-control mt-1 w-full"
          />
        </label>
        <label className="block text-list text-ink-3">
          {t("fundSetup.historical.geography")}
          <input
            value={geography}
            onChange={(event) => setGeography(event.target.value)}
            className="field-control mt-1 w-full"
          />
        </label>
      </div>
      <label className="block text-list text-ink-3">
        {t("fundSetup.historical.note")}
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          className="field-control mt-1 w-full"
          placeholder={t("fundSetup.historical.notePlaceholder")}
        />
      </label>
      {error !== null && (
        <p className="text-list text-critical">
          {userMessage(error, t("fundSetup.historical.saveFailed"), language)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="control-button" onClick={onCancel} disabled={isPending}>
          {t("fundSetup.historical.cancel")}
        </button>
        <button
          type="submit"
          className="control-button"
          disabled={isPending || companyName.trim().length === 0}
        >
          {isPending ? (
            <PendingLabel>{t("fundSetup.historical.saving")}</PendingLabel>
          ) : (
            t("fundSetup.historical.save")
          )}
        </button>
      </div>
    </form>
  );
}
