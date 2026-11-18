/**
 * The Opret case flow: Selskab → Find → Bekræft → Interlect arbejder. This file owns the
 * step machine, the draft (kept in the browser; nothing is created before "Start" or "Opret uden
 * screening"), the candidate search and the hand-over to the creation
 * (`useIntakeRun` → `src/lib/cases/intake-run.ts`).
 *
 * Top bar from the prototype: round back button (34 px), "Opret case" 15/600, four progress
 * strokes (the current one 28 px and coral, finished ones ink, later ones the chart track,
 * 480 ms) and the step label.
 */
import type { RegistryCountry } from "@/lib/analysis/registries/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, X } from "lucide-react";
import { findCompanyCandidates } from "@/lib/cases/find-candidates.functions";
import type { FindResult } from "@/lib/cases/find-candidates.core";
import type { CompanyCandidate } from "@/lib/analysis/identity-resolve";
import { parseCompanyQuery } from "@/lib/analysis/identity-resolve";
import { caseFileType, CASE_FILE_MAX_BYTES } from "@/lib/cases/case-files";
import { normalizeWebsiteInput, screeningFinished, type IntakePlan } from "@/lib/cases/intake-run";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { hasCapability } from "@/lib/domain/workflow";
import type { FundRole } from "@/lib/domain/types";
import { SPRING } from "@/lib/motion";
import { useT } from "@/lib/i18n/useT";
import { translate, type MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";
import { ConfirmStep } from "./ConfirmStep";
import { FindStep, type FindState } from "./FindStep";
import { InboxPills } from "./InboxPills";
import { notesFromInbound, useInboundItems } from "./inbound";
import { IntakeStart } from "./IntakeStart";
import { RunWait } from "./RunWait";
import {
  EMPTY_DRAFT,
  INTAKE_STEPS,
  INTAKE_STEP_LABEL_KEYS,
  type ConfirmExtras,
  type ConfirmFacts,
  type IntakeDraft,
  type IntakeStep,
  type StartAction,
} from "./types";
import { useIntakeCapabilities } from "./useIntakeData";
import { clearIntakeDraft, useIntakeDraftStorage } from "./useIntakeDraftStorage";
import { useIntakeRun } from "./useIntakeRun";

const EMPTY_FACTS: ConfirmFacts = {
  name: "",
  sector: "",
  stage: "unknown",
  country: "",
  website: "",
};

/** The facts Bekræft starts with: only what the verified match (or the user) really gave. */
function factsFrom(
  candidate: CompanyCandidate | null,
  draft: IntakeDraft,
  t: (key: MessageKey) => string,
): ConfirmFacts {
  const typed = draft.query.trim();
  return {
    name: candidate ? candidate.name : parseCompanyQuery(typed).kind === "name" ? typed : "",
    sector: candidate?.industryText ?? "",
    stage: "unknown",
    country: candidate?.country ?? (candidate?.cvrNumber ? "Danmark" : ""),
    website: candidate?.website ?? draft.website.trim(),
  };
}

/**
 * Refusals the server throws on purpose, recognised in either language and shown in the page's
 * (the rate limit is always Danish); everything else is generic.
 */
const SEARCH_REFUSALS: MessageKey[] = [
  "auth.invitation.rateLimited",
  "appServer.access.noMembership",
  "appServer.access.forbidden",
];

function friendlyError(cause: unknown, t: (key: MessageKey) => string): string {
  const message = cause instanceof Error ? cause.message : "";
  const refusal = SEARCH_REFUSALS.find((key) =>
    (["da", "en"] as const).some((language) => translate(language, key) === message),
  );
  return t(refusal ?? "intake.flow.searchFailed");
}

export function IntakeFlow({ fundId }: { fundId: string }) {
  const t = useT();
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const find = useServerFn(findCompanyCandidates);
  const inbound = useInboundItems(fundId);
  const [step, setStep] = useState<IntakeStep>("start");
  const [draft, setDraft] = useState<IntakeDraft>(EMPTY_DRAFT);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [findState, setFindState] = useState<FindState>({ phase: "searching" });
  const [searchQuery, setSearchQuery] = useState("");
  // The register Find searches (Danish CVR unless the user picks another country).
  const [registryCountry, setRegistryCountry] = useState<RegistryCountry>("DK");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<CompanyCandidate | null>(null);
  const [autoPicked, setAutoPicked] = useState(false);
  const { funds } = useActiveFund();
  const eligibleFunds = useMemo(
    () => funds.filter((fund) => hasCapability(fund.roles as FundRole[], "create_case")),
    [funds],
  );
  const [facts, setFacts] = useState<ConfirmFacts>(EMPTY_FACTS);
  const [extras, setExtras] = useState<ConfirmExtras>({
    fundIds: [fundId],
    sourceKind: null,
    assignedTo: null,
    sourceNote: "",
  });
  const [action, setAction] = useState<StartAction>("screen");
  const runner = useIntakeRun();
  const capability = useIntakeCapabilities(extras.fundIds[0] ?? fundId);
  const request = useRef(0);
  // Search results by query + website for this visit: "Søg igen" and Back/forward with the same
  // input never repeat the (slow, partly paid) registry and web lookups.
  const searchCache = useRef(new Map<string, FindResult>());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const patchFacts = useCallback(
    (next: Partial<ConfirmFacts>) => setFacts((current) => ({ ...current, ...next })),
    [],
  );
  const patchExtras = useCallback(
    (next: Partial<ConfirmExtras>) => setExtras((current) => ({ ...current, ...next })),
    [],
  );

  const patch = useCallback(
    (next: Partial<IntakeDraft>) => setDraft((current) => ({ ...current, ...next })),
    [],
  );

  const pickFiles = useCallback(
    (files: File[]) => {
      const accepted: File[] = [];
      let rejected = false;
      for (const file of files) {
        if (caseFileType(file.name) && file.size <= CASE_FILE_MAX_BYTES) accepted.push(file);
        else rejected = true;
      }
      setDeckError(rejected ? t("intake.flow.deckError") : null);
      if (accepted.length > 0)
        setDraft((current) => ({ ...current, files: [...current.files, ...accepted] }));
    },
    [t],
  );
  const removeFile = useCallback((index: number) => {
    setDeckError(null);
    setDraft((current) => ({ ...current, files: current.files.filter((_, i) => i !== index) }));
  }, []);

  const runSearch = useCallback(
    async (
      query: string,
      options: { skipAuto?: boolean; country?: RegistryCountry; website?: string } = {},
    ) => {
      const id = ++request.current;
      const country = options.country ?? registryCountry;
      // "Brug …" searches with the new address before the draft has re-rendered.
      const website = options.website ?? draft.website;
      setStep("find");
      setFindState({ phase: "searching" });
      setSearchQuery(query);
      setSelectedId(null);
      setAutoPicked(false);
      try {
        const cacheKey = `${country}\u0000${query.toLowerCase()}\u0000${website.trim().toLowerCase()}`;
        let result = searchCache.current.get(cacheKey);
        if (!result) {
          result = (await find({
            data: { fundId, query, website, country },
          })) as FindResult;
          // A register that did not answer is asked again next time.
          if (!result.registryFailed) searchCache.current.set(cacheKey, result);
        }
        if (id !== request.current) return;
        const auto = result.candidates.find((c) => c.id === result.autoSelectedId) ?? null;
        if (auto && !options.skipAuto) {
          setChosen(auto);
          setFacts(factsFrom(auto, { ...draft, website }, t));
          setSelectedId(auto.id);
          setAutoPicked(true);
          setStep("confirm");
          return;
        }
        setFindState({
          phase: "done",
          candidates: result.candidates,
          notes: result.noteKeys,
          websiteRedirect: result.websiteRedirect,
        });
        // Only a confirmed or probable, active match is preselected; with only uncertain
        // candidates nothing is chosen for the user (the card shows "Usikkert match").
        const preselectable = (c: CompanyCandidate) =>
          !c.inactive && c.assessment.status !== "uncertain";
        setSelectedId(
          (auto && options.skipAuto ? auto : result.candidates.find(preselectable))?.id ?? null,
        );
      } catch (cause) {
        if (id !== request.current) return;
        console.warn("[opret-case] candidate search failed", cause);
        setFindState({ phase: "error", message: friendlyError(cause, t) });
      }
    },
    [draft, find, fundId, registryCountry, t],
  );

  const startFind = () => {
    const query = draft.query.trim();
    if (!query) return;
    void runSearch(query);
  };

  const goBack = () => {
    request.current += 1; // a search still running no longer matters
    if (step === "start" || step === "run") {
      void navigate({ to: "/cases" });
    } else if (step === "find") {
      setStep("start");
    } else if (step === "confirm") {
      setStep(autoPicked ? "start" : "find");
    }
  };

  const candidates = findState.phase === "done" ? findState.candidates : [];
  const toConfirm = () => {
    const picked = candidates.find((c) => c.id === selectedId) ?? null;
    if (!picked) return;
    setChosen(picked);
    setFacts(factsFrom(picked, draft, t));
    setAutoPicked(false);
    setStep("confirm");
  };
  const noneMatch = () => {
    // Bekræft with the typed name and no CVR; screening step 0 tries on its own.
    setChosen(null);
    setFacts(factsFrom(null, draft, t));
    setSelectedId(null);
    setAutoPicked(false);
    setStep("confirm");
  };

  const startCreation = (next: StartAction) => {
    const selected = eligibleFunds.filter((fund) => extras.fundIds.includes(fund.id));
    if (selected.length === 0) return;
    const name = (chosen?.name ?? facts.name).trim();
    const origin =
      capability.caseOrigin && (extras.sourceKind || extras.assignedTo)
        ? { sourceKind: extras.sourceKind, assignedTo: extras.assignedTo }
        : null;
    const plan: IntakePlan = {
      mode: next === "create" ? "create" : "screen",
      company: {
        name,
        website: normalizeWebsiteInput(facts.website),
        stage: facts.stage,
        sector: facts.sector.trim(),
        geography: facts.country.trim(),
        notes: draft.notes.trim(),
        sourceNote: extras.sourceNote.trim(),
        cvrNumber: chosen?.cvrNumber ?? null,
        registryCountry: chosen?.registryCountry ?? "DK",
        // The company is stored as "human confirmed" only when the user actively chose it
        // (picked it in Find, or typed its CVR); never for a match Interlect picked on its own.
        humanChoseCompany: Boolean(
          chosen?.cvrNumber && (!autoPicked || chosen.origin === "entered_cvr"),
        ),
      },
      origin,
      files: draft.files,
      captureWebsite: true,
    };
    clearIntakeDraft(fundId);
    setAction(next);
    setStep("run");
    runner.start(
      plan,
      selected.map((fund) => ({ id: fund.id, name: fund.name })),
    );
  };

  /** "Opret en til": keeps the chosen thesis (theses), resets name, sources and notes. */
  const another = () => {
    clearIntakeDraft(fundId);
    runner.reset();
    request.current += 1;
    setDraft(EMPTY_DRAFT);
    setDeckError(null);
    setFacts(EMPTY_FACTS);
    setChosen(null);
    setSelectedId(null);
    setAutoPicked(false);
    setFindState({ phase: "searching" });
    setExtras((current) => ({ ...current, sourceKind: null, assignedTo: null, sourceNote: "" }));
    setStep("start");
  };

  // The draft survives a refresh or the browser's Back (not the deck file).
  useIntakeDraftStorage(
    fundId,
    { query: draft.query, website: draft.website, notes: draft.notes, fundIds: extras.fundIds },
    (stored) => {
      setDraft((current) => ({
        ...current,
        query: stored.query,
        website: stored.website,
        notes: stored.notes,
      }));
      const allowed = stored.fundIds.filter((id) => eligibleFunds.some((fund) => fund.id === id));
      if (allowed.length > 0) setExtras((current) => ({ ...current, fundIds: allowed }));
    },
  );

  // A creation that is running must not be lost to a closed tab or a refresh.
  const creating = runner.jobs.some((job) => job.state === "running" || job.state === "idle");
  useEffect(() => {
    if (!creating) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [creating]);

  const runDone =
    step === "run" &&
    runner.jobs.length > 0 &&
    runner.jobs.every((job) =>
      action === "create"
        ? job.state === "done"
        : screeningFinished(job, runner.progress[job.id]?.status),
    );

  // Focus the heading of the new step (keyboard and screen reader users follow the flow).
  useEffect(() => {
    if (step !== "start") headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const stepIndex = INTAKE_STEPS.indexOf(step);
  const invalidCvrHint = useMemo(() => {
    const parsed = parseCompanyQuery(draft.query);
    return parsed.kind === "name" && parsed.invalidCvr ? t("intake.flow.invalidCvr") : null;
  }, [draft.query, t]);

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      <div className="flex shrink-0 items-center gap-3.5 border-b border-line px-6 py-4">
        <motion.button
          type="button"
          onClick={goBack}
          aria-label={
            step === "start" || step === "run" ? t("intake.flow.closeAndGo") : t("intake.flow.back")
          }
          title={
            step === "start" || step === "run" ? t("intake.flow.close") : t("intake.flow.back")
          }
          {...(reduced ? {} : { whileTap: { scale: 0.92 } })}
          className="grid size-[34px] place-items-center rounded-full bg-sunken text-ink-2 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-action"
        >
          {step === "start" || step === "run" ? (
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          ) : (
            <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
          )}
        </motion.button>
        <span className="text-[15px] font-semibold">{t("intake.flow.title")}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-[5px]" aria-hidden>
          {INTAKE_STEPS.map((key, index) => (
            <motion.span
              key={key}
              layout
              transition={reduced ? { duration: 0.12 } : SPRING.smooth}
              className={cn(
                "h-1.5 rounded-[3px]",
                index === stepIndex ? "w-7" : "w-3",
                index < stepIndex
                  ? "bg-ink-1"
                  : index === stepIndex
                    ? "bg-ai"
                    : "bg-[var(--chart-track)]",
              )}
            />
          ))}
        </div>
        <span className="text-meta whitespace-nowrap text-ink-3">
          {runDone ? t("intake.flow.done") : t(INTAKE_STEP_LABEL_KEYS[step])}
        </span>
      </div>

      {step === "start" && (
        <IntakeStart
          draft={draft}
          onChange={patch}
          onPickFiles={pickFiles}
          onRemoveFile={removeFile}
          onFind={startFind}
          deckError={deckError}
          invalidCvrHint={invalidCvrHint}
          inbox={
            <InboxPills
              items={inbound}
              onUse={(item) => patch({ notes: notesFromInbound(item) })}
            />
          }
        />
      )}
      {step === "find" && (
        <FindStep
          fundId={fundId}
          query={searchQuery}
          state={findState}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onBack={goBack}
          onContinue={toConfirm}
          onNoneMatch={noneMatch}
          onSearchAgain={(next) => {
            patch({ query: next });
            void runSearch(next);
          }}
          onUseWebsite={(website) => {
            patch({ website });
            void runSearch(searchQuery, { website });
          }}
          country={registryCountry}
          onCountry={(next) => {
            setRegistryCountry(next);
            void runSearch(searchQuery, { country: next });
          }}
          headingRef={headingRef}
        />
      )}
      {step === "confirm" && (
        <ConfirmStep
          draft={draft}
          candidate={chosen}
          auto={autoPicked}
          facts={facts}
          onFacts={patchFacts}
          extras={extras}
          onExtras={patchExtras}
          eligibleFunds={eligibleFunds}
          onWrongCompany={() => {
            // "Ikke det rigtige?": back to Find with the candidate list (searched again; the
            // automatic choice is skipped this time).
            void runSearch(draft.query.trim(), { skipAuto: true });
          }}
          onBack={goBack}
          onStart={startCreation}
          headingRef={headingRef}
        />
      )}
      {step === "run" && (
        <RunWait
          jobs={runner.jobs}
          progress={runner.progress}
          action={action}
          onRetry={runner.retry}
          onAnother={another}
          headingRef={headingRef}
        />
      )}
    </div>
  );
}
