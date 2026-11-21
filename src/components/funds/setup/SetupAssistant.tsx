/**
 * The Interlect-Assistent in Teamopsætning, ported from the prototype
 * `Teamopsaetning v3.dc.html` ("Interlect-Assistant: chatvindue", `askBtn`, `askRow`, `aibox`,
 * `propHtml`, `msgHtml`, `emptyHtml`, `positionChat`).
 *
 * - One conversation for the page, only for the session: it lives in this provider's state, so it
 *   survives closing the window and switching places, and is gone when the page is left. "Ny
 *   samtale" (+) empties it ("Kun for sessionen … 'Ny chat'").
 * - Each "Interlect-Assistant" pill opens the same conversation with that field as context; the
 *   header says where the person is ("Du er i: …").
 * - An answer can carry ONE proposed change, shown as Før/Efter with "Ja, ændr" / "Nej tak".
 *   Nothing changes without a Ja; after a Ja, "Fortryd" puts back exactly what was changed
 *   (setup-assistant-apply.ts). The change lands in the editor's draft like any other edit.
 * - The AI boxes ("Tilpas med Interlect" on the criteria, "Fortæl Interlect, hvad der skal
 *   ændres" on a specialist) do as in the prototype: the change is made at once, with a line
 *   that says what changed and a "Fortryd".
 *
 * The window floats bottom right (440 px, radius 26); with a sheet open it stands next to the
 * sheet when there is room. Over a sheet it is its own modal layer (the sheet is a Radix modal
 * dialog that would otherwise take its focus and clicks); opening a sheet closes it (the
 * conversation stays).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useReducedMotion } from "motion/react";
import { ArrowUp, Check, Pencil, Plus, X } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { Button, IconButton } from "@/components/ds/Button";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import { stageText } from "@/lib/funds/basis-labels";
import {
  economyPointQuestion,
  economyPointUnit,
  economyPoint,
  type EconomyPointKey,
} from "@/lib/funds/economy-points";
import {
  ASSISTANT_MAX_MESSAGES,
  ASSISTANT_MESSAGE_MAX_CHARS,
  targetText,
  type AssistantChange,
  type AssistantMessage,
  type AssistantPlace,
  type AssistantReply,
  type AssistantSheet,
  type AssistantSnapshot,
} from "@/lib/funds/setup-assistant";
import { askSetupAssistant } from "@/lib/funds/setup-assistant.functions";
import {
  applyChange,
  applyFocusChange,
  isFocusChange,
  type ApplyContext,
} from "@/lib/funds/setup-assistant-apply";
import { criteriaOf, economyOf, gatesOf, stageTabs } from "@/lib/funds/stage-editor";
import type { SpecialistFocus } from "@/lib/funds/stage-specialists";
import { userMessage } from "@/lib/errors/user-message";
import type { Language } from "@/lib/i18n/language";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

type EditorState = SaveFundConfigInput;
type T = ReturnType<typeof useT>;

/** The open specialist sheet: its name and its focus areas as edited (not yet saved). */
export interface AssistantSpecSheet {
  name: string;
  foci: () => SpecialistFocus[];
  setFoci: (next: SpecialistFocus[]) => void;
}

interface SheetInfo {
  sheet: AssistantSheet;
  spec?: AssistantSpecSheet;
}

type ProposalStatus = "open" | "applied" | "undone" | "stale" | "declined";

/** Where a change belongs: the stage, and for a focus area the specialist it was made for. */
type MakeContext = ApplyContext & { spec?: string | undefined };

interface Proposal {
  change: AssistantChange;
  before: string;
  after: string;
  note: string;
  status: ProposalStatus;
  context: MakeContext;
  undo?: () => boolean;
}

type ChatMessage =
  | { id: number; role: "user"; text: string }
  | {
      id: number;
      role: "assistant";
      phase: "think" | "type" | "done";
      text: string;
      shown: number;
      proposal: Proposal | null;
      failed?: boolean;
    };

interface AssistantApi {
  /** The page is held (a proposal applying, a draft run, an out-of-date draft): nothing writes. */
  locked: boolean;
  openFor: (field: string) => void;
  isOpenFor: (field: string) => boolean;
  setSheet: (info: SheetInfo | null) => void;
  /** The AI boxes: ask once and make the change at once. */
  runBox: (field: string, text: string) => Promise<BoxResult>;
}

export type BoxResult =
  { kind: "changed"; notice: string; undo: () => boolean } | { kind: "answer"; text: string };

const AssistantContext = createContext<AssistantApi | null>(null);

/** Sent when the assistant has added a criterion (the criteria list opens it). */
export const CRITERION_ADDED_EVENT = "setup-assistant:criterion-added";

/** The assistant of the page, or null where there is none (Member and Reader). */
export function useSetupAssistant(): AssistantApi | null {
  return useContext(AssistantContext);
}

/** A sheet tells the assistant it is open (and, for a specialist, how to reach its focus areas). */
export function useAssistantSheet(info: SheetInfo | null) {
  const api = useSetupAssistant();
  const key = info ? `${info.sheet}:${info.spec?.name ?? ""}` : "";
  const latest = useRef(info);
  latest.current = info;
  useEffect(() => {
    if (!api || !key) return;
    api.setSheet(latest.current);
    return () => api.setSheet(null);
    // The key decides; `api` is stable for the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// ---------------------------------------------------------------------------
// Fields: their names and texts
// ---------------------------------------------------------------------------

/**
 * The fields the pills sit by (prototype `chatLabel`): "gen" (the page), "thesis", "crit:<key>",
 * "rule:<key>", "finown", "instr", "fm:<n>" (a focus area of the open specialist), and the AI
 * boxes "box:crit" and "box:spec".
 */
function fieldLabel(
  field: string,
  value: EditorState,
  stage: SetupStage | null,
  spec: AssistantSpecSheet | undefined,
  t: T,
): string {
  const [kind, ...rest] = field.split(":");
  const id = rest.join(":");
  if (kind === "thesis") return t("fundSetup.assistant.field.thesis");
  if (kind === "finown") return t("fundSetup.assistant.field.finown");
  if (kind === "instr") return t("fundSetup.assistant.field.instr");
  if (kind === "crit" && stage) {
    const criterion = criteriaOf(value, stage).find((entry) => entry.key === id);
    return criterion ? t("fundSetup.assistant.field.criterion", { name: criterion.label }) : "";
  }
  if (kind === "rule") {
    const rules = stage ? gatesOf(value, stage) : value.gates.filter((gate) => !gate.stage);
    const rule = rules.find((entry) => entry.key === id);
    return rule ? t("fundSetup.assistant.field.rule", { name: rule.label }) : "";
  }
  if (kind === "fm" && spec) {
    return t("fundSetup.assistant.field.focus", { name: spec.name });
  }
  if (field === "box:crit") return t("fundSetup.assistant.field.boxCrit");
  if (field === "box:spec" && spec) {
    return t("fundSetup.assistant.field.boxSpec", { name: spec.name });
  }
  return "";
}

/** The text target a field's text lives in (setup-assistant.ts `targetText`). */
function fieldTarget(field: string): string | null {
  const [kind, ...rest] = field.split(":");
  const id = rest.join(":");
  if (kind === "thesis") return "thesis";
  if (kind === "instr") return "expectation";
  if (kind === "crit") return `criterion:${id}`;
  if (kind === "rule") return `rule:${id}`;
  if (kind === "fm") return `focus:${id}`;
  return null;
}

function ticketText(value: EditorState, localeTag: string): string {
  const { ticketMinEur: min, ticketMaxEur: max } = value;
  const fmt = (n: number) => n.toLocaleString(localeTag);
  if (min !== null && max !== null)
    return `${fmt(Math.min(min, max))} – ${fmt(Math.max(min, max))} EUR`;
  if (min !== null) return `${fmt(min)} EUR`;
  if (max !== null) return `${fmt(max)} EUR`;
  return "";
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** What the page shows right now, for the stage on screen (the request's `snapshot`). */
function buildSnapshot(input: {
  value: EditorState;
  place: AssistantPlace;
  sheet: SheetInfo | null;
  stage: SetupStage | null;
  rawStage: string | undefined;
  field: string;
  t: T;
  language: Language;
  localeTag: string;
}): AssistantSnapshot {
  const { value, stage, rawStage, sheet, field, t, language } = input;
  const spec = sheet?.spec;
  const criteria = stage ? criteriaOf(value, stage) : [];
  const rules = stage ? gatesOf(value, stage) : value.gates.filter((gate) => !gate.stage);
  const economy = stage ? economyOf(value, stage) : null;
  const foci = spec ? spec.foci() : [];
  const base: AssistantSnapshot = {
    place: input.place,
    sheet: sheet?.sheet ?? null,
    stage,
    stageLabel: clip(rawStage ? stageText(rawStage, language) : "", 80),
    field: null,
    teamName: clip(value.fundName, 160),
    thesis: clip(value.thesis, 5000),
    about: clip(value.setup?.about ?? "", 3000),
    stages: value.stages.slice(0, 20).map((entry) => clip(stageText(entry, language), 80)),
    geographies: value.geographies.slice(0, 40).map((entry) => clip(entry, 120)),
    sectors: value.sectors.slice(0, 40).map((entry) => clip(entry, 120)),
    ticket: clip(ticketText(value, input.localeTag), 200),
    criteria: criteria.slice(0, 20).map((criterion) => ({
      key: clip(criterion.key, 80),
      label: clip(criterion.label, 160),
      weight: Math.min(100, Math.max(0, criterion.weight)),
      description: clip(criterion.description, 1000),
    })),
    rules: rules.slice(0, 50).map((rule) => ({
      key: clip(rule.key, 80),
      label: clip(rule.label, 160),
      treatment: rule.treatment,
      description: clip(rule.description, 1000),
      shared: !rule.stage,
    })),
    economy: economy
      ? economy.points.map((point) => ({
          key: point.key,
          label: clip(economyPointQuestion(point.key, language), 300),
          on: point.on,
          limit: point.limit ? point.limit.value : null,
          unit: clip(economyPointUnit(point.key, language), 30),
        }))
      : [],
    questions: economy ? economy.questions.map((question) => clip(question.text, 300)) : [],
    expectation: rawStage ? clip(value.stageExpectations[rawStage] ?? "", 2000) : null,
    specialist: spec
      ? {
          name: clip(spec.name, 80),
          foci: foci
            .slice(0, 12)
            .map((focus) => ({ title: clip(focus.title, 60), text: clip(focus.text, 320) })),
        }
      : null,
  };
  const label = fieldLabel(field, value, stage, spec, t);
  if (field === "gen" || !label) return base;
  const target = fieldTarget(field);
  const text = target ? (targetText(base, target) ?? "") : "";
  return {
    ...base,
    field: { key: clip(field, 120), label: clip(label, 200), text: clip(text, 5000) },
  };
}

/** The Før/Efter rows and the note under an applied change (prototype `prop*`). */
function describeChange(
  change: AssistantChange,
  snapshot: AssistantSnapshot,
  t: T,
  language: Language,
): { before: string; after: string; note: string } {
  const empty = t("fundSetup.assistant.prop.empty");
  const or = (text: string) => text.trim() || empty;
  switch (change.kind) {
    case "text": {
      const now = targetText(snapshot, change.target) ?? "";
      const focus = change.target.startsWith("focus:");
      const field = focus
        ? t("fundSetup.assistant.field.focus", { name: snapshot.specialist?.name ?? "" })
        : change.target === "thesis"
          ? t("fundSetup.assistant.field.thesis")
          : change.target === "about"
            ? t("fundSetup.frame.about")
            : change.target === "expectation"
              ? t("fundSetup.assistant.field.instr")
              : change.target.startsWith("criterion:")
                ? t("fundSetup.screen.lookFor")
                : t("fundSetup.screen.mustMeet");
      return {
        before: or(now),
        after: change.text,
        note: focus
          ? t("fundSetup.assistant.prop.noteFocus")
          : t("fundSetup.assistant.prop.noteField", { field }),
      };
    }
    case "add_criterion": {
      const count = snapshot.criteria.length;
      return {
        before: t("fundSetup.assistant.prop.criteria", { count }),
        after: t("fundSetup.assistant.prop.criteriaWith", { count: count + 1, name: change.label }),
        note: t("fundSetup.assistant.prop.noteCriteria"),
      };
    }
    case "add_rule": {
      const count = snapshot.rules.length;
      return {
        before: t("fundSetup.assistant.prop.rules", { count }),
        after: `${t("fundSetup.assistant.prop.rulesWith", { count: count + 1, name: change.label })}\n${change.description}`,
        note: t("fundSetup.assistant.prop.noteRule"),
      };
    }
    case "rule_treatment": {
      const rule = snapshot.rules.find((entry) => entry.key === change.ruleKey);
      const word = (treatment: "hard" | "review") =>
        treatment === "hard"
          ? t("fundSetup.assistant.prop.binding")
          : t("fundSetup.assistant.prop.review");
      const name = rule?.label ?? change.ruleKey;
      return {
        before: t("fundSetup.assistant.prop.treatment", {
          name,
          treatment: word(rule?.treatment ?? "review"),
        }),
        after: t("fundSetup.assistant.prop.treatment", { name, treatment: word(change.treatment) }),
        note: t("fundSetup.assistant.prop.noteMandate"),
      };
    }
    case "economy_on": {
      const name = (key: EconomyPointKey) => economyPointQuestion(key, language);
      const was = change.on ? "off" : "on";
      const now = change.on ? "on" : "off";
      return {
        before: change.points
          .map((key) => t(`fundSetup.assistant.prop.${was}`, { name: name(key) }))
          .join("\n"),
        after: change.points
          .map((key) => t(`fundSetup.assistant.prop.${now}`, { name: name(key) }))
          .join("\n"),
        note: t("fundSetup.assistant.prop.noteEconomy"),
      };
    }
    case "economy_limit": {
      const entry = snapshot.economy.find((point) => point.key === change.point);
      const name = economyPointQuestion(change.point, language);
      const unit = economyPointUnit(change.point, language);
      const before = entry?.limit ?? economyPoint(change.point).limit?.value ?? change.value;
      return {
        before: t("fundSetup.assistant.prop.limit", { name, value: before, unit }),
        after: t("fundSetup.assistant.prop.limit", { name, value: change.value, unit }),
        note: t("fundSetup.assistant.prop.noteEconomy"),
      };
    }
    case "add_questions":
      return {
        before: snapshot.questions.length
          ? snapshot.questions.join("\n")
          : t("fundSetup.assistant.prop.noQuestions"),
        after: [...snapshot.questions, ...change.questions.map((question) => question.text)].join(
          "\n",
        ),
        note: t("fundSetup.assistant.prop.noteQuestions"),
      };
    case "add_focus": {
      const count = snapshot.specialist?.foci.length ?? 0;
      return {
        before: t("fundSetup.assistant.prop.foci", { count }),
        after: t("fundSetup.assistant.prop.fociWith", { count: count + 1, name: change.title }),
        note: t("fundSetup.assistant.prop.noteFocus"),
      };
    }
  }
}

/** The field's element (to flash it after a Ja, prototype `flashField`). */
function fieldElement(change: AssistantChange, stage: SetupStage | null): HTMLElement | null {
  if (change.kind !== "text") return null;
  const target = change.target;
  if (target === "thesis") return document.getElementById("thesis-frame-thesis");
  if (target === "about") return document.getElementById("thesis-frame-about");
  if (target === "expectation" && stage) return document.getElementById(`expect-${stage}`);
  if (target.startsWith("criterion:") && stage) {
    return document.getElementById(`crit-${stage}-${target.slice("criterion:".length)}`);
  }
  if (target.startsWith("rule:")) {
    const key = target.slice("rule:".length);
    return (
      document.getElementById(`rule-${stage ?? "all"}-${key}`) ??
      document.getElementById(`rule-all-${key}`)
    );
  }
  return null;
}

function flash(element: HTMLElement | null) {
  if (!element) return;
  element.classList.remove("setup-assistant-flash");
  void element.offsetWidth;
  element.classList.add("setup-assistant-flash");
  try {
    element.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch {
    // an old browser without options
  }
}

/** The context a change is made in (also the specialist and focus area it was proposed for). */
function contextOf(
  change: AssistantChange,
  snapshot: AssistantSnapshot,
  rawStage: string | undefined,
): MakeContext {
  const focusIndex =
    change.kind === "text" && change.target.startsWith("focus:")
      ? Number(change.target.slice("focus:".length))
      : null;
  return {
    stage: snapshot.stage,
    rawStage,
    spec: snapshot.specialist?.name,
    focusTitle: focusIndex === null ? undefined : snapshot.specialist?.foci[focusIndex]?.title,
  };
}

/** What an AI box may change: the criteria box its criteria, a specialist's box its focus areas. */
function boxAllows(sheet: "crit" | "spec", change: AssistantChange): boolean {
  if (sheet === "crit") {
    return (
      change.kind === "add_criterion" ||
      (change.kind === "text" && change.target.startsWith("criterion:"))
    );
  }
  return isFocusChange(change);
}

// ---------------------------------------------------------------------------
// The provider: one conversation for the page
// ---------------------------------------------------------------------------

export function SetupAssistantProvider({
  fundId,
  latest,
  onChange,
  place,
  stage: shownStage,
  locked,
  children,
}: {
  fundId: string;
  /** The shell holds the page (applying, drafting, out of date): Ja, Fortryd and the boxes wait. */
  locked: boolean;
  /** The editor's state now (a ref, so a Ja or a Fortryd works on the newest state). */
  latest: MutableRefObject<EditorState>;
  /** The shell's change (starts the draft when there is none). */
  onChange: (value: EditorState) => void;
  place: AssistantPlace;
  /** The stage the shell shows (null = the first chosen stage). */
  stage: SetupStage | null;
  children: ReactNode;
}) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const reduced = useReducedMotion();
  const ask = useServerFn(askSetupAssistant);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState("gen");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheetState] = useState<SheetInfo | null>(null);
  const sheetRef = useRef<SheetInfo | null>(null);
  const token = useRef(0);
  const nextId = useRef(1);
  const timer = useRef<number | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const tabs = stageTabs(latest.current.stages);
  const current = tabs.find((tab) => tab.stage === shownStage) ?? tabs[0];
  const stage = current?.stage ?? null;
  const rawStage = current?.raw;
  const live = useRef({ place, stage, rawStage, field });
  live.current = { place, stage, rawStage, field };

  const snapshotFor = useCallback(
    (forField: string) =>
      buildSnapshot({
        value: latest.current,
        place: live.current.place,
        sheet: sheetRef.current,
        stage: live.current.stage,
        rawStage: live.current.rawStage,
        field: forField,
        t,
        language,
        localeTag,
      }),
    [latest, t, language, localeTag],
  );

  const stopTyping = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };
  /** Ends a running answer (prototype `finishStream`): what has come stays, shown in full. */
  const finish = useCallback(() => {
    token.current += 1;
    stopTyping();
    setBusy(false);
    setMessages((list) =>
      list.map((message) =>
        message.role === "assistant" && message.phase !== "done"
          ? message.phase === "think"
            ? { ...message, phase: "done", failed: true, text: t("fundSetup.assistant.stopped") }
            : { ...message, phase: "done", shown: message.text.length }
          : message,
      ),
    );
  }, [t]);
  useEffect(() => () => stopTyping(), []);

  const close = useCallback(() => {
    finish();
    setOpen(false);
  }, [finish]);

  const setSheet = useCallback(
    (info: SheetInfo | null) => {
      const opened = info !== null && sheetRef.current === null;
      sheetRef.current = info;
      setSheetState(info);
      // A sheet that opens takes the page: the window closes (the conversation stays).
      if (opened && openRef.current) close();
    },
    [close],
  );

  const openFor = useCallback((next: string) => {
    if (openRef.current && live.current.field === next) {
      setOpen(false);
      return;
    }
    setField(next);
    setOpen(true);
  }, []);

  const proposalFor = useCallback(
    (
      change: AssistantChange,
      snapshot: AssistantSnapshot,
      rawStage: string | undefined,
    ): Proposal => ({
      change,
      ...describeChange(change, snapshot, t, language),
      status: "open",
      context: contextOf(change, snapshot, rawStage),
    }),
    [t, language],
  );
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  /** Makes a change (after a Ja, or from an AI box); gives its undo, or null when it no longer fits. */
  const make = useCallback(
    (change: AssistantChange, context: MakeContext): (() => boolean) | null => {
      if (isFocusChange(change)) {
        const spec = sheetRef.current?.spec;
        // Only on the specialist the proposal was made for.
        if (!spec || (context.spec !== undefined && spec.name !== context.spec)) return null;
        const applied = applyFocusChange(spec.foci(), change, context.focusTitle);
        if (!applied) return null;
        spec.setFoci(applied.next);
        return () => {
          const now = sheetRef.current?.spec;
          if (now !== spec) return false;
          const back = applied.undo(spec.foci());
          if (!back) return false;
          spec.setFoci(back);
          return true;
        };
      }
      const applied = applyChange(latest.current, change, context);
      if (!applied) return null;
      onChange(applied.next);
      window.setTimeout(() => flash(fieldElement(change, context.stage)), 60);
      if (change.kind === "add_criterion" && applied.createdKey && context.stage) {
        // Prototype `aiApply`: the new criterion opens, with its description in focus.
        window.dispatchEvent(
          new CustomEvent(CRITERION_ADDED_EVENT, {
            detail: { stage: context.stage, key: applied.createdKey },
          }),
        );
      }
      return () => {
        const back = applied.undo(latest.current);
        if (!back) return false;
        onChange(back);
        return true;
      };
    },
    [latest, onChange],
  );

  const setProposal = (id: number, patch: Partial<Proposal>) =>
    setMessages((list) =>
      list.map((message) =>
        message.id === id && message.role === "assistant" && message.proposal
          ? { ...message, proposal: { ...message.proposal, ...patch } }
          : message,
      ),
    );

  const act = useCallback(
    (id: number, what: "yes" | "no" | "undo") => {
      const message = messages.find((entry) => entry.id === id);
      if (!message || message.role !== "assistant" || !message.proposal) return;
      if (lockedRef.current && what !== "no") return;
      const proposal = message.proposal;
      if (what === "yes" && proposal.status === "open") {
        const undo = make(proposal.change, proposal.context);
        setProposal(id, undo ? { status: "applied", undo } : { status: "stale" });
      } else if (what === "no" && proposal.status === "open") {
        setProposal(id, { status: "declined" });
      } else if (what === "undo" && proposal.status === "applied" && proposal.undo) {
        setProposal(id, { status: proposal.undo() ? "undone" : "stale" });
      }
    },
    [messages, make],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, ASSISTANT_MESSAGE_MAX_CHARS);
      if (!text || busy) return;
      const history = messages
        .flatMap((message): AssistantMessage[] =>
          message.role === "user"
            ? [{ role: "user" as const, text: message.text }]
            : message.phase === "done" && !message.failed && message.text.trim()
              ? [
                  {
                    role: "assistant" as const,
                    text: clip(message.text, ASSISTANT_MESSAGE_MAX_CHARS),
                  },
                ]
              : [],
        )
        .concat({ role: "user", text } satisfies AssistantMessage)
        .slice(-ASSISTANT_MAX_MESSAGES);
      const userId = nextId.current++;
      const answerId = nextId.current++;
      setMessages((list) => [
        ...list,
        { id: userId, role: "user", text },
        { id: answerId, role: "assistant", phase: "think", text: "", shown: 0, proposal: null },
      ]);
      setInput("");
      setBusy(true);
      const mine = ++token.current;
      // Read where the person is now, before the wait (a stage tab may change meanwhile).
      const rawStage = live.current.rawStage;
      const snapshot = snapshotFor(live.current.field);
      let reply: AssistantReply | null = null;
      let failure: string | null = null;
      try {
        reply = await ask({ data: { fundId, messages: history, snapshot } });
      } catch (cause) {
        failure = userMessage(cause, t("fundSetup.assistant.failed"), language);
      }
      if (token.current !== mine) return;
      const proposal = reply?.change ? proposalFor(reply.change, snapshot, rawStage) : null;
      const answer = reply?.answer ?? failure ?? t("fundSetup.assistant.failed");
      const done = (patch: Partial<Extract<ChatMessage, { role: "assistant" }>>) =>
        setMessages((list) =>
          list.map((message) =>
            message.id === answerId && message.role === "assistant"
              ? { ...message, ...patch }
              : message,
          ),
        );
      if (reduced || !reply) {
        done({ phase: "done", text: answer, shown: answer.length, proposal, failed: !reply });
        setBusy(false);
        return;
      }
      // The prototype writes the answer out (4 characters every 22 ms) before the proposal shows.
      done({ phase: "type", text: answer, shown: 0, proposal });
      let shown = 0;
      stopTyping();
      timer.current = window.setInterval(() => {
        if (token.current !== mine) {
          stopTyping();
          return;
        }
        shown = Math.min(answer.length, shown + 4);
        const end = shown >= answer.length;
        done(end ? { phase: "done", shown } : { shown });
        if (end) {
          stopTyping();
          setBusy(false);
        }
      }, 22);
    },
    [ask, busy, fundId, language, messages, proposalFor, reduced, snapshotFor, t],
  );

  const runBox = useCallback(
    async (boxField: string, raw: string): Promise<BoxResult> => {
      const text = raw.trim().slice(0, ASSISTANT_MESSAGE_MAX_CHARS);
      const rawStage = live.current.rawStage;
      const sheetKey = boxField === "box:crit" ? "crit" : "spec";
      const snapshot = snapshotFor(boxField);
      const reply = await ask({
        data: { fundId, messages: [{ role: "user", text }], snapshot },
      });
      // A box only changes what it is about (its sheet's criteria or focus areas), and only while
      // that sheet is still open and the page is not held; anything else stays words.
      const fits =
        reply.change !== null &&
        boxAllows(sheetKey, reply.change) &&
        sheetRef.current?.sheet === sheetKey &&
        !lockedRef.current;
      if (reply.change && fits) {
        const undo = make(reply.change, contextOf(reply.change, snapshot, rawStage));
        if (undo) {
          const change = reply.change;
          const notice =
            change.kind === "add_criterion"
              ? t("fundSetup.assistant.box.changedCriterion", { name: change.label })
              : change.kind === "add_focus"
                ? t("fundSetup.assistant.box.changedFocus", { name: change.title })
                : change.kind === "text" && change.target.startsWith("focus:")
                  ? t("fundSetup.assistant.box.changedFocusText", {
                      name: snapshot.specialist?.foci[Number(change.target.slice(6))]?.title ?? "",
                    })
                  : t("fundSetup.assistant.box.changed");
          return { kind: "changed", notice, undo };
        }
      }
      return { kind: "answer", text: reply.answer || t("fundSetup.assistant.failed") };
    },
    [ask, fundId, make, snapshotFor, t],
  );

  const api = useMemo<AssistantApi>(
    () => ({
      locked,
      openFor,
      isOpenFor: (key) => open && field === key,
      setSheet,
      runBox,
    }),
    [locked, openFor, open, field, setSheet, runBox],
  );

  const newChat = () => {
    finish();
    setMessages([]);
    setInput("");
  };

  const where = [
    sheet?.sheet === "spec"
      ? `${t("fundSetup.assistant.sheets.spec")}${sheet.spec?.name ? ` · ${sheet.spec.name}` : ""}`
      : sheet
        ? t(`fundSetup.assistant.sheets.${sheet.sheet}`)
        : t(`fundSetup.assistant.places.${place}`),
    (place === "screening" || place === "analysis") && rawStage
      ? stageText(rawStage, language)
      : "",
    field !== "gen" ? fieldLabel(field, latest.current, stage, sheet?.spec, t) : "",
  ]
    .filter(Boolean)
    .join(", ");
  const greet = t(`fundSetup.assistant.greet.${sheet?.sheet ?? place}`);

  return (
    <AssistantContext.Provider value={api}>
      {children}
      {open && (
        <ChatWindow
          locked={locked}
          overSheet={sheet !== null}
          where={t("fundSetup.assistant.where", { where })}
          greet={greet}
          messages={messages}
          input={input}
          busy={busy}
          onInput={setInput}
          onSend={() => void send(input)}
          onStop={finish}
          onNewChat={newChat}
          onClose={close}
          onAct={act}
        />
      )}
    </AssistantContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// The pill and the row by a field
// ---------------------------------------------------------------------------

/** Prototype `askBtn`: the "Interlect-Assistant" pill by a field (or by the page title). */
export function AskButton({ field, className }: { field: string; className?: string }) {
  const api = useSetupAssistant();
  const t = useT();
  if (!api) return null;
  const expanded = api.isOpenFor(field);
  return (
    <button
      type="button"
      aria-expanded={expanded}
      data-browse
      data-assistant-field={field}
      onClick={() => api.openFor(field)}
      className={cn(
        "inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-[7px] rounded-pill border-0 bg-surface py-0 pr-[13px] pl-2.5 font-[inherit] text-[12px] font-medium text-ink-1 shadow-pill outline-none transition-[background,transform] duration-200 hover:bg-canvas focus-visible:ring-2 focus-visible:ring-action active:scale-[.97]",
        expanded && "shadow-[0_0_0_1.5px_var(--ink-1)]",
        className,
      )}
    >
      <InterlectMark size={13} />
      {t("fundSetup.assistant.button")}
    </button>
  );
}

/** The pill by the page title (prototype `pagehead`), drawn into FundPageHeader's slot. */
export function PageAskButton() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("fund-page-actions")), []);
  return slot ? createPortal(<AskButton field="gen" />, slot) : null;
}

/** Prototype `askRow`: a hint on the left (optional) and the pill on the right. */
export function AskRow({ field, hint }: { field: string; hint?: ReactNode }) {
  const api = useSetupAssistant();
  if (!api) return hint ? <span className="text-meta text-ink-3">{hint}</span> : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <span className="min-w-0 text-meta text-ink-3">{hint}</span>
      <AskButton field={field} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The AI box (prototype `aibox`)
// ---------------------------------------------------------------------------

export function AiBox({
  field,
  title,
  placeholder,
}: {
  field: "box:crit" | "box:spec";
  title: string;
  placeholder: string;
}) {
  const api = useSetupAssistant();
  const t = useT();
  const language = useLanguage();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { kind: "changed"; notice: string; undo: () => boolean } | { kind: "line"; text: string } | null
  >(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }, [text]);
  if (!api) return null;
  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const outcome = await api.runBox(field, value);
      if (outcome.kind === "changed") {
        setText("");
        setResult({ kind: "changed", notice: outcome.notice, undo: outcome.undo });
      } else {
        setResult({ kind: "line", text: outcome.text });
      }
    } catch (cause) {
      setResult({
        kind: "line",
        text: userMessage(cause, t("fundSetup.assistant.failed"), language),
      });
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="setup-aibox flex flex-col gap-3 rounded-[24px] p-[22px]">
        <div className="flex items-center gap-[9px] text-[20px] font-semibold tracking-[-0.02em]">
          <InterlectMark size={18} />
          <span>{title}</span>
        </div>
        <div className="flex items-end gap-2.5 rounded-[18px] bg-surface py-2.5 pr-2.5 pl-[18px] shadow-[0_1px_3px_rgba(23,21,28,.08)] focus-within:shadow-[0_0_0_2px_var(--action)]">
          <textarea
            ref={area}
            rows={1}
            value={text}
            maxLength={ASSISTANT_MESSAGE_MAX_CHARS}
            placeholder={placeholder}
            aria-label={title}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-[120px] min-h-6 flex-1 resize-none border-0 bg-transparent py-1.5 font-[inherit] text-[14px] leading-[1.5] text-ink-1 outline-none placeholder:text-ink-4"
          />
          <button
            type="button"
            aria-label={busy ? t("fundSetup.assistant.box.working") : t("fundSetup.assistant.send")}
            disabled={busy || !text.trim() || api.locked}
            onClick={() => void submit()}
            className={cn(
              // Prototype `.send` (32 px, ink-4 with a white arrow); `.send.on` (ink) while busy.
              "grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border-0 transition-colors duration-200 disabled:cursor-default",
              busy ? "bg-inverse text-surface" : "bg-ink-4 text-surface",
            )}
          >
            {busy ? (
              <AiOrb size={20} tone="neutral" onDark />
            ) : (
              <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
            )}
          </button>
        </div>
      </div>
      {result?.kind === "changed" && (
        <div
          role="status"
          className="flex items-center justify-between gap-2.5 rounded-[12px] bg-ai-wash px-3.5 py-2.5 text-[12px] text-ai-ink"
        >
          <span>{result.notice}</span>
          <Button
            size="sm"
            variant="quiet"
            className="text-ai-ink"
            onClick={() =>
              setResult({
                kind: "line",
                text: result.undo()
                  ? t("fundSetup.assistant.box.undone")
                  : t("fundSetup.assistant.prop.stale"),
              })
            }
          >
            {t("fundSetup.assistant.prop.undo")}
          </Button>
        </div>
      )}
      {result?.kind === "line" && (
        <p role="status" className="m-0 text-list whitespace-pre-wrap text-ink-2">
          {result.text}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/** Prototype `positionChat`: next to an open sheet when there is room. */
function usePlacement(overSheet: boolean) {
  const [style, setStyle] = useState<{ right?: number; left?: number; width: number }>({
    right: 24,
    width: 440,
  });
  useLayoutEffect(() => {
    const place = () => {
      const sheet = document.querySelector<HTMLElement>("[data-sheet]");
      const vw = window.innerWidth;
      let right: number | undefined = 24;
      let left: number | undefined;
      let width = 440;
      if (overSheet && sheet) {
        const sw = sheet.getBoundingClientRect().width + 12;
        const room = vw - sw - 24;
        if (room >= 420) right = sw + 24;
        else if (room >= 300) {
          right = undefined;
          left = 24;
          width = Math.min(400, vw - sw - 48);
        } else width = 400;
      } else if (vw <= 1100) width = 400;
      width = Math.min(width, vw - (right ?? 0) - 16);
      setStyle(right !== undefined ? { right, width } : { left: left ?? 24, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [overSheet]);
  return style;
}

function ChatWindow({
  locked,
  overSheet,
  where,
  greet,
  messages,
  input,
  busy,
  onInput,
  onSend,
  onStop,
  onNewChat,
  onClose,
  onAct,
}: {
  locked: boolean;
  overSheet: boolean;
  where: string;
  greet: string;
  messages: ChatMessage[];
  input: string;
  busy: boolean;
  onInput: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onNewChat: () => void;
  onClose: () => void;
  onAct: (id: number, what: "yes" | "no" | "undo") => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const placement = usePlacement(overSheet);
  const area = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [announce, setAnnounce] = useState("");
  const wasBusy = useRef(busy);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [input]);
  useEffect(() => {
    if (!overSheet) area.current?.focus({ preventScroll: true });
  }, [overSheet]);
  // Follow the newest message while it is written, and say when the answer is there.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (wasBusy.current && !busy) setAnnounce(t("fundSetup.assistant.answered"));
    if (busy) setAnnounce("");
    wasBusy.current = busy;
  }, [busy, t]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!busy) onSend();
    }
  };
  const onRootKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!overSheet && event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  const titleText = t("fundSetup.assistant.title");
  const body = (
    <div
      role="dialog"
      aria-label={titleText}
      data-setup-assistant=""
      onKeyDown={onRootKey}
      className="fixed bottom-6 z-[97] flex h-[min(680px,calc(100vh-48px))] flex-col overflow-hidden rounded-[26px] bg-surface text-ink-1 shadow-overlay outline-none"
      style={{
        ...placement,
        animation: reduced ? undefined : "setup-assistant-in .28s cubic-bezier(.2,.8,.2,1)",
      }}
    >
      <header className="flex items-center gap-2.5 pt-3.5 pr-3 pb-2.5 pl-[18px]">
        <InterlectMark size={22} />
        <div className="flex min-w-0 flex-1 flex-col leading-[1.3]">
          {overSheet ? (
            <DialogPrimitive.Title className="m-0 text-[15px] font-semibold">
              {titleText}
            </DialogPrimitive.Title>
          ) : (
            <b className="text-[15px] font-semibold">{titleText}</b>
          )}
          <span className="truncate text-[12px] text-ink-3">{where}</span>
        </div>
        <IconButton
          icon={Plus}
          size={36}
          aria-label={t("fundSetup.assistant.newChat")}
          title={t("fundSetup.assistant.newChat")}
          onClick={onNewChat}
          className="size-[34px] bg-transparent shadow-none hover:bg-hover"
        />
        <IconButton
          icon={X}
          size={36}
          aria-label={t("fundSetup.assistant.close")}
          onClick={onClose}
          className="size-[34px] bg-transparent shadow-none hover:bg-hover"
        />
      </header>
      <div
        ref={list}
        role="log"
        aria-live="off"
        className="flex flex-1 flex-col gap-[22px] overflow-y-auto px-5 pt-2.5 pb-2"
      >
        {messages.length === 0 ? (
          <div className="my-auto flex flex-col items-center gap-2.5 px-2.5 pb-[30px] text-center">
            <span className="mb-1.5 grid size-14 place-items-center rounded-full bg-canvas">
              <InterlectMark size={30} />
            </span>
            <h2 className="m-0 text-[24px] font-semibold tracking-[-0.02em]">
              {t("fundSetup.assistant.emptyTitle")}
            </h2>
            <p className="m-0 max-w-[320px] text-[15px] leading-[1.55] text-ink-2">{greet}</p>
            <p className="m-0 max-w-[320px] text-[13px] text-ink-3">
              {t("fundSetup.assistant.emptyMeta")}
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <Message
              key={message.id}
              locked={locked}
              message={message}
              onAct={(id, what) => {
                onAct(id, what);
                // Prototype `renderChat(true)`: the composer has the focus again.
                area.current?.focus({ preventScroll: true });
              }}
            />
          ))
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
      <form
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onSend();
        }}
        className="mx-3.5 mt-2 mb-1.5 flex items-end gap-2 rounded-[24px] bg-sunken py-1.5 pr-1.5 pl-[18px] shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--ink-1)_70%,transparent)]"
      >
        <textarea
          ref={area}
          rows={1}
          value={input}
          maxLength={ASSISTANT_MESSAGE_MAX_CHARS}
          placeholder={t("fundSetup.assistant.placeholder")}
          aria-label={t("fundSetup.assistant.placeholder")}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={onKeyDown}
          className="max-h-[140px] min-w-0 flex-1 resize-none border-0 bg-transparent py-[9px] font-[inherit] text-[15px] leading-[1.5] text-ink-1 outline-none placeholder:text-ink-3"
        />
        {busy ? (
          <button
            type="button"
            aria-label={t("fundSetup.assistant.stop")}
            onClick={onStop}
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-inverse text-surface"
          >
            <i aria-hidden className="block size-3 rounded-[3px] bg-current" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label={t("fundSetup.assistant.send")}
            className={cn(
              "grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border-0 transition-colors duration-150",
              input.trim() ? "bg-inverse text-surface" : "bg-line-strong text-ink-3",
            )}
          >
            <ArrowUp className="size-[17px]" strokeWidth={2.2} aria-hidden />
          </button>
        )}
      </form>
      <p className="m-0 px-[18px] pb-3 text-center text-[11.5px] text-ink-3">
        {t("fundSetup.assistant.sessionNote")}
      </p>
    </div>
  );

  if (!overSheet) return typeof document === "undefined" ? null : createPortal(body, document.body);
  // Over a sheet: its own modal layer above the sheet (focus, clicks and scrolling stay here).
  return (
    <DialogPrimitive.Root open modal onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          asChild
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            area.current?.focus({ preventScroll: true });
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            onClose();
          }}
        >
          {body}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Message({
  locked,
  message,
  onAct,
}: {
  locked: boolean;
  message: ChatMessage;
  onAct: (id: number, what: "yes" | "no" | "undo") => void;
}) {
  const t = useT();
  if (message.role === "user") {
    return (
      <div className="max-w-[84%] self-end rounded-[20px_20px_6px_20px] bg-sunken px-[15px] py-2.5 text-[15px] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {message.text}
      </div>
    );
  }
  const typing = message.phase === "type" && message.shown < message.text.length;
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full",
          message.phase === "done" && "bg-canvas",
        )}
      >
        {message.phase === "think" ? (
          <AiOrb size={32} tone="ai" state="searching" />
        ) : message.phase === "type" ? (
          <AiOrb size={32} tone="ai" state="composing" />
        ) : (
          <InterlectMark size={16} />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        {message.phase === "think" ? (
          <span role="status" className="text-meta text-ink-3">
            {t("fundSetup.assistant.thinking")}
          </span>
        ) : (
          <p
            className={cn(
              "m-0 text-[15px] leading-[1.65] whitespace-pre-wrap",
              message.failed ? "text-ink-3" : "text-ink-1",
              typing && "setup-assistant-caret",
            )}
          >
            {message.phase === "done" ? message.text : message.text.slice(0, message.shown)}
          </p>
        )}
        {message.phase === "done" && message.proposal && (
          <ProposalCard
            locked={locked}
            proposal={message.proposal}
            onAct={(what) => onAct(message.id, what)}
          />
        )}
      </div>
    </div>
  );
}

function ProposalCard({
  locked,
  proposal,
  onAct,
}: {
  locked: boolean;
  proposal: Proposal;
  onAct: (what: "yes" | "no" | "undo") => void;
}) {
  const t = useT();
  const row = (label: string, text: string, isNew: boolean) => (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] items-start gap-2.5">
      <span className="pt-[3px] text-[11px] font-semibold tracking-[.05em] text-ink-3 uppercase">
        {label}
      </span>
      <p
        className={cn(
          "m-0 text-[14px] leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]",
          isNew
            ? "rounded-[12px] bg-surface px-[11px] py-2 text-ink-1 shadow-[inset_3px_0_0_var(--positive)]"
            : "text-ink-3",
        )}
      >
        {text}
      </p>
    </div>
  );
  return (
    <div className="flex flex-col gap-3 rounded-[18px] bg-canvas px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
        {t("fundSetup.assistant.prop.title")}
      </div>
      {row(t("fundSetup.assistant.prop.before"), proposal.before, false)}
      {row(t("fundSetup.assistant.prop.after"), proposal.after, true)}
      <div className="flex flex-wrap items-center gap-2">
        {proposal.status === "open" ? (
          <>
            <Button size="sm" variant="primary" disabled={locked} onClick={() => onAct("yes")}>
              {t("fundSetup.assistant.prop.yes")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onAct("no")}>
              {t("fundSetup.assistant.prop.no")}
            </Button>
          </>
        ) : proposal.status === "applied" ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-positive">
              <Check className="size-3.5" strokeWidth={2.6} aria-hidden />
              {t("fundSetup.assistant.prop.applied")}
            </span>
            <Button size="sm" variant="quiet" disabled={locked} onClick={() => onAct("undo")}>
              {t("fundSetup.assistant.prop.undo")}
            </Button>
          </>
        ) : (
          <span className="text-meta text-ink-3">
            {proposal.status === "undone"
              ? t("fundSetup.assistant.prop.undone")
              : proposal.status === "stale"
                ? t("fundSetup.assistant.prop.stale")
                : t("fundSetup.assistant.prop.declined")}
          </span>
        )}
      </div>
      {proposal.status === "applied" && proposal.note && (
        <span className="text-meta text-ink-3">{proposal.note}</span>
      )}
    </div>
  );
}
