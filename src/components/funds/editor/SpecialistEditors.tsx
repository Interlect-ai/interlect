import { PendingLabel } from "@/components/ai/AiOrb";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n/language";
import { translate } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { userMessage } from "@/lib/errors/user-message";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  proposeResearchStrategy,
  resetResearchModuleOverride,
  saveResearchModuleOverrides,
  type ResearchModuleProposal,
} from "@/lib/funds/research-module-override.functions";

/** Tells the editor while a specialist text is open and not saved (it asks before closing). */
function useReportUnsaved(
  unsaved: boolean,
  onUnsavedChange: ((unsaved: boolean) => void) | undefined,
) {
  const report = useRef(onUnsavedChange);
  report.current = onUnsavedChange;
  useEffect(() => {
    report.current?.(unsaved);
  }, [unsaved]);
  useEffect(() => () => report.current?.(false), []);
}

/** Danske visningsnavne for de 13 faste research-modul-id'er -- rent
 * kosmetisk, påvirker ikke selve id'et der sendes til serveren. */
export const RESEARCH_MODULE_IDS = [
  "identity_registry",
  "filings_financials",
  "founders_team",
  "funding_ownership",
  "product_technology",
  "traction_customers_gtm",
  "market_competition",
  "legal_regulatory_reputation",
  "screening_identity_filings",
  "screening_founders_funding",
  "screening_product_technology",
  "screening_traction_commercial",
  "screening_market_mandate",
] as const;
export type ResearchModuleId = (typeof RESEARCH_MODULE_IDS)[number];

/** The module's name and hint in the fund's language; undefined for an id the list does not know. */
export function researchModuleLabelIn(
  moduleId: string,
  language: Language = DEFAULT_LANGUAGE,
): { title: string; hint: string } | undefined {
  if (!(RESEARCH_MODULE_IDS as readonly string[]).includes(moduleId)) return undefined;
  const id = moduleId as ResearchModuleId;
  return {
    title: translate(language, `specialists.research.module.${id}.title`),
    hint: translate(language, `specialists.research.module.${id}.hint`),
  };
}

/** The Danish names (the source), for callers that do not know the fund's language. */
export const RESEARCH_MODULE_LABELS: Record<string, { title: string; hint: string }> =
  Object.fromEntries(RESEARCH_MODULE_IDS.map((id) => [id, researchModuleLabelIn(id, "da")!]));

/** Ét samlet knap-tryk der på én gang foreslår skræddersyede
 * research-spørgsmål til alle 13 offentlige research-moduler, ud fra
 * fondens tese/mandat -- i stedet for de generiske standardspørgsmål alle
 * fonde ellers deler. Se Arbejdsspor A i planen: dette er den reelle løsning
 * ("Vej 2"), ikke kun kosmetisk skabelontekst. Konsolideret i ét
 * review-skærmbillede, så fondsopsætning ikke bliver 13 separate klik. */
export function ResearchStrategyEditor({
  fundId,
  configId,
  profile,
  overrides,
  onUnsavedChange,
}: {
  fundId: string;
  configId: string;
  onUnsavedChange?: ((unsaved: boolean) => void) | undefined;
  profile: {
    thesis: string;
    stages: string[];
    geographies: string[];
    sectors: string[];
    ticketMinEur: number | null;
    ticketMaxEur: number | null;
    ticketNote: string;
    riskPosture: string;
    dealbreakers: string[];
    gates: Array<{ label: string; description: string; treatment: string }>;
    criteria: Array<{ label: string; description: string; weight: number }>;
  };
  overrides: Record<string, { questions: string[] }>;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const propose = useServerFn(proposeResearchStrategy);
  const save = useServerFn(saveResearchModuleOverrides);
  const reset = useServerFn(resetResearchModuleOverride);

  const [instructions, setInstructions] = useState("");
  const [proposals, setProposals] = useState<ResearchModuleProposal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // A generated strategy (a paid call) is only kept once it is saved.
  useReportUnsaved(proposals !== null, onUnsavedChange);

  const overrideCount = Object.keys(overrides).length;

  async function generate() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const proposal = await propose({
        data: {
          fundId,
          configId,
          profile,
          instructions: instructions.trim() ? instructions.trim() : undefined,
        },
      });
      setProposals(proposal.modules);
      setStatus(t("specialists.editors.proposalReady"));
    } catch (cause) {
      setError(userMessage(cause, t("specialists.editors.generateFailed"), language));
    } finally {
      setBusy(false);
    }
  }

  async function persist() {
    if (!proposals) return;
    setBusy(true);
    setError(null);
    try {
      await save({
        data: {
          fundId,
          configId,
          modules: proposals.map((module) => ({
            ...module,
            questions: cleanLines(module.questions),
          })),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["fund-config", fundId] });
      setStatus(t("specialists.editors.savedStatus"));
      setProposals(null);
      setInstructions("");
    } catch (cause) {
      setError(userMessage(cause, t("specialists.editors.saveFailed"), language));
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    setBusy(true);
    setError(null);
    try {
      for (const key of Object.keys(overrides)) {
        const [mode, moduleId] = key.split(":");
        await reset({
          data: {
            fundId,
            configId,
            mode: mode as "screening" | "deep",
            moduleId: moduleId as ResearchModuleProposal["moduleId"],
          },
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["fund-config", fundId] });
      setStatus(t("specialists.editors.resetDone"));
    } catch (cause) {
      setError(userMessage(cause, t("specialists.editors.resetFailed"), language));
    } finally {
      setBusy(false);
    }
  }

  const grouped = proposals
    ? {
        screening: proposals.filter((module) => module.mode === "screening"),
        deep: proposals.filter((module) => module.mode === "deep"),
      }
    : null;

  return (
    <div className="rounded-md border border-border-subtle border-l-2 border-l-action/50 p-3.5">
      <div>
        <span className="text-list font-medium text-ink">{t("specialists.editors.title")}</span>
        <p className="mt-0.5 text-meta text-ink-3">
          {overrideCount > 0
            ? t("specialists.editors.customCount", { count: overrideCount })
            : t("specialists.editors.allStandard")}
        </p>
      </div>

      {!proposals && (
        <div className="mt-3 space-y-3 border-t border-border-subtle pt-3">
          <label className="block text-list text-ink-3">
            {t("specialists.editors.contextLabel")}
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={2}
              className="field-control mt-1 w-full"
              placeholder={t("specialists.editors.contextPlaceholder")}
            />
          </label>
          <p className="text-meta text-ink-3">{t("specialists.editors.generateHelp")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="control-button"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? (
                <PendingLabel tone="ai">{t("specialists.editors.generating")}</PendingLabel>
              ) : (
                t("specialists.editors.generate")
              )}
            </button>
            {overrideCount > 0 && (
              <>
                <button
                  type="button"
                  className="control-button"
                  disabled={busy}
                  onClick={() => {
                    setProposals(
                      Object.entries(overrides).map(([key, value]) => {
                        const [mode, moduleId] = key.split(":");
                        return {
                          mode: mode as ResearchModuleProposal["mode"],
                          moduleId: moduleId as ResearchModuleProposal["moduleId"],
                          questions: [...value.questions],
                        };
                      }),
                    );
                    setError(null);
                    setStatus(t("specialists.editors.editSaved"));
                  }}
                >
                  {t("specialists.editors.viewSaved")}
                </button>
                <button
                  type="button"
                  className="control-button"
                  disabled={busy}
                  onClick={() => void resetAll()}
                >
                  {t("specialists.editors.resetAll")}
                </button>
              </>
            )}
          </div>
          {error && <p className="text-list text-critical">{error}</p>}
          {status && <p className="text-list text-positive">{status}</p>}
        </div>
      )}

      {grouped && (
        <div className="mt-3 space-y-4 border-t border-border-subtle pt-3">
          <ResearchModuleGroup
            title={t("specialists.editors.groupScreening", { count: grouped.screening.length })}
            modules={grouped.screening}
            overrides={overrides}
            onChange={(next) =>
              setProposals((current) =>
                current
                  ? current.map((module) =>
                      module.mode === next.mode && module.moduleId === next.moduleId
                        ? next
                        : module,
                    )
                  : current,
              )
            }
          />
          <ResearchModuleGroup
            title={t("specialists.editors.groupDeep", { count: grouped.deep.length })}
            modules={grouped.deep}
            overrides={overrides}
            onChange={(next) =>
              setProposals((current) =>
                current
                  ? current.map((module) =>
                      module.mode === next.mode && module.moduleId === next.moduleId
                        ? next
                        : module,
                    )
                  : current,
              )
            }
          />

          {error && <p className="text-list text-critical">{error}</p>}
          {status && <p className="text-list text-positive">{status}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="control-button"
              disabled={busy}
              onClick={() => {
                setProposals(null);
                setError(null);
                setStatus(null);
              }}
            >
              {t("specialists.editors.cancel")}
            </button>
            <button
              type="button"
              className="control-button"
              disabled={
                busy ||
                proposals!.some(
                  (module) => researchQuestionIssue(module.questions, language) !== null,
                )
              }
              onClick={() => void persist()}
            >
              {busy ? (
                <PendingLabel>{t("specialists.editors.saving")}</PendingLabel>
              ) : proposals!.length === 13 ? (
                t("specialists.editors.saveAll")
              ) : (
                t("specialists.editors.saveSome", { count: proposals!.length })
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ResearchModuleGroup({
  title,
  modules,
  overrides,
  onChange,
}: {
  title: string;
  modules: ResearchModuleProposal[];
  overrides: Record<string, { questions: string[] }>;
  onChange: (next: ResearchModuleProposal) => void;
}) {
  const t = useT();
  const language = useLanguage();
  if (!modules.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-list font-semibold text-ink">{title}</h3>
      <div className="space-y-2">
        {modules.map((module) => {
          const meta = researchModuleLabelIn(module.moduleId, language);
          const hadOverride = Boolean(overrides[`${module.mode}:${module.moduleId}`]);
          return (
            <div
              key={`${module.mode}:${module.moduleId}`}
              className="rounded-md border border-border-subtle p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-list font-medium text-ink">
                    {meta?.title ?? module.moduleId}
                  </span>
                  {meta?.hint && <span className="ml-2 text-meta text-ink-3">{meta.hint}</span>}
                </div>
                <span className="rounded-sm border border-border-subtle px-1.5 py-0.5 text-meta text-ink-3">
                  {hadOverride
                    ? t("specialists.editors.replacesCustom")
                    : t("specialists.editors.replacesStandard")}
                </span>
              </div>
              <ModuleTextListField
                label={t("specialists.editors.questions")}
                value={module.questions}
                onChange={(next) => onChange({ ...module, questions: next })}
              />
              {researchQuestionIssue(module.questions, language) && (
                <p className="mt-1 text-meta text-critical">
                  {researchQuestionIssue(module.questions, language)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function cleanLines(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

/** Spejler serverens skema for research-spørgsmål (1–6 pr. modul, maks. 300 tegn). */
export function researchQuestionIssue(
  lines: string[],
  language: Language = DEFAULT_LANGUAGE,
): string | null {
  const questions = cleanLines(lines);
  if (questions.length === 0) return translate(language, "specialists.editors.issueMin");
  if (questions.length > 6) return translate(language, "specialists.editors.issueMax");
  if (questions.some((question) => question.length > 300)) {
    return translate(language, "specialists.editors.issueLength");
  }
  return null;
}

export function ModuleTextListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useT();
  return (
    <label className="block text-list text-ink-3">
      {label} <span className="text-ink-3/70">{t("specialists.editors.lineHint")}</span>
      <textarea
        value={value.join("\n")}
        onChange={(event) => onChange(event.target.value.split("\n"))}
        rows={4}
        className="field-control mt-1 w-full"
      />
    </label>
  );
}
