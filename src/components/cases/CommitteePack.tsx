/**
 * The committee pack ("Komitérapport", `?view=komite`): the same data as the deep analysis
 * (`committeeDeep`, the last FINISHED deep run) as one compact document that reads on screen and
 * prints on A4 (a typical case: four pages or fewer). No number is derived here that the analysis
 * does not already have.
 *
 * Page 1 is the decision summary (score, recommendation, condition, conclusion, mandate, top
 * risks); then the criteria, strengths and weaknesses, risks, questions and key figures as
 * compact tables. The long reasoning (the full multi-paragraph assessment and each risk's full
 * rationale) stays in the app; the pack shows the short verdict and the first sentences.
 *
 * Visual language: Geist on the scale 72/48/22/17/15/13/12/11, hairlines between
 * rows, status as a dot and a word (never a pill), the numbered risk markers in ink (only
 * critical is red), no coloured edge stripes, no mid-dots in the text. On paper the boxes lose
 * their fill and the page is always light (the dark theme is switched off while printing), every
 * row keeps together across a page break, and the app's own chrome (menu, buttons) is hidden.
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CircleAlert, Printer } from "lucide-react";
import type { CaseViewModel, RiskView } from "@/lib/cases/view-model";
import { Button } from "@/components/ds/Button";
import {
  deepBasis,
  earlierBasisScreening,
  firstSentences,
  hasRiskCoordinates,
  cellMarker,
  matrixCells,
  numberRisks,
  rationaleParagraphs,
  specialistGroups,
} from "@/lib/cases/deep-view";
import { specialistCatalog } from "@/lib/analysis/specialist-catalog";
import { listFinancialStatements } from "@/lib/cases/financials.functions";
import { formatCalculationValue } from "@/components/cases/CalculationList";
import { financeLabel } from "@/lib/cases/finance-labels";
import { financialInputLabel } from "@/lib/cases/missing-data";
import { HEAT_BACKGROUND, riskMarkerColor, riskMarkerInk } from "./deep/risk-style";
import { riskTitle } from "@/lib/cases/risk-title";
import { scoreChange } from "@/lib/cases/screening-view";
import { formatScore, groupScores, scoreDeltaReason } from "@/lib/cases/presentation";
import { cn } from "@/lib/utils";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import type { MessageKey, TranslateVars } from "@/lib/i18n/translate";

type Translate = (key: MessageKey, vars?: TranslateVars) => string;

const TOP_RISKS = 3;

/** The pack always prints light: the dark theme is lifted while the print dialog is open. */
function useLightWhilePrinting() {
  useEffect(() => {
    const root = document.documentElement;
    let wasDark = false;
    const before = () => {
      wasDark = root.classList.contains("dark");
      root.classList.remove("dark");
    };
    const after = () => {
      if (wasDark) root.classList.add("dark");
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      after();
    };
  }, []);
}

export function CommitteePack({
  model,
  fundId,
  backAction,
}: {
  model: CaseViewModel;
  fundId?: string | undefined;
  backAction?: ReactNode;
}) {
  useLightWhilePrinting();
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(localeTag, { dateStyle: "long" }),
    [localeTag],
  );
  // Always the last FINISHED deep analysis, so the pack does not empty out of numbers while a
  // new run works in the background. Never a screening or a failed run: those are not an
  // investment memo (the empty state below).
  const analysis = model.committeeDeep ?? (model.deep?.status === "complete" ? model.deep : null);
  const loadFinancials = useServerFn(listFinancialStatements);
  const financials = useQuery({
    queryKey: ["financial-statements", model.id, language],
    queryFn: () => loadFinancials({ data: { fundId: fundId!, caseId: model.id } }),
    enabled: Boolean(fundId) && analysis !== null,
  });
  const reportYears = (financials.data?.metrics?.years ?? []).map((periodEnd) =>
    periodEnd.slice(0, 4),
  );
  const isReRunning = Boolean(
    model.committeeDeep && model.deep && model.deep.status !== "complete",
  );
  const hasWarning = analysis?.hasFailedGate || analysis?.hasCriticalRisk;

  // The change since screening only makes sense when the pack shows a DEEP analysis against the
  // screening's numbers, not when the screening itself is the best there is.
  const isDeepAnalysis = analysis !== null;
  // ... and only against the screening the analysis was built on (not a newer one).
  const earlierBasis = analysis ? earlierBasisScreening(analysis, model.basisScreenings) : null;
  const basis =
    isDeepAnalysis && analysis
      ? deepBasis(
          {
            deepStartedAt: analysis.startedAt,
            deepCompletedAt: analysis.completedAt,
            screeningStartedAt: model.screening?.startedAt ?? null,
            screeningId: model.screening?.id ?? null,
            basisScreeningId: analysis.basisScreeningId,
            basisScreeningLoaded: earlierBasis !== null,
            history: model.history,
          },
          language,
        )
      : null;
  const comparable = basis?.screeningIsNewer ? earlierBasis : model.screening;
  const delta =
    isDeepAnalysis &&
    analysis?.score !== null &&
    analysis?.score !== undefined &&
    comparable?.score !== null &&
    comparable?.score !== undefined
      ? scoreChange(analysis.score, comparable.score)
      : null;
  const deltaReason = isDeepAnalysis
    ? scoreDeltaReason(
        groupScores(comparable?.criteria ?? [], language),
        groupScores(analysis?.criteria ?? [], language),
        delta,
        language,
      )
    : null;

  const decided =
    model.processStage === "invested" || model.processStage === "closed_without_investment";
  const groups = useMemo(
    () =>
      analysis
        ? specialistGroups(
            analysis.criteria,
            comparable?.criteria ?? [],
            analysis.specialistSet ?? specialistCatalog,
            analysis.specialists ?? [],
            language,
          )
        : [],
    [analysis, comparable, language],
  );
  const criteria = analysis?.criteria ?? [];
  const gates = analysis?.gates ?? [];
  const risks = analysis?.risks ?? [];
  const numbered = numberRisks(risks);
  const strengths = analysis?.strengths ?? [];
  // Critical and high risks are also listed among the weaknesses on screen; on paper the Risici
  // section already carries them in full, so they are not repeated here.
  const weaknesses = (analysis?.weaknesses ?? []).filter(
    (item) => !item.meta?.startsWith(t("screening.model.riskWord")),
  );
  // Data gaps ("Datamangel") are not questions for the founders; the Nøgletal section lists them
  // once, as the missing inputs of the key figures that could not be calculated.
  const questions = (analysis?.questions ?? []).filter(
    (q) => q.meta !== t("screening.model.dataGap"),
  );
  const calculations = analysis?.calculations ?? [];
  const notCalculable = calculations.filter((calc) => calc.status !== "ok");
  const missingInputs = [...new Set(notCalculable.flatMap((calc) => calc.missingInputs))];
  const counterThesis = analysis?.counterThesis ?? analysis?.contraryCase ?? null;
  // The conclusion on page 1 is the analyst's own opening; the full text lives in the app.
  const conclusion = analysis?.rationale
    ? firstSentences(rationaleParagraphs(analysis.rationale)[0] ?? analysis.rationale, 3)
    : null;

  if (!analysis) {
    return (
      <div className="mx-auto flex max-w-[860px] flex-col gap-5 px-4 pt-6 pb-16 md:px-11 md:pt-9">
        <div>{backAction}</div>
        <section className="grid min-h-[260px] place-items-center rounded-xl bg-canvas p-6 text-center">
          <div className="max-w-md">
            <h1 className="m-0 text-section font-semibold text-ink-1">
              {t("caseView.committee.emptyTitle")}
            </h1>
            <p className="mt-2 mb-0 text-list leading-5 text-ink-2">
              {t("caseView.committee.emptyBody", { name: model.companyName })}
            </p>
            <Link
              to="/cases/$caseId"
              params={{ caseId: model.id }}
              search={{ view: model.deep ? "deep" : "screening" }}
              className="mt-4 inline-block text-list font-medium text-action"
            >
              {t("caseView.committee.backToCase")}
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5 px-4 pt-6 pb-16 md:px-11 md:pt-9 print:max-w-none print:gap-3.5 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {backAction}
        <Button
          variant="primary"
          size="md"
          icon={Printer}
          className="ml-auto"
          onClick={() => window.print()}
        >
          {t("caseView.committee.print")}
        </Button>
      </div>

      <header className="flex flex-col gap-1 border-b border-line pb-3.5 print:pb-2.5">
        <p className="m-0 text-meta text-ink-3">{t("caseView.committee.memo")}</p>
        <h1 className="m-0 text-[30px] leading-[1.05] font-semibold tracking-display text-ink-1 [overflow-wrap:anywhere] md:text-[34px]">
          {model.companyName}
        </h1>
        <p className="m-0 text-meta text-ink-3">
          {t("caseView.committee.profileLine", {
            name: model.profileName,
            version:
              analysis?.setupVersion == null ? model.profileVersion : `v${analysis.setupVersion}`,
          })}
          {model.updatedAt &&
            t("caseView.committee.updatedOn", {
              date: dateFormat.format(new Date(model.updatedAt)),
            })}
        </p>
        <p className="m-0 text-meta text-ink-3">{t("caseView.committee.aiNote")}</p>
      </header>

      {isReRunning && (
        <Notice tone="action">
          <strong className="font-semibold">{t("caseView.committee.reRunTitle")}</strong>{" "}
          {t("caseView.committee.reRunBody")}
        </Notice>
      )}

      {basis?.note && <Notice tone="action">{basis.note}</Notice>}

      {hasWarning && (
        <Notice tone="critical">
          {analysis?.hasFailedGate && (
            <p className="m-0">
              <strong className="font-semibold">{t("caseView.committee.gateFailedTitle")}</strong>{" "}
              {t("caseView.committee.gateFailedBody")}
            </p>
          )}
          {analysis?.hasCriticalRisk && (
            <p className={cn("m-0", analysis?.hasFailedGate && "mt-1")}>
              <strong className="font-semibold">{t("caseView.committee.criticalTitle")}</strong>{" "}
              {t("caseView.committee.criticalBody")}
            </p>
          )}
        </Notice>
      )}

      {/* Page 1: the decision summary. */}
      <section className="flex flex-col gap-3.5 rounded-xl bg-canvas p-4 md:p-5 print:rounded-none print:bg-transparent print:p-0 print:break-inside-avoid">
        <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-meta text-ink-3">{t("caseView.committee.totalScore")}</span>
            <span
              data-numeric
              className="text-[48px] leading-[0.95] font-semibold tracking-display text-ink-1"
            >
              {formatScore(analysis?.score ?? null, "–", language)}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pb-0.5">
            <span className="text-meta text-ink-3">{t("caseView.committee.recommendation")}</span>
            <span className="text-section leading-tight font-semibold tracking-title text-ink-1">
              {analysis?.recommendation
                ? t(`caseView.committee.rec.${analysis.recommendation}`)
                : t("caseView.committee.notAssessed")}
            </span>
          </div>
          <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2 pb-0.5">
            <Fact label={t("caseView.committee.threshold")}>{model.threshold ?? "–"}</Fact>
            {delta !== null && (
              <Fact label={t("caseView.committee.vsScreening")}>
                {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
                {formatScore(Math.abs(delta), undefined, language)}
              </Fact>
            )}
            {decided && (
              <Fact label={t("caseView.committee.fundDecision")}>
                <span
                  className={cn(model.processStage === "invested" ? "text-positive" : "text-ink-1")}
                >
                  {model.processStage === "invested"
                    ? t("cases.status.invested")
                    : t("caseView.committee.closedWithoutInvestment")}
                </span>
              </Fact>
            )}
          </dl>
        </div>

        {(deltaReason || conclusion || model.thesis) && (
          <div className="flex flex-col gap-1.5">
            {conclusion && <p className="m-0 text-list leading-[1.55] text-ink-1">{conclusion}</p>}
            {deltaReason && <p className="m-0 text-meta leading-[1.5] text-ink-3">{deltaReason}</p>}
            {model.thesis && (
              <p className="m-0 text-meta leading-[1.5] text-ink-2">
                <span className="text-ink-3">{t("caseView.committee.assessedAgainst")}</span>{" "}
                {model.thesis}
              </p>
            )}
          </div>
        )}

        {analysis?.investmentCondition && (
          <div className="border-t border-line pt-2.5 break-inside-avoid">
            <h2 className="m-0 text-meta font-semibold text-ink-3">
              {t("caseView.committee.condition")}
            </h2>
            <p className="m-0 mt-0.5 text-list leading-[1.55] text-ink-1">
              {analysis.investmentCondition}
            </p>
          </div>
        )}

        {counterThesis && (
          <div className="border-t border-line pt-2.5 break-inside-avoid">
            <h2 className="m-0 text-meta font-semibold text-ink-3">
              {t("caseView.committee.counterThesis")}
            </h2>
            <p className="m-0 mt-0.5 text-list leading-[1.55] text-ink-1">
              {firstSentences(counterThesis, 3)}
            </p>
          </div>
        )}

        {numbered.length > 0 && (
          <div className="border-t border-line pt-2.5">
            <h2 className="m-0 text-meta font-semibold text-ink-3">
              {t("caseView.committee.topRisks")}
            </h2>
            <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
              {numbered.slice(0, TOP_RISKS).map(({ risk, number }) => (
                <li
                  key={number}
                  className="grid grid-cols-[22px_minmax(0,1fr)] items-baseline text-list break-inside-avoid"
                >
                  <Marker risk={risk} number={number} />
                  <span className="min-w-0">
                    <span className="font-semibold text-ink-1">{riskTitle(risk, language)}</span>
                    <span className="ml-2 text-meta text-ink-3">{riskMeta(risk, t)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {gates.length > 0 && (
        <Section title={t("caseView.committee.gates")}>
          <Table>
            <tbody>
              {gates.map((gate) => (
                <Row key={gate.key}>
                  <td className="w-[22px] py-1.5 print:py-1 pl-3 align-top">
                    <GateDot passed={gate.passed} />
                  </td>
                  <td className="py-1.5 print:py-1 pr-3 pl-2 align-top">
                    <span className="font-medium text-ink-1">{gate.label}</span>
                    <span className="ml-2 text-meta text-ink-3">
                      {gate.passed === true
                        ? t("caseView.committee.gateMet")
                        : gate.passed === false
                          ? t("caseView.committee.gateNotMet")
                          : t("caseView.committee.gateUnverified")}
                      {gate.treatment === "hard"
                        ? t("caseView.committee.gateBinding")
                        : t("caseView.committee.gateAssess")}
                    </span>
                    {gate.rationale && (
                      <p className="m-0 mt-0.5 text-meta leading-[1.45] text-ink-3">
                        {firstSentences(gate.rationale, 2)}
                      </p>
                    )}
                  </td>
                </Row>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      {groups.length > 0 && (
        <Section title={t("caseView.committee.specialists")}>
          <Table>
            <tbody>
              {groups.map((group) => (
                <Row key={group.id}>
                  <td className="w-[28%] py-1.5 print:py-1 pr-2 pl-3 align-top font-semibold text-ink-1">
                    {group.label}
                  </td>
                  <td className="w-[72px] py-1.5 print:py-1 pr-3 align-top">
                    <span
                      data-numeric
                      className="block text-[17px] leading-[1.2] font-semibold text-ink-1"
                    >
                      {formatScore(group.score, "–", language)}
                    </span>
                  </td>
                  <td className="py-1.5 print:py-1 pr-3 align-top text-meta leading-[1.45] text-ink-2">
                    {group.summary
                      ? firstSentences(group.summary, 2)
                      : t("caseView.committee.noAssessment")}
                  </td>
                </Row>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      <Section title={t("caseView.committee.criteria")}>
        {criteria.length === 0 ? (
          <Empty>{t("caseView.committee.noCriteria")}</Empty>
        ) : (
          <Table>
            <thead className="sr-only">
              <tr>
                <th>{t("caseView.committee.colCriterion")}</th>
                <th>{t("caseView.committee.colScore")}</th>
                <th>{t("caseView.committee.colWeight")}</th>
                <th>{t("caseView.committee.colAssessment")}</th>
              </tr>
            </thead>
            <tbody>
              {criteria.map((criterion) => (
                <Row key={criterion.criterionKey}>
                  <td className="w-[28%] py-1.5 print:py-1 pr-2 pl-3 align-top font-semibold text-ink-1">
                    {criterion.label}
                    <span data-numeric className="block text-meta font-normal text-ink-3">
                      {t("caseView.committee.weight", {
                        value: formatScore(criterion.weight, undefined, language),
                      })}
                    </span>
                  </td>
                  <td className="w-[72px] py-1.5 print:py-1 pr-3 align-top">
                    <span
                      data-numeric
                      className="block text-[17px] leading-[1.2] font-semibold text-ink-1"
                    >
                      {formatScore(criterion.score, "–", language)}
                    </span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-pill bg-[var(--chart-track)]">
                      <span
                        className="block h-full rounded-pill bg-ink-1"
                        style={{
                          width: `${Math.min(100, Math.max(0, criterion.score ?? 0))}%`,
                        }}
                      />
                    </span>
                  </td>
                  <td className="py-1.5 print:py-1 pr-3 align-top text-meta leading-[1.45] text-ink-2">
                    {(criterion.verdict ? firstSentences(criterion.verdict, 2) : null) ||
                      (criterion.rationale
                        ? firstSentences(criterion.rationale, 2)
                        : t("caseView.committee.noRationale"))}
                  </td>
                </Row>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <div className="grid gap-5 md:grid-cols-2 print:grid-cols-2 print:gap-4">
        <Section title={t("caseView.committee.strengths")}>
          {strengths.length === 0 ? (
            <Empty>{t("caseView.committee.noStrengths")}</Empty>
          ) : (
            <Statements items={strengths} dot="var(--positive)" />
          )}
        </Section>
        <Section title={t("caseView.committee.weaknesses")}>
          {weaknesses.length === 0 ? (
            <Empty>{t("caseView.committee.noWeaknesses")}</Empty>
          ) : (
            <Statements items={weaknesses} dot="var(--warning)" />
          )}
        </Section>
      </div>

      <Section title={t("caseView.committee.risks")}>
        {risks.length === 0 ? (
          <Empty>{t("caseView.committee.noRisks")}</Empty>
        ) : (
          <PackRisks numbered={numbered} />
        )}
      </Section>

      <Section title={t("caseView.committee.questions")}>
        {questions.length === 0 ? (
          <Empty>{t("caseView.committee.noQuestions")}</Empty>
        ) : (
          <ol className="m-0 list-none columns-1 gap-6 p-0 md:columns-2 print:columns-2">
            {questions.map((question, index) => (
              <li
                key={index}
                className="mb-1.5 grid grid-cols-[24px_minmax(0,1fr)] text-meta leading-[1.45] text-ink-2 break-inside-avoid"
              >
                <span data-numeric className="text-ink-4">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {question.statement}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={t("caseView.committee.keyFigures")}>
        {calculations.length === 0 ? (
          <Empty>{t("caseView.committee.noCalculations")}</Empty>
        ) : (
          <>
            {reportYears.length > 0 && (
              <p className="m-0 text-meta text-ink-3">
                {t("caseView.committee.annualReports", { years: reportYears.join(", ") })}
              </p>
            )}
            <dl className="m-0 grid grid-cols-2 gap-1.5 md:grid-cols-4 print:grid-cols-4">
              {calculations
                .filter((calc) => calc.status === "ok")
                .map((calc) => (
                  <div
                    key={calc.metric}
                    className="rounded-lg bg-surface px-2.5 py-1.5 shadow-[0_0_0_1px_var(--line)] break-inside-avoid print:py-1"
                  >
                    <dt className="text-meta text-ink-3">{financeLabel(calc.metric, language)}</dt>
                    <dd data-numeric className="m-0 text-list font-semibold text-ink-1">
                      {formatCalculationValue(calc, language)}
                    </dd>
                  </div>
                ))}
            </dl>
            {notCalculable.length > 0 && (
              <p className="m-0 text-meta text-ink-3">
                {t("caseView.committee.notCalculable", {
                  count: notCalculable.length,
                  list: notCalculable.map((calc) => financeLabel(calc.metric, language)).join(", "),
                })}
                {missingInputs.length > 0 &&
                  t("caseView.committee.missingInputs", {
                    inputs: missingInputs
                      .map((input) => financialInputLabel(input, language))
                      .join(", "),
                  })}
                .
              </p>
            )}
          </>
        )}
      </Section>

      <p className="m-0 border-t border-line pt-2.5 text-meta leading-[1.5] text-ink-3 break-inside-avoid">
        {analysis?.completedAt
          ? `${t("caseView.committee.footAnalysed", {
              date: dateFormat.format(new Date(analysis.completedAt)),
            })} `
          : ""}
        {t("caseView.committee.footEnd")}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 print:gap-1.5">
      <h2 className="m-0 text-section font-semibold tracking-title text-ink-1 print:break-after-avoid">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One white surface with hairlines between the rows (v0.3: never a card per row). */
function Table({ children }: { children: ReactNode }) {
  return (
    <table className="w-full border-collapse overflow-hidden rounded-lg bg-surface text-list shadow-[0_0_0_1px_var(--line)]">
      {children}
    </table>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <tr className="border-t border-line first:border-t-0 break-inside-avoid">{children}</tr>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 text-list text-ink-3">{children}</p>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-meta text-ink-3">{label}</dt>
      <dd data-numeric className="m-0 text-section leading-tight font-semibold text-ink-1">
        {children}
      </dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: "critical" | "action"; children: ReactNode }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-meta leading-[1.45] break-inside-avoid",
        tone === "critical" ? "bg-critical-wash text-critical" : "bg-action-wash text-ink-1",
      )}
    >
      <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function GateDot({ passed }: { passed: boolean | null }) {
  const color = passed === true ? "var(--positive)" : passed === false ? "var(--critical)" : null;
  return (
    <span
      className="mt-[3px] block size-[12px] rounded-full"
      style={color ? { background: color } : { boxShadow: "inset 0 0 0 1.5px var(--ink-4)" }}
      aria-hidden
    />
  );
}

function Statements({ items, dot }: { items: CaseViewModel["strengths"]; dot: string }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {items.map((item, index) => (
        <li
          key={index}
          className="grid grid-cols-[12px_minmax(0,1fr)] text-meta leading-[1.45] text-ink-2 break-inside-avoid"
        >
          <span
            className="mt-[6px] size-1.5 rounded-full"
            style={{ background: dot }}
            aria-hidden
          />
          <span>
            {item.statement}
            {item.meta && <span className="ml-1.5 text-ink-3">{item.meta}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function riskMeta(risk: RiskView, t: Translate) {
  return `${t(`caseView.committee.riskLevel.${risk.level}`)}${
    hasRiskCoordinates(risk)
      ? t("caseView.committee.riskCoords", {
          likelihood: risk.likelihood ?? "",
          impact: risk.impact ?? "",
        })
      : t("caseView.committee.riskNoCoords")
  }`;
}

function Marker({
  risk,
  number,
  all,
}: {
  risk: RiskView;
  number: number | string;
  /** Every risk number in a shared matrix marker. */
  all?: readonly number[];
}) {
  return (
    <span
      title={all && all.length > 1 ? all.join(", ") : undefined}
      className="grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-micro font-semibold whitespace-nowrap"
      style={{ background: riskMarkerColor(risk.level), color: riskMarkerInk(risk.level) }}
    >
      {number}
    </span>
  );
}

/**
 * The risks on paper: the numbered 5 × 5 matrix beside a one-line index, then every risk with
 * its first sentences and what must be clarified (the full rationale stays in the app).
 */
function PackRisks({ numbered }: { numbered: ReturnType<typeof numberRisks<RiskView>> }) {
  const t = useT();
  const language = useLanguage();
  const placed = numbered.some((entry) => hasRiskCoordinates(entry.risk));
  return (
    <div className="flex flex-col gap-2.5">
      {placed && (
        <div className="max-w-[300px] break-inside-avoid">
          <div className="grid grid-cols-[14px_minmax(0,1fr)] items-center gap-1.5">
            <span className="text-center text-micro text-ink-4 [transform:rotate(180deg)] [writing-mode:vertical-rl]">
              {t("caseView.committee.impact")}
            </span>
            <div
              className="grid grid-cols-5 gap-[3px]"
              role="img"
              aria-label={t("caseView.committee.matrixLabel")}
            >
              {matrixCells(numbered).map((cell) => (
                <div
                  key={`${cell.likelihood}-${cell.impact}`}
                  className="flex aspect-[1.7] items-center justify-center gap-[2px] rounded-[6px] shadow-[0_0_0_1px_var(--line)]"
                  style={{ background: HEAT_BACKGROUND[cell.band] }}
                >
                  {(() => {
                    // Several risks in one cell share one marker.
                    const marker = cellMarker(cell.entries);
                    return (
                      marker && (
                        <Marker risk={marker.risk} number={marker.label} all={marker.numbers} />
                      )
                    );
                  })()}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex justify-between pl-5 text-micro text-ink-4">
            <span>{t("caseView.committee.low")}</span>
            <span>{t("caseView.committee.likelihood")}</span>
            <span>{t("caseView.committee.high")}</span>
          </div>
        </div>
      )}
      <Table>
        <tbody>
          {numbered.map(({ risk, number }) => (
            <Row key={number}>
              <td className="w-[34px] py-2 print:py-1.5 pl-3 align-top">
                <Marker risk={risk} number={number} />
              </td>
              <td className="py-2 print:py-1.5 pr-3 align-top">
                <span className="font-semibold text-ink-1">{riskTitle(risk, language)}</span>
                <span className="ml-2 text-meta text-ink-3">{riskMeta(risk, t)}</span>
                <p className="m-0 mt-0.5 text-meta leading-[1.5] text-ink-2">
                  {firstSentences(risk.statement, 2)}
                </p>
                {risk.mitigation && (
                  <p className="m-0 mt-1 text-meta leading-[1.5] text-ink-2">
                    <span className="font-semibold text-ink-3">
                      {t("caseView.committee.mitigation")}
                    </span>{" "}
                    {risk.mitigation}
                  </p>
                )}
              </td>
            </Row>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
