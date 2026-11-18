/**
 * The Brain conversation (Interlect Brain prototype): header, empty state (orb, greeting, four
 * fixed suggestions on Velaris), the thread with visible steps, safe answer text and source
 * chips, and the composer with the @ context chip. It knows nothing about the database or the
 * engine: a `ChatTransport` (chat-contract.ts) gives it events, `initialTurns` is a loaded
 * thread. Rules (gap doc "Brain-principper"): Brain never decides (no button here changes a
 * case, a score or the fund set-up); only stored facts are cited ([n] without a source is
 * dropped); model text is plain text (SafeText); errors are fixed Danish sentences.
 *
 * Batch 2: on a whole, saved answer the actions of the prototype: Kopiér, Gem som note (only
 * when the answer is about a case), 👍/👎 and Svar igen (the last answer). They run through
 * `answerActions`, so the Admin test engine page shows Kopiér only. Hurtig/Grundig is a
 * chip next to the @ chip with the typical price; the corner panel always asks Hurtig. Not here:
 * attachments, commands (not in the prototype, or not built by the engine yet).
 *
 * `panel` is the same conversation in the Spørg Interlect corner panel: the page's
 * context is fixed (no @ chip), the panel draws its own header, and the empty state is the
 * panel's heading, one line and four suggestions (AskInterlect prototype).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  BookOpen,
  Building2,
  CircleAlert,
  FileText,
  Globe,
  Waypoints,
  Info,
  Layers,
  Quote,
  Square,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { OccasionOrb } from "@/components/ai/OccasionOrb";
import { CreditStop } from "@/components/ai/CreditStop";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { AiComposer } from "@/components/ds/AiComposer";
import {
  ChatComposer,
  ChatThread,
  type BrainSource,
  type ChatItem,
} from "@/components/ds/ChatThread";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { showToast } from "@/components/ds/Toast";
import { Velaris } from "@/components/ds/Velaris";
import { SafeText } from "@/components/brain/SafeText";
import { SourcePanel } from "@/components/brain/SourcePanel";
import { BrainCardDialog, type CardSource } from "@/components/brain/BrainCard";
import { FeedbackDialog } from "@/components/brain/FeedbackDialog";
import { ModeMenu } from "@/components/brain/ModeMenu";
import { WebSearchChip } from "@/components/brain/WebSearchChip";
import { ContextMenu } from "@/components/brain/ContextMenu";
import { BrainAttachmentList } from "@/components/brain/BrainAttachmentList";
import { BRAIN_ATTACH_ACCEPT, useBrainAttachments } from "@/components/brain/useBrainAttachments";
import { useDictation } from "@/components/brain/useDictation";
import { appendDictated } from "@/lib/ui/dictation";
import { useBrainCapabilities } from "@/lib/brain/useBrainCapabilities";
import {
  ALL_CASES,
  brainSuggestions,
  contextLabel,
  contextRequestFields,
  greetingFor,
  SOURCES_FOLDED_KEY,
  type BrainContext,
} from "@/lib/brain/chat-view";
import type { BrainMention } from "@/lib/brain/chat.functions";
import {
  CHAT_QUESTION_MAX,
  chatErrorText,
  type BrainFeedbackDetails,
  type BrainFeedbackRating,
  type ChatCitation,
  type ChatMode,
  type ChatRequest,
  type ChatTransport,
} from "@/lib/brain/chat-contract";
import {
  answerIsActionable,
  applyStreamEvent,
  citationDisplayNumbers,
  citationNumbers,
  citationTarget,
  failTurn,
  newAnswerTurn,
  stopTurn,
  type AnswerTurn,
  type CitationIcon,
  type NoteCase,
  type Turn,
} from "@/lib/brain/chat-model";
import { plainTextOf, safeExternalHref, unmatchedCitationNumbers } from "@/lib/brain/chat-text";
import { DURATION, EASE, REDUCED_FADE } from "@/lib/motion";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { translate, type MessageKey, type TranslateVars } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";
import { userMessage } from "@/lib/errors/user-message";

const SOURCE_ICONS: Record<CitationIcon, { icon: LucideIcon; color: string }> = {
  case: { icon: Building2, color: "var(--ai)" },
  note: { icon: StickyNote, color: "var(--warning)" },
  fact: { icon: Quote, color: "var(--ink-2)" },
  chunk: { icon: FileText, color: "var(--ink-2)" },
  page: { icon: BookOpen, color: "var(--ink-2)" },
  web: { icon: Globe, color: "var(--ink-2)" },
  mandate: { icon: Layers, color: "var(--critical)" },
};

let counter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** What the page can do with a saved answer; the pane itself knows no server. */
export interface AnswerActions {
  feedback: (
    messageId: string,
    rating: BrainFeedbackRating,
    details?: BrainFeedbackDetails,
  ) => Promise<void>;
  /** Saves the stored answer as a note on the case and returns the case name; absent = no notes. */
  saveNote?: ((messageId: string, caseId: string) => Promise<string>) | undefined;
  /** "Gem i Brain": true = saved now, false = it was already in Brain; absent = not offered. */
  saveToBrain?: ((messageId: string) => Promise<boolean>) | undefined;
  /**
   * "Find med Brain" under an answer on a case: what to show for the question (null =
   * nothing, e.g. the question asks for no figure); absent = not offered.
   */
  findField?: ((caseId: string, question: string) => React.ReactNode) | undefined;
}

/** The Spørg Interlect panel: the page's fixed context and the empty state's texts. */
export interface BrainChatPanel {
  context: BrainContext;
  heading: string;
  intro: string;
  suggestions: readonly string[];
  placeholder: string;
}

const FEEDBACK_OF = { up: "useful", down: "wrong" } as const;
const FEEDBACK_SHOWN = { useful: "up", wrong: "down", incomplete: "down" } as const;

export interface BrainChatPaneProps {
  fundId: string;
  firstName: string | null;
  /** The saved thread this pane shows; null for a new conversation. */
  threadId: string | null;
  initialTurns?: Turn[];
  transport: ChatTransport;
  /** A new thread was created by the first question (update the list and the URL). */
  onThreadCreated?: ((id: string, title: string | null) => void) | undefined;
  /**
   * The thread changed: an answer finished, or the engine saved the question before failing or
   * being stopped (refresh the list; a cached copy of the thread is now old).
   */
  onAnswered?: ((threadId: string | null) => void) | undefined;
  searchMentions?: ((query: string) => Promise<BrainMention[]>) | undefined;
  /**
   * Web search: proposes the queries for a question. Leave out to hide "Søg på nettet"
   * (Spørg Interlect and the Admin test page never search the web).
   */
  proposeWeb?:
    | ((input: {
        question: string;
        caseId: string | null;
        entityIds: string[];
      }) => Promise<{ queries: string[]; rejected: number }>)
    | undefined;
  /** Åbner Hjernekortet; udelad for at skjule knappen "Hjernen". */
  onOpenMap?: (() => void) | undefined;
  /** The thread's title in the header. */
  title?: string | null | undefined;
  /** A marked banner above the thread (the Admin test engine). */
  banner?: React.ReactNode;
  /**
   * A colleague's shared thread: readable, but only its owner may ask in it (the engine refuses
   * anyone else). The composer is replaced by a line and a way to start a new conversation.
   */
  readOnly?: { ownerName: string | null; onNewConversation: () => void } | undefined;
  /** The case the thread is bound to (Spørg Interlect): every answer can be saved there. */
  threadCase?: NoteCase | null | undefined;
  answerActions?: AnswerActions | undefined;
  /** Shown in the Spørg Interlect corner panel instead of as the Brain page. */
  panel?: BrainChatPanel | undefined;
  /** The Brain page: sources open in a foldable panel on the right instead of a dialog. */
  sourcePanel?: boolean | undefined;
  /** A question to put in the composer (not sent), new for each nonce ("Afklar med Brain"). */
  prefill?: { text: string; nonce: number } | null | undefined;
  className?: string | undefined;
}

export function BrainChatPane({
  fundId,
  firstName,
  threadId,
  initialTurns = [],
  transport,
  onThreadCreated,
  onAnswered,
  searchMentions,
  proposeWeb,
  onOpenMap,
  title,
  banner,
  readOnly,
  threadCase = null,
  answerActions,
  panel,
  sourcePanel = false,
  prefill = null,
  className,
}: BrainChatPaneProps) {
  const t = useT();
  const language = useLanguage();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [draft, setDraft] = useState("");
  // A handed-over question replaces the draft once per request; the person sends it.
  const prefillText = prefill?.text ?? null;
  const prefillNonce = prefill?.nonce ?? 0;
  useEffect(() => {
    if (prefillText) setDraft(prefillText);
  }, [prefillText, prefillNonce]);
  // The composer's "+" and microphone on the Brain page (not in the Spørg panel).
  const capabilities = useBrainCapabilities().data;
  const canAttach = !panel && Boolean(capabilities?.ingest && capabilities.canIngest);
  const attachments = useBrainAttachments(fundId);
  const dictation = useDictation({
    lang: useLocaleTag(),
    onText: (phrase) => setDraft((current) => appendDictated(current, phrase)),
    onError: (reason) =>
      showToast({
        message: t(
          reason === "denied" ? "brainChat.attach.micDenied" : "brainChat.attach.micFailed",
        ),
        tone: "error",
      }),
  });
  const [context, setContext] = useState<BrainContext>(panel?.context ?? ALL_CASES);
  const [mode, setMode] = useState<ChatMode>("fast");
  const [busy, setBusy] = useState(false);
  // Web search: the switch, and whether the queries are being found.
  const [web, setWeb] = useState(false);
  const [finding, setFinding] = useState(false);
  const [openCitation, setOpenCitation] = useState<ChatCitation | null>(null);
  const [who, setWho] = useState<CardSource | null>(null);
  // The source panel: which answer's sources it shows (the latest unless a chip in
  // another answer was clicked), which card is open, and whether it is folded (kept in storage).
  const [panelTurn, setPanelTurn] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<{ turnId: string; n: number } | null>(null);
  const [sourcesFolded, setSourcesFolded] = useState(() => {
    try {
      return (
        typeof window !== "undefined" && window.localStorage.getItem(SOURCES_FOLDED_KEY) === "1"
      );
    } catch {
      return false;
    }
  });
  const foldSources = useCallback((folded: boolean) => {
    setSourcesFolded(folded);
    try {
      window.localStorage.setItem(SOURCES_FOLDED_KEY, folded ? "1" : "0");
    } catch {
      /* blocked storage: the choice lasts until the page is left */
    }
  }, []);
  const threadRef = useRef<string | null>(threadId);
  // Stop is offered once the thread exists: stopping a new conversation before the engine has
  // named its thread would leave a saved thread this pane never learns about.
  const [threadKnown, setThreadKnown] = useState(threadId !== null);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  // The @ context of each question asked in this pane, so "Prøv igen" and "Svar igen" ask it the
  // same way. A question loaded from history has no stored context: it is asked with the current.
  const askedWith = useRef(new Map<string, BrainContext>());
  // Answers with a rating on its way: a second click waits, so the server keeps the shown rating.
  const inflight = useRef(new Map<string, Promise<unknown>>());
  // What 👎 details were saved per answer: the dialog shows them again instead of starting empty.
  const savedDetails = useRef(new Map<string, BrainFeedbackDetails>());
  // The fund's monthly Brain limit was reached: no more questions until it resets.
  const [limitReached, setLimitReached] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const patchAnswer = useCallback((id: string, patch: Partial<AnswerTurn>) => {
    if (!mounted.current) return;
    setTurns((previous) =>
      previous.map((turn) =>
        turn.id === id && turn.kind === "answer" ? { ...turn, ...patch } : turn,
      ),
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const send = useCallback(
    async (
      raw: string,
      options: { replacing?: boolean; with?: BrainContext; webQueries?: string[] } = {},
    ) => {
      const question = raw.trim();
      if (!question || question.length > CHAT_QUESTION_MAX || abortRef.current) return;
      const asked = options.with ?? context;
      const answerId = uid("a");
      const questionId = uid("q");
      askedWith.current.set(questionId, asked);
      const label = contextLabel(asked, language);
      const noteCase: NoteCase | null =
        asked.kind === "case" ? { id: asked.id, name: asked.label } : threadCase;
      const fresh: AnswerTurn = { ...newAnswerTurn(answerId), noteCase };
      setTurns((previous) => [
        ...(options.replacing ? previous.slice(0, -2) : previous),
        {
          kind: "question",
          id: questionId,
          body: question,
          ...(asked.kind === "cases" ? {} : { context: label }),
        },
        fresh,
      ]);
      setDraft("");
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const request: ChatRequest = {
        fundId,
        threadId: threadRef.current,
        question,
        mode: panel ? "fast" : mode,
        ...contextRequestFields(asked),
        ...(options.webQueries && options.webQueries.length > 0
          ? { webQueries: options.webQueries }
          : {}),
      };
      let answer: AnswerTurn = fresh;
      // A rating or a saved note can land between `done` and the end of the stream (the engine
      // settles the budget first): they belong to the shown turn and are kept.
      const put = (next: AnswerTurn) =>
        mounted.current &&
        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === answerId && turn.kind === "answer"
              ? {
                  ...next,
                  feedback: turn.feedback,
                  savedOn: turn.savedOn,
                  ...(turn.savedToBrain ? { savedToBrain: true } : {}),
                }
              : turn,
          ),
        );
      try {
        for await (const event of transport(request, controller.signal)) {
          const result = applyStreamEvent(answer, event);
          answer = result.turn;
          if (result.threadId) {
            threadRef.current = result.threadId.id;
            if (mounted.current) setThreadKnown(true);
            onThreadCreated?.(result.threadId.id, result.threadId.title);
          }
          put(answer);
        }
        answer = controller.signal.aborted ? stopTurn(answer) : failTurn(answer);
      } catch (cause) {
        if (!controller.signal.aborted) console.error("[brain-chat] answer", cause);
        answer = controller.signal.aborted ? stopTurn(answer) : failTurn(answer);
      } finally {
        abortRef.current = null;
        put(answer);
        if (mounted.current) setBusy(false);
        if (answer.errorCode === "budget_reached" && mounted.current) setLimitReached(true);
        // Anything but a refusal may have saved the question: the thread changed.
        if (!answer.refused) onAnswered?.(threadRef.current);
      }
    },
    [context, fundId, language, mode, onAnswered, onThreadCreated, panel, threadCase, transport],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // With "Søg på nettet" on, Interlect first finds the search words from the question alone
  // (never from the fund's material, filtered again by the server) and the question then
  // goes out with them. No extra step for the user (keep it simple); the words
  // used are shown with the answer's steps. If they cannot be found, the question is answered
  // without the web and the user is told.
  const submit = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || question.length > CHAT_QUESTION_MAX || finding) return;
      if (!(web && proposeWeb && !panel)) return void send(question);
      setFinding(true);
      let webQueries: string[] | undefined;
      try {
        const fields = contextRequestFields(context);
        const proposal = await proposeWeb({
          question,
          caseId: fields.caseId,
          entityIds: fields.entityIds,
        });
        webQueries = proposal.queries;
        if (webQueries.length === 0) {
          showToast({ message: t("brainChat.pane.webNoQueries") });
        }
      } catch (cause) {
        const reason = userMessage(cause, "", language);
        showToast({
          message: reason
            ? t("brainChat.pane.webFailedWith", { message: reason })
            : t("brainChat.pane.webFailed"),
          tone: "error",
        });
      }
      if (!mounted.current) return;
      setFinding(false);
      setWeb(false);
      void send(question, webQueries && webQueries.length > 0 ? { webQueries } : {});
    },
    [context, finding, panel, proposeWeb, send, t, web],
  );

  const retry = useCallback(
    (index: number) => {
      const question = turns[index - 1];
      const answer = turns[index];
      if (
        question?.kind === "question" &&
        answer?.kind === "answer" &&
        index === turns.length - 1
      ) {
        // Refused before the stream: nothing was saved, so the failed pair is replaced. Any other
        // failure may have saved the question (the engine saves it before the model runs), so the
        // new one follows it instead of hiding a question that is in the thread.
        void send(question.body, {
          replacing: answer.refused,
          with: askedWith.current.get(question.id) ?? context,
        });
      }
    },
    [context, send, turns],
  );

  // 👎 opens the small choices (Forkert, Mangler noget, which sources, a comment) once saved.
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const rate = useCallback(
    async (
      turn: AnswerTurn,
      value: BrainFeedbackRating,
      details?: BrainFeedbackDetails,
    ): Promise<boolean> => {
      if (!answerActions || !turn.messageId) return false;
      if (value === "wrong" && !details && turn.feedback && turn.feedback !== "useful") {
        setDetailFor(turn.id);
        return false;
      }
      if (turn.feedback === value && !details) return false;
      const running = inflight.current.get(turn.id);
      // Details wait for the 👎 that is still being saved (the later save must win); a second
      // plain click while one is running does nothing.
      if (running && !details) return false;
      const messageId = turn.messageId;
      const previous = turn.feedback;
      const save = (async () => {
        if (running) await running.catch(() => undefined);
        patchAnswer(turn.id, { feedback: value });
        if (value === "wrong" && !details && mounted.current) setDetailFor(turn.id);
        await answerActions.feedback(messageId, value, details);
      })();
      inflight.current.set(turn.id, save);
      try {
        await save;
        if (details) savedDetails.current.set(turn.id, details);
        else savedDetails.current.delete(turn.id);
        onAnswered?.(threadRef.current);
        return true;
      } catch (cause) {
        console.error("[brain-chat] feedback", cause);
        patchAnswer(turn.id, { feedback: previous });
        if (!details) setDetailFor(null);
        showToast({ message: t("brainChat.pane.ratingFailed"), tone: "error" });
        return false;
      } finally {
        if (inflight.current.get(turn.id) === save) inflight.current.delete(turn.id);
      }
    },
    [answerActions, onAnswered, patchAnswer, t],
  );

  const saveNote = useCallback(
    async (turn: AnswerTurn) => {
      const save = answerActions?.saveNote;
      if (!save || !turn.messageId || !turn.noteCase || turn.savedOn || saving) return;
      setSaving(turn.id);
      try {
        const caseName = await save(turn.messageId, turn.noteCase.id);
        patchAnswer(turn.id, { savedOn: caseName });
        showToast({ message: t("brainChat.pane.noteSaved", { name: caseName }) });
        onAnswered?.(threadRef.current);
      } catch (cause) {
        console.error("[brain-chat] save note", cause);
        showToast({ message: noteErrorText(cause, t), tone: "error" });
      } finally {
        if (mounted.current) setSaving(null);
      }
    },
    [answerActions, onAnswered, patchAnswer, saving, t],
  );

  const [savingToBrain, setSavingToBrain] = useState<string | null>(null);
  const saveToBrain = useCallback(
    async (turn: AnswerTurn) => {
      const save = answerActions?.saveToBrain;
      if (!save || !turn.messageId || turn.savedToBrain || savingToBrain) return;
      setSavingToBrain(turn.id);
      try {
        const saved = await save(turn.messageId);
        patchAnswer(turn.id, { savedToBrain: true });
        showToast({
          message: saved ? t("brainChat.pane.brainSaved") : t("brainChat.pane.brainAlready"),
        });
      } catch (cause) {
        console.error("[brain-chat] save to brain", cause);
        showToast({ message: t("brainChat.pane.brainSaveFailed"), tone: "error" });
      } finally {
        if (mounted.current) setSavingToBrain(null);
      }
    },
    [answerActions, patchAnswer, savingToBrain, t],
  );

  const lastIndex = turns.length - 1;
  const items = useMemo<ChatItem[]>(() => {
    const list: ChatItem[] = [];
    turns.forEach((turn, index) => {
      const before = turns[index - 1];
      const question = before?.kind === "question" ? before : null;
      if (turn.kind === "question") {
        list.push({
          kind: "question",
          id: turn.id,
          body: turn.body,
          context: turn.context,
        });
        return;
      }
      const numbers = citationNumbers(turn.citations);
      const failed = turn.status === "error";
      if (turn.stopped && !turn.text) {
        list.push({
          kind: "system",
          id: `${turn.id}-stopped`,
          body: t("brainChat.pane.stopped"),
          icon: Square,
          iconColor: "var(--ink-3)",
        });
        return;
      }
      if (!failed || turn.text) {
        const done = turn.status === "done" || failed;
        const sources: BrainSource[] =
          done && !failed ? turn.citations.map((citation) => toSource(citation, t)) : [];
        const notes = done && !failed ? answerNotes(turn, numbers, t) : [];
        const findField =
          answerActions?.findField && answerIsActionable(turn) && turn.noteCase && question
            ? answerActions.findField(turn.noteCase.id, question.body)
            : null;
        list.push({
          kind: "answer",
          id: turn.id,
          status: turn.status === "thinking" || turn.status === "streaming" ? turn.status : "done",
          phase: Math.min(2, turn.activeStep),
          steps: turn.steps,
          activeStep: turn.activeStep,
          text: turn.text,
          sources,
          onSourceClick: (source, event) => {
            if (source.href) {
              // An internal link: navigate in the app (a full page load would cut a running
              // answer). Modified clicks keep the browser's own behaviour (new tab).
              if (
                event &&
                !event.defaultPrevented &&
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                void navigate({ href: source.href });
              }
              return;
            }
            const match = turn.citations.find((c) => `c${c.n}` === source.id);
            if (match && sourcePanel) {
              setPanelTurn(turn.id);
              setSelectedSource({ turnId: turn.id, n: match.n });
              setSourcesFolded(false);
            } else if (match) setOpenCitation(match);
          },
          renderText: (text, streaming) => (
            <SafeText
              text={text}
              streaming={streaming}
              citationNumbers={numbers}
              displayNumbers={citationDisplayNumbers(text, turn.citations)}
            />
          ),
          children:
            notes.length > 0 || findField ? (
              <>
                {notes.length > 0 && <AnswerNotes notes={notes} />}
                {findField}
              </>
            ) : undefined,
          copyText: done && !failed ? plainTextOf(turn.text, numbers) : undefined,
          onCopy: done && !failed && turn.text ? () => undefined : undefined,
          ...(answerActions && answerIsActionable(turn)
            ? {
                onFeedback: (value: "up" | "down") => void rate(turn, FEEDBACK_OF[value]),
                feedback: turn.feedback ? FEEDBACK_SHOWN[turn.feedback] : null,
                ...(answerActions.saveNote && turn.noteCase
                  ? {
                      onSaveNote: () => void saveNote(turn),
                      saved: Boolean(turn.savedOn) || saving === turn.id,
                      savedLabel: turn.savedOn
                        ? t("brainChat.pane.savedOn", { name: turn.savedOn })
                        : t("common.saving"),
                    }
                  : {}),
                ...(answerActions.saveToBrain
                  ? {
                      onSaveToBrain: () => void saveToBrain(turn),
                      savedToBrain: Boolean(turn.savedToBrain) || savingToBrain === turn.id,
                      savedToBrainLabel: turn.savedToBrain
                        ? t("brainChat.pane.savedToBrain")
                        : t("common.saving"),
                    }
                  : {}),
                ...(index === lastIndex && !busy && !readOnly && !limitReached && question
                  ? {
                      onRetry: () =>
                        void send(question.body, {
                          with: askedWith.current.get(question.id) ?? context,
                        }),
                    }
                  : {}),
              }
            : {}),
        });
      }
      if (failed) {
        list.push({
          kind: "system",
          id: `${turn.id}-error`,
          body: chatErrorText(turn.errorCode ?? "failed", language),
          icon: CircleAlert,
          iconColor: "var(--critical)",
        });
      }
    });
    return list;
  }, [
    answerActions,
    busy,
    context,
    language,
    t,
    lastIndex,
    limitReached,
    navigate,
    sourcePanel,
    rate,
    readOnly,
    saveNote,
    saveToBrain,
    savingToBrain,
    saving,
    send,
    turns,
  ]);

  const empty = turns.length === 0;
  const last = turns[lastIndex];
  const canRetry =
    last?.kind === "answer" && last.status === "error" && !busy && !readOnly && !limitReached;

  // In the panel the first question swaps the empty state for the thread, and the suggestion or
  // the composer the reader used goes with it: focus stays in the panel's composer, so typing on
  // and Esc (minimize) keep working.
  const panelRef = useRef<HTMLDivElement>(null);
  const inPanel = Boolean(panel);
  useEffect(() => {
    if (!inPanel || empty) return;
    const active = document.activeElement;
    if (!active || active === document.body) panelRef.current?.querySelector("textarea")?.focus();
  }, [empty, inPanel]);

  // The sources the panel shows: the pointed-at answer, else the latest one that has any.
  const answersWithSources = turns.filter(
    (turn): turn is AnswerTurn =>
      turn.kind === "answer" &&
      turn.status === "done" &&
      !turn.errorCode &&
      turn.citations.length > 0,
  );
  const panelSources =
    answersWithSources.find((turn) => turn.id === panelTurn) ?? answersWithSources.at(-1);
  const withSources = sourcePanel && !empty && panelSources !== undefined;
  const sourceAnswers = answersWithSources.length;
  // A new answer takes the panel over, and a card number only means something in its own answer.
  useEffect(() => setPanelTurn(null), [sourceAnswers]);

  const detailTurn = detailFor
    ? turns.find((turn): turn is AnswerTurn => turn.kind === "answer" && turn.id === detailFor)
    : undefined;
  const feedbackDialog = detailTurn && (
    <FeedbackDialog
      key={detailTurn.id}
      open
      citations={detailTurn.citations}
      displayNumbers={citationDisplayNumbers(detailTurn.text, detailTurn.citations)}
      initial={detailTurn.feedback}
      initialDetails={savedDetails.current.get(detailTurn.id) ?? null}
      onClose={() => setDetailFor(null)}
      onSave={(kind, details) => rate(detailTurn, kind, details)}
    />
  );

  if (panel) {
    const rise = (delay: number) =>
      reduced
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED_FADE }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: DURATION.slide, ease: EASE.out, delay },
          };
    const panelComposer = (
      <div className="flex shrink-0 flex-col">
        {canRetry && (
          <div className="flex justify-center pb-2">
            <Button variant="secondary" size="sm" onClick={() => retry(lastIndex)}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {limitReached && (
          <CreditStop
            fundId={fundId}
            message={t("brainChat.pane.creditsStop")}
            onlyWhenEmpty
            className="mb-2"
          />
        )}
        <ChatComposer
          variant="ask"
          label={t("brainChat.ask.title")}
          value={draft}
          onChange={setDraft}
          onSend={(text) => void send(text)}
          placeholder={panel.placeholder}
          sending={busy}
          onStop={threadKnown ? stop : undefined}
          disabled={limitReached}
        />
      </div>
    );
    return (
      <div ref={panelRef} className={cn("flex min-h-0 flex-1 flex-col", className)}>
        {empty ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-[18px]">
              <motion.h2
                className="m-0 text-[20px] leading-[1.3] font-semibold tracking-[-0.015em] text-balance"
                {...rise(0.12)}
              >
                {panel.heading}
              </motion.h2>
              <motion.p className="m-0 text-[14px] leading-[1.55] text-ink-3" {...rise(0.12)}>
                {panel.intro}
              </motion.p>
              <div className="flex flex-col gap-1.5">
                {panel.suggestions.map((suggestion, index) => (
                  <motion.button
                    key={suggestion}
                    type="button"
                    disabled={busy || limitReached}
                    onClick={() => void send(suggestion)}
                    className="flex min-h-[42px] items-center gap-2.5 rounded-[12px] bg-canvas px-3.5 py-2 text-left text-[14px] text-ink-1 outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50"
                    {...rise(0.16 + index * 0.06)}
                  >
                    <ArrowUpRight
                      className="size-[13px] shrink-0 text-ai"
                      strokeWidth={2}
                      aria-hidden
                    />
                    {suggestion}
                  </motion.button>
                ))}
              </div>
            </div>
            {panelComposer}
          </>
        ) : (
          <ChatThread
            variant="ask"
            items={items}
            scroll
            className="min-h-0 flex-1"
            composer={panelComposer}
          />
        )}
        <CitationDialog citation={openCitation} onClose={() => setOpenCitation(null)} />
        {feedbackDialog}
      </div>
    );
  }

  const composer = (
    <AiComposer
      variant="brain"
      label={t("brainChat.pane.composerLabel")}
      value={draft}
      onChange={setDraft}
      onSend={(text) => void submit(text)}
      placeholder={t("brainChat.pane.composerPlaceholder")}
      busy={busy || finding}
      disabled={limitReached}
      onStop={threadKnown ? stop : undefined}
      {...(canAttach
        ? {
            onFiles: attachments.add,
            accept: BRAIN_ATTACH_ACCEPT,
            attachments: (
              <BrainAttachmentList
                items={attachments.items}
                onRead={(item) => void attachments.read(item)}
                onDismiss={attachments.dismiss}
              />
            ),
          }
        : {})}
      {...(!panel && dictation.supported
        ? { onMic: dictation.toggle, listening: dictation.listening }
        : {})}
      context={
        <>
          <ContextMenu
            value={context}
            onChange={setContext}
            search={searchMentions}
            disabled={busy}
          />
          <ModeMenu value={mode} onChange={setMode} disabled={busy} />
          {proposeWeb && <WebSearchChip on={web} onChange={setWeb} disabled={busy || finding} />}
        </>
      }
      glow={false}
      {...(empty
        ? {
            above: (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
                {brainSuggestions(language).map((suggestion) => (
                  <button
                    key={suggestion.title}
                    type="button"
                    disabled={busy}
                    onClick={() => void send(suggestion.title)}
                    className="flex flex-col items-start gap-1 rounded-[16px] bg-surface/75 px-4 py-3.5 text-left shadow-pill outline-none backdrop-blur-md transition-[transform,background-color] duration-[var(--dur-base)] hover:-translate-y-0.5 hover:bg-surface focus-visible:ring-2 focus-visible:ring-action"
                  >
                    <span className="text-[14px] font-medium text-ink-1">{suggestion.title}</span>
                    <span className="text-meta text-ink-3">{suggestion.hint}</span>
                  </button>
                ))}
              </div>
            ),
          }
        : {})}
      below={
        <span className="text-center text-micro text-ink-4">{t("brainChat.pane.disclaimer")}</span>
      }
    />
  );

  const composerArea = readOnly ? (
    <div className="flex w-full flex-col items-center gap-3 py-2 text-center">
      <p className="m-0 max-w-[520px] text-list text-ink-3">
        {readOnly.ownerName
          ? t("brainChat.pane.sharedBy", { name: readOnly.ownerName })
          : t("brainChat.pane.sharedByUnknown")}
      </p>
      <Button variant="secondary" size="md" onClick={readOnly.onNewConversation}>
        {t("brainChat.pane.newThread")}
      </Button>
    </div>
  ) : limitReached ? (
    <div className="flex w-full flex-col items-center gap-2">
      <CreditStop
        fundId={fundId}
        message={t("brainChat.pane.creditsStop")}
        onlyWhenEmpty
        className="w-full max-w-[760px]"
      />
      {composer}
    </div>
  ) : (
    composer
  );

  const column = (
    <div
      className={
        sourcePanel
          ? "relative isolate flex min-w-0 flex-1 flex-col overflow-hidden"
          : "relative isolate flex h-[calc(100svh-96px)] min-h-[520px] flex-col overflow-hidden md:h-full " +
            (className ?? "")
      }
    >
      {empty && <Velaris className="absolute inset-0 -z-10" />}
      <header className="flex shrink-0 items-center gap-3 px-5 py-3.5">
        <span className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold">
          <InterlectMark size={15} />
          {t("brainChat.pane.title")}
        </span>
        {title && <span className="min-w-0 truncate text-list text-ink-3">{title}</span>}
        {onOpenMap && (
          <button
            type="button"
            onClick={onOpenMap}
            className="ml-auto inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border-0 bg-surface/80 px-3 text-meta font-medium text-ink-1 shadow-pill outline-none backdrop-blur-md transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-action"
          >
            <Waypoints className="size-3.5" strokeWidth={1.75} aria-hidden />
            {t("brainChat.pane.brainMap")}
          </button>
        )}
      </header>
      {banner}
      {empty ? (
        // Brain prototype: the greeting sits in the middle of the free space, the suggestions and
        // the composer are pinned to the bottom (not stacked together in the middle).
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-auto px-6 pb-6">
          <div className="flex min-h-[260px] flex-1 flex-col items-center justify-center gap-2.5 text-center">
            <OccasionOrb occasion="brainThinking" placement="empty" phase={0} />
            <h1 className="m-0 max-w-[640px] text-[clamp(28px,3.4vw,42px)] leading-[1.1] font-semibold tracking-display text-balance">
              {greetingFor(new Date(), firstName, language)}
            </h1>
          </div>
          <div className="flex w-full shrink-0 justify-center">{composerArea}</div>
        </div>
      ) : (
        <ChatThread
          variant="brain"
          items={items}
          scroll
          className="min-h-0 flex-1"
          composer={
            <div className="flex shrink-0 flex-col items-center gap-2 px-6 pb-5">
              {canRetry && (
                <Button variant="secondary" size="md" onClick={() => retry(lastIndex)}>
                  {t("common.retry")}
                </Button>
              )}
              {composerArea}
            </div>
          }
        />
      )}
      {!sourcePanel && (
        <CitationDialog citation={openCitation} onClose={() => setOpenCitation(null)} />
      )}
      {feedbackDialog}
    </div>
  );

  if (!sourcePanel) return column;
  return (
    <div className={"flex h-[calc(100svh-96px)] min-h-[520px] md:h-full " + (className ?? "")}>
      {column}
      <BrainCardDialog fundId={fundId} source={who} onClose={() => setWho(null)} />
      {withSources && (
        <SourcePanel
          citations={panelSources.citations}
          displayNumbers={citationDisplayNumbers(panelSources.text, panelSources.citations)}
          selected={selectedSource?.turnId === panelSources.id ? selectedSource.n : null}
          onSelect={(n) => setSelectedSource(n === null ? null : { turnId: panelSources.id, n })}
          folded={sourcesFolded}
          onFold={foldSources}
          onOpenHref={(href) => void navigate({ href })}
          onWho={setWho}
        />
      )}
    </div>
  );
}

/**
 * The server's own refusals are fixed sentences in the page's language (matched here, never shown
 * as they are): each known one has its own text in the fund's language; anything else is not shown.
 */
const NOTE_REFUSAL_SOURCES: [MessageKey, MessageKey][] = [
  ["brainServer.common.caseNotFound", "brainChat.pane.refusalNoCase"],
  ["brainServer.chat.answerNotFound", "brainChat.pane.refusalNoAnswer"],
  ["brainServer.common.notAvailable", "brainChat.pane.refusalNoBrain"],
  ["appServer.access.forbidden", "brainChat.pane.refusalForbidden"],
];
const NOTE_REFUSALS: Record<string, MessageKey> = Object.fromEntries(
  NOTE_REFUSAL_SOURCES.flatMap(([server, shown]) =>
    (["da", "en"] as const).map((language) => [translate(language, server), shown]),
  ),
);

type Translate = (key: MessageKey, vars?: TranslateVars) => string;

function noteErrorText(cause: unknown, t: Translate): string {
  const message = cause instanceof Error ? cause.message : "";
  const refusal = NOTE_REFUSALS[message];
  return refusal
    ? t("brainChat.pane.noteFailedWith", { message: t(refusal) })
    : t("brainChat.pane.noteFailed");
}

/** A deleted source has no label of its own to show: the dictionary's text stands in. */
const sourceLabel = (target: ReturnType<typeof citationTarget>, t: Translate): string =>
  target.deleted ? t("brainChat.sources.deleted") : target.label;

function toSource(citation: ChatCitation, t: Translate): BrainSource {
  const target = citationTarget(citation);
  const look = SOURCE_ICONS[target.icon];
  return {
    id: `c${citation.n}`,
    label: sourceLabel(target, t),
    icon: look.icon,
    color: look.color,
    // A web page opens in the card (with its own link); only internal routes are plain links.
    ...(target.href && !target.card ? { href: target.href } : {}),
  };
}

function answerNotes(turn: AnswerTurn, numbers: ReadonlySet<number>, t: Translate): string[] {
  const notes: string[] = [];
  if (turn.stopped) notes.push(t("brainChat.pane.stopped"));
  const dangling = unmatchedCitationNumbers(turn.text, numbers).length > 0;
  if (turn.unsourcedClaims || dangling) notes.push(t("brainChat.pane.unsourced"));
  for (const missing of turn.missing) notes.push(t("brainChat.pane.unknownYet", { missing }));
  return notes;
}

function AnswerNotes({ notes }: { notes: string[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {notes.map((note) => (
        <li key={note} className="flex items-start gap-2 text-meta text-ink-3">
          <Info className="mt-[2px] size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          {note}
        </li>
      ))}
    </ul>
  );
}

/** A source that has no page to open: its verbatim quote and date (never how far it can be trusted). */
function CitationDialog({
  citation,
  onClose,
}: {
  citation: ChatCitation | null;
  onClose: () => void;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  const external = citation?.kind === "web" ? safeExternalHref(citation.ref) : null;
  return (
    <Dialog
      open={citation !== null}
      onOpenChange={(open) => !open && onClose()}
      title={citation ? sourceLabel(citationTarget(citation), t) : ""}
      footer={
        <>
          {external && (
            <a
              href={external}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center rounded-pill px-4 text-list font-medium text-ink-1 hover:bg-hover"
            >
              {t("brainChat.sources.openWebsite")}
            </a>
          )}
          <Button variant="secondary" size="md" onClick={onClose}>
            {t("common.close")}
          </Button>
        </>
      }
    >
      {citation?.quote ? (
        <blockquote className="m-0 border-l-2 border-line-strong pl-4 text-[15px] leading-[1.6] break-words whitespace-pre-line text-ink-1">
          {citation.quote}
        </blockquote>
      ) : (
        <p className="m-0 text-list text-ink-3">{t("brainChat.sources.noQuote")}</p>
      )}
      {citation?.at && (
        <p className="m-0 text-meta text-ink-3">
          {new Date(citation.at).toLocaleDateString(localeTag, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      )}
    </Dialog>
  );
}
