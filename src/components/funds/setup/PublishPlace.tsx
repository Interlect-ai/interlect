/**
 * "Gennemse og udgiv" as the prototype's `publishView` (`Teamopsaetning v3.dc.html`): a
 * title ("Klar til at udgive?"), the stages side by side when there are more than one, one row
 * for what is not ready (with "Ret", which opens the place and the stage that needs it), one
 * green row for the thesis and one per stage, and the foot with "Tilbage" and "Udgiv tese".
 *
 * What the prototype counts as not ready is kept: weights that do not give 100 % in a stage, a
 * stage without mandate rules, a stage without a specialist that is on. What the page has besides
 * (what blocks a publish in the server's own words, the specialists' own problems, what changes
 * compared with the version in use and what it does to the cases already screened) stays below
 * the rows; the suggestions and the re-screening are the place's extras in the shell.
 */
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ds/Button";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import { geographyText, stageText } from "@/lib/funds/basis-labels";
import type { EditableFundConfig, SaveFundConfigInput } from "@/lib/funds/config.functions";
import type { StepStatus } from "@/lib/funds/editor-rules";
import type { SetupPlaceKey } from "@/lib/funds/setup-places";
import { criteriaOf, economyOf, gatesOf, stageTabs } from "@/lib/funds/stage-editor";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { DraftConsequences, useDraftChanges } from "@/components/funds/editor/PublishStep";
import {
  useFundSpecialists,
  useStageSpecialistCounts,
} from "@/components/funds/editor/use-fund-specialists";
import { FoldSection } from "@/components/funds/FoldSection";
import { CompareTable, ticketLine } from "./ScreeningSheets";

type EditorState = SaveFundConfigInput;

interface Issue {
  key: string;
  title: string;
  body: string;
  /** Where "Ret" goes; the stage when the problem belongs to one. */
  place: SetupPlaceKey;
  stage?: SetupStage;
}

export function PublishPlace({
  fundId,
  value,
  active,
  moduleOverrides,
  researchModuleOverrides,
  screeningSetup,
  status,
  draftVersion,
  busy,
  publishing,
  onPublish,
  onFix,
  onBack,
}: {
  fundId: string;
  value: EditorState;
  active: EditableFundConfig | null;
  moduleOverrides: EditableFundConfig["moduleOverrides"];
  researchModuleOverrides: EditableFundConfig["researchModuleOverrides"];
  screeningSetup: Pick<EditableFundConfig, "screeningInstruction" | "screeningCards">;
  status: StepStatus;
  draftVersion: number;
  /** Saving, importing or loading: nothing can be published right now. */
  busy: boolean;
  publishing: boolean;
  onPublish: () => void;
  onFix: (place: SetupPlaceKey, stage?: SetupStage) => void;
  onBack: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const tabs = stageTabs(value.stages);
  const counts = useStageSpecialistCounts(
    fundId,
    value.configId,
    tabs.map((tab) => tab.stage),
  );
  const { changes } = useDraftChanges({
    fundId,
    value,
    active,
    moduleOverrides,
    researchModuleOverrides,
    screeningSetup,
  });
  const specialistProblems = useFundSpecialists(fundId, value.configId).data?.problems ?? [];

  const issues: Issue[] = [];
  for (const tab of tabs) {
    const label = stageText(tab.raw, language);
    const total =
      Math.round(criteriaOf(value, tab.stage).reduce((sum, row) => sum + row.weight, 0) * 10) / 10;
    if (total !== 100) {
      issues.push({
        key: `weights-${tab.stage}`,
        title: t("fundSetup.publishPage.issueWeights", { stage: label }),
        body: t("fundSetup.publishPage.issueWeightsBody", {
          total: total.toLocaleString(localeTag, { maximumFractionDigits: 1 }),
        }),
        place: "screening",
        stage: tab.stage,
      });
    }
    if (!gatesOf(value, tab.stage).length) {
      issues.push({
        key: `rules-${tab.stage}`,
        title: t("fundSetup.publishPage.issueRules", { stage: label }),
        body: t("fundSetup.publishPage.issueRulesBody"),
        place: "screening",
        stage: tab.stage,
      });
    }
    if (counts[tab.stage] === 0) {
      issues.push({
        key: `specialists-${tab.stage}`,
        title: t("fundSetup.publishPage.issueSpecialists", { stage: label }),
        body: t("fundSetup.publishPage.issueSpecialistsBody"),
        place: "analysis",
        stage: tab.stage,
      });
    }
  }
  // What the server and the database check besides the prototype's three (same words as before).
  // (The weights per stage are the rows above, so the server's own weight line is left out.)
  const covered = new Set(
    status.limitViolations
      .filter((violation) => violation.code === "weight_sum")
      .map((violation) => violation.message),
  );
  for (const line of status.missing) {
    if (covered.has(line)) continue;
    issues.push({
      key: `missing-${line}`,
      title: t("fundSetup.publishPage.issueOther"),
      body: line,
      place: "thesis",
    });
  }
  for (const line of specialistProblems) {
    issues.push({
      key: `specialist-${line}`,
      title: t("fundSetup.publishPage.issueSpecialistSet"),
      body: line,
      place: "analysis",
    });
  }

  const thesisLine = [
    value.fundName.trim(),
    value.geographies.map((geography) => geographyText(geography, language)).join(", "),
    ticketLine(value, localeTag),
  ]
    .filter((part) => part && part !== "–")
    .join(", ");

  const rows = [
    { key: "thesis", title: t("fundSetup.publishPage.thesisRow"), text: thesisLine },
    ...tabs.map((tab) => {
      const criteria = criteriaOf(value, tab.stage).length;
      const points = economyOf(value, tab.stage).points.filter((point) => point.on).length;
      const specialists = counts[tab.stage];
      return {
        key: tab.stage,
        title: stageText(tab.raw, language),
        text:
          specialists === undefined
            ? t("fundSetup.publishPage.stageLinePending", { criteria, points })
            : t("fundSetup.publishPage.stageLine", { criteria, points, specialists }),
      };
    }),
  ];

  const blocked = issues.length > 0 || !status.valid || busy;

  return (
    <div className="flex flex-col gap-[22px]">
      {tabs.length > 1 && (
        <CompareTable
          value={value}
          specialistCounts={counts}
          onPick={(stage) => onFix("screening", stage)}
        />
      )}

      <div className="flex max-w-[760px] flex-col gap-2.5">
        {issues.map((issue) => (
          <div
            key={issue.key}
            className="flex items-center gap-3.5 rounded-[20px] bg-warning-wash px-5 py-4"
          >
            <span
              aria-hidden
              className="grid size-[26px] flex-none place-items-center rounded-full bg-warning text-[13px] leading-none font-bold text-white"
            >
              !
            </span>
            <div className="min-w-0 flex-1">
              <b className="text-[15px] font-semibold">{issue.title}</b>
              <div className="text-meta text-ink-2">{issue.body}</div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => onFix(issue.place, issue.stage)}>
              {t("fundSetup.publishPage.fix")}
            </Button>
          </div>
        ))}
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-center gap-3.5 rounded-[20px] bg-positive-wash px-5 py-4"
          >
            <span
              aria-hidden
              className="grid size-[26px] flex-none place-items-center rounded-full bg-positive text-white"
            >
              <Check className="size-3.5" strokeWidth={2.6} />
            </span>
            <div className="min-w-0">
              <b className="text-[15px] font-semibold">{row.title}</b>
              <div className="text-meta text-ink-2">{row.text}</div>
            </div>
          </div>
        ))}
      </div>

      {issues.length === 0 && !status.valid && (
        <div
          role="alert"
          className="flex max-w-[760px] gap-2.5 rounded-md bg-warning-wash p-3.5 text-list leading-5 text-ink-2"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="m-0">{t("fundEditor.publish.missingBeforePublish")}</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-1.5">
        <Button variant="quiet" onClick={onBack}>
          {t("fundSetup.publishPage.back")}
        </Button>
        <Button
          variant="primary"
          onClick={onPublish}
          disabled={blocked}
          pending={publishing ? "ai" : false}
          pendingLabel={t("fundEditor.shell.publishing")}
          title={t("fundSetup.publishPage.publishVersion", { version: draftVersion })}
        >
          {t("fundSetup.publishPage.publish")}
        </Button>
      </div>

      {/* Beyond the prototype: what changes compared with the version in use, folded away. */}
      {active && (
        <FoldSection
          title={t("fundSetup.publishPage.changesTitle", { version: active.version })}
          hint={t("fundSetup.publishPage.changesHint")}
        >
          <div className="flex flex-col gap-3.5">
            <div className="overflow-hidden rounded-lg bg-surface shadow-card">
              {changes.length > 0 ? (
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
              )}
            </div>
            <DraftConsequences
              fundId={fundId}
              value={value}
              activeThreshold={active.analysisThreshold}
            />
          </div>
        </FoldSection>
      )}
    </div>
  );
}
