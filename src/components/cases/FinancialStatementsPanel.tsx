import { financialMetricLabel } from "@/lib/analysis/financial-labels";
import { currencySuffix } from "@/lib/analysis/financial-format";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, RefreshCw, Search, TrendingDown, TrendingUp, Wand2 } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import {
  FOREIGN_REGISTRY_COUNTRIES,
  isForeignRegistryCountry,
  registryNumberLabel,
  type RegistryCountry,
} from "@/lib/analysis/registries/types";
import {
  fetchCompanyFinancials,
  fetchForeignCompanyFinancials,
  listFinancialStatements,
  lookupCvrByName,
  type CvrCompanyMatch,
  type FinancialRatio,
} from "@/lib/cases/financials.functions";
import { userMessage } from "@/lib/errors/user-message";

/**
 * Selskabets offentlige, indberettede regnskaber (CVR/Erhvervsstyrelsen) --
 * ikke AI-genereret. Hvert tal er enten det virksomheden faktisk har
 * indberettet, eller det vises slet ikke. Danske selskaber hentes fra CVR, andre fra landets
 * eget register (land + registernummer, fx norsk org.nr.).
 */
export function FinancialStatementsPanel({
  fundId,
  caseId,
  companyName,
}: {
  fundId: string;
  caseId: string;
  companyName: string;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(localeTag, { dateStyle: "medium" }),
    [localeTag],
  );
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(localeTag, { maximumFractionDigits: 0 }),
    [localeTag],
  );
  const queryClient = useQueryClient();
  const [cvrNumber, setCvrNumber] = useState("");
  // null: landet fra det seneste regnskab (ellers Danmark), til brugeren vælger et andet.
  const [countryChoice, setCountryChoice] = useState<RegistryCountry | null>(null);
  const regionNames = useMemo(
    () => new Intl.DisplayNames([localeTag], { type: "region" }),
    [localeTag],
  );
  const [cvrCandidates, setCvrCandidates] = useState<CvrCompanyMatch[] | null>(null);
  const list = useServerFn(listFinancialStatements);
  const fetchFinancials = useServerFn(fetchCompanyFinancials);
  const fetchForeign = useServerFn(fetchForeignCompanyFinancials);
  const lookupCvr = useServerFn(lookupCvrByName);

  const query = useQuery({
    queryKey: ["financial-statements", caseId, language],
    queryFn: () => list({ data: { fundId, caseId } }),
  });

  const fetchMutation = useMutation({
    mutationFn: () =>
      isForeignRegistryCountry(country)
        ? fetchForeign({ data: { fundId, caseId, country, registryNumber: effectiveCvr } })
        : fetchFinancials({ data: { fundId, caseId, cvrNumber: effectiveCvr } }),
    onSuccess: () => {
      // Load the list again instead of using the fetch's answer: the list also adds the figures
      // entered on the case, which the fetch does not know about.
      void queryClient.invalidateQueries({ queryKey: ["financial-statements", caseId] });
      // Det valgte CVR ændrer selskabets identitet: hent casen igen.
      void queryClient.invalidateQueries({ queryKey: ["case", caseId, fundId] });
    },
    // Even a refused fetch may have changed what is stored: show the current state.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["financial-statements", caseId, language] });
      void queryClient.invalidateQueries({ queryKey: ["case", caseId, fundId] });
    },
  });

  const fetchWarnings = fetchMutation.data?.warnings ?? [];

  const lookupMutation = useMutation({
    mutationFn: () => lookupCvr({ data: { fundId, caseId, name: companyName, country } }),
    onSuccess: (matches) => {
      if (matches.length === 1) {
        setCvrNumber(matches[0]!.cvrNumber);
        setCvrCandidates(null);
      } else {
        setCvrCandidates(matches);
      }
    },
  });

  const statements = query.data?.statements ?? [];
  const country: RegistryCountry = countryChoice ?? statements[0]?.registryCountry ?? "DK";
  const foreign = country !== "DK";
  const numberLabel = registryNumberLabel(country);
  // "Hent seneste igen" bruger det kendte nummer i det valgte land, når feltet er tomt.
  const knownCvr = statements[0]?.registryCountry === country ? statements[0].cvrNumber : "";
  const effectiveCvr = cvrNumber.trim() || knownCvr;
  const canFetch = foreign ? effectiveCvr.length > 0 : effectiveCvr.length === 8;
  const ratios = fetchMutation.data?.ratios ?? query.data?.ratios ?? [];
  const latest = statements[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="registry-country" className="block text-meta text-ink-3">
            {t("finance.statements.country")}
          </label>
          <select
            id="registry-country"
            value={country}
            onChange={(e) => {
              setCountryChoice(e.target.value as RegistryCountry);
              setCvrNumber("");
              setCvrCandidates(null);
            }}
            className="field-control mt-1 max-w-[180px]"
          >
            {(["DK", ...FOREIGN_REGISTRY_COUNTRIES] as const).map((code) => (
              <option key={code} value={code}>
                {regionNames.of(code) ?? code}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="cvr-input" className="block text-meta text-ink-3">
            {foreign ? numberLabel : t("finance.statements.cvrNumber")}
          </label>
          <input
            id="cvr-input"
            value={cvrNumber}
            onChange={(e) =>
              setCvrNumber(
                foreign
                  ? e.target.value.slice(0, 40)
                  : e.target.value.replace(/\D/g, "").slice(0, 8),
              )
            }
            placeholder={foreign ? knownCvr : t("finance.statements.cvrPlaceholder")}
            inputMode={foreign ? "text" : "numeric"}
            className="field-control mt-1 max-w-[220px]"
          />
        </div>
        <button
          type="button"
          disabled={lookupMutation.isPending}
          onClick={() => {
            setCvrCandidates(null);
            lookupMutation.mutate();
          }}
          className="control-button-quiet"
        >
          {lookupMutation.isPending ? (
            <AiOrb size={20} state="searching" tone="ai" />
          ) : (
            <Wand2 className="size-3.5" aria-hidden />
          )}
          {foreign
            ? t("finance.statements.lookupAutoForeign", { label: numberLabel })
            : t("finance.statements.lookupAuto")}
        </button>
        {!foreign && (
          <a
            href={`https://datacvr.virk.dk/soegeresultater?fritekst=${encodeURIComponent(companyName)}&sideIndex=0&size=10`}
            target="_blank"
            rel="noreferrer"
            className="control-button-quiet"
          >
            <Search className="size-3.5" aria-hidden />
            {t("finance.statements.findCvr")}
          </a>
        )}
        <button
          type="button"
          disabled={!canFetch || fetchMutation.isPending}
          onClick={() => fetchMutation.mutate()}
          className="control-button"
        >
          {fetchMutation.isPending ? (
            <AiOrb size={20} state="searching" tone="ai" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden />
          )}
          {statements.length > 0
            ? t("finance.statements.fetchAgain")
            : t("finance.statements.fetchPublic")}
        </button>
      </div>

      {lookupMutation.isError && (
        <p className="text-meta text-critical">
          {userMessage(lookupMutation.error, t("finance.statements.lookupFailed"), language)}
        </p>
      )}

      {cvrCandidates && cvrCandidates.length === 0 && (
        <p className="text-meta text-ink-3">
          {foreign
            ? t("finance.statements.noMatchForeign", { name: companyName, label: numberLabel })
            : t("finance.statements.noMatch", { name: companyName })}
        </p>
      )}

      {cvrCandidates && cvrCandidates.length > 1 && (
        <div className="space-y-1">
          <p className="text-meta text-ink-3">
            {t("finance.statements.manyMatches", { name: companyName })}
          </p>
          <ul className="space-y-1">
            {cvrCandidates.map((candidate) => (
              <li key={candidate.cvrNumber}>
                <button
                  type="button"
                  onClick={() => {
                    setCvrNumber(candidate.cvrNumber);
                    setCvrCandidates(null);
                  }}
                  className="control-button-quiet w-full justify-start text-left"
                >
                  {candidate.name}{" "}
                  <span className="text-ink-4">
                    · {numberLabel} {candidate.cvrNumber}
                  </span>{" "}
                  <span className="text-ink-4">· {candidate.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fetchMutation.isError && (
        <p className="text-meta text-critical">
          {userMessage(fetchMutation.error, t("finance.statements.fetchFailed"), language)}
        </p>
      )}

      {fetchWarnings.map((warning) => (
        <p key={warning} className="text-meta text-warning">
          {warning}
        </p>
      ))}

      {query.isLoading && <p className="text-meta text-ink-3">{t("finance.statements.loading")}</p>}

      {query.isError && (
        <p className="text-meta text-critical" role="alert">
          {t("finance.statements.loadFailed")}
        </p>
      )}

      {statements.length === 0 &&
        !query.isLoading &&
        !query.isError &&
        !fetchMutation.isPending && (
          <p className="text-meta text-ink-4">{t("finance.statements.none")}</p>
        )}

      {latest && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-hairline pt-3">
            <div>
              <p className="text-list font-medium text-ink">
                {t("finance.statements.period", {
                  from: dateFormat.format(new Date(latest.periodStart)),
                  to: dateFormat.format(new Date(latest.periodEnd)),
                })}
              </p>
              {latest.reportingClassText && (
                <p className="text-meta text-ink-3">{latest.reportingClassText}</p>
              )}
            </div>
            <a
              href={latest.sourceDocumentUrl}
              target="_blank"
              rel="noreferrer"
              className="control-button-quiet"
            >
              <Download className="size-3.5" aria-hidden />
              {t("finance.statements.download")}
            </a>
          </div>

          <RatioGrid ratios={ratios} currency={latest.currency} />

          <details className="group">
            <summary className="cursor-pointer text-meta text-ink-3 marker:content-none hover:text-ink-2">
              {t("finance.statements.showFigures", { count: latest.lineItems.length })}
            </summary>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {latest.lineItems.map((item) => (
                <div key={item.metric} className="flex items-baseline justify-between gap-3">
                  <dt className="truncate text-meta text-ink-3">
                    {financialMetricLabel(item.metric, language)}
                  </dt>
                  <dd className="mono-num shrink-0 text-meta text-ink">
                    {numberFormat.format(item.value)} {item.unit}
                  </dd>
                </div>
              ))}
            </dl>
          </details>

          {statements.length > 1 && (
            <p className="text-meta text-ink-4">
              {t("finance.statements.periodsStored", { count: statements.length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Kun ændrings-nøgletal (vs. forrige periode) får en trend-pil -- et snapshot-forhold som soliditetsgrad har ingen retning at vise. */
const trendRatioKeys = new Set(["equity_growth"]);

function RatioGrid({ ratios, currency }: { ratios: FinancialRatio[]; currency: string }) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(localeTag, { maximumFractionDigits: 0 }),
    [localeTag],
  );
  if (ratios.length === 0) return null;
  return (
    <dl className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline bg-surface">
      {ratios.map((ratio) => {
        const showsTrend = trendRatioKeys.has(ratio.key) && ratio.status === "ok";
        const isUp = showsTrend && ratio.value! >= 0;
        return (
          <div
            key={ratio.key}
            className="flex items-center justify-between gap-4 p-3 transition-colors hover:bg-surface-neutral/40"
          >
            <div className="min-w-0">
              <dt className="text-meta text-ink-3">{ratio.label}</dt>
              {!showsTrend && (
                <dd
                  className={`mono-num mt-0.5 text-section ${ratio.status === "ok" ? "text-ink" : "text-ink-4"}`}
                >
                  {ratio.status === "ok"
                    ? ratio.unit === "percent"
                      ? `${ratio.value!.toLocaleString(localeTag, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
                      : ratio.unit === "ratio"
                        ? ratio.value!.toLocaleString(localeTag, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : `${numberFormat.format(ratio.value!)} ${currencySuffix(currency, language)}`
                    : t("finance.economy.cannotCalculate")}
                </dd>
              )}
              {ratio.note && (
                <p className="mt-1 max-w-[38ch] text-meta leading-[1.4] text-ink-4">{ratio.note}</p>
              )}
            </div>
            {showsTrend && (
              <dd
                className={`mono-num flex shrink-0 items-center gap-1 text-section ${isUp ? "text-positive" : "text-critical"}`}
              >
                {isUp ? (
                  <TrendingUp className="size-3.5" aria-hidden />
                ) : (
                  <TrendingDown className="size-3.5" aria-hidden />
                )}
                {isUp ? "+" : ""}
                {ratio.value!.toLocaleString(localeTag, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}{" "}
                %
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
