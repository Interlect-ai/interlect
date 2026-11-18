/** Danish texts for the shared components (chat thread, composer, file list, sheet, hideable sections, Brain cards). */
export const shared = {
  /** BrainAnswer (ChatThread). */
  answer: {
    working: "Brain arbejder",
    sources: "Kilder",
    copy: "Kopiér",
    copied: "Kopieret",
    copyFailed: "Svaret kunne ikke kopieres",
    saveNote: "Gem som note",
    savedNote: "Gemt som note",
    saveNoteLabel: "Gem som note på casen",
    saveToBrain: "Gem i Brain",
    savedToBrain: "Gemt i Brain",
    saveToBrainLabel: "Gem svaret i Brain, så det bliver en del af teamets hukommelse",
    good: "Godt svar",
    notRight: "Ikke rigtigt",
    retry: "Svar igen",
    feedbackUp: "Brain husker, at svar som dette hjælper jer",
    feedbackDown: "Tak. Brain bruger det til at svare bedre næste gang",
  },
  /** ChatThread and ChatComposer. */
  chat: {
    placeholderCase: "Skriv til teamet, @ for at nævne",
    placeholderPanel: "Skriv til teamet",
    placeholderAsk: "Spørg Interlect",
    label: "Skriv en besked",
    send: "Send",
    messages: "Beskeder",
    conversation: "Samtale",
    you: "Dig",
    unknown: "Ukendt",
    edited: ", redigeret",
    deleted: "Beskeden er slettet",
    /** An earlier day: "23. sep, 09:12". */
    dateTime: "{day}. {month}, {time}",
  },
  /** AiComposer. */
  composer: {
    attachCase: "Vedhæft pitch deck",
    attachFund: "Vedhæft LPA, PPM eller tese",
    attachBrain: "Vedhæft",
    dictate: "Diktér",
    stopDictation: "Stop diktering",
    stopAnswer: "Stop svaret",
    send: "Send",
  },
  /** FileList. */
  files: {
    filter: {
      alle: "Alle",
      pdf: "PDF",
      xlsx: "Regneark",
      docx: "Dokumenter",
    },
    empty: {
      alle: "Ingen filer på casen endnu",
      pdf: "Ingen PDF’er på casen endnu",
      xlsx: "Ingen regneark på casen endnu",
      docx: "Ingen dokumenter på casen endnu",
    },
    noMatch: 'Ingen filer matcher "{query}"',
    today: "i dag",
    yesterday: "i går",
    /** "23. sep" this year, "23. sep 2025" otherwise. */
    date: "{day}. {month}",
    dateYear: "{day}. {month} {year}",
    uploadTitle: "Tilføj filer til casen",
    uploadHint: "Træk filer hertil, eller klik for at vælge",
    search: "Søg i filer",
    clearSearch: "Ryd søgning",
    filterLabel: "Filtrér efter type",
    download: "Hent",
    downloadName: "Hent {name}",
  },
  /** MandatfitCircles (title, passed and missing come from `screening.mandate`). */
  mandate: {
    breach: "Brud",
  },
  /** Hideable and HiddenSectionsBar. */
  hideable: {
    hide: "Skjul {label}",
    saveFailed: "Dit visningsvalg kunne ikke gemmes. Prøv igen.",
    hidden: "Skjult: {labels}",
    showAgain: "Vis igen",
  },
} as const;
