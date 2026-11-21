/**
 * The step "Screening" in Fondsopsætning → Redigér opsætning: how the fund screens.
 * Three parts: the free "sådan screener vi" instruction (saved with "Gem screeningen", apart from
 * the rest of the draft, as the specialist texts; the extra screening cards are no longer chosen
 * here, the draft keeps what it has), "Tilpas med
 * Interlect" (describe → Interlect writes a proposal with before/after → "Læg i kladden"; no trial
 * run on the screen) and the quality check, which runs by itself after a change and is only
 * shown when it finds something. Criteria and weights, gates and the research questions have their
 * own steps and the same "Ret med AI"; the proposal here may touch them too and says so in its
 * before/after. Nothing reaches an analysis before the draft is published.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp } from "lucide-react";
import { AiBeam } from "@/components/ai/AiBeam";
import { Velaris } from "@/components/ds/Velaris";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { Button } from "@/components/ds/Button";
import { ComposerStatus } from "@/components/ds/AiComposer";
import { fieldClass } from "@/components/ds/Field";
import { showToast } from "@/components/ds/Toast";
import {
  proposeConfigChange,
  type ConfigProposalView,
} from "@/lib/funds/config-proposals.functions";
import {
  checkScreeningSetup,
  type ScreeningCheckResult,
} from "@/lib/funds/screening-assist.functions";
import type { ScreeningCheckArea } from "@/lib/funds/screening-check";
import { saveFundScreeningSetup } from "@/lib/funds/screening-setup.functions";
import {
  SCREENING_CARD_IDS,
  SCREENING_INSTRUCTION_MAX,
  type ScreeningCardId,
} from "@/lib/funds/screening-setup";
import { useLocaleTag, useT, useLanguage } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";
import { textareaClass } from "./fields";
import { proposalsKey, ProposalCard, useProposalDecision } from "./proposals";
import type { Language } from "@/lib/i18n/language";
import { userMessage } from "@/lib/errors/user-message";

const errorText = (cause: unknown, fallback: string, language: Language) =>
  userMessage(cause, fallback, language);

/** The check runs by itself once the user has paused; each check is a paid call. */
const CHECK_PAUSE_MS = 4000;

const AREA_LABELS: Record<ScreeningCheckArea, MessageKey> = {
  criteria: "specialists.screening.area.criteria",
  gates: "specialists.screening.area.gates",
  risk: "specialists.screening.area.risk",
  instruction: "specialists.screening.area.instruction",
  cards: "specialists.screening.area.cards",
  research: "specialists.screening.area.research",
};

const signature = (instruction: string, cards: readonly ScreeningCardId[]) =>
  JSON.stringify([instruction.trim(), [...cards].sort()]);

export function ScreeningStep({
  fundId,
  configId,
  saved,
  canAi,
  ensureSaved,
  onReload,
  onUnsavedChange,
  only,
}: {
  /** Only the "Spørg Interlect" box (the other cards' sheets). */
  only?: "tailor" | undefined;
  fundId: string;
  configId: string;
  /** The draft's screening setup as it is saved. */
  saved: { screeningInstruction: string; screeningCards: ScreeningCardId[] };
  /** Admin and Lead: "Tilpas med Interlect" and the check are shown. */
  canAi: boolean;
  /** Saves the rest of the draft first, so Interlect reads what the user sees. */
  ensureSaved: () => Promise<boolean>;
  /** The draft changed on the server (a proposal was laid in): load it into the editor. */
  onReload: () => void | Promise<void>;
  onUnsavedChange: (part: string, unsaved: boolean) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const queryClient = useQueryClient();
  const save = useServerFn(saveFundScreeningSetup);
  const propose = useServerFn(proposeConfigChange);
  const check = useServerFn(checkScreeningSetup);

  const savedSig = signature(saved.screeningInstruction, saved.screeningCards);
  const [instruction, setInstruction] = useState(saved.screeningInstruction);
  const cards = saved.screeningCards;
  const dirty = signature(instruction, cards) !== savedSig;
  const lastSaved = useRef(savedSig);
  // The draft was reloaded (a proposal was laid in, or another save): show what is saved now,
  // unless the user has typed something that is not saved yet.
  useEffect(() => {
    if (savedSig === lastSaved.current) return;
    lastSaved.current = savedSig;
    setInstruction(saved.screeningInstruction);
  }, [savedSig, saved.screeningInstruction]);

  const report = useRef(onUnsavedChange);
  report.current = onUnsavedChange;
  useEffect(() => report.current("screening", dirty), [dirty]);
  useEffect(() => () => report.current("screening", false), []);

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          fundId,
          configId,
          instruction: instruction.trim(),
          cards: SCREENING_CARD_IDS.filter((id) => cards.includes(id)),
        },
      }),
    onSuccess: async () => {
      showToast({ message: t("specialists.screening.saved") });
      await onReload();
    },
    onError: (cause) =>
      showToast({
        message: errorText(cause, t("specialists.screening.saveFailed"), language),
        tone: "error",
        duration: 6000,
      }),
  });

  // "Tilpas med Interlect"
  const [ask, setAsk] = useState("");
  const [proposal, setProposal] = useState<ConfigProposalView | null>(null);
  const proposeMutation = useMutation({
    mutationFn: async (text: string) => {
      // Interlect writes against the saved draft, so what is typed here is saved first.
      if (dirty) await saveMutation.mutateAsync();
      if (!(await ensureSaved())) throw new Error(t("specialists.screening.draftNotSavedRetry"));
      return propose({ data: { configId, kind: "screening", instruction: text } });
    },
    onSuccess: async (view) => {
      setProposal(view);
      setAsk("");
      await queryClient.invalidateQueries({ queryKey: proposalsKey(configId) });
    },
    onError: (cause) =>
      showToast({
        message: errorText(cause, t("specialists.screening.proposalFailed"), language),
        tone: "error",
        duration: 6000,
      }),
  });
  const decision = useProposalDecision(
    configId,
    async () => {
      setProposal(null);
      await onReload();
    },
    async () => {
      if (dirty) {
        try {
          await saveMutation.mutateAsync();
        } catch {
          return false;
        }
      }
      return ensureSaved();
    },
  );

  // The quality check: runs by itself after a change has been saved and the user pauses,
  // once per saved setup; shown only when it finds something. "Tjek screeningen" runs it on
  // demand. The first look at an unchanged setup costs nothing.
  const [checked, setChecked] = useState<{ sig: string; result: ScreeningCheckResult } | null>(
    null,
  );
  const [checkFailed, setCheckFailed] = useState<{ sig: string; message: string } | null>(null);
  const checkMutation = useMutation({
    mutationFn: async (sig: string) => {
      if (!(await ensureSaved())) throw new Error(t("specialists.screening.draftNotSaved"));
      return { sig, result: await check({ data: { fundId, configId } }) };
    },
    onSuccess: (done) => {
      setChecked(done);
      setCheckFailed(null);
    },
    onError: (cause, sig) =>
      setCheckFailed({
        sig,
        message: errorText(cause, t("specialists.screening.checkFailedFallback"), language),
      }),
  });
  const baseline = useRef(savedSig);
  const runCheck = useRef(checkMutation.mutate);
  runCheck.current = checkMutation.mutate;
  const busy = saveMutation.isPending || proposeMutation.isPending || decision.busy;
  const checkDue =
    canAi &&
    !dirty &&
    !busy &&
    !checkMutation.isPending &&
    savedSig !== baseline.current &&
    savedSig !== checked?.sig &&
    savedSig !== checkFailed?.sig;
  useEffect(() => {
    if (!checkDue) return;
    const timer = setTimeout(() => runCheck.current(savedSig), CHECK_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [checkDue, savedSig]);

  const result = checked?.result ?? null;
  const stale = checked !== null && checked.sig !== savedSig;
  const toFix = result?.issues.filter((issue) => issue.severity === "fix").length ?? 0;
  const aiWorking = proposeMutation.isPending || checkMutation.isPending;
  const canSend = ask.trim().length >= 3 && !busy;
  const send = () => {
    if (canSend) proposeMutation.mutate(ask.trim());
  };
  const remaining = SCREENING_INSTRUCTION_MAX - instruction.length;
  const over = remaining < 0;

  return (
    <div className="flex flex-col gap-8">
      {canAi && (
        <AiBeam active={aiWorking} className="rounded-lg">
          <section
            aria-label={t("specialists.screening.tailorTitle")}
            // Where Interlect helps, the flowing AI ground (Velaris) instead of a grey box.
            className="relative isolate flex flex-col gap-3 overflow-hidden rounded-lg p-[18px]"
          >
            <Velaris className="absolute inset-0 -z-10" />
            <div>
              <h3 className="m-0 flex items-center gap-2 text-section font-semibold">
                <InterlectMark size={14} />
                {t("specialists.screening.tailorTitle")}
              </h3>
              <p className="mt-1 mb-0 text-list text-ink-2">
                {t("specialists.screening.tailorHelp")}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-pill bg-surface py-1 pr-1 pl-3.5">
              <input
                value={ask}
                onChange={(event) => setAsk(event.target.value.slice(0, 2000))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    send();
                  }
                }}
                disabled={proposeMutation.isPending}
                aria-label={t("specialists.screening.askLabel")}
                placeholder={t("specialists.screening.askLabel")}
                className={cn(
                  fieldClass,
                  "h-8 flex-1 bg-transparent px-0 text-[14px] shadow-none focus:bg-transparent focus:shadow-none",
                )}
              />
              <button
                type="button"
                onClick={send}
                disabled={!canSend}
                aria-label={t("specialists.screening.send")}
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-inverse text-ink-inverse transition-[opacity,transform] active:scale-90 disabled:cursor-default disabled:opacity-35"
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
            </div>
            {proposeMutation.isPending && (
              <ComposerStatus>{t("specialists.screening.writing")}</ComposerStatus>
            )}
            {proposal && (
              <ProposalCard
                proposal={proposal}
                canDecide
                busy={decision.busy}
                applying={decision.applying === proposal.id}
                onApply={() => decision.apply(proposal.id)}
                onReject={() => {
                  decision.reject(proposal.id);
                  setProposal(null);
                }}
                note={t("specialists.screening.proposalNote")}
              />
            )}
          </section>
        </AiBeam>
      )}

      {only !== "tailor" && (
        <section className="flex flex-col gap-3.5">
          <div>
            <h3 className="m-0 text-section font-semibold">
              {t("specialists.screening.instructionTitle")}
            </h3>
            <p className="mt-1 mb-0 text-list text-ink-3">
              {t("specialists.screening.instructionHelp")}
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="sr-only">{t("specialists.screening.instructionTitle")}</span>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={6}
              placeholder={t("specialists.screening.instructionPlaceholder")}
              aria-invalid={over || undefined}
              className={textareaClass}
            />
            <span
              className={cn(
                "self-end text-meta tabular-nums",
                over ? "text-critical" : "text-ink-4",
              )}
            >
              {over
                ? t("specialists.screening.charsOver", {
                    count: (-remaining).toLocaleString(localeTag),
                  })
                : t("specialists.screening.charsOf", {
                    count: instruction.length.toLocaleString(localeTag),
                    max: SCREENING_INSTRUCTION_MAX.toLocaleString(localeTag),
                  })}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            {(dirty || saveMutation.isPending) && (
              <Button
                variant="primary"
                size="md"
                onClick={() => saveMutation.mutate()}
                disabled={!dirty || over || busy}
                pending={saveMutation.isPending ? "ai" : false}
                pendingLabel={t("specialists.screening.saving")}
              >
                {t("specialists.screening.save")}
              </Button>
            )}
            {dirty && !saveMutation.isPending && (
              <span role="status" className="text-meta text-ink-3">
                {t("specialists.screening.unsaved")}
              </span>
            )}
          </div>
          {/* Every button says what it does. */}
          <p className="m-0 text-meta leading-[1.5] text-ink-3">
            {t("specialists.screening.saveHelp")}
          </p>
        </section>
      )}

      {canAi && only !== "tailor" && (
        <section
          aria-label={t("specialists.screening.checkTitle")}
          className="flex flex-col gap-2.5"
        >
          {checkFailed && !result && (
            <p className="m-0 text-meta text-ink-3">
              {t("specialists.screening.checkFailed", { message: checkFailed.message })}
            </p>
          )}
          {result && result.issues.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md bg-canvas p-4">
              <p className="m-0 flex items-center gap-2 text-list font-medium text-ink-1">
                <InterlectMark size={12} />
                {toFix === 0
                  ? t("specialists.screening.lookedAt")
                  : toFix === 1
                    ? t("specialists.screening.fixOne")
                    : t("specialists.screening.fixMany", { count: toFix })}
              </p>
              <p className="m-0 text-meta text-ink-3">
                {!result.aiChecked && t("specialists.screening.aiNoAnswer")}
                {stale && t("specialists.screening.stale")}
              </p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {result.issues.map((issue, index) => (
                  <li
                    key={`${issue.area}-${issue.target ?? "x"}-${index}`}
                    className="flex flex-col gap-1 rounded-md bg-surface px-3.5 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
                  >
                    <span className="flex items-center gap-2 text-meta text-ink-3">
                      <span
                        aria-hidden
                        className="size-[7px] shrink-0 rounded-full"
                        style={{
                          background:
                            issue.severity === "fix" ? "var(--warning)" : "var(--line-strong)",
                        }}
                      />
                      {t(AREA_LABELS[issue.area])}
                      {issue.target ? ` · ${issue.target}` : ""}
                    </span>
                    <span className="text-list text-ink-1">{issue.message}</span>
                    {issue.suggestion && (
                      <span className="text-list text-ink-2">
                        <span className="font-medium">
                          {issue.source === "ai"
                            ? t("specialists.screening.suggestion")
                            : t("specialists.screening.advice")}
                        </span>{" "}
                        {issue.suggestion}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => checkMutation.mutate(savedSig)}
              disabled={dirty || busy || checkMutation.isPending}
              pending={checkMutation.isPending ? "ai" : false}
              pendingLabel={t("specialists.screening.checking")}
            >
              {t("specialists.screening.checkNow")}
            </Button>
            <span className="text-meta leading-[1.5] text-ink-3">
              {t("specialists.screening.checkHelp")}
            </span>
            {result && result.issues.length === 0 && !stale && (
              <span role="status" className="text-meta text-ink-3">
                {t("specialists.screening.nothingFound")}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
