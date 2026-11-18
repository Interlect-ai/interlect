/**
 * Chat thread: the case "Beskeder" (Case Screening v5, `showMsgTab` and the side panel) and
 * Brain answers (Interlect Brain, `m.ai`). "Case-faner" and "Interlect Brain".
 *
 * Team messages, measured in the prototype:
 * - `case` (the tab): column gap 14; name line 12 px ink-4 with the name 600 ink-2, then
 *   ", 09:12"; bubble max 78 %, padding 11/15, radius 18, 15/1.5. Own messages right in ink
 *   (bg-inverse), others left in sunken. System lines (Interlect, filled tasks) centred in
 *   12 px ink-4 with a 12 px icon.
 * - `panel` (400 px side panel on canvas): gap 12, 11 px name line, bubble max 88 %,
 *   padding 9/13, radius 16, 14/1.45, others on surface.
 * - Composer: a pill on canvas with a 1 px inset line, padding 6 6 6 16, 15 px text and a
 *   34 px ink send circle at 35 % until there is text (panel: surface, 5 5 5 14, 14 px, 30 px).
 *   It is a textarea: Enter sends, Shift+Enter makes a new line; the pill softens to a
 *   rounded box when it grows. Focus uses the field focus ring ("Felter").
 *
 * Spørg Interlect (`ask`, the 400 px corner panel, AskInterlect prototype): padding 18, items 18
 * px apart, the question in a 14/1.55 ai-wash bubble (radius 16, padding 11/14, max 88 %),
 * the answer as in Brain; composer on canvas, radius 18, padding 8 8 8 14, 14 px, 34 px send.
 *
 * Brain (`brain`): items 26 px apart. The question is right in sunken, radius 20 20 6 20,
 * 16/1.55, with an optional "@ context" line. The answer is a 32 px column + text: while
 * working the brainThinking orb (searching → solving → composing, 20 px in the thread per
 * the orb catalogue) and the visible steps (13 px icons, earlier steps become a check in
 * ink-3); then 16/1.7 paragraphs streaming with a coral caret; when done the coral mark,
 * source chips (34 px, radius 12, canvas, 22 px tinted tile) and actions (32 px quiet pills:
 * Kopiér, Gem som note, thumbs up/down, Svar igen). Every action is optional.
 *
 * Replaced from the prototype: the placeholder orb is OccasionOrb; CSS rise/slideIn are
 * motion fades (new items only); the caret does not blink (no endless animation besides AiOrb and
 * Velaris); press scale is.94 (never below.94).
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowUp,
  AtSign,
  BookmarkCheck,
  BookmarkPlus,
  Brain,
  Check,
  Copy,
  PenLine,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import { AiBeam } from "@/components/ai/AiBeam";
import { OccasionOrb } from "@/components/ai/OccasionOrb";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { showToast } from "@/components/ds/Toast";
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";
import { translate, type MessageKey } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { DURATION, EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { STOP_GRACE_MS } from "./AiComposer";
import { cn } from "@/lib/utils";

export type ChatVariant = "case" | "panel" | "brain" | "ask";

// ---------------------------------------------------------------------------
// Items. Team messages follow CaseMessage (src/lib/cases/messages.functions.ts).
// ---------------------------------------------------------------------------

export interface ChatUserMessage {
  kind: "user";
  id: string;
  /** null when the message was deleted. */
  body: string | null;
  authorName: string | null;
  isMine: boolean;
  createdAt: string;
  editedAt?: string | null | undefined;
  deleted?: boolean | undefined;
}

export interface ChatSystemMessage {
  kind: "system";
  id: string;
  body: string | null;
  /** 12 px icon before the line, e.g. Sparkles in var(--ai) for Interlect. */
  icon?: LucideIcon | undefined;
  iconColor?: string | undefined;
}

/** A question to Brain (the asker's own message in the Brain look). */
export interface ChatQuestion {
  kind: "question";
  id: string;
  body: string;
  /** The @ context it was asked in, e.g. "Havbrug Nord". */
  context?: string | undefined;
}

export interface ChatAnswer extends BrainAnswerProps {
  kind: "answer";
  id: string;
}

export type ChatItem = ChatUserMessage | ChatSystemMessage | ChatQuestion | ChatAnswer;

// ---------------------------------------------------------------------------
// Brain answer
// ---------------------------------------------------------------------------

export interface BrainSource {
  id: string;
  label: string;
  icon?: LucideIcon | undefined;
  /** Tile colour as a token, e.g. "var(--ai)" or "var(--series-3)". */
  color?: string | undefined;
  /** A link; without it the chip is a button that calls `onSourceClick`. */
  href?: string | undefined;
}

export type BrainFeedback = "up" | "down";

export interface BrainAnswerProps {
  status: "thinking" | "streaming" | "done";
  /** Orb phase while thinking: 0 searching, 1 solving, 2 composing. Streaming is composing. */
  phase?: number | undefined;
  /** Visible step texts, e.g. "Leder i jeres cases og noter". */
  steps?: readonly string[] | undefined;
  /** Which step is running (defaults to `phase`); the earlier ones show a check. */
  activeStep?: number | undefined;
  /** The answer so far; paragraphs are separated by a blank line. */
  text: string;
  sources?: readonly BrainSource[] | undefined;
  /** A link chip passes its click, so the page can navigate in the app (`preventDefault`). */
  onSourceClick?: ((source: BrainSource, event?: MouseEvent) => void) | undefined;
  /**
   * Draws the answer text instead of the plain paragraphs (Brain: safe model text with
   * citation markers, `SafeText`). It then also draws the streaming caret (`StreamCaret`).
   */
  renderText?: ((text: string, streaming: boolean) => ReactNode) | undefined;
  /** Extra content under the text, e.g. a chart. */
  children?: ReactNode;
  /** What "Kopiér" copies when it should differ from `text` (Brain: no citation markers). */
  copyText?: string | undefined;
  /** Shows "Kopiér"; the text is copied here and then this is called. */
  onCopy?: ((text: string) => void) | undefined;
  /** Shows "Gem som note". */
  onSaveNote?: (() => void) | undefined;
  saved?: boolean | undefined;
  saveLabel?: string | undefined;
  /** Text once saved, e.g. "Gemt på Havbrug Nord". */
  savedLabel?: string | undefined;
  /** Shows "Gem i Brain" (the answer becomes part of the fund's memory). */
  onSaveToBrain?: (() => void) | undefined;
  /** "Gem i Brain" is done or running: the button is replaced by `savedToBrainLabel`. */
  savedToBrain?: boolean | undefined;
  savedToBrainLabel?: string | undefined;
  /** Shows thumbs up and down. */
  onFeedback?: ((value: BrainFeedback) => void) | undefined;
  feedback?: BrainFeedback | null | undefined;
  /** Shows "Svar igen". */
  onRetry?: (() => void) | undefined;
  /** Own polite live region (default). ChatThread turns it off, its log announces instead. */
  live?: boolean | undefined;
  className?: string | undefined;
}

const STEP_ICONS: readonly LucideIcon[] = [Search, Brain, PenLine];

const FEEDBACK_TEXT: Record<BrainFeedback, MessageKey> = {
  up: "shared.answer.feedbackUp",
  down: "shared.answer.feedbackDown",
};

export function BrainAnswer({
  status,
  phase = 0,
  steps = [],
  activeStep,
  text,
  sources = [],
  onSourceClick,
  renderText,
  children,
  copyText,
  onCopy,
  onSaveNote,
  saved = false,
  saveLabel,
  savedLabel,
  onSaveToBrain,
  savedToBrain = false,
  savedToBrainLabel,
  onFeedback,
  feedback = null,
  onRetry,
  live = true,
  className,
}: BrainAnswerProps) {
  const reduced = useReducedMotion();
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const done = status === "done";
  const orbPhase = status === "thinking" ? phase : 2;
  const current = Math.max(0, Math.min(activeStep ?? phase, steps.length - 1));
  const visibleSteps = status === "thinking" ? steps.slice(0, current + 1) : [];
  const paragraphs = text ? text.split(/\n{2,}/) : [];
  const hasActions = Boolean(onCopy || onSaveNote || onSaveToBrain || onFeedback || onRetry);
  const fade = reduced ? REDUCED_FADE : { duration: DURATION.base, ease: EASE.out };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText ?? text);
      setCopied(true);
      onCopy?.(copyText ?? text);
    } catch {
      showToast({ message: t("shared.answer.copyFailed"), tone: "error" });
    }
  };

  return (
    <div
      className={cn(
        "grid w-full min-w-0 grid-cols-[32px_minmax(0,1fr)] items-start gap-3.5",
        className,
      )}
    >
      <span className="relative grid size-8 place-items-center">
        <AnimatePresence initial={false}>
          <motion.span
            key={done ? "mark" : "orb"}
            className="absolute inset-0 grid place-items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
          >
            {done ? (
              <InterlectMark size={18} />
            ) : (
              <OccasionOrb
                occasion="brainThinking"
                phase={orbPhase}
                placement="thread"
                label={t("shared.answer.working")}
              />
            )}
          </motion.span>
        </AnimatePresence>
      </span>

      <div
        className="flex min-w-0 flex-col gap-3.5 pt-1"
        {...(live ? { "aria-live": "polite" as const, "aria-busy": !done } : {})}
      >
        {visibleSteps.length > 0 && (
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
            {visibleSteps.map((step, index) => {
              const passed = index < current;
              const Icon = passed ? Check : (STEP_ICONS[index] ?? PenLine);
              return (
                <motion.li
                  key={`${index}-${step}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={fade}
                  className={cn(
                    "flex items-center gap-2 text-list transition-colors duration-[var(--dur-quick)]",
                    passed ? "text-ink-3" : "text-ink-1",
                  )}
                >
                  <Icon className="size-[13px] shrink-0" strokeWidth={1.75} aria-hidden />
                  {step}
                </motion.li>
              );
            })}
          </ol>
        )}

        <AiBeam size="line" active={!done}>
          <div className="flex min-w-0 flex-col gap-3.5">
            {renderText ? (
              renderText(text, status === "streaming")
            ) : (
              <>
                {paragraphs.map((paragraph, index) => (
                  <p
                    key={index}
                    className="m-0 text-[16px] leading-[1.7] break-words whitespace-pre-line text-pretty text-ink-1"
                  >
                    {paragraph}
                    {status === "streaming" && index === paragraphs.length - 1 && <StreamCaret />}
                  </p>
                ))}
                {status === "streaming" && paragraphs.length === 0 && (
                  <p className="m-0 text-[16px] leading-[1.7]">
                    <StreamCaret />
                  </p>
                )}
              </>
            )}
          </div>
        </AiBeam>

        {children}

        {done && (sources.length > 0 || hasActions) && (
          <motion.div
            className="flex flex-col gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduced ? REDUCED_FADE : { duration: DURATION.slide, ease: EASE.out }}
          >
            {sources.length > 0 && (
              <ul
                aria-label={t("shared.answer.sources")}
                className="m-0 flex list-none flex-wrap gap-2 p-0"
              >
                {sources.map((source) => (
                  <li key={source.id} className="min-w-0">
                    <SourceChip source={source} onSourceClick={onSourceClick} />
                  </li>
                ))}
              </ul>
            )}
            {hasActions && (
              <div className="flex flex-wrap items-center gap-0.5">
                {onCopy && (
                  <ActionButton
                    icon={copied ? Check : Copy}
                    label={copied ? t("shared.answer.copied") : t("shared.answer.copy")}
                    onClick={() => void copy()}
                  />
                )}
                {onSaveNote && (
                  <ActionButton
                    icon={saved ? BookmarkCheck : BookmarkPlus}
                    label={t("shared.answer.saveNoteLabel")}
                    text={
                      saved
                        ? (savedLabel ?? t("shared.answer.savedNote"))
                        : (saveLabel ?? t("shared.answer.saveNote"))
                    }
                    onClick={onSaveNote}
                    disabled={saved}
                  />
                )}
                {onSaveToBrain && (
                  <ActionButton
                    icon={savedToBrain ? Check : Brain}
                    label={t("shared.answer.saveToBrainLabel")}
                    text={
                      savedToBrain
                        ? (savedToBrainLabel ?? t("shared.answer.savedToBrain"))
                        : t("shared.answer.saveToBrain")
                    }
                    onClick={onSaveToBrain}
                    disabled={savedToBrain}
                  />
                )}
                {onFeedback && (
                  <>
                    <ActionButton
                      icon={ThumbsUp}
                      label={t("shared.answer.good")}
                      pressed={feedback === "up"}
                      tone="positive"
                      onClick={() => onFeedback("up")}
                    />
                    <ActionButton
                      icon={ThumbsDown}
                      label={t("shared.answer.notRight")}
                      pressed={feedback === "down"}
                      tone="critical"
                      onClick={() => onFeedback("down")}
                    />
                  </>
                )}
                {onRetry && (
                  <ActionButton
                    icon={RotateCcw}
                    label={t("shared.answer.retry")}
                    onClick={onRetry}
                  />
                )}
              </div>
            )}
            <AnimatePresence initial={false}>
              {feedback && (
                <motion.span
                  key={feedback}
                  role="status"
                  className="inline-flex items-center gap-2 text-meta text-ai-ink"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={reduced ? REDUCED_FADE : SPRING.smooth}
                >
                  <Sparkles className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  {t(FEEDBACK_TEXT[feedback])}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/** Coral streaming caret, 8 × 18 px, radius 2, at the end of the text. */
export function StreamCaret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[18px] w-2 translate-y-[3px] rounded-[2px] bg-ai"
    />
  );
}

function SourceChip({
  source,
  onSourceClick,
}: {
  source: BrainSource;
  onSourceClick: ((source: BrainSource, event?: MouseEvent) => void) | undefined;
}) {
  const color = source.color ?? "var(--ink-2)";
  const Icon = source.icon;
  const className =
    "inline-flex h-[34px] max-w-full min-w-0 items-center gap-2 rounded-[12px] bg-canvas pr-3 pl-2 text-meta text-ink-1 outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action";
  const content = (
    <>
      <span
        className="grid size-[22px] shrink-0 place-items-center rounded-[7px]"
        style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
        aria-hidden
      >
        {Icon && <Icon className="size-[11px]" strokeWidth={2} />}
      </span>
      <span className="truncate">{source.label}</span>
    </>
  );
  if (source.href) {
    return (
      <a
        href={source.href}
        className={className}
        {...(onSourceClick ? { onClick: (event) => onSourceClick(source, event) } : {})}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      disabled={!onSourceClick}
      onClick={() => onSourceClick?.(source)}
    >
      {content}
    </button>
  );
}

function ActionButton({
  icon: Icon,
  label,
  text,
  onClick,
  pressed,
  tone,
  disabled = false,
}: {
  icon: LucideIcon;
  /** Tooltip, and the accessible name when there is no visible text. */
  label: string;
  text?: string | undefined;
  onClick: () => void;
  pressed?: boolean | undefined;
  tone?: "positive" | "critical" | undefined;
  disabled?: boolean | undefined;
}) {
  const on = pressed === true;
  return (
    <button
      type="button"
      title={label}
      onClick={disabled ? undefined : onClick}
      // aria-disabled, not `disabled`: a disabled button drops focus to the page, and Esc in the
      // Spørg Interlect panel (minimize) then stops working after "Gem i Brain" or "Gem som note".
      {...(disabled ? { "aria-disabled": true } : {})}
      {...(text ? {} : { "aria-label": label })}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-pill px-2.5 text-meta font-medium whitespace-nowrap outline-none",
        "transition-[background-color,color] duration-[var(--dur-quick)] focus-visible:ring-2 focus-visible:ring-action aria-disabled:cursor-default",
        on && tone === "positive"
          ? "bg-positive-wash text-positive"
          : on && tone === "critical"
            ? "bg-critical-wash text-critical"
            : "text-ink-3 hover:bg-hover hover:text-ink-1",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      {text}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Team composer
// ---------------------------------------------------------------------------

const COMPOSER_LOOK = {
  case: {
    box: "mt-2 rounded-[23px] bg-canvas py-1.5 pr-1.5 pl-4 focus-within:bg-surface",
    input: "py-1.5 text-[15px] leading-[22px]",
    send: "size-[34px]",
    maxHeight: 160,
    placeholder: "shared.chat.placeholderCase",
  },
  panel: {
    box: "mx-3 mb-3 rounded-[20px] bg-surface py-[5px] pr-[5px] pl-3.5",
    input: "py-[5px] text-[14px] leading-5",
    send: "size-[30px]",
    maxHeight: 140,
    placeholder: "shared.chat.placeholderPanel",
  },
  ask: {
    box: "mx-3 mb-3 rounded-[18px] bg-canvas py-2 pr-2 pl-3.5",
    input: "py-1.5 text-[14px] leading-[1.5]",
    send: "size-[34px]",
    maxHeight: 120,
    placeholder: "shared.chat.placeholderAsk",
  },
} as const;

export function ChatComposer({
  value,
  onChange,
  onSend,
  variant = "case",
  placeholder,
  label,
  sending = false,
  onStop,
  disabled = false,
  className,
}: {
  /** Controlled draft; leave out to let the composer keep its own. */
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  /** Gets the trimmed text. If it returns a promise, an own draft is cleared on success only. */
  onSend: (body: string) => void | Promise<unknown>;
  variant?: "case" | "panel" | "ask" | undefined;
  placeholder?: string | undefined;
  /** Accessible name of the text field. */
  label?: string | undefined;
  sending?: boolean | undefined;
  /** While sending: the send circle becomes a stop square that calls this. */
  onStop?: (() => void) | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const look = COMPOSER_LOOK[variant];
  const [own, setOwn] = useState("");
  const draft = value ?? own;
  const ref = useRef<HTMLTextAreaElement>(null);
  const sentAt = useRef(0);
  const canSend = draft.trim().length > 0 && !sending && !disabled;
  const canStop = sending && Boolean(onStop);

  // Grow with the text up to the variant's maximum.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(look.maxHeight, element.scrollHeight)}px`;
  }, [draft, look.maxHeight]);

  const change = (next: string) => {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  };

  const send = () => {
    if (canStop) {
      // A double click on Send must not stop the answer it just started.
      if (Date.now() - sentAt.current > STOP_GRACE_MS) onStop?.();
      return;
    }
    const body = draft.trim();
    if (!body || sending || disabled) return;
    sentAt.current = Date.now();
    const result = onSend(body);
    if (value !== undefined) return;
    if (result instanceof Promise) {
      result.then(
        () => setOwn(""),
        () => {
          /* keep the draft; the caller reports the error */
        },
      );
    } else {
      setOwn("");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      // Enter never stops an answer that is coming; only the stop square does.
      if (!sending) send();
    }
  };

  return (
    <AiBeam active={Boolean(sending)} size="md">
      <div
        className={cn(
          "flex items-end gap-2 shadow-[inset_0_0_0_1px_var(--line)] transition-[box-shadow,background-color] duration-[var(--dur-quick)]",
          "focus-within:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]",
          look.box,
          className,
        )}
      >
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? t(look.placeholder)}
          aria-label={label ?? t("shared.chat.label")}
          disabled={disabled}
          className={cn(
            "min-w-0 flex-1 resize-none border-0 bg-transparent text-ink-1 outline-none placeholder:text-ink-4",
            look.input,
          )}
        />
        <motion.button
          type="button"
          onClick={send}
          disabled={!canSend && !canStop}
          aria-label={canStop ? t("shared.composer.stopAnswer") : t("shared.chat.send")}
          aria-busy={sending || undefined}
          {...(reduced || (!canSend && !canStop) ? {} : { whileTap: { scale: 0.94 } })}
          transition={SPRING.press}
          className={cn(
            "grid shrink-0 place-items-center rounded-full bg-inverse text-ink-inverse outline-none transition-opacity duration-200 focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2",
            look.send,
            !canSend && !sending && "opacity-35",
          )}
        >
          {canStop ? (
            <Square className="size-3.5" strokeWidth={2} fill="currentColor" aria-hidden />
          ) : sending ? (
            <OccasionOrb occasion="buttonPending" />
          ) : (
            <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
          )}
        </motion.button>
      </div>
    </AiBeam>
  );
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

const TIME_ZONE = "Europe/Copenhagen";
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const timePartsByLanguage = new Map<Language, Intl.DateTimeFormat>();

function timeParts(language: Language): Intl.DateTimeFormat {
  let format = timePartsByLanguage.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(LANGUAGE_TAGS[language], {
      timeZone: TIME_ZONE,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    timePartsByLanguage.set(language, format);
  }
  return format;
}

/** "09:12" today, otherwise "23. sep, 09:12" (Copenhagen time). */
function defaultFormatTime(iso: string, language: Language = DEFAULT_LANGUAGE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = timeParts(language).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value.replace(/\.$/, "") ?? "";
  const time = `${part("hour")}:${part("minute")}`;
  if (dayKey.format(date) === dayKey.format(new Date())) return time;
  return translate(language, "shared.chat.dateTime", {
    day: part("day"),
    month: part("month"),
    time,
  });
}

const THREAD_LOOK = {
  case: {
    list: "gap-3.5",
    message: "gap-1",
    meta: "text-meta",
    bubble: "max-w-[78%] rounded-[18px] px-[15px] py-[11px] text-[15px] leading-[1.5]",
    other: "bg-sunken",
    system: "py-1 text-meta",
  },
  panel: {
    list: "gap-3 px-4 pb-4",
    message: "gap-[3px]",
    meta: "text-micro",
    bubble: "max-w-[88%] rounded-2xl px-[13px] py-[9px] text-[14px] leading-[1.45]",
    other: "bg-surface",
    system: "py-0.5 text-micro",
  },
  ask: {
    list: "gap-[18px] px-[18px] pt-[18px] pb-3",
    message: "gap-[3px]",
    meta: "text-micro",
    bubble: "max-w-[88%] rounded-2xl px-[13px] py-[9px] text-[14px] leading-[1.45]",
    other: "bg-surface",
    system: "py-0.5 text-micro",
  },
  brain: {
    list: "gap-[26px] pt-3 pb-[30px]",
    message: "gap-1",
    meta: "text-meta",
    bubble: "max-w-[78%] rounded-[18px] px-[15px] py-[11px] text-[15px] leading-[1.5]",
    other: "bg-sunken",
    system: "py-1 text-meta",
  },
} as const;

export function ChatThread({
  items,
  variant = "case",
  label,
  empty,
  composer,
  draft,
  onDraftChange,
  onSend,
  placeholder,
  sending = false,
  scroll = false,
  formatTime,
  className,
}: {
  items: readonly ChatItem[];
  variant?: ChatVariant | undefined;
  /** Accessible name of the thread; defaults to "Beskeder" (Brain: "Samtale"). */
  label?: string | undefined;
  /** Shown instead of the list when there are no items (e.g. Brain's greeting). */
  empty?: ReactNode;
  /** Replaces the built-in composer (e.g. AiComposer in Brain); `null` shows none. */
  composer?: ReactNode;
  /** Built-in team composer: shown when `onSend` is given and `composer` is not. */
  draft?: string | undefined;
  onDraftChange?: ((value: string) => void) | undefined;
  onSend?: ((body: string) => void | Promise<unknown>) | undefined;
  placeholder?: string | undefined;
  sending?: boolean | undefined;
  /** The list scrolls inside the thread and stays pinned to the newest item. */
  scroll?: boolean | undefined;
  formatTime?: ((createdAt: string) => string) | undefined;
  className?: string | undefined;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  const look = THREAD_LOOK[variant];
  const formatWhen = formatTime ?? ((createdAt: string) => defaultFormatTime(createdAt, language));
  const listRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastId = useRef<string | null>(null);
  const busy = items.some((item) => item.kind === "answer" && item.status !== "done");

  // Keep the newest item in view while the reader is at the bottom, and always after the
  // reader's own new message or question.
  useEffect(() => {
    if (!scroll) return;
    const element = listRef.current;
    const last = items[items.length - 1];
    const ownNew =
      last !== undefined &&
      last.id !== lastId.current &&
      (last.kind === "question" || (last.kind === "user" && last.isMine));
    lastId.current = last?.id ?? null;
    if (element && (pinned.current || ownNew)) element.scrollTop = element.scrollHeight;
  }, [items, scroll]);

  const enter = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED_FADE }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: DURATION.slide, ease: EASE.out },
      };

  const composerNode =
    composer !== undefined ? (
      composer
    ) : onSend ? (
      <ChatComposer
        variant={variant === "panel" || variant === "ask" ? variant : "case"}
        value={draft}
        onChange={onDraftChange}
        onSend={onSend}
        placeholder={placeholder}
        sending={sending}
      />
    ) : null;

  return (
    <div className={cn("flex min-w-0 flex-col", scroll && "min-h-0 flex-1", className)}>
      <div
        ref={listRef}
        onScroll={
          scroll
            ? (event) => {
                const element = event.currentTarget;
                pinned.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 80;
              }
            : undefined
        }
        className={cn("min-w-0", scroll && "min-h-0 flex-1 overflow-y-auto")}
      >
        {items.length === 0 && empty !== undefined ? (
          empty
        ) : (
          <div
            role="log"
            aria-label={
              label ??
              (variant === "brain" || variant === "ask"
                ? t("shared.chat.conversation")
                : t("shared.chat.messages"))
            }
            aria-busy={busy || undefined}
            className={cn(
              "flex min-w-0 flex-col",
              variant !== "panel" && "mx-auto w-full max-w-[760px]",
              look.list,
            )}
          >
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.div key={item.id} className="flex min-w-0 flex-col" {...enter}>
                  <ThreadItem item={item} variant={variant} formatTime={formatWhen} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
      {composerNode}
    </div>
  );
}

function ThreadItem({
  item,
  variant,
  formatTime,
}: {
  item: ChatItem;
  variant: ChatVariant;
  formatTime: (createdAt: string) => string;
}) {
  const t = useT();
  const look = THREAD_LOOK[variant];

  if (item.kind === "answer") {
    const { kind: _kind, id: _id, ...answer } = item;
    return <BrainAnswer {...answer} live={false} />;
  }

  if (item.kind === "question" && variant === "ask") {
    return (
      <div className="max-w-[88%] self-end rounded-2xl bg-ai-wash px-3.5 py-[11px] text-[14px] leading-[1.55] break-words whitespace-pre-line text-ink-1">
        {item.body}
      </div>
    );
  }

  if (item.kind === "question") {
    return (
      <div className="flex max-w-[78%] flex-col items-end gap-2 self-end">
        {item.context && (
          <span className="inline-flex items-center gap-1.5 text-meta text-ink-3">
            <AtSign className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
            {item.context}
          </span>
        )}
        <div className="rounded-[20px_20px_6px_20px] bg-sunken px-4 py-3 text-[16px] leading-[1.55] break-words whitespace-pre-line text-ink-1">
          {item.body}
        </div>
      </div>
    );
  }

  if (item.kind === "system") {
    const Icon = item.icon;
    return (
      <p
        className={cn(
          "m-0 flex items-center justify-center gap-1.5 self-center text-center text-ink-4",
          look.system,
        )}
      >
        {Icon && (
          <Icon
            className="size-3 shrink-0"
            strokeWidth={1.75}
            style={item.iconColor ? { color: item.iconColor } : undefined}
            aria-hidden
          />
        )}
        {item.body}
      </p>
    );
  }

  const mine = item.isMine;
  const deleted = item.deleted === true || item.body === null;
  const when = formatTime(item.createdAt);
  const name = item.authorName ?? (mine ? t("shared.chat.you") : t("shared.chat.unknown"));
  return (
    <div className={cn("flex min-w-0 flex-col", look.message, mine ? "items-end" : "items-start")}>
      <span className={cn("px-1.5 text-ink-4", look.meta)}>
        <span className="font-semibold text-ink-2">{name}</span>
        {when && `, ${when}`}
        {item.editedAt && !deleted && t("shared.chat.edited")}
      </span>
      {deleted ? (
        <span className={cn("px-1.5 text-ink-4", look.meta)}>{t("shared.chat.deleted")}</span>
      ) : (
        <div
          className={cn(
            "break-words whitespace-pre-line",
            look.bubble,
            mine ? "bg-inverse text-ink-inverse" : cn(look.other, "text-ink-1"),
          )}
        >
          {item.body}
        </div>
      )}
    </div>
  );
}
