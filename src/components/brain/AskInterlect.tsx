/**
 * Spørg Interlect (AskInterlect prototype, "Spørg Interlect"): fixed in the
 * bottom right corner on every page in the app shell. Three modes: the pill (orb, title and an
 * example that changes every 4 s), the open 400 × 580 panel (springs out of the corner) and
 * hidden (a small handle on the right edge; the choice is remembered in this browser).
 *
 * The panel is the Brain conversation (`BrainChatPane panel`) on the same engine, with the
 * page's context: on a case the first question binds the thread to that case, everywhere else
 * Brain looks at all the fund's cases. The thread is saved like any other and is listed in
 * `/brain`. Shown only when Brain chat works for this fund and role (`showBrain`).
 *
 * A page change mounts the panel again (every page has its own AppShell): whether it was open
 * and the last thread per context are kept in sessionStorage and the thread is loaded again
 * So the conversation follows the reader and a source link does not lose it.
 *
 * Once opened, the panel stays mounted while it is minimized or hidden (as in the prototype):
 * a running answer is not cut and the conversation is still there when it is opened again.
 *
 * (21st.dev "AI Input", `MorphPanel`, MIT, idea only): the pill folds out into the panel
 * and back (the panel's clip grows from the pill's own box, 440 ms `--ease-standard`), and a
 * click outside the panel folds it up like Esc. Reduced motion: no morph, only the fade.
 *
 * Replaced from the prototype: the placeholder orb and pulse are `OccasionOrb askInterlect`,
 * still until the pill is hovered or focused (only one orb moves at a time on a screen); the
 * dot on the hidden handle is the Interlect mark. "Gem i Brain" is an action on each answer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Minus, X } from "lucide-react";
import { OrbPause } from "@/components/ai/AiOrb";
import { OccasionOrb } from "@/components/ai/OccasionOrb";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { IconButton } from "@/components/ds/Button";
import { Velaris } from "@/components/ds/Velaris";
import { BrainChatPane, type AnswerActions } from "@/components/brain/BrainChatPane";
import { AnswerFindField } from "@/components/cases/deep/FindWithBrain";
import { fieldsAskedFor } from "@/lib/brain/field-question";
import { notesKey } from "@/components/cases/screening/case-tab-data";
import {
  ASK_OPEN_EVENT,
  askBrainContext,
  askOpenQuestion,
  askHeading,
  askIntro,
  askKey,
  askKnows,
  askPlaceholder,
  askSuggestions,
  readAskHidden,
  readAskSession,
  writeAskHidden,
  writeAskSession,
  type AskContext,
} from "@/lib/brain/ask";
import { showBrain } from "@/lib/brain/capabilities";
import { createHttpChatTransport } from "@/lib/brain/chat-client";
import {
  getBrainThread,
  saveBrainAnswerAsNote,
  saveBrainAnswerToBrain,
  submitBrainFeedback,
} from "@/lib/brain/chat.functions";
import { turnsFromMessages } from "@/lib/brain/chat-model";
import { brainThreadsQueryKey } from "@/lib/brain/threads";
import { useBrainCapabilities } from "@/lib/brain/useBrainCapabilities";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { supabase } from "@/lib/supabase/client";

type Mode = "pill" | "open" | "hidden";
type Bezier = readonly [number, number, number, number];

/** The prototype's spring: the pill pops in. */
const PILL_EASE: Bezier = [0.34, 1.3, 0.64, 1];
const EXAMPLE_MS = 4000;
/** The fold-out between pill and panel (`--ease-standard`, 440 ms). */
const MORPH = { duration: 0.44, ease: EASE.standard };
/** Where the panel sits: fixed 22 px from the bottom right corner, at most 400 × 580. */
const EDGE = 22;
/** The pill's box when it has not been measured (reload with the panel open): 286 × 52, left of
 *  the 28 px hide button and its 6 px gap. */
const PILL_DEFAULT = { width: 286, height: 52, right: EDGE + 28 + 6 };

type Box = { top: number; right: number; bottom: number; left: number };
/** The pill's size and distance from the bottom right corner (it is anchored there, so this
 *  still holds after a resize or an iPad rotation). */
type PillPlace = { width: number; height: number; right: number; bottom: number };

function measurePill(pill: HTMLElement): PillPlace {
  const r = pill.getBoundingClientRect();
  return {
    width: r.width,
    height: r.height,
    right: window.innerWidth - r.right,
    bottom: window.innerHeight - r.bottom,
  };
}

/** The pill's box as an inset of the panel's box, so the panel's clip can start as the pill. */
function pillInset(pill: PillPlace | null): string {
  if (typeof window === "undefined") return PANEL_CLIP;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const panel: Box = {
    right: vw - EDGE,
    bottom: vh - EDGE,
    left: vw - EDGE - Math.min(400, vw - 2 * EDGE),
    top: vh - EDGE - Math.min(580, vh - 2 * EDGE),
  };
  const place = pill ?? { ...PILL_DEFAULT, bottom: EDGE };
  const box: Box = {
    right: vw - place.right,
    left: vw - place.right - place.width,
    bottom: vh - place.bottom,
    top: vh - place.bottom - place.height,
  };
  const px = (n: number) => `${Math.max(0, Math.round(n))}px`;
  return `inset(${px(box.top - panel.top)} ${px(panel.right - box.right)} ${px(panel.bottom - box.bottom)} ${px(box.left - panel.left)} round 26px)`;
}
const PANEL_CLIP = "inset(0px 0px 0px 0px round 24px)";

/** Layers a click on is not a click outside: the panel itself, its portaled source card,
 *  dialogs and menus (and any other open sheet), and toasts (ours and sonner's). */
const INSIDE_LAYERS =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],[data-toast-viewport],[data-sonner-toaster]';

/** A pointer press that should fold the panel: the main button, on page content (not on a
 *  scroll bar) and outside every layer above. */
function pressedOutside(event: PointerEvent): boolean {
  const target = event.target;
  if (event.button !== 0 || !(target instanceof Element)) return false;
  if (target.closest(INSIDE_LAYERS)) return false;
  // A press on a scroll bar lands on the scrolling element, outside its client box.
  if (target instanceof HTMLElement) {
    const box = target.getBoundingClientRect();
    if (
      event.clientX - box.left > target.clientLeft + target.clientWidth ||
      event.clientY - box.top > target.clientTop + target.clientHeight
    ) {
      return false;
    }
  }
  return true;
}

/** localStorage, or nothing when the browser blocks it (reading it can throw). */
function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function AskInterlect({ context }: { context: AskContext }) {
  const caps = useBrainCapabilities();
  const { fundId } = useActiveFund();
  if (!fundId || !showBrain(caps.data)) return null;
  // Another fund is another corner: no conversation follows the reader across funds.
  return <AskCorner key={fundId} fundId={fundId} context={context} />;
}

function AskCorner({ fundId, context }: { fundId: string; context: AskContext }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  // A page change mounts this corner again (every page has its own AppShell): a panel that was
  // open stays open, and AskConversation loads the last thread of this context again.
  const [reopened] = useState(
    () => !readAskHidden(browserStorage()) && readAskSession(browserStorage(), fundId).open,
  );
  const [mode, setMode] = useState<Mode>(() =>
    readAskHidden(browserStorage()) ? "hidden" : reopened ? "open" : "pill",
  );
  // The panel stays mounted once opened: Minimér, Skjul and Esc only put it away, so a running
  // answer keeps going and the conversation is still there when the pill is opened again.
  const [opened, setOpened] = useState(reopened);
  // "Afklar med Brain": the question to put in the composer, new each request.
  const [prefill, setPrefill] = useState<{ text: string; nonce: number; key: string } | null>(null);
  const open = mode === "open";
  const pillRef = useRef<HTMLButtonElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The control that gets focus after the reader's own action unmounted the focused one.
  const refocus = useRef<"pill" | "handle" | null>(null);
  // Only one orb moves at a time on a screen: the pill's orb breathes on hover.
  const [lively, setLively] = useState(false);
  // The pill's box when it was last clicked, so the panel folds out of it and back into it.
  const pillBox = useRef<PillPlace | null>(null);
  // The pill waits for the panel to fold back before it appears again.
  const [fromPanel, setFromPanel] = useState(false);

  const suggestions = askSuggestions(context, language);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (mode !== "pill" || reduced) return;
    const timer = setInterval(() => setTick((n) => n + 1), EXAMPLE_MS);
    return () => clearInterval(timer);
  }, [mode, reduced]);
  const example = suggestions[tick % suggestions.length];

  useEffect(() => {
    writeAskSession(browserStorage(), fundId, { open: mode === "open" });
  }, [fundId, mode]);

  useEffect(() => {
    // A panel opened again is still `visibility: hidden` until its animation starts, and a
    // hidden field cannot take focus: focus it on the next frame.
    const frame =
      mode === "open"
        ? requestAnimationFrame(() => panelRef.current?.querySelector("textarea")?.focus())
        : 0;
    const target =
      mode === "pill" && refocus.current === "pill"
        ? pillRef.current
        : mode === "hidden" && refocus.current === "handle"
          ? handleRef.current
          : null;
    if (target) {
      refocus.current = null;
      target.focus();
    }
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  const openPanel = () => {
    if (pillRef.current) pillBox.current = measurePill(pillRef.current);
    setOpened(true);
    setMode("open");
  };
  const contextKey = askKey(context);
  // "Spørg Brain" on the case sheet: open the panel, also when it was hidden.
  useEffect(() => {
    const open = (event: Event) => {
      const question = askOpenQuestion(event);
      if (question)
        setPrefill((current) => ({
          text: question,
          nonce: (current?.nonce ?? 0) + 1,
          key: contextKey,
        }));
      writeAskSession(browserStorage(), fundId, { open: true });
      writeAskHidden(browserStorage(), false);
      setOpened(true);
      setMode("open");
    };
    window.addEventListener(ASK_OPEN_EVENT, open);
    return () => window.removeEventListener(ASK_OPEN_EVENT, open);
  }, [fundId, contextKey]);
  /** Folds the panel into the pill; focus goes to the pill unless the reader clicked elsewhere. */
  const minimize = useCallback((focusPill = true) => {
    refocus.current = focusPill ? "pill" : null;
    setFromPanel(true);
    setMode("pill");
  }, []);

  // A click outside the open panel folds it up, like Esc (focus stays where the reader
  // clicked). The press is noted on pointerdown and acted on at the click, so a touch that only
  // scrolls the page (iPad) does not fold it; the case sheet's "Spørg Brain" is in its dialog.
  useEffect(() => {
    if (mode !== "open") return;
    let outside = false;
    const onPointerDown = (event: PointerEvent) => {
      outside = pressedOutside(event);
    };
    const onClick = () => {
      if (outside) minimize(false);
      outside = false;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [minimize, mode]);
  const setHidden = (hidden: boolean) => {
    setFromPanel(false);
    writeAskHidden(browserStorage(), hidden);
    refocus.current = hidden ? "handle" : "pill";
    setMode(hidden ? "hidden" : "pill");
  };

  const pop = (from: { y: number; scale: number }, ease: Bezier, duration: number) =>
    reduced
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          exit: { opacity: 0 },
          transition: REDUCED_FADE,
        }
      : {
          initial: { opacity: 0, ...from },
          animate: { opacity: 1, y: 0, scale: 1 },
          exit: {
            opacity: 0,
            y: from.y / 2,
            scale: (1 + from.scale) / 2,
            transition: { duration: 0.16 },
          },
          transition: { duration, ease },
        };
  // The panel's clip grows out of the pill's box and shrinks back into it. The clip is
  // dropped when the panel is open, so its shadow shows; hiding it (X) keeps the quick fade.
  const panelShown = reduced
    ? { opacity: 1, clipPath: "none", visibility: "visible" as const, transition: REDUCED_FADE }
    : {
        opacity: 1,
        clipPath: [pillInset(pillBox.current), PANEL_CLIP],
        visibility: "visible" as const,
        transition: { ...MORPH, opacity: { duration: 0.12 } },
        transitionEnd: { clipPath: "none" },
      };
  const panelPutAway = reduced
    ? { opacity: 0, transition: REDUCED_FADE, transitionEnd: { visibility: "hidden" as const } }
    : mode === "pill"
      ? {
          clipPath: [PANEL_CLIP, pillInset(pillBox.current)],
          opacity: [1, 1, 0],
          transition: { ...MORPH, opacity: { ...MORPH, times: [0, 0.8, 1] } },
          transitionEnd: { visibility: "hidden" as const },
        }
      : {
          opacity: 0,
          transition: { duration: 0.16 },
          transitionEnd: { visibility: "hidden" as const },
        };
  // The panel's content fades in once the fold-out is under way and out before it folds back.
  const contentShown = reduced
    ? { opacity: 1 }
    : { opacity: 1, transition: { duration: 0.24, delay: 0.16 } };
  const contentPutAway = reduced ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.12 } };
  // The pill after a fold-back: it appears as the panel lands in its box.
  const pillFromPanel = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0, transition: { duration: 0.08 } },
    transition: { duration: 0.16, delay: 0.34 },
  };

  return (
    <div className="print:hidden">
      {/* Each mode is its own fixed layer, so the swap needs no layout mode. */}
      <AnimatePresence initial={false}>
        {mode === "pill" && (
          <motion.div
            key="pill"
            className="fixed right-[22px] bottom-[22px] z-50 flex items-center gap-1.5"
            {...(fromPanel && !reduced
              ? pillFromPanel
              : pop({ y: 12, scale: 0.9 }, PILL_EASE, 0.52))}
          >
            <button
              ref={pillRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={false}
              onClick={openPanel}
              onPointerEnter={() => setLively(true)}
              onPointerLeave={() => setLively(false)}
              onFocus={() => setLively(true)}
              onBlur={() => setLively(false)}
              className="relative isolate flex h-[52px] items-center gap-3 overflow-hidden rounded-[26px] bg-surface pr-5 pl-2 shadow-[0_0_0_1px_var(--line),0_18px_44px_-14px_rgba(23,21,28,.32)] outline-none transition-[transform,box-shadow] duration-[260ms] ease-[cubic-bezier(.34,1.4,.64,1)] hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_var(--line-strong),0_22px_50px_-14px_rgba(23,21,28,.38)] focus-visible:ring-2 focus-visible:ring-action active:scale-[.97]"
            >
              {/* The flowing AI ground, so the pill reads as Interlect's agent. */}
              <Velaris className="absolute inset-0 -z-10" paused={!lively} />
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ai-wash">
                <OccasionOrb occasion="askInterlect" placement="card" paused={!lively} />
              </span>
              <span className="flex w-[210px] flex-col items-start text-left leading-[1.2]">
                <span className="text-[14px] font-semibold whitespace-nowrap text-ink-1">
                  {t("brainChat.ask.title")}
                </span>
                <span className="relative block h-4 w-full overflow-hidden" aria-hidden>
                  <AnimatePresence initial={false} mode="wait">
                    <motion.span
                      key={tick}
                      className="absolute inset-0 truncate text-meta text-ink-2"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.32 } }}
                      exit={{ opacity: 0, y: -6, transition: { duration: 0.24 } }}
                    >
                      {example}
                    </motion.span>
                  </AnimatePresence>
                </span>
              </span>
            </button>
            <IconButton
              icon={X}
              size={32}
              aria-label={t("brainChat.ask.hide")}
              title={t("brainChat.ask.hideShort")}
              onClick={() => setHidden(true)}
              className="size-7 text-ink-3 shadow-[0_0_0_1px_var(--line)] [&>svg]:size-3"
            />
          </motion.div>
        )}

        {mode === "hidden" && (
          <motion.button
            key="hidden"
            ref={handleRef}
            type="button"
            aria-label={t("brainChat.ask.show")}
            title={t("brainChat.ask.show")}
            onClick={() => setHidden(false)}
            className="fixed right-0 bottom-[90px] z-50 grid h-14 w-[22px] place-items-center rounded-l-[12px] bg-surface shadow-[0_0_0_1px_var(--line),0_8px_24px_-10px_rgba(23,21,28,.3)] outline-none transition-[width] duration-[var(--dur-quick)] hover:w-7 focus-visible:ring-2 focus-visible:ring-action"
            {...pop({ y: 0, scale: 0.9 }, PILL_EASE, 0.4)}
          >
            <InterlectMark size={11} />
          </motion.button>
        )}
      </AnimatePresence>

      {opened && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label={t("brainChat.ask.title")}
          aria-hidden={!open || undefined}
          inert={!open}
          onKeyDown={(event) => {
            // Escape inside the panel minimizes it (a source card has its own dialog).
            if (event.key === "Escape" && panelRef.current?.contains(event.target as Node)) {
              event.stopPropagation();
              minimize();
            }
          }}
          className="fixed right-[22px] bottom-[22px] z-50 flex h-[min(580px,calc(100svh-44px))] w-[min(400px,calc(100vw-44px))] origin-bottom-right flex-col overflow-hidden rounded-[24px] bg-surface text-ink-1 shadow-[0_0_0_1px_var(--line),0_32px_80px_-20px_rgba(23,21,28,.4)]"
          // A page change with the panel open shows it at once (no fold-out on every page).
          initial={reopened ? false : { opacity: 0 }}
          animate={open ? panelShown : panelPutAway}
        >
          <motion.div
            className="flex min-h-0 flex-1 flex-col"
            initial={reopened ? false : { opacity: 0 }}
            animate={open ? contentShown : contentPutAway}
          >
            <header className="flex shrink-0 items-center gap-2.5 border-b border-line py-3 pr-3.5 pl-[18px]">
              <OccasionOrb occasion="askInterlect" placement="inline" paused />
              <span className="flex min-w-0 flex-1 flex-col leading-[1.25]">
                <span className="text-[15px] font-semibold">{t("brainChat.ask.title")}</span>
                <span className="truncate text-micro text-ink-3">
                  {askKnows(context, language)}
                </span>
              </span>
              <IconButton
                icon={Minus}
                size={32}
                aria-label={t("brainChat.ask.minimize")}
                title={t("brainChat.ask.minimize")}
                onClick={() => minimize()}
                className="bg-transparent text-ink-3 shadow-none hover:bg-hover"
              />
              <IconButton
                icon={X}
                size={32}
                aria-label={t("brainChat.ask.hide")}
                title={t("brainChat.ask.hideShort")}
                onClick={() => setHidden(true)}
                className="bg-transparent text-ink-3 shadow-none hover:bg-hover"
              />
            </header>
            {/* Another case (or leaving the case) is a new conversation; the old one is in /brain. */}
            <OrbPause value={!open}>
              <AskConversation
                key={askKey(context)}
                fundId={fundId}
                context={context}
                // A question about one case never lands in another case's conversation.
                prefill={prefill?.key === contextKey ? prefill : null}
              />
            </OrbPause>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}

function AskConversation({
  fundId,
  context,
  prefill,
}: {
  fundId: string;
  context: AskContext;
  prefill: { text: string; nonce: number } | null;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const rateAnswer = useServerFn(submitBrainFeedback);
  const noteAnswer = useServerFn(saveBrainAnswerAsNote);
  const brainAnswer = useServerFn(saveBrainAnswerToBrain);
  const answerActions = useMemo<AnswerActions>(
    () => ({
      feedback: async (messageId, rating, details) => {
        await rateAnswer({ data: { fundId, messageId, rating, ...details } });
      },
      saveNote: async (messageId, caseId) => {
        const { caseName } = await noteAnswer({ data: { fundId, messageId, caseId } });
        // The case's Noter tab behind the panel shows the new note without a reload.
        void queryClient.invalidateQueries({ queryKey: notesKey(caseId) });
        return caseName;
      },
      saveToBrain: async (messageId) => (await brainAnswer({ data: { fundId, messageId } })).saved,
      // "Find med Brain" when the question asks for a figure on the case.
      findField: (caseId, question) => {
        const asked = fieldsAskedFor(question);
        return asked ? <AnswerFindField fundId={fundId} caseId={caseId} asked={asked} /> : null;
      },
    }),
    [brainAnswer, fundId, noteAnswer, queryClient, rateAnswer],
  );
  const transport = useMemo(
    () =>
      createHttpChatTransport({
        getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      }),
    [],
  );
  // The new or changed thread shows up in /brain's list without a reload.
  const refreshThreads = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: brainThreadsQueryKey(fundId) }),
    [fundId, queryClient],
  );
  const caseId = context.kind === "case" ? context.id : null;
  const caseName = context.kind === "case" ? context.name : null;
  const caseContext = useMemo(
    () => (caseId && caseName ? { id: caseId, name: caseName } : null),
    [caseId, caseName],
  );
  // The last thread of this context: a page change mounts the panel again, so the
  // thread is loaded again; one that is gone or not readable (deleted, another fund) is dropped.
  const key = askKey(context);
  const [storedId] = useState(() => readAskSession(browserStorage(), fundId).threads[key] ?? null);
  const get = useServerFn(getBrainThread);
  const stored = useQuery({
    queryKey: ["ask-thread", fundId, storedId],
    queryFn: () => get({ data: { fundId, threadId: storedId! } }),
    enabled: storedId !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const rememberThread = useCallback(
    (id: string | null) => writeAskSession(browserStorage(), fundId, { thread: { key, id } }),
    [fundId, key],
  );
  useEffect(() => {
    if (stored.isError) rememberThread(null);
  }, [rememberThread, stored.isError]);

  const panel = useMemo(
    () => ({
      context: askBrainContext(context),
      heading: askHeading(context, language),
      intro: askIntro(context, language),
      suggestions: askSuggestions(context, language),
      placeholder: askPlaceholder(context, language),
    }),
    [context, language],
  );

  if (storedId !== null && stored.isPending) {
    return (
      <div className="min-h-0 flex-1" role="status" aria-label={t("brainChat.ask.loadingThread")} />
    );
  }
  const resumed = stored.data ?? null;

  return (
    <BrainChatPane
      fundId={fundId}
      firstName={null}
      threadId={resumed ? storedId : null}
      initialTurns={resumed ? turnsFromMessages(resumed.messages, caseContext) : []}
      transport={transport}
      onThreadCreated={(id) => {
        rememberThread(id);
        refreshThreads();
      }}
      onAnswered={refreshThreads}
      threadCase={caseContext}
      answerActions={answerActions}
      panel={panel}
      prefill={prefill}
    />
  );
}
