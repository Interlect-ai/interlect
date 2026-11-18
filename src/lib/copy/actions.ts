/**
 * The shared action vocabulary ("Handlingsnavne"): the same
 * words in the Cases list, the bulk bar, the case's split button, confirmation dialogs
 * and toasts. Use these constants; never write an action name by hand.
 *
 * Labels, descriptions, icons and colours are taken verbatim from the prototypes
 * (Cases v4, CaseStatus, Overblik v2). The reason chips are the prototype's defaults
 * until reason codes come from the database (brain_reason_codes).
 */
import {
  CircleCheck,
  CirclePause,
  CirclePlay,
  CircleX,
  Gavel,
  ScanSearch,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type CaseActionKey =
  | "runScreening"
  | "rerunScreening"
  | "backToScreening"
  | "runDeepAnalysis"
  | "rerunDeepAnalysis"
  | "sendToCommittee"
  | "hold"
  | "resume"
  | "reopen"
  | "markInvested"
  | "close";

/** Signal colours as token names (styles.css), never hex. */
export interface ActionTone {
  color: "action" | "ai" | "warning" | "positive" | "ink-3";
  wash: "action-wash" | "ai-wash" | "warning-wash" | "positive-wash" | "bg-sunken";
}

export interface ConfirmCopy {
  /** Dialog title, e.g. "Hvorfor sættes casen på hold?". */
  question: string;
  /** Confirm button. */
  confirm: string;
  /** Default reason chips (multi-select). */
  reasons: readonly string[];
  /** Placeholder for the free-text note. */
  notePlaceholder: string;
}

export interface CaseAction {
  key: CaseActionKey;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: ActionTone;
  /** Status changes ask for reasons and a note ("Case-status"). */
  confirm?: ConfirmCopy;
}

const TONE = {
  action: { color: "action", wash: "action-wash" },
  ai: { color: "ai", wash: "ai-wash" },
  warning: { color: "warning", wash: "warning-wash" },
  positive: { color: "positive", wash: "positive-wash" },
  quiet: { color: "ink-3", wash: "bg-sunken" },
} as const satisfies Record<string, ActionTone>;

/** Shared descriptions ("Handlingsnavne"). */
export const ACTION_DESCRIPTIONS = {
  staysInPhase: "Bliver i fasen, kan genoptages",
  activeAgain: "Casen bliver aktiv igen",
  movesToDecided: "Flyttes til Besluttet",
} as const;

export const CASE_ACTIONS = {
  // A case that was never screened (no prototype text: the vocabulary only has "igen").
  runScreening: {
    key: "runScreening",
    label: "Kør screening",
    description: "Screenes mod tesen",
    icon: ScanSearch,
    tone: TONE.action,
  },
  rerunScreening: {
    key: "rerunScreening",
    label: "Kør screening igen",
    description: "Med nye data eller en ny tese",
    icon: ScanSearch,
    tone: TONE.action,
  },
  backToScreening: {
    key: "backToScreening",
    label: "Tilbage til screening",
    description: "Screenes igen mod tesen",
    icon: ScanSearch,
    tone: TONE.action,
  },
  runDeepAnalysis: {
    key: "runDeepAnalysis",
    label: "Kør dyb analyse",
    // The number of specialists comes from the fund's setup: see specialistsDescription().
    description: "Specialisterne går i dybden",
    icon: Sparkles,
    tone: TONE.ai,
  },
  rerunDeepAnalysis: {
    key: "rerunDeepAnalysis",
    label: "Kør dyb analyse igen",
    description: "Specialisterne går i dybden",
    icon: Sparkles,
    tone: TONE.ai,
  },
  sendToCommittee: {
    key: "sendToCommittee",
    label: "Send til komité",
    description: "Klar til beslutning",
    icon: Gavel,
    tone: TONE.warning,
    // The committee step also asks why (no prototype dialog; same pattern).
    confirm: {
      question: "Hvorfor sendes casen til komité?",
      confirm: "Send til komité",
      reasons: [],
      notePlaceholder: "Fx: Stærkt team og tydelig traction",
    },
  },
  hold: {
    key: "hold",
    label: "Sæt på hold",
    description: ACTION_DESCRIPTIONS.staysInPhase,
    icon: CirclePause,
    tone: TONE.warning,
    confirm: {
      question: "Hvorfor sættes casen på hold?",
      confirm: "Sæt på hold",
      reasons: ["Venter på data", "Timing", "Kapacitet i teamet", "Selskabet har bedt om pause"],
      notePlaceholder: "Fx: Vi venter på licensstatus i Norge",
    },
  },
  resume: {
    key: "resume",
    label: "Genoptag",
    description: ACTION_DESCRIPTIONS.activeAgain,
    icon: CirclePlay,
    tone: TONE.positive,
    confirm: {
      question: "Hvorfor genoptages casen?",
      confirm: "Genoptag",
      reasons: ["Nye oplysninger", "Ny runde", "Ændret tese"],
      notePlaceholder: "Hvad har ændret sig?",
    },
  },
  reopen: {
    key: "reopen",
    label: "Genåbn",
    description: ACTION_DESCRIPTIONS.activeAgain,
    icon: CirclePlay,
    tone: TONE.positive,
    confirm: {
      question: "Hvorfor genåbnes casen?",
      confirm: "Genåbn",
      reasons: ["Nye oplysninger", "Ny runde", "Ændret tese"],
      notePlaceholder: "Hvad har ændret sig?",
    },
  },
  markInvested: {
    key: "markInvested",
    label: "Marker som investeret",
    description: ACTION_DESCRIPTIONS.movesToDecided,
    icon: CircleCheck,
    tone: TONE.positive,
    confirm: {
      question: "Hvad var afgørende for investeringen?",
      confirm: "Marker som investeret",
      reasons: ["Team", "Teknologi", "Traction", "Marked", "Pris"],
      notePlaceholder: "Fx: Stærkt team og bekræftet unit economics",
    },
  },
  close: {
    key: "close",
    label: "Luk casen",
    description: ACTION_DESCRIPTIONS.movesToDecided,
    icon: CircleX,
    tone: TONE.quiet,
    confirm: {
      question: "Hvorfor lukkes casen?",
      confirm: "Luk casen",
      reasons: ["Uden for mandatet", "Team", "Marked", "Pris", "Timing", "Konkurrence"],
      notePlaceholder: "Beskriv kort hvorfor I siger nej",
    },
  },
} as const satisfies Record<CaseActionKey, CaseAction>;

/** Group headings in the split button's menu ("Handlinger v2"). */
export const ACTION_GROUPS = {
  phase: "Fase",
  status: "Status",
  decision: "Beslutning",
  /** Replaces "Fase" when the case is decided. */
  reopen: "Genåbn",
} as const;

/** Variants of phase actions when the case is decided (the menu under "Genåbn"). */
export const REOPEN_IN = {
  screening: "Genåbn i screening",
  deepAnalysis: "Genåbn i dyb analyse",
} as const;

/** Reopen items for a decided case: a move only, no new run (see gap §5). */
export const REOPEN_DESCRIPTION = ACTION_DESCRIPTIONS.activeAgain;

/** "Tilbage til screening" moves the case; "Kør screening igen" is the paid run. */
export const BACK_TO_SCREENING_DESCRIPTION = "Flyttes til Screening";

/** Toasts after an action (Cases v4): the company's name, or "N cases". */
export function actionToast(
  action:
    | "screen"
    | "deep"
    | "committee"
    | "hold"
    | "resume"
    | "reopen"
    | "close"
    | "invest"
    | "backToScreening",
  subject: string,
): string {
  switch (action) {
    case "screen":
      return `${subject} screenes igen`;
    case "deep":
      return `${subject} er sendt til dyb analyse`;
    case "committee":
      return `${subject} er sendt til komité`;
    case "hold":
      return `${subject} er sat på hold`;
    case "resume":
      return `${subject} er genoptaget`;
    case "reopen":
      return `${subject} er genåbnet`;
    case "close":
      return `${subject} er lukket`;
    case "invest":
      return `${subject} er markeret som investeret`;
    case "backToScreening":
      return `${subject} er flyttet til screening`;
  }
}

/** The current phase shown greyed out with a check in the menu (committee). */
export const IN_COMMITTEE = { label: "I komité", description: "Afventer beslutning" } as const;

export const ACTION_COPY = {
  recommended: "Anbefalet",
  cancel: "Annullér",
  undo: "Fortryd",
  /** Under the reason dialog's title. */
  reasonHint: "Årsagen gemmes i casens historik og bruges af Brain.",
  /** Nudge under the next step when an active case has waited ≥ 7 days. */
  noActionForDays: (days: number) => `Ingen handling i ${days} dage`,
} as const;

const DANISH_COUNT = ["", "En", "To", "Tre", "Fire", "Fem", "Seks", "Syv", "Otte", "Ni", "Ti"];

/**
 * "Fem specialister går i dybden" with the fund's own number of specialists
 * (locked decision 11: the count comes from the fund's setup, never a fixed five).
 */
export function specialistsDescription(count: number): string {
  if (!Number.isInteger(count) || count < 1) return CASE_ACTIONS.runDeepAnalysis.description;
  if (count === 1) return "Én specialist går i dybden";
  const word = DANISH_COUNT[count] ?? String(count);
  return `${word} specialister går i dybden`;
}
