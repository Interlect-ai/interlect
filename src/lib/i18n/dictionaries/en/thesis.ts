import type { Dictionary } from "../../translate";

/** English texts for the thesis group: "New investment thesis" (`/fond/ny`). */
export const thesis: Dictionary["thesis"] = {
  title: "New investment thesis",
  loading: "Loading your setup …",
  loadFailed: "Your investment theses could not be loaded. Reload the page.",
  adminOnly: "Only an Admin can create a new investment thesis.",
  closePage: "Close the page",
  previousStep: "To previous step",
  back: "Back",
  next: "Next",
  publish: "Publish setup",
  published: "Published",
  stepsNav: "Steps",
  stepDone: "Done",
  stepActive: "In progress",
  stepOf: "Step {n} of {total}",
  helpNeedsFund: "The help needs a team to be created first.",
  draftNameMissing: "Enter a name for your team in step 1 before you create your own specialist.",
  draftFailed: "The draft could not be created. Try again in a moment.",
  setupFailed: "The setup could not be created. Try again in a moment.",
  setupFailedDraft:
    '{base} The team has been created as a draft; press "Publish setup" again to start over.',
  setup: {
    title: "Interlect is setting up your investment thesis",
    body: "We turn your answers into criteria, gates and instructions for the specialists. Afterwards you can review everything and adjust it whenever you like.",
    pending: "Creating the setup",
    step1: "Translating the thesis into criteria",
    step2: "Building gates from your mandate",
    step3: "Preparing screening cards",
    step4: "Briefing the specialists",
    step5: "Calibrating against example cases",
  },
  done: {
    title: "The setup is ready",
    body: "The setup has been published as v1. New cases are screened against it from now on. You can always edit it in the team setup.",
    open: "Go to team setup",
  },
  area: {
    who: { title: "Who are you?", sub: "It helps Interlect suggest the right defaults." },
    basis: { title: "Basis", sub: "The framework for what you invest in." },
    thesis: {
      title: "Thesis and risk",
      sub: "Your thesis in your own words and how much risk you take.",
    },
    weights: { title: "Weighting", sub: "What counts most when a case is scored." },
    mandate: { title: "Mandate", sub: "Limits that stop a case or require a judgement." },
    specialists: { title: "Specialists", sub: "The experts who carry out the deep analysis." },
    review: {
      title: "Review and publish",
      sub: "Check everything before the setup is put into use.",
    },
  },
  askHint: {
    who: "Interlect suggests a type based on your name",
    frames: "Interlect suggests a framework that fits your type",
    thesis: "Interlect drafts the thesis from your answers",
    weights: "Interlect suggests weights based on what you look for",
    mandate: "Interlect builds gates from your basis and your no-list",
    specialists: "Interlect suggests specialists based on your sectors",
  },
  askPlaceholder: {
    who: "Write who you are, e.g. we are three founders investing our own money",
    frames: "Write your framework, e.g. seed in the Nordics, 1–3 m per company",
    thesis: "Write a few words about your thesis and Interlect will draft it",
    weights: "Write what matters most and Interlect will weight it",
    mandate: "Write what you never invest in",
    specialists: "Write which expertise you lack",
  },
  suggestQuestion: {
    who: "Suggest what type of investor we are, based on what we have written.",
    frames: "Suggest our framework: stages, geography, sectors and ticket.",
    thesis: "Write a draft of our investment thesis based on what we have filled in.",
    weights: "Suggest what should weigh most when a case is scored.",
    mandate: "Suggest gates: what should stop a case, and what needs an assessment?",
    specialists: "Suggest which expertise we should focus extra on.",
  },
  ask: {
    sectionLabel: "Get help from Interlect",
    questionLabel: "Ask Interlect",
    suggest: "Give me a suggestion",
    send: "Send",
    thinking: "Interlect is thinking",
    copy: "Copy",
    copied: "Copied",
    clear: "Clear the conversation",
    failed: "Interlect could not answer. Try again in a moment.",
  },
  investor: {
    venture: {
      label: "Venture capital",
      description: "Invests LPs’ money in early-stage companies",
    },
    corporate: { label: "Corporate venture", description: "An investment unit within a company" },
    family: { label: "Family office", description: "Invests a family’s wealth" },
    angels: { label: "Business angels", description: "A network or group of private investors" },
    other: { label: "Other", description: "Describe yourselves in your own words" },
  },
  phase: {
    preSeed: "Pre-seed",
    seed: "Seed",
    seriesA: "Series A",
    seriesB: "Series B",
    growth: "Growth",
  },
  geography: {
    denmark: "Denmark",
    nordics: "Nordics",
    europe: "Europe",
    global: "Global",
  },
  sector: {
    climate: "Climate",
    food: "Food",
    software: "Software",
    health: "Health",
    industry: "Industry",
    fintech: "Fintech",
  },
  ticketPreset: {
    k100: "100,000",
    k500: "500,000",
    m1: "1m",
    m5: "5m",
    m10: "10m",
  },
  risk: {
    veryCautious: "Very cautious",
    cautious: "Cautious",
    balanced: "Balanced",
    bold: "Bold",
    veryBold: "Very bold",
  },
  summary: {
    noName: "Unnamed",
    otherType: "Other",
    notFilled: "Not filled in yet",
    noThesis: "No thesis yet",
    gates: "Gates: {n}",
    specialistOne: "{n} specialist",
    specialistMany: "{n} specialists",
    ownOne: "({n} of them your own)",
    ownMany: "({n} of them your own)",
  },
  problems: {
    name: "Give your team a name in step 1.",
    phase: "Choose at least one stage in step 2.",
    geography: "Choose at least one geography in step 2.",
    sector: "Choose at least one sector in step 2.",
    thesis: "Write your thesis in step 3.",
    gate: "Add at least one gate in step 5.",
    ticket: "The ticket’s lower amount must not be larger than the upper amount (step 2).",
  },
  who: {
    name: "Name",
    namePlaceholder: "E.g. Nordhav Ventures III",
    otherLabel: "Describe yourselves in your own words",
  },
  frames: {
    phases: "Stages",
    geography: "Geography",
    geographyAdd: "Another country or region",
    sectors: "Sectors",
    sectorAdd: "Add sector",
    ticket: "Ticket per company",
    from: "From",
    to: "To",
    amountLabel: "{label}, DKK",
    currency: "DKK",
    scaleZero: "DKK 0",
    scaleMid: "DKK 25m",
    scaleMax: "DKK 50m",
  },
  thesisStep: {
    label: "Investment thesis",
    placeholder: "Write your thesis in your own words, or get a draft from Interlect above.",
    risk: "Risk appetite",
    low: "Cautious",
    high: "Bold",
  },
  weights: {
    criteria: "criteria",
    intro:
      "Drag a criterion and the rest are redistributed so the total is always 100 %. Click a criterion to describe what Interlect should look for. It becomes the basis for research and scoring.",
    describePrompt: "Describe what Interlect should look for",
    weightFor: "Weight for {label}",
    remove: "Remove {label}",
    lookFor: "What should Interlect look for?",
    lookForAbout: "What should Interlect look for in {label}?",
    lookForPlaceholder:
      "E.g. how well documented the company’s CO₂ reduction is, and whether it is verified by a third party",
    described: "Ready. Interlect researches and scores the criterion from the description.",
    notDescribed: "Write a sentence or two so Interlect knows what to find and assess.",
    add: "Add criterion",
    addPlaceholder: "Add criterion, e.g. Sustainability",
  },
  mandate: {
    binding: "Binding",
    review: "Review",
    remove: "Remove {label}",
    add: "Add gate",
    addPlaceholder: "Add gate, e.g. No gambling",
  },
  specialistsStep: {
    toggle: "Specialist: {label}",
    createTitle: "Create your own specialist",
    createBody:
      "Describe the expert you are missing. Interlect writes the draft and checks it while you edit it.",
    preparing: "Preparing …",
    create: "Create specialist",
    suggestLabel: "Suggest a specialist",
    suggestPlaceholder: "Suggest a specialist, e.g. one who knows food regulation",
    send: "Send",
    noteDraft:
      'Your choices are saved in the draft and published together with the rest when you press "Publish setup".',
    noteNoDraft:
      'Your choices are saved in the setup when you publish. If you want to create your own specialist, Interlect first prepares your team as a draft; nothing is published before "Publish setup".',
  },
  review: {
    edit: "Edit",
    editRow: "Edit {title}",
  },
  /** Texts Ny investeringstese saves in the new fund's setup, in the language of the page. */
  defaults: {
    criteria: {
      team: {
        label: "Team",
        description:
          "The founders' insight into the market, their track record and whether the team covers the key roles.",
      },
      marked: {
        label: "Market",
        description: "The size and growth of the market and how large an outcome it can give.",
      },
      produkt: {
        label: "Product",
        description:
          "How strong the problem is, and whether customers show early signs of wanting the solution.",
      },
      traction: {
        label: "Traction",
        description: "Paying customers, growth and validation relative to the stage.",
      },
      timing: { label: "Timing", description: "Why now is the right time." },
      teknologi: { label: "Technology", description: "Technical edge and how hard it is to copy." },
      deal: {
        label: "Deal and terms",
        description: "Valuation, ownership and the chance of an exit.",
      },
    },
    risk: {
      veryCautious:
        "Very cautious: only companies with documented traction and low technology risk. Unknown evidence lowers the confidence of the score and needs review.",
      cautious:
        "Cautious: we accept limited risk and expect clear signs of validation. Unknown evidence lowers the confidence of the score.",
      balanced:
        "Balanced: we accept moderate risk when the potential matches it. Unknown evidence is uncertainty, not a rejection.",
      bold: "Bold: we accept high technology and market risk when the potential is large. Unknown evidence is uncertainty, not a rejection.",
      veryBold:
        "Very bold: we invest early and accept very high risk for a large outcome. Unknown evidence is uncertainty, not a rejection.",
    },
    gates: {
      geography_fit:
        "The company's headquarters or main investment jurisdiction must be within the chosen geography. If evidence is missing, the rule is unknown, not breached.",
      stage_fit:
        "The company's real maturity and current round must be within the chosen stages. If evidence is missing, the rule is unknown, not breached.",
      ticket_fit:
        "The expected initial ticket and the possible ownership must fit within the mandate. If evidence is missing, the rule is unknown, not breached.",
    },
    autoGeography: "Based in {list}",
    autoStage: "Stage: {list}",
    autoTicket: "Ticket {min}–{max} DKK",
    customReview:
      "A person must assess: {label}. If evidence is missing, the rule is unknown, not breached.",
    customHard:
      "Binding rule from the setup: {label}. If evidence is missing, the rule is unknown, not breached.",
    gateFallback: "Gate",
    criterionFallback: "Assess the company on {label}.",
  },
};
