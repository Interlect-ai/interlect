/**
 * Opret case, step 3 "Bekræft" (prototype "Opret case.dc.html", `sConfirm`): the company, the
 * facts (prefilled only from what is really known; the rest is "Ukendt"), the mandate fit
 * (ONLY requirements that known facts decide in code; the rest is "afklares i screeningen"),
 * "Screenes mod" (only when the user is in several theses: one isolated case each), the folded
 * "Kilde, ansvarlig og note", and the split button.
 *
 * "Hvor kommer casen fra" and "Ansvarlig" are shown ONLY when the database has the columns
 * (`getIntakeCapabilities`, migration 0056): staging and production share one database.
 *
 * The split button: "Start screening" | "Screening, og dyb analyse når du har set den" (starts
 * ONLY the screening; deep analysis is never started from here, principle 10) | "Opret uden
 * screening" (no run, no cost; the case waits in phase Screening as "afventer screening").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  Bookmark,
  Building2,
  Check,
  ChevronDown,
  CircleCheck,
  ScanSearch,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Collapse } from "@/components/ds/Collapse";
import { MandatfitCircles } from "@/components/ds/MandatfitCircles";
import { MenuItem } from "@/components/ds/Menu";
import { SplitButton } from "@/components/ds/SplitButton";
import type { CompanyCandidate } from "@/lib/analysis/identity-resolve";
import type { MemberFund } from "@/lib/funds/funds.functions";
import { fundAllowsStage } from "@/lib/domain/stages";
import { hasCapability } from "@/lib/domain/workflow";
import type { FundRole } from "@/lib/domain/types";
import { isUsableName, normalizeWebsiteInput } from "@/lib/cases/intake-run";
import {
  previewMandate,
  previewSummary,
  type IntakeStage,
  type PreviewGate,
} from "@/lib/cases/intake-mandate";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { registryNumberLabel } from "@/lib/analysis/registries/types";
import { candidateMeta } from "./candidate-format";
import {
  SOURCE_KINDS,
  type ConfirmExtras,
  type ConfirmFacts,
  type IntakeDraft,
  type StartAction,
} from "./types";
import {
  useCommonAssignees,
  useExistingCases,
  useIntakeCapabilities,
  useIntakeMandate,
} from "./useIntakeData";

const CARD = "rounded-lg bg-surface shadow-card";
const CHIP_OFF = "bg-surface text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-hover";
const CHIP_ON = "bg-inverse text-ink-inverse";

const STAGE_ORDER: IntakeStage[] = [
  "unknown",
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "later",
  "growth",
  "buyout",
];

/** "Interlect fandt X ud fra hjemmesiden, og det matcher CVR." Built from the real signals. */
function autoBasis(candidate: CompanyCandidate, hasWebsite: boolean): MessageKey {
  const fromWebsite =
    candidate.origin === "website_footer" || candidate.matches.includes("website");
  if (candidate.matches.includes("name") && fromWebsite && hasWebsite) {
    return "intake.confirm.basisNameWebsite";
  }
  if (fromWebsite && hasWebsite) return "intake.confirm.basisWebsite";
  if (candidate.matches.includes("cvr") && candidate.origin === "entered_cvr") {
    return "intake.confirm.basisCvr";
  }
  return "intake.confirm.basisName";
}

function FactRow({
  label,
  first,
  children,
}: {
  label: string;
  first: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "grid min-h-[62px] grid-cols-[110px_minmax(0,1fr)] items-center gap-3 px-4 py-1",
        !first && "border-t border-line",
      )}
    >
      <span className="text-list text-ink-3">{label}</span>
      {children}
    </label>
  );
}

const FACT_INPUT =
  "h-[38px] min-w-0 -ml-2.5 rounded-[10px] border-0 bg-transparent px-2.5 text-[15px] text-ink-1 outline-none transition-[background-color,box-shadow] duration-[var(--dur-quick)] placeholder:text-ink-4 hover:bg-canvas focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]";

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export interface ConfirmStepProps {
  draft: IntakeDraft;
  candidate: CompanyCandidate | null;
  auto: boolean;
  facts: ConfirmFacts;
  onFacts: (patch: Partial<ConfirmFacts>) => void;
  extras: ConfirmExtras;
  onExtras: (patch: Partial<ConfirmExtras>) => void;
  /** The funds the user may create cases in (create_case), including the active one. */
  eligibleFunds: MemberFund[];
  onWrongCompany: () => void;
  onBack: () => void;
  onStart: (action: StartAction) => void;
  headingRef: React.Ref<HTMLHeadingElement>;
}

export function ConfirmStep({
  draft,
  candidate,
  auto,
  facts,
  onFacts,
  extras,
  onExtras,
  eligibleFunds,
  onWrongCompany,
  onBack,
  onStart,
  headingRef,
}: ConfirmStepProps) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const [more, setMore] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const ownerTouched = useRef(false);

  const chosen = useMemo(
    () => eligibleFunds.filter((fund) => extras.fundIds.includes(fund.id)),
    [eligibleFunds, extras.fundIds],
  );
  const chosenIds = chosen.map((fund) => fund.id);
  const name = (candidate?.name ?? facts.name).trim();
  const website = normalizeWebsiteInput(facts.website);
  const websiteInvalid = facts.website.trim().length > 0 && website === "";

  const capability = useIntakeCapabilities(chosenIds[0] ?? null);
  const mandate = useIntakeMandate(chosenIds);
  const existing = useExistingCases(
    chosenIds,
    isUsableName(name) ? name : "",
    website,
    candidate?.cvrNumber ?? null,
  );
  const assignees = useCommonAssignees(chosenIds, capability.caseOrigin);

  // Default "Ansvarlig" = the current user, when the team list is known and the user has not
  // chosen anyone; a chosen person who is not in every chosen fund is dropped.
  const me = assignees.people.find((person) => person.isMe) ?? null;
  const assigned = extras.assignedTo;
  useEffect(() => {
    if (!capability.caseOrigin || assignees.people.length === 0) return;
    if (assigned && !assignees.people.some((person) => person.userId === assigned)) {
      onExtras({ assignedTo: me?.userId ?? null });
      return;
    }
    if (!assigned && !ownerTouched.current && me) onExtras({ assignedTo: me.userId });
  }, [capability.caseOrigin, assignees.people, assigned, me, onExtras]);

  const duplicates = existing.hits.filter((hit) => chosenIds.includes(hit.fundId));
  const allDuplicate = chosenIds.length > 0 && duplicates.length === chosenIds.length;

  const canScreen =
    chosen.length > 0 &&
    chosen.every((fund) => hasCapability(fund.roles as FundRole[], "start_analysis"));
  const nameOk = isUsableName(name);
  const ready = chosen.length > 0 && nameOk && !websiteInvalid && !allDuplicate;

  const stageOptions = STAGE_ORDER.filter(
    (stage) =>
      (stage !== "growth" && stage !== "buyout") ||
      (chosen.length > 0 && chosen.every((fund) => fundAllowsStage(fund.stages, stage))),
  );

  // Mandate fit per chosen thesis, decided in code from what is known.
  const previews = useMemo(
    () =>
      mandate.snapshots
        .filter((snapshot) => chosenIds.includes(snapshot.fundId))
        .map((snapshot) => ({
          snapshot,
          gates: previewMandate(
            snapshot,
            {
              country: facts.country.trim() || null,
              stage: facts.stage,
            },
            language,
          ),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mandate.snapshots, chosenIds.join(","), facts.country, facts.stage, language],
  );

  const sourceKind = SOURCE_KINDS.find((kind) => kind.key === extras.sourceKind);
  const sourceLabel = sourceKind ? t(sourceKind.labelKey) : null;
  const ownerName = assignees.people.find((person) => person.userId === assigned)?.name ?? null;
  const moreSummary =
    [
      capability.caseOrigin ? sourceLabel : null,
      capability.caseOrigin ? ownerName : null,
      extras.sourceNote.trim() ? t("intake.confirm.moreNote") : null,
    ]
      .filter(Boolean)
      .join(" · ") || t("intake.confirm.moreOptional");
  const moreTitle = capability.caseOrigin
    ? t("intake.confirm.moreTitleFull")
    : t("intake.confirm.moreTitleNote");

  const toggleFund = (fundId: string) => {
    const on = extras.fundIds.includes(fundId);
    if (on && extras.fundIds.length === 1) return; // at least one thesis
    onExtras({
      fundIds: on ? extras.fundIds.filter((id) => id !== fundId) : [...extras.fundIds, fundId],
    });
  };

  const run = (action: StartAction) => {
    setMenuOpen(false);
    if (ready) onStart(action);
  };

  const hint = !nameOk
    ? t("intake.confirm.hintNoName")
    : websiteInvalid
      ? t("intake.confirm.hintBadWebsite")
      : allDuplicate
        ? t("intake.confirm.hintAllDuplicate")
        : null;

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-auto">
      <motion.div
        className="flex w-full max-w-[924px] flex-col gap-4 px-4 pt-10 pb-[60px] md:px-8"
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={reduced ? { duration: 0.12 } : { duration: 0.42, ease: EASE.out }}
      >
        <div className="flex flex-wrap items-center gap-4">
          {/* A neutral company glyph: design rules forbid initial circles as logos. */}
          <span
            className="grid size-14 place-items-center rounded-2xl bg-sunken text-ink-3"
            aria-hidden
          >
            <Building2 className="size-6" strokeWidth={1.5} />
          </span>
          <div className="flex min-w-0 flex-col gap-[3px]">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="m-0 text-[32px] leading-[1.1] font-semibold tracking-title text-ink-1 outline-none"
            >
              {name || t("intake.confirm.newCompany")}
            </h2>
            <span className="text-[15px] text-ink-3">
              {candidate
                ? candidateMeta(candidate, language) || website
                : t("intake.confirm.fillWhatYouKnow")}
            </span>
          </div>
        </div>

        {auto && candidate && (
          <div className="flex items-center gap-3 rounded-lg bg-positive-wash px-4 py-3.5">
            <CircleCheck
              className="size-[18px] shrink-0 text-positive"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-list text-ink-1">
              {t("intake.confirm.autoFound", {
                name: candidate.name,
                basis: t(autoBasis(candidate, Boolean(draft.website.trim()))),
              })}
            </span>
            <button
              type="button"
              onClick={onWrongCompany}
              className="h-8 rounded-pill bg-surface px-3 text-meta font-medium whitespace-nowrap text-ink-1 shadow-pill outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              {t("intake.confirm.notThisOne")}
            </button>
          </div>
        )}

        {duplicates.map((hit) => (
          <div
            key={hit.fundId}
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-wash px-4 py-3.5"
          >
            <TriangleAlert
              className="size-[18px] shrink-0 text-warning"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-list text-ink-1">
              {t("intake.confirm.duplicate", {
                name: hit.companyName,
                where:
                  eligibleFunds.length > 1
                    ? t("intake.confirm.duplicateIn", {
                        fund:
                          eligibleFunds.find((fund) => fund.id === hit.fundId)?.name ??
                          t("intake.confirm.duplicateFundFallback"),
                      })
                    : "",
              })}
            </span>
            <Link
              to="/cases/$caseId"
              params={{ caseId: hit.caseId }}
              search={{ view: "screening" }}
              className="inline-flex h-8 items-center rounded-pill bg-surface px-3 text-meta font-medium whitespace-nowrap text-ink-1 shadow-pill outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              {t("intake.confirm.openCase")}
            </Link>
          </div>
        ))}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3">
          <div className={cn("flex flex-col overflow-hidden", CARD)}>
            {!candidate && (
              <FactRow label={t("intake.confirm.factName")} first>
                <input
                  aria-label={t("intake.confirm.factNameLabel")}
                  value={facts.name}
                  onChange={(event) => onFacts({ name: event.target.value })}
                  placeholder={t("intake.confirm.factNameLabel")}
                  maxLength={200}
                  className={FACT_INPUT}
                />
              </FactRow>
            )}
            {candidate?.cvrNumber && (
              <FactRow label={t("intake.confirm.factRegistration")} first>
                <span className="text-[15px] text-ink-1">
                  {registryNumberLabel(candidate.registryCountry)} {candidate.cvrNumber}
                  {candidate.legalForm ? `, ${candidate.legalForm}` : ""}
                </span>
              </FactRow>
            )}
            <FactRow
              label={t("intake.confirm.factSector")}
              first={Boolean(candidate) && !candidate?.cvrNumber}
            >
              <input
                aria-label={t("intake.confirm.factSector")}
                value={facts.sector}
                onChange={(event) => onFacts({ sector: event.target.value })}
                placeholder={t("intake.confirm.unknown")}
                maxLength={160}
                className={FACT_INPUT}
              />
            </FactRow>
            <FactRow label={t("intake.confirm.factStage")} first={false}>
              <select
                aria-label={t("intake.confirm.factStage")}
                value={facts.stage}
                onChange={(event) => onFacts({ stage: event.target.value as IntakeStage })}
                className={cn(FACT_INPUT, "cursor-pointer")}
              >
                {stageOptions.map((stage) => (
                  <option key={stage} value={stage}>
                    {t(`basis.stage.${stage}` as MessageKey)}
                  </option>
                ))}
              </select>
            </FactRow>
            <FactRow label={t("intake.confirm.factCountry")} first={false}>
              <input
                aria-label={t("intake.confirm.factCountry")}
                value={facts.country}
                onChange={(event) => onFacts({ country: event.target.value })}
                placeholder={t("intake.confirm.unknown")}
                maxLength={160}
                className={FACT_INPUT}
              />
            </FactRow>
            <FactRow label={t("intake.confirm.factWebsite")} first={false}>
              <input
                aria-label={t("intake.confirm.factWebsite")}
                value={facts.website}
                onChange={(event) => onFacts({ website: event.target.value })}
                placeholder={t("intake.confirm.unknown")}
                aria-invalid={websiteInvalid || undefined}
                maxLength={300}
                className={FACT_INPUT}
              />
            </FactRow>
          </div>

          <div className="flex flex-col gap-3.5 rounded-lg bg-canvas p-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[15px] font-semibold">{t("intake.confirm.mandate")}</span>
              <span className="text-meta text-ink-3">
                {mandate.loading
                  ? t("intake.confirm.mandateLoading")
                  : previews.length === 1
                    ? previewSummary(previews[0]!.gates, language)
                    : ""}
              </span>
            </div>
            {mandate.failed && (
              <span className="text-list leading-[1.55] text-ink-2">
                {t("intake.confirm.mandateFailed")}
              </span>
            )}
            {!mandate.loading && !mandate.failed && previews.length === 0 && (
              <span className="text-list leading-[1.55] text-ink-2">
                {t("intake.confirm.mandateNoSetup")}
              </span>
            )}
            {previews.map(({ snapshot, gates }) => (
              <div key={snapshot.fundId} className="flex flex-col gap-2">
                {previews.length > 1 && (
                  <span className="text-meta text-ink-3">
                    {snapshot.fundName} · {previewSummary(gates, language)}
                  </span>
                )}
                {gates.length > 0 && <MandatGates gates={gates} />}
              </div>
            ))}
            {previews.length > 0 && (
              <span className="text-list leading-[1.55] text-ink-2">
                {t("intake.confirm.mandateNote")}
              </span>
            )}
          </div>
        </div>

        {eligibleFunds.length > 1 && (
          <div className={cn("flex flex-col gap-3 px-[22px] py-5", CARD)}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{t("intake.confirm.screenAgainst")}</span>
              <span className="text-meta text-ink-3">
                {t("intake.confirm.screenAgainstSub", { count: chosen.length })}
              </span>
            </div>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t("intake.confirm.screenAgainst")}
            >
              {eligibleFunds.map((fund) => {
                const on = extras.fundIds.includes(fund.id);
                return (
                  <button
                    key={fund.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleFund(fund.id)}
                    className={cn(
                      "inline-flex h-10 items-center rounded-xl px-[15px] text-[14px] font-medium whitespace-nowrap outline-none transition-colors duration-[var(--dur-base)] active:scale-[.96] focus-visible:ring-2 focus-visible:ring-action",
                      on ? CHIP_ON : CHIP_OFF,
                    )}
                  >
                    <span
                      className={cn(
                        "grid place-items-center overflow-hidden transition-[width,margin] duration-[var(--dur-base)]",
                        on ? "mr-2 w-3.5" : "mr-0 w-0",
                      )}
                      aria-hidden
                    >
                      <Check className="size-3.5" strokeWidth={2.25} />
                    </span>
                    {fund.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={cn("flex flex-col", CARD)}>
          <button
            type="button"
            onClick={() => setMore((open) => !open)}
            aria-expanded={more}
            aria-controls="intake-more"
            className="flex h-14 items-center gap-2.5 rounded-lg px-5 text-left text-[15px] font-semibold text-ink-1 outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {moreTitle}
            <span className="text-meta font-normal text-ink-3">{moreSummary}</span>
            <span className="flex-1" />
            <ChevronDown
              className={cn(
                "size-4 text-ink-4 transition-transform duration-[280ms]",
                more && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          <Collapse open={more} id="intake-more" className="flex flex-col gap-4 px-5 pb-5">
            {capability.caseOrigin && (
              <>
                <div
                  className="flex flex-col gap-2"
                  role="group"
                  aria-label={t("intake.confirm.sourceKindGroup")}
                >
                  <span className="text-meta text-ink-3">
                    {t("intake.confirm.sourceKindQuestion")}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {SOURCE_KINDS.map((kind) => {
                      const on = extras.sourceKind === kind.key;
                      return (
                        <button
                          key={kind.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => onExtras({ sourceKind: on ? null : kind.key })}
                          className={cn(
                            "h-9 rounded-[10px] px-[13px] text-list whitespace-nowrap outline-none transition-colors duration-[var(--dur-base)] focus-visible:ring-2 focus-visible:ring-action",
                            on ? CHIP_ON : CHIP_OFF,
                          )}
                        >
                          {t(kind.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div
                  className="flex flex-col gap-2"
                  role="group"
                  aria-label={t("intake.confirm.owner")}
                >
                  <span className="text-meta text-ink-3">{t("intake.confirm.owner")}</span>
                  {assignees.failed ? (
                    <span className="text-list text-ink-3">{t("intake.confirm.teamFailed")}</span>
                  ) : assignees.people.length === 0 ? (
                    <span className="text-list text-ink-3">
                      {assignees.loading
                        ? t("intake.confirm.teamLoading")
                        : t("intake.confirm.teamNone")}
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {assignees.people.map((person) => {
                        const on = assigned === person.userId;
                        return (
                          <button
                            key={person.userId}
                            type="button"
                            aria-pressed={on}
                            onClick={() => {
                              ownerTouched.current = true;
                              onExtras({ assignedTo: on ? null : person.userId });
                            }}
                            className={cn(
                              "inline-flex h-9 items-center gap-2 rounded-[10px] pr-[13px] pl-1.5 text-list whitespace-nowrap outline-none transition-colors duration-[var(--dur-base)] focus-visible:ring-2 focus-visible:ring-action",
                              on ? CHIP_ON : CHIP_OFF,
                            )}
                          >
                            <span
                              className={cn(
                                "grid size-6 place-items-center rounded-full text-[10px] font-semibold",
                                on ? "bg-surface text-ink-1" : "bg-sunken text-ink-2",
                              )}
                              aria-hidden
                            >
                              {initials(person.name)}
                            </span>
                            {person.name}
                            {person.isMe ? t("intake.confirm.me") : ""}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
            <textarea
              aria-label={t("intake.confirm.noteLabel")}
              value={extras.sourceNote}
              onChange={(event) => onExtras({ sourceNote: event.target.value })}
              placeholder={t("intake.confirm.notePlaceholder")}
              maxLength={1000}
              className="min-h-20 resize-y rounded-sm border-0 bg-canvas px-3.5 py-3 text-[14px] leading-[1.55] text-ink-1 outline-none transition-[background-color,box-shadow] duration-[var(--dur-quick)] placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]"
            />
          </Collapse>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1.5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-11 items-center gap-2 rounded-pill bg-surface px-4 text-[14px] font-medium whitespace-nowrap text-ink-1 shadow-pill outline-none transition-colors hover:bg-canvas focus-visible:ring-2 focus-visible:ring-action"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
            {t("intake.confirm.back")}
          </button>
          <div className="min-w-0 flex-1 px-1 text-meta text-ink-3" aria-live="polite">
            {hint}
          </div>
          <SplitButton
            size="lg"
            inverse
            label={
              canScreen ? t("intake.confirm.startScreening") : t("intake.confirm.createWithout")
            }
            icon={canScreen ? ScanSearch : Bookmark}
            disabled={!ready}
            onPrimary={() => run(canScreen ? "screen" : "create")}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          >
            <MenuItem
              icon={ScanSearch}
              tone={{ color: "action", wash: "action-wash" }}
              description={
                canScreen ? t("intake.confirm.startDescription") : t("intake.confirm.startNoRole")
              }
              recommended={canScreen}
              disabled={!canScreen}
              onSelect={() => run("screen")}
            >
              {t("intake.confirm.startScreening")}
            </MenuItem>
            <MenuItem
              icon={Sparkles}
              tone={{ color: "ai", wash: "ai-wash" }}
              description={t("intake.confirm.thenReviewDescription")}
              disabled={!canScreen}
              onSelect={() => run("screen_then_review")}
            >
              {t("intake.confirm.thenReview")}
            </MenuItem>
            <MenuItem
              icon={Bookmark}
              tone={{ color: "ink-2", wash: "bg-sunken" }}
              description={t("intake.confirm.createDescription")}
              onSelect={() => run("create")}
            >
              {t("intake.confirm.createWithout")}
            </MenuItem>
          </SplitButton>
        </div>
      </motion.div>
    </div>
  );
}

function MandatGates({ gates }: { gates: PreviewGate[] }) {
  const t = useT();
  return (
    <MandatfitCircles
      gates={gates.map((gate) => ({
        key: gate.key,
        label:
          gate.status === "passed"
            ? t("intake.confirm.gateDecided", { label: gate.label, basis: gate.basis })
            : t("intake.confirm.gateUndecided", { label: gate.label }),
        status: gate.status,
      }))}
      className="!min-h-0"
    />
  );
}
