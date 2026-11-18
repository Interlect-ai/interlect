/** Danish texts for the thesis group: "Ny investeringstese" (`/fond/ny`). */
export const thesis = {
  title: "Ny investeringstese",
  loading: "Henter jeres opsætning …",
  loadFailed: "Jeres investeringsteser kunne ikke hentes. Genindlæs siden.",
  adminOnly: "Kun en Admin kan oprette en ny investeringstese.",
  closePage: "Luk siden",
  previousStep: "Til forrige trin",
  back: "Tilbage",
  next: "Næste",
  publish: "Udgiv opsætning",
  published: "Udgivet",
  stepsNav: "Trin",
  stepDone: "Færdig",
  stepActive: "I gang",
  stepOf: "Trin {n} af {total}",
  helpNeedsFund: "Hjælpen kræver et oprettet team.",
  draftNameMissing: "Skriv et navn til teamet i trin 1, før I laver en egen specialist.",
  draftFailed: "Kladden kunne ikke oprettes. Prøv igen om lidt.",
  setupFailed: "Opsætningen kunne ikke oprettes. Prøv igen om lidt.",
  setupFailedDraft:
    '{base} Teamet er oprettet som kladde; tryk "Udgiv opsætning" igen for at prøve forfra.',
  setup: {
    title: "Interlect sætter jeres investeringstese op",
    body: "Vi omsætter jeres svar til kriterier, gates og instrukser til specialisterne. Bagefter kan I gennemgå det hele og rette, når I vil.",
    pending: "Opretter opsætningen",
    step1: "Oversætter tesen til kriterier",
    step2: "Bygger gates ud fra jeres mandat",
    step3: "Klargør screeningskort",
    step4: "Instruerer specialisterne",
    step5: "Kalibrerer mod eksempelcases",
  },
  done: {
    title: "Opsætningen er klar",
    body: "Opsætningen er udgivet som v1. Nye cases screenes mod den fra nu af. I kan altid redigere den i teamopsætningen.",
    open: "Gå til teamopsætning",
  },
  area: {
    who: {
      title: "Hvem er I?",
      sub: "Det hjælper Interlect med at foreslå de rigtige standarder.",
    },
    basis: { title: "Grundlag", sub: "Rammerne for, hvad I investerer i." },
    thesis: {
      title: "Tese og risiko",
      sub: "Jeres tese med egne ord og hvor meget risiko I tager.",
    },
    weights: { title: "Vægtning", sub: "Hvad der tæller mest, når en case scores." },
    mandate: { title: "Mandat", sub: "Grænser, der stopper en case eller kræver en vurdering." },
    specialists: { title: "Specialister", sub: "Eksperterne, der laver den dybe analyse." },
    review: {
      title: "Gennemse og udgiv",
      sub: "Tjek det hele, før opsætningen tages i brug.",
    },
  },
  askHint: {
    who: "Interlect foreslår en type ud fra jeres navn",
    frames: "Interlect foreslår rammer, der passer til jeres type",
    thesis: "Interlect skriver et udkast til tesen ud fra jeres svar",
    weights: "Interlect foreslår vægte ud fra det, I leder efter",
    mandate: "Interlect laver gates ud fra jeres grundlag og nej-liste",
    specialists: "Interlect foreslår specialister ud fra jeres sektorer",
  },
  askPlaceholder: {
    who: "Skriv hvem I er, fx vi er tre founders, der investerer egne penge",
    frames: "Skriv jeres rammer, fx seed i Norden, 1–3 mio. pr. selskab",
    thesis: "Skriv et par ord om jeres tese, så skriver Interlect den",
    weights: "Skriv hvad der betyder mest, så vægter Interlect",
    mandate: "Skriv hvad I aldrig investerer i",
    specialists: "Skriv hvilken ekspertise I mangler",
  },
  suggestQuestion: {
    who: "Giv mig et forslag til, hvilken type investor vi er, ud fra det, vi har skrevet.",
    frames: "Giv mig et forslag til rammerne: faser, geografi, sektorer og ticket.",
    thesis: "Skriv et udkast til vores investeringstese ud fra det, vi har udfyldt.",
    weights: "Giv mig et forslag til, hvad der bør vægte mest, når en case scores.",
    mandate: "Giv mig et forslag til gates: hvad bør stoppe en case, og hvad kræver en vurdering?",
    specialists: "Giv mig et forslag til, hvilken ekspertise vi bør have ekstra fokus på.",
  },
  ask: {
    sectionLabel: "Få hjælp af Interlect",
    questionLabel: "Spørg Interlect",
    suggest: "Giv mig et forslag",
    send: "Send",
    thinking: "Interlect tænker",
    copy: "Kopiér",
    copied: "Kopieret",
    clear: "Ryd samtalen",
    failed: "Interlect kunne ikke svare. Prøv igen om lidt.",
  },
  investor: {
    venture: {
      label: "Venturekapital",
      description: "Investerer LP’ernes penge i tidlige selskaber",
    },
    corporate: { label: "Corporate venture", description: "Investeringsenhed i en virksomhed" },
    family: { label: "Family office", description: "Investerer en families formue" },
    angels: { label: "Business angels", description: "Netværk eller gruppe af privatinvestorer" },
    other: { label: "Andet", description: "Beskriv jer med egne ord" },
  },
  phase: {
    preSeed: "Pre-seed",
    seed: "Seed",
    seriesA: "Serie A",
    seriesB: "Serie B",
    growth: "Growth",
  },
  geography: {
    denmark: "Danmark",
    nordics: "Norden",
    europe: "Europa",
    global: "Globalt",
  },
  sector: {
    climate: "Klima",
    food: "Fødevarer",
    software: "Software",
    health: "Sundhed",
    industry: "Industri",
    fintech: "Fintech",
  },
  ticketPreset: {
    k100: "100.000",
    k500: "500.000",
    m1: "1 mio.",
    m5: "5 mio.",
    m10: "10 mio.",
  },
  risk: {
    veryCautious: "Meget forsigtig",
    cautious: "Forsigtig",
    balanced: "Balanceret",
    bold: "Modig",
    veryBold: "Meget modig",
  },
  summary: {
    noName: "Uden navn",
    otherType: "Andet",
    notFilled: "Ikke udfyldt endnu",
    noThesis: "Ingen tese endnu",
    gates: "{n} gates",
    specialistOne: "{n} specialist",
    specialistMany: "{n} specialister",
    ownOne: "(heraf {n} egen)",
    ownMany: "(heraf {n} egne)",
  },
  problems: {
    name: "Giv jeres team et navn i trin 1.",
    phase: "Vælg mindst én fase i trin 2.",
    geography: "Vælg mindst én geografi i trin 2.",
    sector: "Vælg mindst én sektor i trin 2.",
    thesis: "Skriv jeres tese i trin 3.",
    gate: "Tilføj mindst én gate i trin 5.",
    ticket: "Ticketens startbeløb må ikke være større end slutbeløbet (trin 2).",
  },
  who: {
    name: "Navn",
    namePlaceholder: "Fx Nordhav Ventures III",
    otherLabel: "Beskriv jer med egne ord",
  },
  frames: {
    phases: "Faser",
    geography: "Geografi",
    geographyAdd: "Andet land eller region",
    sectors: "Sektorer",
    sectorAdd: "Tilføj sektor",
    ticket: "Ticket pr. selskab",
    from: "Fra",
    to: "Til",
    amountLabel: "{label}, kr.",
    currency: "kr.",
    scaleZero: "0 kr.",
    scaleMid: "25 mio. kr.",
    scaleMax: "50 mio. kr.",
  },
  thesisStep: {
    label: "Investeringstese",
    placeholder: "Skriv jeres tese med egne ord, eller få et udkast af Interlect ovenfor.",
    risk: "Risikovillighed",
    low: "Forsigtig",
    high: "Modig",
  },
  weights: {
    criteria: "kriterier",
    intro:
      "Træk i et kriterie, så fordeles resten, så summen altid er 100 %. Klik på et kriterie for at beskrive, hvad Interlect skal kigge efter. Det bliver grundlaget for research og scoring.",
    describePrompt: "Beskriv hvad Interlect skal kigge efter",
    weightFor: "Vægt for {label}",
    remove: "Fjern {label}",
    lookFor: "Hvad skal Interlect kigge efter?",
    lookForAbout: "Hvad skal Interlect kigge efter ved {label}?",
    lookForPlaceholder:
      "Fx hvor dokumenteret selskabets CO₂-reduktion er, og om den er verificeret af tredjepart",
    described: "Klar. Interlect researcher og scorer kriteriet ud fra beskrivelsen.",
    notDescribed: "Skriv en sætning eller to, så Interlect ved, hvad der skal findes og vurderes.",
    add: "Tilføj kriterie",
    addPlaceholder: "Tilføj kriterie, fx Bæredygtighed",
  },
  mandate: {
    binding: "Bindende",
    review: "Vurdering",
    remove: "Fjern {label}",
    add: "Tilføj gate",
    addPlaceholder: "Tilføj gate, fx Ingen gambling",
  },
  specialistsStep: {
    toggle: "Specialist: {label}",
    createTitle: "Lav jeres egen specialist",
    createBody:
      "Beskriv eksperten, I mangler. Interlect skriver udkastet og tjekker det, mens I retter det.",
    preparing: "Gør klar …",
    create: "Lav specialist",
    suggestLabel: "Foreslå en specialist",
    suggestPlaceholder: "Foreslå en specialist, fx en der kender fødevareregulering",
    send: "Send",
    noteDraft:
      'Jeres valg gemmes i kladden og udgives sammen med resten, når I trykker "Udgiv opsætning".',
    noteNoDraft:
      'Jeres valg gemmes i opsætningen, når I udgiver. Vil I lave en egen specialist, gør Interlect teamet klar som kladde først; intet udgives før "Udgiv opsætning".',
  },
  review: {
    edit: "Ret",
    editRow: "Ret {title}",
  },
  /** Texts Ny investeringstese saves in the new fund's setup, in the language of the page. */
  defaults: {
    criteria: {
      team: {
        label: "Team",
        description:
          "Founderens indsigt i markedet, tidligere resultater og om teamet dækker de vigtigste roller.",
      },
      marked: {
        label: "Marked",
        description: "Markedets størrelse, vækst og hvor stort et udfald det kan give.",
      },
      produkt: {
        label: "Produkt",
        description:
          "Hvor stærkt problemet er, og om kunderne viser tidlige tegn på at ville have løsningen.",
      },
      traction: {
        label: "Traction",
        description: "Betalende kunder, vækst og validering i forhold til fasen.",
      },
      timing: { label: "Timing", description: "Hvorfor netop nu er det rigtige tidspunkt." },
      teknologi: {
        label: "Teknologi",
        description: "Teknisk forspring og hvor svært det er at kopiere.",
      },
      deal: {
        label: "Deal og vilkår",
        description: "Værdiansættelse, ejerandel og mulighed for exit.",
      },
    },
    risk: {
      veryCautious:
        "Meget forsigtig: kun selskaber med dokumenteret traction og lav teknologisk risiko. Ukendt evidens sænker sikkerheden i scoren og kræver gennemgang.",
      cautious:
        "Forsigtig: vi accepterer begrænset risiko og forventer tydelige valideringssignaler. Ukendt evidens sænker sikkerheden i scoren.",
      balanced:
        "Balanceret: vi accepterer moderat risiko, når potentialet står mål med den. Ukendt evidens er usikkerhed, ikke et afslag.",
      bold: "Modig: vi accepterer høj teknologisk og markedsmæssig risiko, når potentialet er stort. Ukendt evidens er usikkerhed, ikke et afslag.",
      veryBold:
        "Meget modig: vi investerer tidligt og accepterer meget høj risiko for et stort udfald. Ukendt evidens er usikkerhed, ikke et afslag.",
    },
    gates: {
      geography_fit:
        "Selskabets hovedsæde eller primære investeringsjurisdiktion skal ligge inden for den valgte geografi. Mangler der evidens, er reglen ukendt, ikke brudt.",
      stage_fit:
        "Virksomhedens reelle modenhed og aktuelle runde skal ligge inden for de valgte stadier. Mangler der evidens, er reglen ukendt, ikke brudt.",
      ticket_fit:
        "Det forventede initiale ticket og den mulige ejerandel skal kunne rummes inden for mandatet. Mangler der evidens, er reglen ukendt, ikke brudt.",
    },
    autoGeography: "Hjemme i {list}",
    autoStage: "Fase: {list}",
    autoTicket: "Ticket {min}–{max} kr.",
    customReview:
      "Et menneske skal vurdere: {label}. Mangler der evidens, er reglen ukendt, ikke brudt.",
    customHard:
      "Bindende regel fra opsætningen: {label}. Mangler der evidens, er reglen ukendt, ikke brudt.",
    gateFallback: "Gate",
    criterionFallback: "Vurder selskabet på {label}.",
  },
} as const;
