/**
 * Ny investeringstese (`/fond/ny`): syv trin på Velaris (uden trinnet med screeningskort) med Interlect-hjælp pr. trin,
 * venteskærm og "Opsætningen er klar", porteret fra prototypen `Ny investeringstese v3`.
 *
 * Intet gemmes, før brugeren trykker "Udgiv opsætning": så oprettes fonden (`createFund`),
 * svarene gemmes som kladde (`saveFundConfigDraft`) og kladden udgives (`publishFundConfigDraft`),
 * altså de samme skrivestier som fondsopsætningen bruger. Svarene huskes i browseren
 * (`sessionStorage`), så en genindlæsning ikke koster dem. Hjælpen pr. trin er kun tekst.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { AiOrb, PendingLabel, type OrbState } from "@/components/ai/AiOrb";
import { LoadingState, PermissionDeniedState } from "@/components/states/StateBlocks";
import { Reveal } from "@/components/ds/Reveal";
import { isAdminRole } from "@/lib/auth/is-admin";
import { publishFundConfigDraft, saveFundConfigDraft } from "@/lib/funds/config.functions";
import { fundConfigTemplateIn } from "@/lib/funds/config-templates";
import { createFund } from "@/lib/funds/funds.functions";
import { setStandardSpecialist } from "@/lib/funds/specialists.functions";
import { useFundSpecialists } from "@/components/funds/editor/use-fund-specialists";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { useLanguage, useT } from "@/lib/i18n/useT";
import {
  AREAS,
  SETUP_STEPS,
  SPECIALISTS,
  buildDraftFields,
  chatContext,
  initialWizardState,
  localizeDefaultCriteria,
  publishProblems,
  templateFor,
  type WizardState,
} from "@/lib/funds/thesis-wizard";
import { EASE, PRESS, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { StepAsk, useStepChat } from "./StepAsk";
import {
  FramesStep,
  MandateStep,
  ReviewStep,
  SpecialistsStep,
  type SpecialistDraft,
  ThesisStep,
  WeightsStep,
  WhoStep,
  type StepProps,
} from "./StepViews";
import { userMessage } from "@/lib/errors/user-message";

const DRAFT_KEY = "interlect.newThesis.draft";
/** Den oprettede fond (og om den er udgivet), så en genindlæsning eller et nyt forsøg aldrig opretter en fond til. */
const CREATED_KEY = "interlect.newThesis.created";

interface Progress {
  fundId: string;
  configId: string;
  published: boolean;
}

function readProgress(): Progress | null {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(CREATED_KEY) ?? "null",
    ) as Progress | null;
    return parsed && typeof parsed.fundId === "string" && typeof parsed.configId === "string"
      ? { fundId: parsed.fundId, configId: parsed.configId, published: parsed.published === true }
      : null;
  } catch {
    return null;
  }
}

function writeProgress(progress: Progress | null) {
  try {
    if (progress) window.sessionStorage.setItem(CREATED_KEY, JSON.stringify(progress));
    else window.sessionStorage.removeItem(CREATED_KEY);
  } catch {
    // uden sessionStorage huskes det kun, så længe siden er åben
  }
}
/** Venteskærmen vises mindst så længe som i prototypen (5 trin à 750 ms + 650 ms); trinene følger det rigtige arbejde. */
const MIN_SETUP_MS = 4400;
const LAST_STEP = AREAS.length - 1;

type Phase = "review" | "setup" | "done";

function loadDraft(): { state: WizardState; area: number } | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: Partial<WizardState>; area?: unknown };
    if (!parsed.state || typeof parsed.state !== "object") return null;
    const base = initialWizardState();
    const state = { ...base, ...parsed.state } as WizardState;
    // Gamle eller beskadigede kladder må aldrig knække siden: felt for felt, ellers standard.
    const list = <T,>(value: unknown, fallback: T[]): T[] =>
      Array.isArray(value) ? (value as T[]) : fallback;
    state.criteria = list(state.criteria, base.criteria);
    if (state.criteria.length === 0) state.criteria = base.criteria;
    // Gamle kladder havde fem kort; nu er der de fire rigtige specialister.
    state.specialists = base.specialists.map((fallback, index) => {
      const value = Array.isArray(state.specialists) ? state.specialists[index] : undefined;
      return typeof value === "boolean" ? value : fallback;
    });
    if (!Number.isInteger(state.customSpecialists) || state.customSpecialists < 0) {
      state.customSpecialists = 0;
    }
    state.phases = list(state.phases, []);
    state.geo = list(state.geo, []);
    state.geoExtra = list(state.geoExtra, []);
    state.sectors = list(state.sectors, []);
    state.sectorExtra = list(state.sectorExtra, []);
    if (state.gates !== null) state.gates = Array.isArray(state.gates) ? state.gates : null;
    if (state.type !== null && !(Number.isInteger(state.type) && state.type >= 0 && state.type < 5))
      state.type = null;
    if (!Number.isInteger(state.risk) || state.risk < 0 || state.risk > 4) state.risk = base.risk;
    for (const key of ["name", "other", "thesis", "ticketMin", "ticketMax"] as const) {
      if (typeof state[key] !== "string") state[key] = base[key];
    }
    const area =
      typeof parsed.area === "number" ? Math.max(0, Math.min(LAST_STEP, parsed.area)) : 0;
    return { state, area };
  } catch {
    return null;
  }
}

export function ThesisWizard() {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  const { fundId, funds, isLoading, isError, selectFund, refreshFunds } = useActiveFund();
  const create = useServerFn(createFund);
  const saveDraft = useServerFn(saveFundConfigDraft);
  const publish = useServerFn(publishFundConfigDraft);
  const setStandard = useServerFn(setStandardSpecialist);

  const [state, setState] = useState<WizardState>(initialWizardState);
  const [area, setArea] = useState(0);
  const [phase, setPhase] = useState<Phase>("review");
  const [setupStep, setSetupStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [maxSet, setMaxSet] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const created = useRef<Progress | null>(null);
  // Kladden findes, når fonden er oprettet før udgivelsen (egen specialist); så er den sandheden.
  const [draft, setDraft] = useState<SpecialistDraft | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    created.current = readProgress();
    if (created.current && !created.current.published) {
      setDraft({
        fundId: created.current.fundId,
        configId: created.current.configId,
        openNew: false,
      });
    }
    const draft = loadDraft();
    if (draft) {
      setState(draft.state);
      setArea(draft.area);
    }
    setHydrated(true);
  }, []);
  // The starting criteria follow the page's language until the team edits them.
  useEffect(() => {
    setState((current) => {
      const criteria = localizeDefaultCriteria(current.criteria, language);
      return criteria === current.criteria ? current : { ...current, criteria: [...criteria] };
    });
  }, [language]);
  useEffect(() => {
    if (!hydrated || phase === "done") return;
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ state, area }));
    } catch {
      // Uden sessionStorage virker siden stadig, svarene huskes bare ikke.
    }
  }, [state, area, hydrated, phase]);

  const patch = useCallback<StepProps["patch"]>((change) => {
    setState((current) => ({
      ...current,
      ...(typeof change === "function" ? change(current) : change),
    }));
  }, []);

  const stateRef = useRef(state);
  stateRef.current = state;
  const context = useCallback(() => chatContext(stateRef.current), []);
  const chat = useStepChat(fundId, area, context);

  const go = useCallback((next: number) => {
    setArea(Math.max(0, Math.min(LAST_STEP, next)));
    setError(null);
    scroller.current?.scrollTo({ top: 0 });
  }, []);

  const canCreate = funds.some((candidate) => isAdminRole(candidate.roles));

  const draftSpecialists = useFundSpecialists(draft?.fundId ?? "", draft?.configId);
  useEffect(() => {
    const view = draftSpecialists.data;
    if (!draft || !view) return;
    const standard = SPECIALISTS.map(
      (spec) => view.standard.find((item) => item.id === spec.id)?.enabled ?? true,
    );
    const own = view.custom.filter((item) => item.enabled).length;
    setState((current) =>
      current.customSpecialists === own &&
      current.specialists.every((value, index) => value === standard[index])
        ? current
        : { ...current, specialists: standard, customSpecialists: own },
    );
  }, [draft, draftSpecialists.data]);

  /** Opretter fonden som kladde, så en egen specialist kan gemmes og udkastet tjekkes. */
  async function createDraftForSpecialist() {
    if (creatingDraft) return;
    if (state.name.trim().length < 2) {
      setError(t("thesis.draftNameMissing"));
      return;
    }
    setError(null);
    setCreatingDraft(true);
    try {
      if (!created.current) {
        const ids = await create({
          data: { name: state.name.trim(), template: templateFor(state), language },
        });
        created.current = { ...ids, published: false };
        writeProgress(created.current);
      }
      const ids = created.current;
      // De faste specialister, I allerede har slået fra, følger med over i kladden.
      for (const [index, spec] of SPECIALISTS.entries()) {
        if (state.specialists[index] === false) {
          await setStandard({
            data: {
              fundId: ids.fundId,
              configId: ids.configId,
              moduleId: spec.id,
              enabled: false,
            },
          });
        }
      }
      setDraft({ fundId: ids.fundId, configId: ids.configId, openNew: true });
    } catch (cause) {
      setError(userMessage(cause, t("thesis.draftFailed"), language));
    } finally {
      setCreatingDraft(false);
    }
  }

  async function publishSetup() {
    const problems = publishProblems(
      state,
      fundConfigTemplateIn(templateFor(state), language),
      language,
    );
    if (problems.length > 0) {
      setError(problems.join(" "));
      return;
    }
    setError(null);
    setSetupStep(0);
    setPhase("setup");
    const started = Date.now();
    try {
      if (!created.current) {
        const ids = await create({
          data: { name: state.name.trim(), template: templateFor(state), language },
        });
        created.current = { ...ids, published: false };
        writeProgress(created.current);
      }
      // The five steps are ticked off as the real work gets done, not on a timer.
      setSetupStep(1);
      const ids = created.current;
      // Er den allerede udgivet (svaret gik tabt sidst), springes skrivningen over.
      if (!ids.published) {
        await saveDraft({
          data: {
            configId: ids.configId,
            ...buildDraftFields(
              state,
              fundConfigTemplateIn(templateFor(state), language),
              language,
            ),
          },
        });
        setSetupStep(2);
        // No screening-card step any more; the draft keeps the template's screening setup.
        setSetupStep(3);
        await publish({ data: { configId: ids.configId } });
        ids.published = true;
        writeProgress(ids);
      }
      setSetupStep(4);
      await refreshFunds().catch(() => undefined);
      selectFund(ids.fundId);
      const wait = MIN_SETUP_MS - (Date.now() - started);
      if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait));
      try {
        window.sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // ingen kladde at fjerne
      }
      writeProgress(null);
      created.current = null;
      setSetupStep(SETUP_STEPS.length);
      setDraft(null);
      setPhase("done");
    } catch (cause) {
      const base = userMessage(cause, t("thesis.setupFailed"), language);
      setError(created.current ? t("thesis.setupFailedDraft", { base }) : base);
      setPhase("review");
    }
  }

  const back = () => {
    if (phase === "done") return void navigate({ to: "/fond" });
    if (area === 0) return void navigate({ to: "/fond" });
    go(area - 1);
  };
  const next = () => (area === LAST_STEP ? void publishSetup() : go(area + 1));

  const bars = useMemo(
    () =>
      AREAS.map((_, index) => ({
        width: index === area ? 26 : 10,
        color: index < area ? "var(--ink-1)" : index === area ? "var(--ai)" : "var(--chart-track)",
      })),
    [area],
  );

  if (isLoading || !hydrated)
    return (
      <Frame>
        <LoadingState title={t("thesis.loading")} />
      </Frame>
    );
  if (isError) {
    return (
      <Frame>
        <div className="p-8">
          <PermissionDeniedState body={t("thesis.loadFailed")} />
        </div>
      </Frame>
    );
  }
  if (!canCreate) {
    return (
      <Frame>
        <div className="p-8">
          <PermissionDeniedState body={t("thesis.adminOnly")} />
        </div>
      </Frame>
    );
  }

  const stepProps: StepProps = { state, patch };
  const chatDisabled = !fundId;

  return (
    <Frame>
      <header className="flex shrink-0 items-center gap-3.5 border-b border-line px-6 py-4">
        <motion.button
          type="button"
          aria-label={
            area === 0 || phase === "done" ? t("thesis.closePage") : t("thesis.previousStep")
          }
          title={t("thesis.back")}
          onClick={back}
          whileTap={{ scale: 0.92 }}
          transition={PRESS.transition}
          className="grid size-[34px] cursor-pointer place-items-center rounded-full border-0 bg-sunken text-ink-2 transition-colors hover:bg-hover"
        >
          {area === 0 || phase === "done" ? (
            <X className="size-4" aria-hidden />
          ) : (
            <ArrowLeft className="size-4" aria-hidden />
          )}
        </motion.button>
        <h1 className="m-0 text-[15px] font-semibold">{t("thesis.title")}</h1>
        <div className="flex-1" />
        <div className="flex items-center gap-[5px]" aria-hidden>
          {bars.map((bar, index) => (
            <span
              key={index}
              className="h-1.5 rounded-[3px] transition-[width,background] duration-[480ms] ease-standard"
              style={{ width: bar.width, background: bar.color }}
            />
          ))}
        </div>
        <span className="whitespace-nowrap text-meta text-ink-3">
          {phase === "done" ? t("thesis.published") : t(AREAS[area]!.title)}
        </span>
      </header>

      {phase === "setup" && <SetupScreen step={setupStep} />}
      {phase === "done" && <DoneScreen onOpen={() => void navigate({ to: "/fond" })} />}

      {phase === "review" && (
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] min-[1000px]:grid-cols-[240px_minmax(0,1fr)] min-[1000px]:grid-rows-[minmax(0,1fr)]">
          <nav
            aria-label={t("thesis.stepsNav")}
            className="flex flex-row gap-1 overflow-auto border-b border-line px-3.5 py-2.5 [scrollbar-width:none] min-[1000px]:flex-col min-[1000px]:border-b-0 min-[1000px]:border-r min-[1000px]:px-3.5 min-[1000px]:py-[22px]"
          >
            {AREAS.map((entry, index) => {
              const active = index === area;
              const seen = index < area;
              return (
                <button
                  key={entry.step}
                  type="button"
                  aria-current={active ? "step" : undefined}
                  onClick={() => go(index)}
                  className={cn(
                    "flex min-h-[52px] shrink-0 cursor-pointer items-center gap-3 rounded-md border-0 px-3 py-2 text-left font-[inherit] transition-colors duration-200 hover:bg-hover",
                    active ? "bg-canvas" : "bg-transparent",
                  )}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="24"
                    height="24"
                    className="shrink-0 -rotate-90"
                    aria-hidden
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      fill="none"
                      stroke="var(--chart-track)"
                      strokeWidth="3"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      fill="none"
                      stroke={seen ? "var(--positive)" : active ? "var(--ai)" : "var(--ink-4)"}
                      strokeWidth="3"
                      strokeLinecap="round"
                      pathLength={100}
                      strokeDasharray={seen ? "100 100" : active ? "60 100" : "0 100"}
                      style={{ transition: "stroke-dasharray 500ms var(--ease-standard)" }}
                    />
                  </svg>
                  <span className="flex flex-col whitespace-nowrap leading-tight">
                    <span
                      className={cn(
                        "text-[14px] text-ink-1",
                        active ? "font-semibold" : "font-medium",
                      )}
                    >
                      {t(entry.title)}
                    </span>
                    <span className="text-micro text-ink-4">
                      {seen ? t("thesis.stepDone") : active ? t("thesis.stepActive") : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div ref={scroller} className="overflow-auto">
            <div key={area} className="flex max-w-[860px] flex-col gap-[22px] px-10 pb-10 pt-9">
              <Reveal>
                <div className="flex flex-col gap-1.5">
                  <span className="text-list text-ink-4">
                    {t("thesis.stepOf", { n: area + 1, total: AREAS.length })}
                  </span>
                  <h2 className="m-0 text-[30px] font-semibold tracking-[var(--track-title)]">
                    {t(AREAS[area]!.title)}
                  </h2>
                  <span className="text-[15px] text-ink-3">{t(AREAS[area]!.sub)}</span>
                </div>
              </Reveal>

              {area < LAST_STEP && (
                <StepAsk
                  chat={chat}
                  stepIndex={area}
                  disabledReason={chatDisabled ? t("thesis.helpNeedsFund") : null}
                />
              )}

              <Reveal delay={0.06}>
                <div>
                  {area === 0 && <WhoStep {...stepProps} />}
                  {area === 1 && (
                    <FramesStep {...stepProps} maxSet={maxSet} setMaxSet={setMaxSet} />
                  )}
                  {area === 2 && <ThesisStep {...stepProps} />}
                  {area === 3 && <WeightsStep {...stepProps} />}
                  {area === 4 && <MandateStep {...stepProps} />}
                  {area === 5 && (
                    <SpecialistsStep
                      {...stepProps}
                      chat={chat}
                      chatDisabled={chatDisabled}
                      draft={draft}
                      creatingDraft={creatingDraft}
                      onCreateDraft={() => void createDraftForSpecialist()}
                    />
                  )}
                  {area === 6 && <ReviewStep state={state} goTo={go} />}
                </div>
              </Reveal>

              {error && (
                <motion.p
                  role="alert"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: reduced ? REDUCED_FADE : { duration: 0.24, ease: EASE.out },
                  }}
                  className="m-0 rounded-lg bg-critical-wash px-4 py-3 text-list text-critical"
                >
                  {error}
                </motion.p>
              )}

              <div className="flex items-center gap-2.5 pt-1.5">
                <motion.button
                  type="button"
                  onClick={back}
                  whileTap={PRESS.whileTap}
                  transition={PRESS.transition}
                  className="inline-flex h-11 cursor-pointer items-center gap-2 whitespace-nowrap rounded-pill border-0 bg-surface px-4 text-[14px] font-medium text-ink-1 shadow-pill"
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  {t("thesis.back")}
                </motion.button>
                <div className="flex-1" />
                <motion.button
                  type="button"
                  onClick={next}
                  whileTap={PRESS.whileTap}
                  transition={PRESS.transition}
                  className="inline-flex h-11 cursor-pointer items-center gap-2 whitespace-nowrap rounded-pill border-0 bg-inverse px-5 text-[14px] font-medium text-ink-inverse"
                >
                  {area === LAST_STEP ? t("thesis.publish") : t("thesis.next")}
                  <ArrowRight className="size-4" aria-hidden />
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen min-h-[760px] bg-canvas p-2.5 text-ink-1 max-[1000px]:min-h-0">
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface shadow-card">
        {children}
      </main>
    </div>
  );
}

/** Venteskærmen: orb i 64 px (koral, searching → solving → composing) og de fem trin. */
function SetupScreen({ step }: { step: number }) {
  const t = useT();
  const orb: OrbState = step < 2 ? "searching" : step < 4 ? "solving" : "composing";
  return (
    <div className="grid flex-1 place-items-center p-10">
      <div
        role="status"
        className="flex max-w-[480px] flex-col items-center gap-[26px] text-center"
      >
        <AiOrb size={64} tone="ai" state={orb} label={t("thesis.setup.title")} />
        <div className="flex flex-col gap-2">
          <span className="text-[26px] font-semibold leading-[1.2] tracking-[var(--track-title)]">
            {t("thesis.setup.title")}
          </span>
          <span className="text-[15px] leading-[1.55] text-ink-3">{t("thesis.setup.body")}</span>
        </div>
        <ol className="m-0 flex w-full max-w-[360px] list-none flex-col gap-2.5 p-0 text-left">
          {SETUP_STEPS.map((labelKey, index) => {
            const done = step > index;
            return (
              <li
                key={labelKey}
                className="flex items-center gap-3 text-[14px] transition-colors duration-300"
                style={{ color: done ? "var(--ink-1)" : "var(--ink-4)" }}
              >
                <span
                  className="grid size-5 place-items-center rounded-full text-white transition-colors duration-300"
                  style={{
                    background: done ? "var(--positive)" : "transparent",
                    boxShadow: done ? "none" : "inset 0 0 0 1.5px var(--line-strong)",
                  }}
                >
                  <Check
                    className="size-[11px] transition-opacity duration-300"
                    style={{ opacity: done ? 1 : 0 }}
                    aria-hidden
                  />
                </span>
                {t(labelKey)}
              </li>
            );
          })}
        </ol>
        <span className="sr-only">
          <PendingLabel tone="ai">{t("thesis.setup.pending")}</PendingLabel>
        </span>
      </div>
    </div>
  );
}

function DoneScreen({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return (
    <div className="grid flex-1 place-items-center p-10">
      <Reveal>
        <div role="status" className="flex max-w-[460px] flex-col items-center gap-4 text-center">
          <motion.span
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            className="grid size-16 place-items-center rounded-full bg-positive text-white"
          >
            <Check className="size-7" aria-hidden />
          </motion.span>
          <span className="text-[28px] font-semibold tracking-[var(--track-title)]">
            {t("thesis.done.title")}
          </span>
          <span className="text-[15px] leading-[1.55] text-ink-2">{t("thesis.done.body")}</span>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex h-11 cursor-pointer items-center whitespace-nowrap rounded-pill border-0 bg-inverse px-5 text-[14px] font-medium text-ink-inverse"
          >
            {t("thesis.done.open")}
          </button>
        </div>
      </Reveal>
    </div>
  );
}
