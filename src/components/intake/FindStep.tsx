/**
 * Opret case, step 2 "Find selskabet" (prototype "Opret case.dc.html", `sFind`): the heading
 * says what Interlect is doing or found; while it searches three skeleton cards (84 px, opacity
 * 1 / .7 / .45) stand in; then 1-3 match cards ("Bedste match" is preselected), "Vis N flere",
 * "Ingen af dem, opret manuelt", a re-search field and Tilbage / Fortsæt.
 *
 * Presentational: the search itself (server function, stale-response guard) is in IntakeFlow.
 * Never shows a candidate without a checked source: that is guaranteed by the server side
 * (`identity-resolve.ts`), this component only renders what it is given.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, ChevronDown, Globe, Search } from "lucide-react";
import { EASE } from "@/lib/motion";
import type { CompanyCandidate } from "@/lib/analysis/identity-resolve";
import { cn } from "@/lib/utils";
import { useLocaleTag, useT } from "@/lib/i18n/useT";
import {
  FOREIGN_REGISTRY_COUNTRIES,
  registryNumberLabel,
  type RegistryCountry,
} from "@/lib/analysis/registries/types";
import { CreditStop } from "@/components/ai/CreditStop";
import type { FindNote } from "@/lib/cases/find-candidates.core";
import { MatchCard } from "./MatchCard";

const VISIBLE = 3;

export type FindState =
  | { phase: "searching" }
  | { phase: "error"; message: string }
  | {
      phase: "done";
      candidates: CompanyCandidate[];
      notes: FindNote[];
      /** The website redirects here (another domain); offered as "Brug …". */
      websiteRedirect?: string | null;
    };

export function FindStep({
  fundId,
  query,
  state,
  selectedId,
  onSelect,
  onBack,
  onContinue,
  onNoneMatch,
  onSearchAgain,
  onUseWebsite,
  country,
  onCountry,
  headingRef,
}: {
  /** The team the search is for (its credits decide the paid web search). */
  fundId: string;
  /** The query being searched (shown in the heading while searching). */
  query: string;
  state: FindState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
  onContinue: () => void;
  onNoneMatch: () => void;
  onSearchAgain: (query: string) => void;
  /** Search again with the address the website redirects to. */
  onUseWebsite: (website: string) => void;
  /** The register searched; another country searches that country's register. */
  country: RegistryCountry;
  onCountry: (country: RegistryCountry) => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  const reduced = useReducedMotion();
  const regionNames = useMemo(
    () => new Intl.DisplayNames([localeTag], { type: "region" }),
    [localeTag],
  );
  const [expanded, setExpanded] = useState(false);
  const [again, setAgain] = useState("");
  const searching = state.phase === "searching";
  const candidates = state.phase === "done" ? state.candidates : [];
  const hidden = Math.max(0, candidates.length - VISIBLE);
  const shown = expanded ? candidates : candidates.slice(0, VISIBLE);
  // The selection is a candidate that must still be in the list (a new search clears it).
  const hasSelection = candidates.some((candidate) => candidate.id === selectedId);

  // A fresh result set folds the list back to three.
  const lastSet = useRef<CompanyCandidate[] | null>(null);
  useEffect(() => {
    if (state.phase === "done" && lastSet.current !== state.candidates) {
      lastSet.current = state.candidates;
      setExpanded(false);
    }
  }, [state]);

  const bestId =
    candidates.find((c) => !c.inactive && c.assessment.status !== "uncertain")?.id ?? null;
  const title = searching
    ? t("intake.find.searchingTitle", { query })
    : state.phase === "error"
      ? t("intake.find.errorTitle")
      : candidates.length === 0
        ? t("intake.find.noneTitle")
        : candidates.length === 1
          ? t("intake.find.oneTitle")
          : t("intake.find.manyTitle");
  const sub = searching
    ? t("intake.find.searchingSub")
    : state.phase === "error"
      ? state.message
      : candidates.length === 0
        ? t("intake.find.noneSub")
        : candidates.length === 1
          ? t("intake.find.oneSub")
          : hasSelection
            ? t("intake.find.manySelectedSub")
            : t("intake.find.manyUnselectedSub");

  // Roving tabindex: the chosen card (else the first) is the one tab stop; arrows move and choose.
  const rovingId = hasSelection ? selectedId : (shown[0]?.id ?? null);
  const onGroupKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !backward) return;
    event.preventDefault();
    const index = Math.max(
      0,
      shown.findIndex((c) => c.id === rovingId),
    );
    const next = shown[(index + (forward ? 1 : -1) + shown.length) % shown.length];
    if (!next) return;
    onSelect(next.id);
    requestAnimationFrame(() =>
      event.currentTarget
        .querySelector<HTMLElement>(`[data-candidate-id="${CSS.escape(next.id)}"]`)
        ?.focus(),
    );
  };

  const submitAgain = () => {
    const next = again.trim();
    if (!next) return;
    onSearchAgain(next);
    setAgain("");
  };
  const onAgainKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitAgain();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-auto">
      <motion.div
        className="flex w-full max-w-[824px] flex-col gap-5 px-4 pt-11 pb-[60px] md:px-8"
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={reduced ? { duration: 0.12 } : { duration: 0.42, ease: EASE.out }}
      >
        <div className="flex flex-col gap-1.5">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="m-0 text-[30px] font-semibold tracking-title text-ink-1 outline-none"
          >
            {title}
          </h2>
          <span className="text-[15px] text-ink-3" aria-live="polite">
            {sub}
          </span>
        </div>

        {searching && (
          <div
            className="flex flex-col gap-2.5"
            role="status"
            aria-label={t("intake.find.searchingLabel")}
          >
            {[1, 0.7, 0.45].map((opacity) => (
              <motion.div
                key={opacity}
                className="h-[84px] rounded-lg bg-canvas"
                initial={{ opacity: 0 }}
                animate={{ opacity }}
                transition={{ duration: 0.6 }}
              />
            ))}
          </div>
        )}

        {state.phase === "done" && (
          <div className="flex flex-col gap-2.5">
            {candidates.length > 0 && (
              <div
                role="radiogroup"
                aria-label={t("intake.find.groupLabel")}
                className="flex flex-col gap-2.5"
                onKeyDown={onGroupKey}
              >
                {shown.map((candidate, index) => (
                  <MatchCard
                    key={candidate.id}
                    candidate={candidate}
                    index={index}
                    selected={candidate.id === selectedId}
                    best={candidate.id === bestId}
                    tabIndex={candidate.id === rovingId ? 0 : -1}
                    onSelect={() => onSelect(candidate.id)}
                  />
                ))}
              </div>
            )}
            {state.notes.map((note) => {
              const text = t(note.key, note.vars);
              // The paid web search stopped on the balance: the reason and "Fyld op".
              if (note.key === "intake.note.webSkippedCredits") {
                return <CreditStop key={text} fundId={fundId} message={text} />;
              }
              return (
                <p key={text} className="m-0 text-meta text-ink-3">
                  {text}
                </p>
              );
            })}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {state.websiteRedirect && (
                <button
                  type="button"
                  onClick={() => onUseWebsite(state.websiteRedirect!)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-canvas px-3.5 text-list font-medium whitespace-nowrap text-ink-1 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-action"
                >
                  <Globe className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {t("intake.find.useRedirect", {
                    target: new URL(state.websiteRedirect).hostname,
                  })}
                </button>
              )}
              {hidden > 0 && !expanded && (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-canvas px-3.5 text-list font-medium whitespace-nowrap text-ink-1 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-action"
                >
                  {t("intake.find.showMore", { count: hidden })}
                  <ChevronDown className="size-3" aria-hidden />
                </button>
              )}
              <button
                type="button"
                onClick={onNoneMatch}
                className="h-9 rounded-pill px-3.5 text-list font-medium whitespace-nowrap text-ink-3 outline-none transition-colors hover:bg-hover hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
              >
                {t("intake.find.noneMatch")}
              </button>
            </div>
          </div>
        )}

        {(state.phase === "done" || state.phase === "error") && (
          <div className="flex h-12 items-center gap-2.5 rounded-pill bg-canvas pr-1.5 pl-4 transition-[box-shadow,background-color] duration-[var(--dur-quick)] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]">
            <Search className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} aria-hidden />
            <select
              value={country}
              onChange={(event) => onCountry(event.target.value as RegistryCountry)}
              aria-label={t("intake.find.countryLabel")}
              className="h-9 shrink-0 rounded-pill bg-transparent px-1 text-meta font-medium text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              {(["DK", ...FOREIGN_REGISTRY_COUNTRIES] as const).map((code) => (
                <option key={code} value={code}>
                  {regionNames.of(code) ?? code}
                </option>
              ))}
            </select>
            <input
              value={again}
              onChange={(event) => setAgain(event.target.value)}
              onKeyDown={onAgainKey}
              placeholder={
                country === "DK"
                  ? t("intake.find.againPlaceholder")
                  : t("intake.find.againPlaceholderForeign", {
                      label: registryNumberLabel(country),
                    })
              }
              aria-label={
                country === "DK"
                  ? t("intake.find.againPlaceholder")
                  : t("intake.find.againPlaceholderForeign", {
                      label: registryNumberLabel(country),
                    })
              }
              maxLength={200}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-ink-1 outline-none placeholder:text-ink-4"
            />
            <button
              type="button"
              onClick={submitAgain}
              disabled={!again.trim()}
              className="h-9 rounded-pill bg-surface px-3.5 text-meta font-medium whitespace-nowrap text-ink-1 shadow-pill outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-action disabled:opacity-40"
            >
              {t("intake.find.search")}
            </button>
          </div>
        )}

        <div className="flex gap-2 pt-1.5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-11 items-center gap-2 rounded-pill bg-surface px-4 text-[14px] font-medium whitespace-nowrap text-ink-1 shadow-pill outline-none transition-colors hover:bg-canvas focus-visible:ring-2 focus-visible:ring-action"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
            {t("intake.find.back")}
          </button>
          {!hasSelection && state.phase === "done" && candidates.length > 0 && (
            <span className="order-last self-center px-1 text-meta text-ink-3" aria-live="polite">
              {t("intake.find.pickToContinue")}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (hasSelection) onContinue();
            }}
            aria-disabled={!hasSelection}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-pill bg-inverse px-5 text-[14px] font-medium whitespace-nowrap text-ink-inverse outline-none transition-opacity duration-200 focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
              hasSelection ? "active:scale-[.97]" : "cursor-not-allowed opacity-35",
            )}
          >
            {t("intake.find.continue")}
            <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
