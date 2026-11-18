/**
 * The simple steps of the editing flow in the new field style: Start (read a document into the
 * draft), Grundlag, Tese og risiko and Specialister. Behaviour is the guide's from before the
 * redesign; only the look is new. The specialist step shows the fund's set as cards
 * (SpecialistCards.tsx); the research strategy below keeps its own editor and older look.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getInternalPagesEnabled } from "@/lib/internal/internal-pages.functions";
import { isAdminRole } from "@/lib/auth/is-admin";
import { Section } from "./fields";
import type { FundDocumentProposal } from "@/lib/funds/document-import.functions";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import { SECTOR_AGNOSTIC } from "@/lib/funds/gate-suggestions";
import {
  geographyKeys,
  geographyText,
  stageKeys,
  stageText,
  withBasisKeys,
} from "@/lib/funds/basis-labels";
import { withUniqueKeys } from "@/lib/funds/editor-rules";
import { ticketShareOfFund, ticketShareText } from "@/lib/funds/fund-size";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { fieldClass } from "@/components/ds/Field";
import { FundDocumentImport } from "./FundDocumentImport";
import { SpecialistCards } from "./SpecialistCards";
import { ResearchStrategyEditor } from "./SpecialistEditors";
import {
  ChoiceField,
  ListField,
  NumberField,
  RiskPostureField,
  TextArea,
  TextField,
  geographyOptions,
  sectorOptions,
  stageOptions,
} from "./fields";

type EditorState = SaveFundConfigInput;

/**
 * A document proposal merged into the newest draft (an import that took a while must not
 * overwrite). The document's stages and geographies are read as the editor's keys.
 */
export function mergeDocumentProposal(
  value: EditorState,
  proposal: FundDocumentProposal,
): EditorState {
  return withBasisKeys({
    ...value,
    strategyType: proposal.strategyType,
    thesis: proposal.thesis || value.thesis,
    stages: proposal.stages.length ? proposal.stages : value.stages,
    geographies: proposal.geographies.length ? proposal.geographies : value.geographies,
    sectors: proposal.sectors.length ? proposal.sectors : value.sectors,
    fundSizeEur:
      proposal.fundSizeEur && proposal.fundSizeEur > 0 ? proposal.fundSizeEur : value.fundSizeEur,
    ticketMinEur: proposal.ticketMinEur ?? value.ticketMinEur,
    ticketMaxEur: proposal.ticketMaxEur ?? value.ticketMaxEur,
    ticketNote: proposal.ticketNote || value.ticketNote,
    analysisThreshold: proposal.analysisThreshold,
    riskPosture: proposal.riskPosture || value.riskPosture,
    stageExpectations:
      Object.keys(proposal.stageExpectations).length > 0
        ? proposal.stageExpectations
        : value.stageExpectations,
    dealbreakers: proposal.dealbreakers.length ? proposal.dealbreakers : value.dealbreakers,
    // The model may repeat a key; two items with one key would make every save fail.
    gates: proposal.gates.length ? withUniqueKeys(proposal.gates) : value.gates,
    criteria: proposal.criteria.length ? withUniqueKeys(proposal.criteria) : value.criteria,
  });
}

export function StartStep({
  fundId,
  configId,
  onProposal,
  onBusyChange,
  initialFile,
  onInitialFileTaken,
}: {
  fundId: string;
  configId: string;
  onProposal: (proposal: FundDocumentProposal) => void;
  /** An import is in flight (the editor asks before it is closed). */
  onBusyChange?: (busy: boolean) => void;
  /** A document picked with "+" on the overview. */
  initialFile?: File | null | undefined;
  onInitialFileTaken?: (() => void) | undefined;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <FundDocumentImport
        fundId={fundId}
        configId={configId}
        onProposal={onProposal}
        onBusyChange={onBusyChange}
        initialFile={initialFile}
        onInitialFileTaken={onInitialFileTaken}
      />
    </div>
  );
}

export function BasisStep({
  value,
  onChange,
  ticketTooLarge,
}: {
  value: EditorState;
  onChange: (value: EditorState) => void;
  ticketTooLarge: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const patch = <K extends keyof EditorState>(key: K, next: EditorState[K]) =>
    onChange({ ...value, [key]: next });
  const share = ticketShareText(
    ticketShareOfFund(value.fundSizeEur, value.ticketMinEur, value.ticketMaxEur),
    language,
  );
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="grid gap-[14px] md:grid-cols-2">
        <TextField
          label={t("fundEditor.basic.thesisName")}
          value={value.fundName}
          onChange={(next) => patch("fundName", next)}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-meta text-ink-3">{t("fundEditor.basic.strategy")}</span>
          <select
            value={value.strategyType}
            onChange={(event) =>
              patch("strategyType", event.target.value as EditorState["strategyType"])
            }
            className={fieldClass}
          >
            <option value="venture">{t("fundEditor.basic.strategyVenture")}</option>
            <option value="growth">{t("fundEditor.basic.strategyGrowth")}</option>
            <option value="thematic">{t("fundEditor.basic.strategyThematic")}</option>
            <option value="custom">{t("fundEditor.basic.strategyCustom")}</option>
          </select>
        </label>
      </div>
      <ChoiceField
        label={t("fundEditor.basic.stages")}
        value={value.stages}
        onChange={(next) => patch("stages", stageKeys(next))}
        options={stageOptions}
        display={(stage) => stageText(stage, language)}
        placeholder={t("fundEditor.basic.addStage")}
      />
      <ChoiceField
        label={t("fundEditor.basic.geography")}
        value={value.geographies}
        onChange={(next) => patch("geographies", geographyKeys(next))}
        options={geographyOptions}
        display={(geography) => geographyText(geography, language)}
        placeholder={t("fundEditor.basic.addGeography")}
      />
      <div className="flex flex-col gap-2.5">
        <label className="flex items-center gap-2 text-list text-ink-2">
          <input
            type="checkbox"
            checked={value.sectors.includes(SECTOR_AGNOSTIC)}
            onChange={(event) =>
              patch(
                "sectors",
                event.target.checked
                  ? [SECTOR_AGNOSTIC]
                  : value.sectors.filter((sector) => sector !== SECTOR_AGNOSTIC),
              )
            }
          />
          {t("fundEditor.basic.sectorAgnostic")}
        </label>
        {!value.sectors.includes(SECTOR_AGNOSTIC) && (
          <ChoiceField
            label={t("fundEditor.basic.sectors")}
            value={value.sectors}
            onChange={(next) => patch("sectors", next)}
            options={sectorOptions}
            placeholder={t("fundEditor.basic.addSector")}
          />
        )}
      </div>
      <div className="grid gap-[14px] md:grid-cols-2">
        <NumberField
          label={t("fundEditor.basic.fundSize")}
          value={value.fundSizeEur}
          onChange={(next) => patch("fundSizeEur", next && next > 0 ? next : null)}
          min={0}
        />
        <div className="hidden md:block" />
        <NumberField
          label={t("fundEditor.basic.ticketMin")}
          value={value.ticketMinEur}
          onChange={(next) => patch("ticketMinEur", next)}
          min={0}
        />
        <NumberField
          label={t("fundEditor.basic.ticketMax")}
          value={value.ticketMaxEur}
          onChange={(next) => patch("ticketMaxEur", next)}
          min={0}
        />
        <TextField
          label={t("fundEditor.basic.ticketNote")}
          value={value.ticketNote}
          onChange={(next) => patch("ticketNote", next)}
          className="md:col-span-2"
        />
      </div>
      {ticketTooLarge ? (
        <p role="alert" className="m-0 text-meta text-critical">
          {t("fundEditor.basic.ticketTooLarge")}
        </p>
      ) : (
        share && (
          <p className="m-0 text-meta text-ink-3">{t("fundEditor.basic.ticketShare", { share })}</p>
        )
      )}
      <p className="m-0 rounded-md bg-canvas px-4 py-3 text-list text-ink-2">
        <span className="font-medium text-ink-1">{t("fundEditor.basic.decisionControl")}</span>{" "}
        {t("fundEditor.basic.decisionControlText")}
      </p>
    </div>
  );
}

export function ThesisStep({
  value,
  onChange,
}: {
  value: EditorState;
  onChange: (value: EditorState) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const patch = <K extends keyof EditorState>(key: K, next: EditorState[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="flex flex-col gap-[18px]">
      <TextArea
        label={t("fundEditor.basic.thesis")}
        value={value.thesis}
        onChange={(next) => patch("thesis", next)}
        rows={6}
      />
      <RiskPostureField value={value.riskPosture} onChange={(next) => patch("riskPosture", next)} />
      <section className="flex flex-col gap-3.5 rounded-lg bg-canvas p-[18px]">
        <div>
          <p className="m-0 text-list font-semibold text-ink-1">
            {t("fundEditor.basic.stageExpectations")}
          </p>
          <p className="mt-0.5 mb-0 text-meta leading-4 text-ink-3">
            {t("fundEditor.basic.stageExpectationsHint")}
          </p>
        </div>
        {value.stages.length === 0 ? (
          <p className="m-0 text-meta text-ink-3">{t("fundEditor.basic.pickStage")}</p>
        ) : (
          value.stages.map((stage) => (
            <TextArea
              key={stage}
              label={stageText(stage, language)}
              value={value.stageExpectations[stage] ?? ""}
              onChange={(next) =>
                patch("stageExpectations", { ...value.stageExpectations, [stage]: next })
              }
            />
          ))
        )}
      </section>
      <ListField
        label={t("fundEditor.basic.dealbreakers")}
        value={value.dealbreakers}
        onChange={(next) => patch("dealbreakers", next)}
        hint={t("fundEditor.basic.dealbreakersHint")}
        separator="newline"
      />
    </div>
  );
}

export function SpecialistsStep({
  fundId,
  value,
  moduleOverrides,
  researchModuleOverrides,
  userRoles,
  onUnsavedChange,
}: {
  fundId: string;
  value: EditorState;
  /** A specialist text or draft ("research" for the strategy) is open and not saved. */
  onUnsavedChange?: ((part: string, unsaved: boolean) => void) | undefined;
  moduleOverrides: Record<
    string,
    { mandate: string[]; evidenceTests: string[]; riskAreas: string[] }
  >;
  researchModuleOverrides: Record<string, { questions: string[] }>;
  userRoles: string[] | undefined;
}) {
  const t = useT();
  // The link to /intern/prompts only where the internal pages exist (never at customers).
  const internalPages = useQuery({
    queryKey: ["internal-pages-enabled"],
    queryFn: () => getInternalPagesEnabled(),
    staleTime: Infinity,
  });
  return (
    <div className="flex flex-col gap-8">
      {/* DECISION PENDING (M2): Admin only or Admin + Lead may edit/see the specialist
          instruction text here. Today configure_fund (Admin and Lead) does. Do not change
          until the product owner has decided. */}
      <SpecialistCards
        fundId={fundId}
        configId={value.configId}
        moduleOverrides={moduleOverrides}
        onUnsavedChange={onUnsavedChange}
      />
      {/* The research strategy keeps its older text scale. */}
      <div data-legacy-scale="">
        <Section
          title={t("fundEditor.basic.researchTitle")}
          description={t("fundEditor.basic.researchDescription")}
        >
          {isAdminRole(userRoles) && internalPages.data === true && (
            <p className="text-list text-ink-3">
              {t("fundEditor.basic.promptsBefore")}{" "}
              <Link to="/intern/prompts" className="text-action hover:text-action-hover">
                {t("fundEditor.basic.promptsLink")}
              </Link>
              {t("fundEditor.basic.promptsAfter")}
            </p>
          )}
          <ResearchStrategyEditor
            fundId={fundId}
            configId={value.configId}
            onUnsavedChange={(unsaved) => onUnsavedChange?.("research", unsaved)}
            profile={{
              thesis: value.thesis,
              stages: value.stages,
              geographies: value.geographies,
              sectors: value.sectors,
              ticketMinEur: value.ticketMinEur,
              ticketMaxEur: value.ticketMaxEur,
              ticketNote: value.ticketNote,
              riskPosture: value.riskPosture,
              dealbreakers: value.dealbreakers,
              gates: value.gates,
              criteria: value.criteria,
            }}
            overrides={researchModuleOverrides}
          />
        </Section>
      </div>
    </div>
  );
}
