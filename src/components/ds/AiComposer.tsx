/**
 * The large AI input (Opret case, Fondsopsætning, Brain): a centred heading, a big card
 * with the text field and a toolbar: + (attach), a context/focus chip slot, an optional
 * microphone and a send circle that stays grey until there is text. A faint coral glow sits
 * at the top of the card ("AI-composer (fondstese)"); `velaris` puts the Velaris
 * ground behind it. Enter sends, Shift+Enter makes a new line.
 *
 * Measurements per variant, from the prototypes:
 * - `fund` (Fondsopsaetning v2, "Lad Interlect hjælpe med tesen"): canvas box radius xl,
 *   padding 44/24/34, gap 18; heading = 18 px coral mark + clamp(20px, 2.4vw, 26px)/1.2 600;
 *   card max 720, radius 22, shadow-raised (hover adds a line-strong ring), padding
 *   18 18 12 20, gap 14; 17 px input; toolbar gap 4 with 34 px + (17 px icon), a 34 px
 *   chip (13/500 ink-2), 34 px mic and a 36 px send circle.
 * - `brain` (Interlect Brain composer): column max 760, gap 10; card radius 26, padding
 *   14 14 10 18, gap 10; 16/1.55 textarea, 28–180 px high; toolbar gap 6 with 34 px +,
 *   a 34 px chip (12/500 on canvas, ai-wash when a context is chosen) and a 38 px send
 *   circle that turns into a stop square while Brain answers.
 * - `case` (Opret case, startskærm): column max 820, gap 14; heading
 *   clamp(30px, 3.6vw, 44px)/1.04 600; card radius 28, padding 18, gap 12, 22 px input
 * . Dragging a file over it scales 1 → 1.015 with a 2 px coral ring (smooth
 *   spring). Velaris fills the surrounding work surface.
 * The rotating example placeholder takes five phrases and changes every 3.2 s: the new
 * phrase fades in from 10 px above while the old one leaves upwards; paused (first phrase,
 * still) under reduced motion.
 */
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, ChevronDown, Mic, Plus, Square, type LucideIcon } from "lucide-react";
import { AiBeam } from "@/components/ai/AiBeam";
import { OccasionOrb } from "@/components/ai/OccasionOrb";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { Velaris } from "@/components/ds/Velaris";
import { useT } from "@/lib/i18n/useT";
import { DURATION, EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type AiComposerVariant = "case" | "fund" | "brain";

const LOOK = {
  case: {
    root: "flex w-full min-w-0 max-w-[820px] flex-col items-center gap-3.5",
    heading:
      "text-[clamp(30px,3.6vw,44px)] leading-[1.04] tracking-display font-semibold text-balance",
    card: "gap-3 rounded-[28px] p-[18px] shadow-raised",
    input: "text-[22px] leading-[31px]",
    maxHeight: 220,
    toolbar: "gap-1",
    send: "size-10",
    plusIcon: "size-[18px]",
    attachLabel: "shared.composer.attachCase",
  },
  fund: {
    root: "relative isolate flex min-w-0 flex-col items-center gap-[18px] overflow-hidden rounded-xl bg-canvas px-6 pt-11 pb-[34px]",
    heading: "text-[clamp(20px,2.4vw,26px)] leading-[1.2] tracking-title font-semibold text-center",
    card: "max-w-[720px] gap-3.5 rounded-[22px] pt-[18px] pr-[18px] pb-3 pl-5 shadow-raised transition-shadow duration-[var(--dur-base)] hover:shadow-[0_0_0_1px_var(--line-strong),var(--shadow-raised)]",
    input: "text-[17px] leading-[26px]",
    maxHeight: 180,
    toolbar: "gap-1",
    send: "size-9",
    plusIcon: "size-[17px]",
    attachLabel: "shared.composer.attachFund",
  },
  brain: {
    root: "flex w-full min-w-0 max-w-[760px] flex-col gap-2.5",
    heading:
      "text-[clamp(28px,3.4vw,42px)] leading-[1.1] tracking-display font-semibold text-balance",
    card: "gap-2.5 rounded-[26px] pt-3.5 pr-3.5 pb-2.5 pl-[18px] shadow-raised",
    input: "py-1 text-[16px] leading-[1.55]",
    maxHeight: 180,
    toolbar: "gap-1.5",
    send: "size-[38px]",
    plusIcon: "size-4",
    attachLabel: "shared.composer.attachBrain",
  },
} as const;

const ROTATE_MS = 3200;
/** A click on Stop this soon after Send is the second half of a double click and is ignored. */
export const STOP_GRACE_MS = 400;

function hasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function AiComposer({
  variant,
  label,
  value,
  onChange,
  onSend,
  placeholder,
  heading,
  headingAs,
  mark,
  context,
  onAttach,
  attachLabel,
  onFiles,
  accept,
  onMic,
  listening = false,
  busy = false,
  onStop,
  disabled = false,
  autoFocus = false,
  glow = true,
  velaris = false,
  attachments,
  above,
  below,
  children,
  className,
}: {
  variant: AiComposerVariant;
  /** Accessible name of the text field, e.g. "Beskriv ændringen til tesen". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Gets the trimmed text. */
  onSend: (text: string) => void;
  /** One fixed placeholder, or example phrases that rotate every 3.2 s (use five). */
  placeholder?: string | readonly string[] | undefined;
  /** Centred heading above the card. */
  heading?: ReactNode;
  /** Heading element; `case` and `brain` default to h1, `fund` to h2. */
  headingAs?: "h1" | "h2" | "h3" | undefined;
  /** Coral mark before the heading; on by default for `fund`. */
  mark?: boolean | undefined;
  /** Context or focus chip(s) after the + (use ComposerChip). */
  context?: ReactNode;
  /** The + button. Runs instead of the built-in file picker when given. */
  onAttach?: (() => void) | undefined;
  attachLabel?: string | undefined;
  /** Files picked with + or dropped on the card; enables drag and drop. */
  onFiles?: ((files: File[]) => void) | undefined;
  accept?: string | undefined;
  /** Shows the microphone. */
  onMic?: (() => void) | undefined;
  listening?: boolean | undefined;
  /** AI is answering: the send circle shows a stop square (clickable with `onStop`). */
  busy?: boolean | undefined;
  onStop?: (() => void) | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  /** Faint coral glow at the top of the card (default on). */
  glow?: boolean | undefined;
  /** Velaris ground behind the composer. */
  velaris?: boolean | undefined;
  /** Inside the card between the text and the toolbar, e.g. file chips. */
  attachments?: ReactNode;
  /** Above the card inside the column, e.g. Brain's suggestion cards. */
  above?: ReactNode;
  /** Under the card inside the column, e.g. a proposal or Brain's footnote. */
  below?: ReactNode;
  /** Inside the card under the toolbar, e.g. focus options that fold out. */
  children?: ReactNode;
  className?: string | undefined;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const look = LOOK[variant];
  const textRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const sentAt = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [phraseIndex, setPhraseIndex] = useState(0);

  const phrases = typeof placeholder === "string" ? [placeholder] : (placeholder ?? []);
  const rotatingPlaceholder = phrases.length > 1;
  const showPhrase = rotatingPlaceholder && value.length === 0;
  const rotate = showPhrase && !reduced;
  const phrase = phrases[reduced ? 0 : phraseIndex % phrases.length] ?? "";
  const canSend = value.trim().length > 0 && !busy && !disabled;
  const canStop = busy && Boolean(onStop);

  useEffect(() => {
    if (!rotate) return;
    const timer = setInterval(() => setPhraseIndex((index) => index + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotate]);

  // Grow with the text up to the variant's maximum.
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(look.maxHeight, element.scrollHeight)}px`;
  }, [value, look.maxHeight]);

  const send = () => {
    if (canStop) {
      // A double click on Send must not stop the answer it just started.
      if (Date.now() - sentAt.current > STOP_GRACE_MS) onStop?.();
      return;
    }
    const text = value.trim();
    if (!text || busy || disabled) return;
    sentAt.current = Date.now();
    onSend(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!busy) send();
    }
  };

  const takeFiles = (list: ArrayLike<File> | null) => {
    const chosen = list ? Array.from(list) : [];
    if (chosen.length && onFiles) onFiles(chosen);
  };

  const dragHandlers = onFiles
    ? {
        onDragEnter: (event: DragEvent<HTMLDivElement>) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragOver: (event: DragEvent<HTMLDivElement>) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          takeFiles(event.dataTransfer.files);
        },
      }
    : {};

  const Heading = headingAs ?? (variant === "fund" ? "h2" : "h1");
  const showMark = mark ?? variant === "fund";
  const phraseTransition = reduced
    ? REDUCED_FADE
    : { duration: DURATION.page, ease: EASE.standard };

  const card = (
    <motion.div
      {...dragHandlers}
      animate={{ scale: dragging && !reduced ? 1.015 : 1 }}
      transition={reduced ? REDUCED_FADE : SPRING.smooth}
      className={cn(
        "relative isolate box-border flex w-full min-w-0 shrink-0 flex-col bg-surface",
        look.card,
      )}
    >
      {glow && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-24 rounded-[inherit]"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 0%, color-mix(in srgb, var(--ai) 9%, transparent), transparent 75%)",
          }}
        />
      )}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[0_0_0_2px_var(--ai)]"
        initial={false}
        animate={{ opacity: dragging ? 1 : 0 }}
        transition={reduced ? REDUCED_FADE : { duration: DURATION.base, ease: EASE.out }}
      />

      <div className="relative min-w-0">
        {showPhrase && (
          <AnimatePresence initial={false}>
            <motion.span
              key={reduced ? 0 : phraseIndex}
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-0 top-0 block truncate text-ink-4",
                look.input,
              )}
              initial={{ opacity: 0, y: reduced ? 0 : -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -10 }}
              transition={phraseTransition}
            >
              {phrase}
            </motion.span>
          </AnimatePresence>
        )}
        <textarea
          ref={textRef}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label={label}
          disabled={disabled}
          autoFocus={autoFocus}
          {...(!rotatingPlaceholder && phrases[0] ? { placeholder: phrases[0] } : {})}
          className={cn(
            "relative block w-full resize-none border-0 bg-transparent p-0 text-ink-1 outline-none placeholder:text-ink-4 disabled:opacity-60",
            look.input,
          )}
        />
      </div>

      {attachments}

      <div className={cn("flex min-w-0 items-center", look.toolbar)}>
        {(onAttach || onFiles) && (
          <ToolButton
            icon={Plus}
            iconClass={look.plusIcon}
            label={attachLabel ?? t(look.attachLabel)}
            onClick={() => (onAttach ? onAttach() : pickerRef.current?.click())}
            disabled={disabled}
          />
        )}
        {context}
        <div className="min-w-0 flex-1" />
        {onMic && (
          <ToolButton
            icon={Mic}
            iconClass="size-4"
            label={listening ? t("shared.composer.stopDictation") : t("shared.composer.dictate")}
            pressed={listening}
            onClick={onMic}
            disabled={disabled}
          />
        )}
        <motion.button
          type="button"
          onClick={send}
          disabled={!canSend && !canStop}
          aria-label={busy ? t("shared.composer.stopAnswer") : t("shared.composer.send")}
          {...(reduced || (!canSend && !canStop) ? {} : { whileTap: { scale: 0.94 } })}
          transition={SPRING.press}
          className={cn(
            "grid shrink-0 place-items-center rounded-full text-ink-inverse outline-none",
            "transition-[background-color] duration-[var(--dur-base)] focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2",
            look.send,
            canSend || canStop ? "bg-inverse" : "bg-ink-4",
          )}
        >
          {busy ? (
            <Square className="size-3.5" strokeWidth={2} fill="currentColor" aria-hidden />
          ) : (
            <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
          )}
        </motion.button>
      </div>

      {children}

      {onFiles && !onAttach && (
        <input
          ref={pickerRef}
          type="file"
          multiple
          hidden
          {...(accept ? { accept } : {})}
          onChange={(event) => {
            takeFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      )}
    </motion.div>
  );

  const column = (
    <div className={cn(look.root, variant === "case" && velaris && "my-auto", className)}>
      {variant === "fund" && velaris && <VelarisGround />}
      {heading !== undefined && (
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center justify-center text-center text-ink-1",
            variant === "fund" ? "gap-2.5" : "flex-col gap-3",
          )}
        >
          {showMark && <InterlectMark size={18} />}
          <Heading className={cn("m-0", look.heading)}>{heading}</Heading>
        </div>
      )}
      {above}
      {variant === "brain" ? <AiBeam active={busy}>{card}</AiBeam> : card}
      {below}
    </div>
  );

  if (!velaris || variant === "fund") return column;
  return (
    <div
      className={cn(
        "relative isolate flex min-w-0",
        variant === "case" && "min-h-0 flex-1 justify-center overflow-auto px-4 py-4 sm:px-8",
      )}
    >
      <VelarisGround />
      {column}
    </div>
  );
}

function VelarisGround() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <Velaris />
    </div>
  );
}

function ToolButton({
  icon: Icon,
  iconClass,
  label,
  onClick,
  pressed,
  disabled = false,
}: {
  icon: LucideIcon;
  iconClass: string;
  label: string;
  onClick: () => void;
  pressed?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      className={cn(
        "grid size-[34px] shrink-0 place-items-center rounded-full text-ink-2 outline-none",
        "transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action disabled:pointer-events-none disabled:opacity-35",
        pressed && "bg-sunken text-ink-1",
      )}
    >
      <Icon className={iconClass} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  icon?: LucideIcon | undefined;
  /** A value is chosen: `brain` tints ai-wash, `fund` sunken. */
  active?: boolean | undefined;
  /** Chevron after the label (Brain's @ context menu). */
  chevron?: boolean | undefined;
  /** `brain`: 12/500 ink-1 on canvas; `fund`: 13/500 ink-2 on no ground. */
  look?: "brain" | "fund" | undefined;
};

/**
 * The context/focus chip in the composer toolbar (34 px pill). Forwards its ref, so it can
 * be a menu trigger: `<MenuTrigger asChild><ComposerChip …/></MenuTrigger>`.
 */
export const ComposerChip = forwardRef<HTMLButtonElement, ChipProps>(function ComposerChip(
  {
    children,
    icon: Icon,
    active = false,
    chevron = false,
    look = "brain",
    className,
    type = "button",
    ...props
  },
  ref,
) {
  const brain = look === "brain";
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex h-[34px] min-w-0 shrink items-center gap-[7px] rounded-pill px-3 font-medium whitespace-nowrap outline-none",
        "transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action disabled:pointer-events-none disabled:opacity-35",
        brain ? "text-meta text-ink-1" : "text-list text-ink-2",
        brain ? (active ? "bg-ai-wash" : "bg-canvas") : active ? "bg-sunken" : "bg-transparent",
        className,
      )}
      {...props}
    >
      {Icon && (
        <Icon
          className={cn("shrink-0", brain ? "size-[13px] text-ink-3" : "size-3.5")}
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      <span className="truncate">{children}</span>
      {chevron && (
        <ChevronDown className="size-3 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
});

/** Small waiting line under a composer ("Interlect gennemgår tesen …") with the AI orb. */
export function ComposerStatus({ children }: { children: ReactNode }) {
  return (
    <motion.div
      role="status"
      className="flex items-center gap-2.5 text-[14px] text-ink-2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION.base, ease: EASE.out }}
    >
      <OccasionOrb occasion="aiComposing" />
      {children}
    </motion.div>
  );
}
