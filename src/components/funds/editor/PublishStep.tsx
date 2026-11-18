/**
 * Last step, "Gennemse og udgiv" (prototype: "Ændringer i forhold til vN"): what changes compared
 * with the active version, a short summary of the draft, and the consequence box: the score of the
 * screened cases is recalculated IN CODE with the draft's weights and threshold from the sub-scores
 * that already exist (no AI call), and the cases that would switch side of the threshold are named.
 * A criterion without a sub-score gets the stage prior, as the scoring itself would. What still
 * blocks a publish is listed; the server and the database check the same limits again.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check } from "lucide-react";
import { LoadingState } from "@/components/ds/States";
import { stagePriorScore } from "@/lib/analysis/scoring";
import { listCases } from "@/lib/cases/cases.functions";
import type { EditableFundConfig, SaveFundConfigInput } from "@/lib/funds/config.functions";
import { geographyText, stageText } from "@/lib/funds/basis-labels";
import { diffFundConfigs } from "@/lib/funds/config-diff";
import { specialistSetChanges } from "@/lib/funds/specialist-cards";
import type { StepStatus } from "@/lib/funds/editor-rules";
import type { Language } from "@/lib/i18n/language";
import type { MessageKey, TranslateVars } from "@/lib/i18n/translate";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { useFundSpecialists } from "./use-fund-specialists";

type EditorState = SaveFundConfigInput;

/** "Hvad ændrer sig ved udgivelse?": regnet i kode, intet AI-kald. */
export function DraftConsequences({
  fundId,
  value,
  activeThreshold,
}: {
  fundId: string;
  value: EditorState;
  activeThreshold: number | null;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  const loadCases = useServerFn(listCases);
  const casesQuery = useQuery({
    queryKey: ["cases", fundId],
    queryFn: () => loadCases({ data: { fundId } }),
    retry: false,
  });
  if (casesQuery.isLoading) return <LoadingState title={t("fundEditor.publish.calculating")} />;
  if (casesQuery.isError) {
    return <p className="m-0 text-list text-ink-3">{t("fundEditor.publish.calculationFailed")}</p>;
  }
  const screened = (casesQuery.data ?? []).filter(
    // Screenings of the active setup only, as put older ones in the list.
    (row) => row.screeningScore !== null && !row.olderSetup && row.workspaceStatus !== "archived",
  );
  if (!screened.length) {
    return <p className="m-0 text-list text-ink-3">{t("fundEditor.publish.noScreened")}</p>;
  }
  const totalWeight = value.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const results = screened.map((row) => {
    const byKey = new Map(row.screeningScores.map((score) => [score.criterionKey, score.score]));
    let missing = 0;
    const raw =
      totalWeight > 0
        ? value.criteria.reduce((sum, criterion) => {
            const known = byKey.get(criterion.key);
            if (known === undefined || known === null) missing += 1;
            const score = known ?? stagePriorScore(row.stage);
            return sum + (score * criterion.weight) / totalWeight;
          }, 0)
        : null;
    // Samme afrunding som scoreScreening (én decimal), før tærsklen sammenlignes.
    const next = raw === null ? null : Math.round(raw * 10) / 10;
    const before = row.screeningScore!;
    const oldThreshold = activeThreshold ?? value.analysisThreshold;
    const wasAbove = before >= oldThreshold;
    const isAbove = next !== null && next >= value.analysisThreshold;
    return { row, before, next, missing, switched: wasAbove !== isAbove, isAbove };
  });
  const switched = results.filter((result) => result.switched);
  const example = [...results].sort((a, b) => b.before - a.before)[0]!;
  const withMissing = results.filter((result) => result.missing > 0).length;
  const format = (score: number | null) =>
    score === null ? "–" : score.toLocaleString(localeTag, { maximumFractionDigits: 1 });
  return (
    <section className="rounded-lg bg-canvas p-[22px]">
      <h3 className="m-0 text-section font-semibold">
        {t("fundEditor.publish.consequencesTitle")}
      </h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-md bg-surface p-4 shadow-card">
          <p className="m-0 text-meta text-ink-3">
            {t("fundEditor.publish.example", { company: example.row.companyName })}
          </p>
          <p className="mt-2 mb-0 flex items-baseline gap-3 tabular-nums">
            <span className="text-[17px] text-ink-3">{format(example.before)}</span>
            <span aria-hidden className="text-ink-4">
              →
            </span>
            <span className="text-[32px] font-semibold tracking-title text-ink-1">
              {format(example.next)}
            </span>
          </p>
          <p className="mt-1 mb-0 text-meta text-ink-3">
            {t(
              example.isAbove
                ? "fundEditor.publish.aboveThreshold"
                : "fundEditor.publish.belowThreshold",
              { threshold: value.analysisThreshold },
            )}
          </p>
        </div>
        <ul className="m-0 grid list-none content-start gap-2 p-0 text-list text-ink-2">
          <li>
            <strong className="tabular-nums text-ink-1">{switched.length}</strong>{" "}
            {t("fundEditor.publish.switchedOf")}{" "}
            <span className="tabular-nums">{results.length}</span>{" "}
            {t("fundEditor.publish.switchedAfter")}
            {switched.length > 0 && (
              <span className="text-ink-3">
                {" "}
                (
                {switched
                  .map((result) => result.row.companyName)
                  .slice(0, 3)
                  .join(", ")}
                {switched.length > 3 ? " …" : ""})
              </span>
            )}
          </li>
          {withMissing > 0 && (
            <li className="text-ink-3">
              {t(
                withMissing === 1
                  ? "fundEditor.publish.missingScoresOne"
                  : "fundEditor.publish.missingScoresMany",
                { count: withMissing },
              )}
            </li>
          )}
          <li className="text-ink-3">{t("fundEditor.publish.existingUnchanged")}</li>
        </ul>
      </div>
    </section>
  );
}

function summaryRows(
  value: EditorState,
  weightTotal: number,
  t: (key: MessageKey, vars?: TranslateVars) => string,
  localeTag: string,
  language: Language,
): Array<[string, string]> {
  const hard = value.gates.filter((gate) => gate.treatment === "hard").length;
  const thesis = value.thesis.trim();
  const missing = t("fundEditor.publish.summary.missing");
  return [
    [
      t("fundEditor.publish.summary.thesis"),
      thesis ? `${thesis.slice(0, 140)}${thesis.length > 140 ? " …" : ""}` : missing,
    ],
    [
      t("fundEditor.publish.summary.stages"),
      value.stages.map((stage) => stageText(stage, language)).join(", ") || missing,
    ],
    [
      t("fundEditor.publish.summary.countries"),
      value.geographies.map((geography) => geographyText(geography, language)).join(", ") ||
        missing,
    ],
    [t("fundEditor.publish.summary.sectors"), value.sectors.join(", ") || missing],
    [t("fundEditor.publish.summary.threshold"), `${value.analysisThreshold}`],
    [
      t("fundEditor.publish.summary.gates"),
      t("fundEditor.publish.summary.gatesValue", { count: value.gates.length, hard }),
    ],
    [
      t("fundEditor.publish.summary.criteria"),
      t("fundEditor.publish.summary.criteriaValue", {
        count: value.criteria.length,
        total: weightTotal.toLocaleString(localeTag),
      }),
    ],
  ];
}

export function PublishStep({
  fundId,
  value,
  active,
  moduleOverrides,
  researchModuleOverrides,
  screeningSetup,
  status,
}: {
  fundId: string;
  value: EditorState;
  active: EditableFundConfig | null;
  moduleOverrides: EditableFundConfig["moduleOverrides"];
  researchModuleOverrides: EditableFundConfig["researchModuleOverrides"];
  screeningSetup: Pick<EditableFundConfig, "screeningInstruction" | "screeningCards">;
  status: StepStatus;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const weightTotal =
    Math.round(value.criteria.reduce((sum, criterion) => sum + criterion.weight, 0) * 10) / 10;
  // The set of specialists lives in its own table; compared here, not in the diff.
  const draftSpecialists = useFundSpecialists(fundId, value.configId).data;
  const activeSpecialists = useFundSpecialists(fundId, active?.id).data;
  const changes = active
    ? [
        ...diffFundConfigs(
          active,
          {
            ...value,
            moduleOverrides,
            researchModuleOverrides,
            screeningInstruction: screeningSetup.screeningInstruction,
            screeningCards: screeningSetup.screeningCards,
          },
          language,
        ),
        ...(draftSpecialists && activeSpecialists
          ? specialistSetChanges(activeSpecialists, draftSpecialists, language)
          : []),
      ]
    : [];
  return (
    <div className="flex flex-col gap-3.5">
      <div className="overflow-hidden rounded-lg bg-surface shadow-card">
        {active ? (
          changes.length > 0 ? (
            changes.map((change, index) => (
              <div
                // Two own specialists may share a name, so one line can appear twice.
                key={`${index}-${change}`}
                className={cn(
                  "grid min-h-14 grid-cols-[28px_minmax(0,1fr)] items-center gap-3 px-[18px] py-2",
                  index > 0 && "border-t border-line",
                )}
              >
                <span
                  aria-hidden
                  className="grid size-6 place-items-center rounded-lg bg-action-wash text-action"
                >
                  <Check className="size-3" strokeWidth={2.5} />
                </span>
                <span className="text-[14px]">{change}</span>
              </div>
            ))
          ) : (
            <p className="m-0 px-[18px] py-4 text-list text-ink-3">
              {t("fundEditor.publish.noChanges", { version: active.version })}
            </p>
          )
        ) : (
          <p className="m-0 px-[18px] py-4 text-list text-ink-3">
            {t("fundEditor.publish.firstVersion")}
          </p>
        )}
      </div>

      <dl className="m-0 grid gap-2.5 rounded-lg bg-canvas p-[22px]">
        {summaryRows(value, weightTotal, t, localeTag, language).map(([label, text]) => (
          <div key={label} className="grid gap-1 sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-3">
            <dt className="text-list text-ink-3">{label}</dt>
            <dd
              className={cn(
                "m-0 text-list",
                text === t("fundEditor.publish.summary.missing") ? "text-warning" : "text-ink-1",
              )}
            >
              {text}
            </dd>
          </div>
        ))}
      </dl>

      <DraftConsequences
        fundId={fundId}
        value={value}
        activeThreshold={active?.analysisThreshold ?? null}
      />

      {(draftSpecialists?.problems.length ?? 0) > 0 && (
        <div
          role="alert"
          className="flex gap-2.5 rounded-md bg-warning-wash p-3.5 text-list leading-5 text-ink-2"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="m-0 font-medium text-ink-1">
              {t("fundEditor.publish.specialistsProblems")}
            </p>
            <ul className="m-0 mt-1 list-disc pl-5">
              {draftSpecialists!.problems.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!status.valid && (
        <div
          role="alert"
          className="flex gap-2.5 rounded-md bg-warning-wash p-3.5 text-list leading-5 text-ink-2"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="m-0 font-medium text-ink-1">
              {t("fundEditor.publish.missingBeforePublish")}
            </p>
            <ul className="m-0 mt-1 list-disc pl-5">
              {status.missing.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <p className="m-0 text-list text-ink-3">
        {active ? t("fundEditor.publish.footerActive") : t("fundEditor.publish.footerFirst")}
      </p>
    </div>
  );
}
