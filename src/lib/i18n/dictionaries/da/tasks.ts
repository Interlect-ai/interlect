/** Danish texts for the case tasks (TaskRow, TaskList, TaskComposer, GateAnswerEditor, task-types). */
export const tasks = {
  /** task-types.ts: the composer's "Type" list (prototype TYPES). */
  kind: {
    task: "Opgave",
    question: "Spørgsmål til selskabet",
    verification: "Verificering",
    document: "Dokument",
    research: "Research",
    meeting: "Møde",
  },
  /** Interlect's line in the "Ansvarlig" lists when the page gives none. */
  interlectDescription: "Søger selv i offentlige kilder",
  /** Tasks linked to nothing. */
  unlinked: "Generelt",
  /** The composer's default "Frist" list and the due label ("Fre. 2. okt"). */
  due: {
    none: "Ingen frist",
    today: "I dag",
    tomorrow: "I morgen",
    nextWeek: "Næste uge",
    format: "{weekday} {day}. {month}",
  },
  /** A gate answer: the requirement is met or not. */
  gateMet: "Opfyldt",
  gateNotMet: "Ikke opfyldt",
  /** Shared labels. */
  me: "Dig",
  type: "Type",
  assignee: "Ansvarlig",
  dueLabel: "Frist",
  none: "Ingen",
  titleLabel: "Opgavens titel",
  answer: "Svar",
  save: "Gem",
  cancel: "Annullér",
  close: "Luk",
  selected: "(valgt)",
  fileReady: "{name}, klar til at gemme",
  foundPlaceholder: "Skriv det, du har fundet ud af",
  /** TaskRow. */
  row: {
    aiWorking:
      'Interlect arbejder på det. Svaret kommer i Beskeder, og du kan altid overtage opgaven via "…".',
    orbLabel: "Interlect arbejder",
    resolved: "Afklaret",
    fromDeep: "Fra dyb analyse",
    fill: "Udfyld",
    moreActions: "Flere handlinger for {title}",
    rename: "Redigér opgave",
    reassign: "Skift ansvarlig",
    delete: "Slet opgave",
    deleted: "Opgave slettet",
    linkedTo: "Knyttet til",
    noDescription: "Ingen beskrivelse endnu.",
    why: "Hvorfor",
    replaceFile: "Erstat {name}",
    chooseFile: "Vælg fil eller træk den hertil",
    saveAnswer: "Gem svar",
    edit: "Redigér",
    editAria: "Redigér: {title}",
  },
  /** TaskList. */
  list: {
    title: "Skal afklares",
    newTask: "Ny opgave",
    showTop: "Vis de vigtigste",
    showAll: "Vis alle {count}",
    solved: "{count} løst",
  },
  /** TaskComposer. */
  composer: {
    descriptionPlaceholder: "Beskriv hvad der skal gøres, og hvorfor det er vigtigt for casen",
    descriptionLabel: "Beskrivelse",
    linkTo: "Knyt til",
    standalone: "Opgaven står alene",
    linkGate: "Knyttes til en gate",
    linkCriterion: "Kriterie",
    create: "Opret opgave",
  },
  /** GateAnswerEditor. */
  gate: {
    question: "Er kravet opfyldt?",
    overrideNote:
      "Kravet er vurderet som ikke opfyldt. Et Opfyldt tilsidesætter vurderingen og skrives i revisionsloggen. Skriv hvorfor.",
    blockedNote:
      "Kravet er vurderet som ikke opfyldt. Kun en Admin eller Lead kan tilsidesætte det.",
    reasonPlaceholder: "Begrundelse for at tilsidesætte kravet",
    reasonLabel: "Begrundelse",
    foundLabel: "Det, du har fundet ud af",
    attach: "Vedhæft en fil (valgfrit)",
    savedNote: "Gemmes som oplyst af dig og indgår straks i scoren. Kan redigeres bagefter.",
    saveRecalc: "Gem og genberegn",
  },
} as const;
