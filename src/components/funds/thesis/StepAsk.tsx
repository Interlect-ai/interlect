/**
 * "Få hjælp af Interlect" øverst på hvert trin i Ny investeringstese (prototypen `Ny
 * investeringstese v3`): Velaris bag et skrivefelt, "Giv mig et forslag", og under det samtalen
 * for trinnet med Kopiér og "Ryd samtalen". Svaret er kun tekst (`askThesisStep`); intet i
 * kladden ændres af det. Samtalen gemmes i browseren (`sessionStorage`) pr. fond og trin, aldrig
 * i databasen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, Check, Copy, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { PendingLabel } from "@/components/ai/AiOrb";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { Collapse } from "@/components/ds/Collapse";
import { Reveal } from "@/components/ds/Reveal";
import { Velaris } from "@/components/ds/Velaris";
import { askThesisStep } from "@/lib/funds/thesis-chat.functions";
import { THESIS_STEPS } from "@/lib/funds/thesis-steps";
import { ASK_HINTS, ASK_PLACEHOLDERS, SUGGESTION_QUESTIONS } from "@/lib/funds/thesis-wizard";
import { useT, useLanguage } from "@/lib/i18n/useT";
import { PRESS } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { userMessage } from "@/lib/errors/user-message";

export interface ChatMessage {
  role: "user" | "ai";
  text: string;
}

const chatKey = (fundId: string, step: string) => `interlect.thesisChat.${fundId}.${step}`;

export function readChat(fundId: string, step: string): ChatMessage[] {
  try {
    const raw = window.sessionStorage.getItem(chatKey(fundId, step));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ChatMessage =>
          !!item &&
          typeof item === "object" &&
          ((item as ChatMessage).role === "user" || (item as ChatMessage).role === "ai") &&
          typeof (item as ChatMessage).text === "string",
      )
      .slice(-20);
  } catch {
    return [];
  }
}

function writeChat(fundId: string, step: string, messages: ChatMessage[]) {
  try {
    if (messages.length === 0) window.sessionStorage.removeItem(chatKey(fundId, step));
    else window.sessionStorage.setItem(chatKey(fundId, step), JSON.stringify(messages.slice(-20)));
  } catch {
    // Uden sessionStorage virker samtalen stadig, den huskes bare ikke.
  }
}

/** Samtalen for ét trin; deles af "Få hjælp"-boksen og specialisttrinnets forslagsfelt. */
export function useStepChat(
  fundId: string | null,
  stepIndex: number,
  context: () => Record<string, string>,
) {
  const t = useT();
  const language = useLanguage();
  const ask = useServerFn(askThesisStep);
  const step = THESIS_STEPS[stepIndex]!;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(0);

  // Hent samtalen for trinnet med det samme (ikke i en effekt), så en samtale aldrig vises ét
  // billede på det forkerte trin, og drop et svar, der kommer efter, man er gået videre.
  const key = `${fundId ?? ""}:${step}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (loadedKey !== key) {
    setLoadedKey(key);
    live.current += 1;
    setMessages(fundId ? readChat(fundId, step) : []);
    setPending(false);
    setError(null);
  }

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!fundId || text.length < 2) return;
      const ticket = live.current;
      const withQuestion: ChatMessage[] = [...messages, { role: "user", text }];
      setMessages(withQuestion);
      writeChat(fundId, step, withQuestion);
      setPending(true);
      setError(null);
      try {
        const result = await ask({ data: { fundId, step, question: text, context: context() } });
        if (live.current !== ticket) return;
        const next: ChatMessage[] = [...withQuestion, { role: "ai", text: result.answer }];
        setMessages(next);
        writeChat(fundId, step, next);
      } catch (cause) {
        if (live.current !== ticket) return;
        setError(userMessage(cause, t("thesis.ask.failed"), language));
      } finally {
        if (live.current === ticket) setPending(false);
      }
    },
    [ask, context, fundId, messages, step, t],
  );

  const clear = useCallback(() => {
    live.current += 1;
    setMessages([]);
    setPending(false);
    setError(null);
    if (fundId) writeChat(fundId, step, []);
  }, [fundId, step]);

  return { messages, pending, error, send, clear };
}

export type StepChat = ReturnType<typeof useStepChat>;

export function ChatThread({ chat, stepIndex }: { chat: StepChat; stepIndex: number }) {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const open = chat.messages.length > 0 || chat.pending || !!chat.error;
  return (
    <Collapse open={open}>
      <div className="flex flex-col gap-3 px-0.5 py-1" aria-live="polite">
        {chat.messages.map((message, index) => {
          const ai = message.role === "ai";
          const key = `${stepIndex}-${index}`;
          return (
            <motion.div
              key={key + message.text.length}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24 }}
              className={cn("flex", ai ? "justify-start" : "justify-end")}
            >
              <div
                className={cn(
                  "flex max-w-[88%] flex-col gap-2.5 rounded-[18px] px-4 py-3.5",
                  ai ? "bg-surface shadow-card" : "bg-sunken",
                )}
              >
                {ai && (
                  <span className="flex items-center gap-[7px] text-micro font-semibold text-ai-ink">
                    <InterlectMark size={10} />
                    Interlect
                  </span>
                )}
                <span className="whitespace-pre-line text-[15px] leading-[1.6] text-ink-1">
                  {message.text}
                </span>
                {ai && (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(message.text).catch(() => undefined);
                      setCopied(key);
                      window.clearTimeout(timer.current);
                      timer.current = window.setTimeout(() => setCopied(null), 1600);
                    }}
                    className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 self-start whitespace-nowrap rounded-pill border-0 bg-canvas px-[11px] text-meta font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink-1"
                  >
                    {copied === key ? (
                      <Check className="size-3 text-positive" aria-hidden />
                    ) : (
                      <Copy className="size-3 text-ink-3" aria-hidden />
                    )}
                    {copied === key ? t("thesis.ask.copied") : t("thesis.ask.copy")}
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
        {chat.pending && (
          <span className="flex items-center px-1 py-1.5 text-[14px] text-ink-3">
            <PendingLabel tone="ai">{t("thesis.ask.thinking")}</PendingLabel>
          </span>
        )}
        {chat.error && (
          <p role="alert" className="px-1 text-list text-critical">
            {chat.error}
          </p>
        )}
        {chat.messages.length > 0 && !chat.pending && (
          <button
            type="button"
            onClick={chat.clear}
            className="h-[30px] cursor-pointer self-start whitespace-nowrap rounded-pill border-0 bg-transparent px-2.5 text-meta font-medium text-ink-4 transition-colors hover:bg-hover hover:text-ink-2"
          >
            {t("thesis.ask.clear")}
          </button>
        )}
      </div>
    </Collapse>
  );
}

export function StepAsk({
  chat,
  stepIndex,
  disabledReason,
}: {
  chat: StepChat;
  stepIndex: number;
  /** Hvorfor hjælpen ikke kan bruges (fx ingen fond at spørge på vegne af). */
  disabledReason?: string | null;
}) {
  const t = useT();
  const [question, setQuestion] = useState("");
  useEffect(() => setQuestion(""), [stepIndex]);
  const disabled = !!disabledReason || chat.pending;
  const submit = () => {
    if (disabled || question.trim().length < 2) return;
    const text = question;
    setQuestion("");
    void chat.send(text);
  };
  const ready = question.trim().length >= 2 && !disabled;
  return (
    <>
      <Reveal delay={0.04}>
        <section
          aria-label={t("thesis.ask.sectionLabel")}
          className="relative isolate flex flex-col gap-3.5 overflow-hidden rounded-xl bg-canvas px-[22px] pb-[18px] pt-[22px]"
        >
          <Velaris className="absolute inset-0 -z-10" />
          <div className="flex shrink-0 items-center gap-2.5">
            <InterlectMark size={16} />
            <span className="shrink-0 whitespace-nowrap text-[17px] font-semibold tracking-[-0.01em]">
              {t("thesis.ask.sectionLabel")}
            </span>
          </div>
          <div className="flex shrink-0 flex-col gap-2.5 rounded-[18px] bg-surface py-3.5 pl-4 pr-3.5 pb-2.5 shadow-raised">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              maxLength={2000}
              aria-label={t("thesis.ask.questionLabel")}
              placeholder={ASK_PLACEHOLDERS[stepIndex] ? t(ASK_PLACEHOLDERS[stepIndex]) : ""}
              disabled={!!disabledReason}
              className="border-0 bg-transparent text-base text-ink-1 outline-none placeholder:text-ink-4"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const question = SUGGESTION_QUESTIONS[stepIndex];
                  if (question) void chat.send(t(question));
                }}
                className="inline-flex h-8 cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-pill border-0 bg-canvas px-3 text-meta font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles className="size-3 text-ai" aria-hidden />
                {t("thesis.ask.suggest")}
              </button>
              <span className="text-meta text-ink-4">
                {disabledReason ?? (ASK_HINTS[stepIndex] ? t(ASK_HINTS[stepIndex]) : undefined)}
              </span>
              <div className="flex-1" />
              <motion.button
                type="button"
                aria-label={t("thesis.ask.send")}
                disabled={!ready}
                onClick={submit}
                whileTap={PRESS.whileTap}
                transition={PRESS.transition}
                className="grid size-[34px] cursor-pointer place-items-center rounded-full border-0 text-ink-inverse transition-colors duration-200 disabled:cursor-default"
                style={{ background: ready ? "var(--bg-inverse)" : "var(--ink-4)" }}
              >
                <ArrowUp className="size-4" aria-hidden />
              </motion.button>
            </div>
          </div>
        </section>
      </Reveal>
      {/* Samtalen står altid i flowet (som i prototypen), så afstanden over og under er den samme. */}
      <div>
        <ChatThread chat={chat} stepIndex={stepIndex} />
      </div>
    </>
  );
}
