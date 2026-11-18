/**
 * The self-host edition's demo cases: ten invented companies, spread over phase, sector, country
 * and outcome, so every screen has content from the first sign-in. EVERYTHING HERE IS FICTIONAL:
 * no company, person, figure or quote is real, every name is shown with "(demo)", every address
 * is on the reserved .example domain, and every source is a "fictional" document. A test scans the
 * texts for real company names (demo-build.test.ts).
 *
 * The texts are written for the Venture template's criteria (setup's first fund); the builder
 * (demo-build.ts) maps them onto whatever criteria and gates the fund has.
 */
import type { CompanyProfile } from "../../../src/lib/analysis/contracts.ts";
import type { EvidenceStatus, ScoreCategory } from "../../../src/lib/domain/types.ts";

/** Where the case ends up: the seed moves it there through transition_case. */
export type DemoPath =
  "screened" | "hold" | "rejected" | "deep" | "committee" | "invested" | "declined";

export interface DemoEvidence {
  key: string;
  claim: string;
  value: string;
  statedBy: string;
  status: EvidenceStatus;
  observed: string | null;
  excerpt?: string;
}

export interface DemoFact {
  text: string;
  evidence: string[];
  confidence?: number;
  nature?: "fact" | "company_claim" | "judgement";
  up?: string;
  down?: string;
  unknown?: string;
  /** What to watch, only in the specialist's long text. */
  watch?: string;
}

export interface DemoPerson {
  key: string;
  name: string;
  role: string;
  founder: boolean;
  /** domain, execution, commercial, technical, leadership (0–10). */
  scores: [number, number, number, number, number];
  evidence: string[];
}

export interface DemoRisk {
  key: string;
  label: string;
  level: "low" | "medium" | "high" | "critical";
  likelihood: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  cause: string;
  evidenceNote: string;
  /** More of the story, in the deep analysis's longer reasoning. */
  context?: string;
  likelihoodWhy: string;
  impactWhy: string;
  mitigation: string;
  evidence: string[];
  /** The specialist that owns the risk in the deep analysis. */
  module: "people_team" | "product_market_gtm" | "technology_risk" | "fund_finance_deal";
}

export interface DemoFinance {
  metric:
    | "mrr"
    | "arr"
    | "monthly_revenue"
    | "cash"
    | "monthly_operating_expenses"
    | "cogs"
    | "sales_marketing_spend"
    | "new_customers"
    | "customers"
    | "monthly_churn_rate";
  label: string;
  value: number;
  unit: string;
  periodStart: string | null;
  periodEnd: string | null;
  evidence: string;
}

export interface DemoDeep {
  notes: Partial<Record<ScoreCategory, string>>;
  overall: string;
  contrary: string;
  recommendation: "go_forward" | "follow" | "reject" | "outside_thesis_interesting";
  investmentCondition: string | null;
  specialists: Record<string, { summary: string; headline: string; questions: string[] }>;
  finance: DemoFinance[];
  market: {
    label: string;
    scope: "tam" | "sam" | "som" | "market";
    geography: string;
    unit: "million" | "billion";
    evidence: string;
    points: Array<[number, number, "actual" | "forecast"]>;
  };
  tech: Array<{
    metric: string;
    unit: string;
    company: number | null;
    industry: number | null;
    higherIsBetter: boolean;
    evidence: string;
  }>;
  ownership: {
    asOf: string;
    evidence: string;
    holders: Array<{
      holder: string;
      type: "founder" | "investor" | "employee_pool" | "other";
      percent: number;
    }>;
    rounds: Array<{ name: string; date: string; amount: number; investors: string[] }>;
  };
}

export interface DemoCase {
  key: string;
  name: string;
  website: string;
  sector: string;
  sectorLabel: string;
  geography: string;
  stage: "pre_seed" | "seed" | "series_a";
  description: string;
  path: DemoPath;
  recommendation: "go_forward" | "follow" | "reject" | "outside_thesis_interesting";
  people: DemoPerson[];
  evidence: DemoEvidence[];
  scores: Partial<Record<ScoreCategory, number>>;
  facts: Partial<Record<ScoreCategory, DemoFact>>;
  gates?: Record<string, boolean | null>;
  risks: DemoRisk[];
  strengths: string[];
  weaknesses: string[];
  openQuestions: string[];
  summary: string;
  contrary: string;
  keyFindings: Array<{
    statement: string;
    direction: "up" | "down";
    category: ScoreCategory;
    importance: 1 | 2 | 3;
  }>;
  nextSteps: Array<{
    title: string;
    question: string;
    why: string;
    kind: "task" | "question" | "verification" | "document" | "research" | "meeting";
    category: ScoreCategory;
  }>;
  profile: CompanyProfile;
  notes: string[];
  /** The note on the decision that moved the case (hold, reject, invest, decline). */
  decision?: string;
  deep?: DemoDeep;
}

const DECK = "Fictional pitch deck";
const CALL = "Fictional founder call";
const DATA_ROOM = "Fictional data room";
const MARKET = "Fictional market report";
const REFERENCE = "Fictional customer reference";
const REGISTER = "Fictional company register extract";

export const DEMO_CASES: readonly DemoCase[] = [
  // 1 · Screened, go forward ---------------------------------------------------------------
  {
    key: "ledgerlark",
    name: "Ledgerlark",
    website: "https://ledgerlark.example",
    sector: "fintech",
    sectorLabel: "Fintech",
    geography: "DK",
    stage: "seed",
    description:
      "Fictional demo company. Ledgerlark automates accounts payable for small and mid-sized companies: invoices are read, matched to purchase orders and paid in one approval flow.",
    path: "screened",
    recommendation: "go_forward",
    people: [
      {
        key: "ledgerlark-ceo",
        name: "Maren Holst",
        role: "CEO and co-founder",
        founder: true,
        scores: [8, 8, 7, 5, 8],
        evidence: ["team"],
      },
      {
        key: "ledgerlark-cto",
        name: "Jonas Brink",
        role: "CTO and co-founder",
        founder: true,
        scores: [7, 7, 4, 9, 6],
        evidence: ["team"],
      },
    ],
    evidence: [
      {
        key: "arr",
        claim: "Annual recurring revenue (ARR)",
        value: "EUR 1.1 million",
        statedBy: DECK,
        status: "company_stated",
        observed: "2026-09-30",
      },
      {
        key: "customers",
        claim: "Paying customers",
        value: "312 companies, net revenue retention 118 %",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-09-30",
      },
      {
        key: "team",
        claim: "Founders' background",
        value: "Both founders built the payables product at a Nordic ERP vendor for six years",
        statedBy: CALL,
        status: "company_stated",
        observed: "2026-10-12",
      },
      {
        key: "market",
        claim: "Serviceable market in the Nordics",
        value: "About 180,000 companies with 20–500 employees",
        statedBy: MARKET,
        status: "corroborated",
        observed: "2026-06-01",
      },
      {
        key: "round",
        claim: "Current round",
        value: "EUR 4 million seed, EUR 1.5 million committed",
        statedBy: DECK,
        status: "company_stated",
        observed: "2026-10-01",
      },
    ],
    scores: {
      fund_thesis_fit: 84,
      founder_market_fit: 86,
      team_market_fit: 72,
      product_market_fit: 78,
      market_timing: 74,
      traction_gtm: 80,
      product_technology: 70,
      evidence_quality: 66,
    },
    facts: {
      fund_thesis_fit: {
        text: "Ledgerlark is Nordic B2B software at seed with recurring revenue, which is the core of the fund's thesis.",
        evidence: ["round", "arr"],
        up: "Squarely inside the thesis: Nordic B2B software at seed.",
      },
      founder_market_fit: {
        text: "The founders built accounts payable software at an ERP vendor for six years and know the buyer and the integrations first hand.",
        evidence: ["team"],
        up: "Founders have built this product before for the same buyers.",
      },
      team_market_fit: {
        text: "The team of 14 is strong in product and engineering, but there is no dedicated sales leader yet; the CEO still closes most deals.",
        evidence: ["team"],
        down: "No sales leader; the CEO carries most of the selling.",
      },
      product_market_fit: {
        text: "Net revenue retention of 118 % across 312 paying companies suggests customers expand once the flow is in place.",
        evidence: ["customers"],
        up: "Customers expand: net revenue retention of 118 %.",
      },
      market_timing: {
        text: "E-invoicing becomes mandatory for more Nordic companies from 2027, which pushes small companies to automate payables now.",
        evidence: ["market"],
        up: "Regulation pushes the market towards automation from 2027.",
      },
      traction_gtm: {
        text: "ARR has reached EUR 1.1 million, mostly through accountants who recommend Ledgerlark to their clients.",
        evidence: ["arr", "customers"],
        up: "Accountants act as a low-cost sales channel.",
      },
      product_technology: {
        text: "Invoice reading and matching rely on a model trained on the customers' own invoices; integrations exist for the four most common Nordic ERP systems.",
        evidence: ["team"],
        unknown: "How much of the matching still needs manual review.",
      },
      evidence_quality: {
        text: "Revenue and retention come from the data room and match the customer list, but no figures have been confirmed by an auditor yet.",
        evidence: ["customers", "arr"],
        nature: "fact",
      },
    },
    risks: [
      {
        key: "sales_dependency",
        label: "Sales rests on the CEO",
        level: "medium",
        likelihood: 3,
        impact: 3,
        cause:
          "Most new customers are still closed by the CEO personally, and the accountant channel has no owner of its own.",
        evidenceNote:
          "The founder call and the deck both show no sales hire in the plan before mid-2027.",
        likelihoodWhy:
          "growth will soon need more meetings than one person can hold while also raising money.",
        impactWhy:
          "a stall in the channel would slow ARR growth exactly when the seed round has to show it.",
        mitigation:
          "Make hiring a head of partnerships a condition of the round and give the accountant channel its own targets. Review the pipeline split between CEO-led and channel-led deals every quarter.",
        evidence: ["team", "round"],
        module: "people_team",
      },
      {
        key: "bank_competition",
        label: "Banks bundle payables for free",
        level: "medium",
        likelihood: 3,
        impact: 3,
        cause:
          "Two large Nordic banks have announced payables features in their business banking apps.",
        evidenceNote:
          "The market report mentions bundling as the main threat to independent tools.",
        likelihoodWhy:
          "banks can give the feature away to keep the account, and small companies are price-sensitive.",
        impactWhy:
          "it would push Ledgerlark towards larger customers with more complex approval flows, where sales cycles are longer.",
        mitigation:
          "Ask for win and loss data against bank tools in the last two quarters. Test whether the ERP integrations and approval flows are deep enough that a bank feature does not replace them.",
        evidence: ["market"],
        module: "product_market_gtm",
      },
    ],
    strengths: [
      "Founders have built the same product before and know the buyer.",
      "Customers expand after onboarding: net revenue retention of 118 %.",
      "Accountants bring customers at low cost.",
    ],
    weaknesses: [
      "No sales leader; the CEO still closes most deals.",
      "Figures are not yet confirmed by an auditor.",
    ],
    openQuestions: [
      "How many customers came through accountants in the last two quarters?",
      "What does the gross margin look like after payment fees?",
      "Who will lead sales after the round?",
    ],
    summary:
      "Ledgerlark fits the thesis closely and shows real expansion among its customers. The founders know the product and the buyer from years at an ERP vendor. The main questions are who takes over sales from the CEO and how well the product holds up against banks bundling payables for free.",
    contrary:
      "Bank-bundled payables could commoditise the core flow before Ledgerlark reaches the larger customers where its depth matters.",
    keyFindings: [
      {
        statement: "Net revenue retention of 118 % across 312 paying companies.",
        direction: "up",
        category: "product_market_fit",
        importance: 3,
      },
      {
        statement: "Founders built payables software at an ERP vendor for six years.",
        direction: "up",
        category: "founder_market_fit",
        importance: 3,
      },
      {
        statement: "No dedicated sales leader; the CEO closes most deals.",
        direction: "down",
        category: "team_market_fit",
        importance: 2,
      },
    ],
    nextSteps: [
      {
        title: "Channel split",
        question: "How many new customers came through accountants in the last two quarters?",
        why: "Shows whether growth can continue without the CEO.",
        kind: "question",
        category: "traction_gtm",
      },
      {
        title: "Gross margin after fees",
        question: "Ask for the gross margin per plan after payment and card fees.",
        why: "The margin decides how much the accountant channel can be paid.",
        kind: "document",
        category: "traction_gtm",
      },
      {
        title: "Sales hire plan",
        question: "Who leads sales after the round, and when do they start?",
        why: "Sales rests on the CEO today.",
        kind: "meeting",
        category: "team_market_fit",
      },
    ],
    profile: {
      business:
        "Ledgerlark (fictional) sells accounts payable automation to small and mid-sized Nordic companies on a monthly subscription.",
      productModel:
        "A web app reads incoming invoices, matches them to purchase orders and sends one approval flow; pricing is per company and invoice volume.",
      market:
        "About 180,000 Nordic companies with 20–500 employees, pushed towards automation by mandatory e-invoicing from 2027.",
      team: "Two founders from a Nordic ERP vendor and a team of 14, strong in product and engineering.",
      economyCapital: "EUR 1.1 million ARR; raising a EUR 4 million seed round.",
      status: "Selling in Denmark and Sweden; Norway planned for 2027.",
    },
    notes: [
      "Met the founders at a fintech meetup. Sharp on the buyer, less clear on how sales scales.",
      "Spoke with two accountants who use Ledgerlark (fictional references): both say clients stay because of the ERP integrations.",
    ],
  },

  // 2 · Screened, follow ----------------------------------------------------------------------
  {
    key: "tangfoder",
    name: "Tangfoder",
    website: "https://tangfoder.example",
    sector: "foodtech",
    sectorLabel: "Foodtech",
    geography: "NO",
    stage: "pre_seed",
    description:
      "Fictional demo company. Tangfoder makes a seaweed-based feed additive for salmon farms that aims to cut the use of imported soy protein.",
    path: "screened",
    recommendation: "follow",
    people: [
      {
        key: "tangfoder-ceo",
        name: "Siri Aalvik",
        role: "CEO and co-founder",
        founder: true,
        scores: [9, 6, 5, 7, 6],
        evidence: ["team"],
      },
      {
        key: "tangfoder-cso",
        name: "Erlend Moe",
        role: "Chief scientist and co-founder",
        founder: true,
        scores: [9, 5, 3, 9, 5],
        evidence: ["team"],
      },
    ],
    evidence: [
      {
        key: "pilot",
        claim: "Feeding trial",
        value: "Two farms, 14-week trial, 6 % of soy protein replaced without slower growth",
        statedBy: DECK,
        status: "company_stated",
        observed: "2026-08-15",
      },
      {
        key: "team",
        claim: "Founders' background",
        value:
          "Marine biologist with a PhD in seaweed protein; co-founder from a feed producer's R&D team",
        statedBy: CALL,
        status: "company_stated",
        observed: "2026-09-20",
      },
      {
        key: "market",
        claim: "Feed market",
        value: "Norwegian salmon farming uses about 2 million tonnes of feed a year",
        statedBy: MARKET,
        status: "corroborated",
        observed: "2026-03-01",
      },
      {
        key: "grant",
        claim: "Public funding",
        value: "NOK 3 million innovation grant awarded for the scale-up line",
        statedBy: REGISTER,
        status: "verified",
        observed: "2026-05-10",
      },
    ],
    scores: {
      fund_thesis_fit: 58,
      founder_market_fit: 78,
      team_market_fit: 60,
      product_market_fit: 55,
      market_timing: 70,
      traction_gtm: 48,
      product_technology: 68,
      evidence_quality: 55,
    },
    facts: {
      fund_thesis_fit: {
        text: "Tangfoder is a Nordic climate-adjacent company, but a physical feed product with production capex sits at the edge of a software-led thesis.",
        evidence: ["pilot"],
        down: "Hardware-like production capex is outside the fund's usual model.",
      },
      founder_market_fit: {
        text: "The founders combine seaweed protein research with feed industry R&D, which is rare and directly relevant.",
        evidence: ["team"],
        up: "Rare mix of seaweed science and feed-industry experience.",
      },
      team_market_fit: {
        text: "The team is two founders and two lab staff; nobody has sold to large feed producers before.",
        evidence: ["team"],
        down: "No commercial lead for selling to feed producers.",
      },
      product_market_fit: {
        text: "One 14-week trial on two farms replaced 6 % of soy protein without slower growth, which is promising but early.",
        evidence: ["pilot"],
        unknown: "Whether the result holds across seasons and more farms.",
      },
      market_timing: {
        text: "Salmon farmers face pressure to cut imported soy, and feed is the largest single cost in farming.",
        evidence: ["market"],
        up: "Strong pull from farms to replace imported soy.",
      },
      traction_gtm: {
        text: "There is no revenue yet; the go-to-market depends on two or three large feed producers adopting the additive.",
        evidence: ["pilot"],
        down: "No revenue and a buyer group of very few large producers.",
      },
      product_technology: {
        text: "The extraction process is patented and a public grant funds the first scale-up line.",
        evidence: ["grant"],
        up: "Patented process with public funding for scale-up.",
      },
      evidence_quality: {
        text: "The grant is confirmed in the register, but the trial results are the company's own and have not been reviewed independently.",
        evidence: ["grant", "pilot"],
        nature: "fact",
      },
    },
    risks: [
      {
        key: "buyer_concentration",
        label: "Few buyers decide everything",
        level: "high",
        likelihood: 3,
        impact: 4,
        cause: "Three feed producers buy most of the feed sold to Norwegian salmon farms.",
        evidenceNote: "The market report shows the producers' combined share above 80 %.",
        likelihoodWhy:
          "each producer runs long qualification programmes and can wait for a competing additive.",
        impactWhy: "without one of them, Tangfoder has no route to volume.",
        mitigation:
          "Ask which producer runs the next trial and on what terms. Follow the case until a producer has signed a qualification agreement.",
        evidence: ["market"],
        module: "product_market_gtm",
      },
      {
        key: "scale_up",
        label: "Scale-up of production",
        level: "medium",
        likelihood: 3,
        impact: 3,
        cause: "The process has only run at lab and small pilot scale.",
        evidenceNote: "The grant funds the first scale-up line, which is not yet built.",
        likelihoodWhy: "most bio-based processes lose yield when they scale.",
        impactWhy: "a lower yield would raise the price per tonne above what farms will pay.",
        mitigation:
          "Ask for the yield assumptions behind the cost per tonne. Revisit once the scale-up line has run for a quarter.",
        evidence: ["grant"],
        module: "technology_risk",
      },
    ],
    strengths: [
      "Founders combine seaweed science with feed-industry experience.",
      "Patented extraction with public funding for scale-up.",
      "Farms want to replace imported soy.",
    ],
    weaknesses: [
      "No revenue, and only a handful of possible buyers.",
      "Capital-intensive production at the edge of the thesis.",
    ],
    openQuestions: [
      "Which feed producer runs the next trial?",
      "What is the cost per tonne at full scale?",
      "How much capital does the first production line need beyond the grant?",
    ],
    summary:
      "Tangfoder has a strong scientific team and a promising first trial, but no revenue and a buyer group of three large feed producers. The fund should follow the case until a producer signs a qualification agreement and the scale-up line has run.",
    contrary:
      "If one large producer adopts the additive, Tangfoder could become the standard quickly, and waiting would mean a much higher price.",
    keyFindings: [
      {
        statement: "6 % of soy protein replaced in a 14-week trial without slower growth.",
        direction: "up",
        category: "product_market_fit",
        importance: 2,
      },
      {
        statement: "Three feed producers control most of the market.",
        direction: "down",
        category: "traction_gtm",
        importance: 3,
      },
    ],
    nextSteps: [
      {
        title: "Next producer trial",
        question: "Which feed producer runs the next trial, and on what terms?",
        why: "Volume depends on one of three producers.",
        kind: "question",
        category: "traction_gtm",
      },
      {
        title: "Cost per tonne",
        question: "Ask for the cost per tonne at full scale and the yield behind it.",
        why: "Decides whether farms can afford the additive.",
        kind: "document",
        category: "product_technology",
      },
    ],
    profile: {
      business: "Tangfoder (fictional) develops a seaweed-based protein additive for salmon feed.",
      productModel: "Sold by the tonne to feed producers, who mix it into their feed.",
      market: "Norwegian salmon farming uses about 2 million tonnes of feed a year.",
      team: "Two founders (marine biology, feed R&D) and two lab staff.",
      economyCapital: "Pre-revenue; NOK 3 million grant; raising a pre-seed round.",
      status: "First feeding trial finished; scale-up line being planned.",
    },
    notes: ["Interesting science. Revisit when a feed producer has signed a trial agreement."],
  },

  // 3 · On hold ----------------------------------------------------------------------------------
  {
    key: "pulsvik",
    name: "Pulsvik Health",
    website: "https://pulsvik.example",
    sector: "healthtech",
    sectorLabel: "Digital health",
    geography: "SE",
    stage: "seed",
    description:
      "Fictional demo company. Pulsvik Health runs remote cardiac rehabilitation: patients train at home with a sensor patch while nurses follow them from a dashboard.",
    path: "hold",
    recommendation: "follow",
    people: [
      {
        key: "pulsvik-ceo",
        name: "Karin Lindqvist",
        role: "CEO and co-founder",
        founder: true,
        scores: [8, 7, 6, 4, 7],
        evidence: ["team"],
      },
      {
        key: "pulsvik-cmo",
        name: "Dr. Anders Vall",
        role: "Chief medical officer and co-founder",
        founder: true,
        scores: [9, 5, 4, 5, 6],
        evidence: ["team"],
      },
    ],
    evidence: [
      {
        key: "regions",
        claim: "Contracts with regions",
        value: "Two regional pilots, 140 patients; procurement for a third region opens in Q2 2027",
        statedBy: DECK,
        status: "company_stated",
        observed: "2026-09-01",
      },
      {
        key: "outcome",
        claim: "Completion rate",
        value: "81 % finished the 12-week programme versus about 50 % in clinic-based rehab",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-09-01",
      },
      {
        key: "team",
        claim: "Founders' background",
        value: "Former head of a rehab clinic and a cardiologist",
        statedBy: CALL,
        status: "company_stated",
        observed: "2026-09-18",
      },
      {
        key: "certification",
        claim: "Medical device class",
        value: "Software certified as a class IIa medical device in progress, expected Q1 2027",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-09-01",
      },
    ],
    scores: {
      fund_thesis_fit: 66,
      founder_market_fit: 80,
      team_market_fit: 62,
      product_market_fit: 70,
      market_timing: 64,
      traction_gtm: 56,
      product_technology: 62,
      evidence_quality: 58,
    },
    facts: {
      fund_thesis_fit: {
        text: "Pulsvik is Nordic software with recurring contracts, but sells to public regions with long procurement cycles.",
        evidence: ["regions"],
      },
      founder_market_fit: {
        text: "The founders ran a rehab clinic and treat cardiac patients, so they know both the clinical workflow and the buyer.",
        evidence: ["team"],
        up: "Clinical founders who know the workflow and the buyer.",
      },
      team_market_fit: {
        text: "The team has clinical depth but only one engineer in-house; most of the software is built by an agency.",
        evidence: ["team"],
        down: "Software is mostly built by an outside agency.",
      },
      product_market_fit: {
        text: "81 % of patients finished the programme, against about half in clinic-based rehab.",
        evidence: ["outcome"],
        up: "Much higher completion than clinic-based rehab.",
      },
      market_timing: {
        text: "Swedish regions are under pressure to cut waiting lists, but budgets for new digital care are tight in 2027.",
        evidence: ["regions"],
      },
      traction_gtm: {
        text: "Two regional pilots with 140 patients; the next contract depends on a public procurement that opens in Q2 2027.",
        evidence: ["regions"],
        down: "Next revenue step waits for a public procurement.",
      },
      product_technology: {
        text: "The software's certification as a medical device is still in progress.",
        evidence: ["certification"],
        unknown: "Whether certification lands before the procurement.",
      },
      evidence_quality: {
        text: "Outcomes come from the company's own data and have not been published or reviewed.",
        evidence: ["outcome"],
        nature: "fact",
      },
    },
    risks: [
      {
        key: "procurement_timing",
        label: "Procurement decides the timing",
        level: "high",
        likelihood: 4,
        impact: 3,
        cause: "The next revenue step depends on one public procurement in Q2 2027.",
        evidenceNote: "The deck has no commercial customers outside the regions.",
        likelihoodWhy: "public procurements are often delayed or appealed.",
        impactWhy: "a delay of two quarters would use most of the current runway.",
        mitigation:
          "Put the case on hold until the procurement result is known. Ask for the runway with and without the third region.",
        evidence: ["regions"],
        module: "product_market_gtm",
      },
      {
        key: "certification",
        label: "Device certification",
        level: "medium",
        likelihood: 3,
        impact: 3,
        cause: "The class IIa certification is not finished.",
        evidenceNote: "The data room gives Q1 2027 as the expected date.",
        likelihoodWhy: "notified bodies have long queues.",
        impactWhy: "without certification Pulsvik cannot bid in the procurement.",
        mitigation:
          "Ask for the notified body's latest letter. Check again when the certificate is issued.",
        evidence: ["certification"],
        module: "technology_risk",
      },
    ],
    strengths: [
      "Clinical founders who know the workflow and the buyer.",
      "81 % completion against about half in clinic-based rehab.",
    ],
    weaknesses: [
      "Next contract waits for a public procurement in Q2 2027.",
      "Device certification not yet finished.",
    ],
    openQuestions: [
      "What is the runway without the third region?",
      "When does the notified body expect to issue the certificate?",
    ],
    summary:
      "Pulsvik shows strong clinical results and has founders who know the field, but the next step depends on a public procurement and an unfinished certification. The case is on hold until the procurement result is known.",
    contrary:
      "Winning the third region would make Pulsvik the reference supplier in Sweden, and the round would then be priced much higher.",
    keyFindings: [
      {
        statement: "81 % of patients finished the 12-week programme.",
        direction: "up",
        category: "product_market_fit",
        importance: 3,
      },
      {
        statement: "Next contract depends on a procurement in Q2 2027.",
        direction: "down",
        category: "traction_gtm",
        importance: 3,
      },
    ],
    nextSteps: [
      {
        title: "Runway without region three",
        question: "What is the runway if the third region is delayed by two quarters?",
        why: "The procurement decides the timing.",
        kind: "question",
        category: "traction_gtm",
      },
    ],
    profile: {
      business:
        "Pulsvik Health (fictional) offers remote cardiac rehabilitation to Swedish regions.",
      productModel:
        "Per-patient fee for a 12-week programme with sensor patch and nurse dashboard.",
      market: "Swedish regions treat tens of thousands of cardiac patients a year.",
      team: "Clinical founders, one in-house engineer and an outside development agency.",
      economyCapital: "Revenue from two pilots; raising a seed round.",
      status: "Two pilots running; certification and a third procurement pending.",
    },
    notes: ["Strong data. On hold until the region's procurement result in Q2 2027."],
    decision:
      "On hold: the next contract depends on a public procurement in Q2 2027 and the device certification.",
  },

  // 4 · Rejected at screening --------------------------------------------------------------------
  {
    key: "dockmile",
    name: "Dockmile",
    website: "https://dockmile.example",
    sector: "mobility",
    sectorLabel: "Logistics",
    geography: "NL",
    stage: "seed",
    description:
      "Fictional demo company. Dockmile installs smart parcel lockers in apartment buildings and charges carriers per delivery.",
    path: "rejected",
    recommendation: "reject",
    people: [
      {
        key: "dockmile-ceo",
        name: "Pieter van Dalen",
        role: "CEO and founder",
        founder: true,
        scores: [5, 7, 6, 4, 6],
        evidence: ["team"],
      },
    ],
    evidence: [
      {
        key: "lockers",
        claim: "Installed lockers",
        value: "420 lockers in three Dutch cities",
        statedBy: DECK,
        status: "company_stated",
        observed: "2026-07-01",
      },
      {
        key: "unit",
        claim: "Cost per locker",
        value: "EUR 6,500 per locker, paid back in about 4 years at current volumes",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-07-01",
      },
      {
        key: "team",
        claim: "Founder's background",
        value: "Former operations manager at a regional courier",
        statedBy: CALL,
        status: "company_stated",
        observed: "2026-08-02",
      },
    ],
    gates: { geography_fit: false },
    scores: {
      fund_thesis_fit: 32,
      founder_market_fit: 58,
      team_market_fit: 50,
      product_market_fit: 52,
      market_timing: 55,
      traction_gtm: 50,
      product_technology: 40,
      evidence_quality: 50,
    },
    facts: {
      fund_thesis_fit: {
        text: "Dockmile is a hardware roll-out business in the Netherlands, outside both the fund's geography and its software focus.",
        evidence: ["lockers"],
        down: "Outside the fund's geography and software focus.",
      },
      founder_market_fit: {
        text: "The founder knows last-mile operations from a regional courier.",
        evidence: ["team"],
      },
      team_market_fit: {
        text: "A founder and a small installation crew; no technology leadership.",
        evidence: ["team"],
      },
      product_market_fit: {
        text: "Lockers are used, but carriers pay per delivery and can switch to competing networks.",
        evidence: ["lockers"],
      },
      market_timing: {
        text: "Parcel volumes keep growing, and buildings want fewer missed deliveries.",
        evidence: ["lockers"],
      },
      traction_gtm: {
        text: "420 lockers in three cities, with each locker paid back in about four years.",
        evidence: ["lockers", "unit"],
        down: "Each locker takes about four years to pay back.",
      },
      product_technology: {
        text: "The lockers are bought from a supplier; the software is a thin booking layer.",
        evidence: ["unit"],
        down: "Little proprietary technology.",
      },
      evidence_quality: {
        text: "All figures are the company's own.",
        evidence: ["lockers"],
        nature: "fact",
      },
    },
    risks: [
      {
        key: "capital_intensity",
        label: "Capital-heavy roll-out",
        level: "high",
        likelihood: 4,
        impact: 4,
        cause: "Every new locker costs EUR 6,500 before it earns anything.",
        evidenceNote: "The data room shows a payback of about four years at current volumes.",
        likelihoodWhy: "growth requires capital for every unit, not just for the team.",
        impactWhy: "the fund's ticket would mostly buy hardware rather than build software value.",
        mitigation:
          "Not pursued: the case is outside the fund's geography and model. If the founders move to a software-only model, the team can look again.",
        evidence: ["unit"],
        module: "fund_finance_deal",
      },
    ],
    strengths: ["The founder knows last-mile operations well."],
    weaknesses: [
      "Outside the fund's geography and software focus.",
      "Capital-heavy roll-out with a four-year payback per locker.",
    ],
    openQuestions: [
      "Would the founders consider a software-only model for existing locker networks?",
    ],
    summary:
      "Dockmile is a capital-heavy hardware roll-out in the Netherlands, outside the fund's geography and software focus. The founder knows the market, but the model does not fit the fund.",
    contrary:
      "Locker networks can become valuable infrastructure once they reach density, and carriers may then pay much more per delivery.",
    keyFindings: [
      {
        statement: "Outside the fund's geography (Netherlands) and software focus.",
        direction: "down",
        category: "fund_thesis_fit",
        importance: 3,
      },
    ],
    nextSteps: [
      {
        title: "Send a friendly no",
        question:
          "Write to the founder with the reasons and leave the door open for a software model.",
        why: "Keeps the relationship.",
        kind: "task",
        category: "fund_thesis_fit",
      },
    ],
    profile: {
      business: "Dockmile (fictional) installs parcel lockers in apartment buildings.",
      productModel: "Carriers pay per delivery; buildings get the lockers for free.",
      market: "Dutch urban apartment buildings.",
      team: "Founder from a regional courier and an installation crew.",
      economyCapital: "Revenue from 420 lockers; raising a seed round.",
      status: "Operating in three Dutch cities.",
    },
    notes: [],
    decision: "Rejected: outside the fund's geography and software focus, and capital-heavy.",
  },

  // 5 · Deep analysis ----------------------------------------------------------------------------
  {
    key: "fjordgrid",
    name: "Fjordgrid",
    website: "https://fjordgrid.example",
    sector: "climate_energy",
    sectorLabel: "Energy software",
    geography: "NO",
    stage: "seed",
    description:
      "Fictional demo company. Fjordgrid's software coordinates batteries in commercial buildings so they can sell flexibility to the grid operator at peak hours.",
    path: "deep",
    recommendation: "go_forward",
    people: [
      {
        key: "fjordgrid-ceo",
        name: "Ingrid Solberg",
        role: "CEO and co-founder",
        founder: true,
        scores: [8, 8, 7, 6, 8],
        evidence: ["team"],
      },
      {
        key: "fjordgrid-cto",
        name: "Henrik Dahle",
        role: "CTO and co-founder",
        founder: true,
        scores: [8, 7, 4, 9, 6],
        evidence: ["team"],
      },
      {
        key: "fjordgrid-coo",
        name: "Leila Haugen",
        role: "Head of partnerships",
        founder: false,
        scores: [6, 7, 8, 4, 6],
        evidence: ["team"],
      },
    ],
    evidence: [
      {
        key: "arr",
        claim: "Annual recurring revenue (ARR)",
        value: "EUR 640,000",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-09-30",
      },
      {
        key: "sites",
        claim: "Connected sites",
        value: "57 buildings, 31 MW of battery capacity under control",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-09-30",
      },
      {
        key: "team",
        claim: "Founders' background",
        value:
          "CEO from a grid operator's flexibility market; CTO built trading software for a power exchange",
        statedBy: CALL,
        status: "company_stated",
        observed: "2026-10-02",
      },
      {
        key: "market",
        claim: "Flexibility market in the Nordics",
        value: "EUR 420 million in 2025, expected EUR 1.6 billion by 2030",
        statedBy: MARKET,
        status: "corroborated",
        observed: "2026-04-01",
      },
      {
        key: "reference",
        claim: "Customer reference",
        value: "Property owner reports 14 % lower energy cost across 12 buildings",
        statedBy: REFERENCE,
        status: "corroborated",
        observed: "2026-10-08",
      },
      {
        key: "finance",
        claim: "Monthly figures",
        value: "MRR EUR 53,000, operating cost EUR 140,000 a month, cash EUR 2.1 million",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-09-30",
      },
      {
        key: "captable",
        claim: "Cap table",
        value: "Founders 68 %, angels 14 %, pre-seed fund 10 %, option pool 8 %",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-09-30",
      },
      {
        key: "uptime",
        claim: "Platform performance",
        value: "99.95 % uptime; dispatch to batteries in under 2 seconds",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-09-30",
      },
    ],
    scores: {
      fund_thesis_fit: 80,
      founder_market_fit: 84,
      team_market_fit: 74,
      product_market_fit: 74,
      market_timing: 82,
      traction_gtm: 70,
      product_technology: 76,
      financial_strength: 64,
      evidence_quality: 68,
    },
    facts: {
      fund_thesis_fit: {
        text: "Fjordgrid is Nordic climate software at seed with recurring revenue, inside the fund's thesis.",
        evidence: ["arr"],
        up: "Nordic climate software with recurring revenue.",
      },
      founder_market_fit: {
        text: "The CEO ran flexibility products at a grid operator and the CTO built trading software for a power exchange.",
        evidence: ["team"],
        up: "Founders come from both sides of the flexibility market.",
      },
      team_market_fit: {
        text: "A head of partnerships was hired from a battery installer, which gives the team a channel to new sites.",
        evidence: ["team"],
        up: "Partnerships lead brings an installer channel.",
      },
      product_market_fit: {
        text: "A property owner with 12 buildings reports 14 % lower energy cost, and has added sites twice.",
        evidence: ["reference"],
        up: "Reference customer expanded twice.",
      },
      market_timing: {
        text: "The Nordic flexibility market is expected to grow from EUR 420 million in 2025 to EUR 1.6 billion in 2030.",
        evidence: ["market"],
        up: "Fast-growing flexibility market.",
      },
      traction_gtm: {
        text: "ARR is EUR 640,000 across 57 buildings and 31 MW of batteries.",
        evidence: ["arr", "sites"],
      },
      product_technology: {
        text: "The platform dispatches batteries in under two seconds with 99.95 % uptime.",
        evidence: ["uptime"],
        up: "Fast, reliable dispatch.",
        unknown: "How the platform performs when the grid operator changes market rules.",
      },
      financial_strength: {
        text: "With EUR 2.1 million in cash and a net burn of about EUR 87,000 a month, the runway is roughly two years.",
        evidence: ["finance"],
      },
      evidence_quality: {
        text: "Revenue and sites are confirmed by the data room and a customer reference; the cap table is the company's own statement.",
        evidence: ["arr", "reference"],
        nature: "fact",
      },
    },
    risks: [
      {
        key: "market_rules",
        label: "Grid market rules can change",
        level: "high",
        likelihood: 3,
        impact: 4,
        cause:
          "Fjordgrid earns part of its revenue from flexibility payments set by the grid operator's market rules. The operator is reviewing those rules for 2028.",
        evidenceNote: "The market report expects lower prices per MW as more batteries join.",
        likelihoodWhy:
          "a rule change is announced, and prices per MW usually fall as the market fills up.",
        impactWhy:
          "lower prices would cut the customers' savings and with them Fjordgrid's share, unless volume grows faster.",
        mitigation:
          "Model revenue per MW at 30 % lower flexibility prices and check that customers still save. Ask how the platform handles a rule change, and when it last did. If customers still save at the lower price, the risk is acceptable for a seed investment.",
        evidence: ["market", "finance"],
        module: "product_market_gtm",
      },
      {
        key: "key_person",
        label: "Trading logic rests on the CTO",
        level: "medium",
        likelihood: 2,
        impact: 4,
        cause: "The dispatch and bidding logic was written mostly by the CTO.",
        evidenceNote: "The founder call names only two engineers who know the bidding engine.",
        context:
          "The CTO has said he intends to stay, and he holds a large share of the company, which aligns his interests with the fund's for the next years.",
        likelihoodWhy:
          "the risk is low while the CTO stays, but nothing is documented for a hand-over.",
        impactWhy: "losing him would slow every change to the bidding engine for months.",
        mitigation:
          "Ask for a hiring plan for a second senior engineer on the bidding engine. Make documentation of the engine part of the first 100 days after the round. Until then, the board should see a short status on the engine's documentation each quarter.",
        evidence: ["team"],
        module: "people_team",
      },
      {
        key: "runway",
        label: "Runway if growth slows",
        level: "medium",
        likelihood: 2,
        impact: 3,
        cause: "The plan assumes ARR doubles in 2027.",
        evidenceNote: "Current burn is about EUR 87,000 a month net of revenue.",
        context:
          "Most of the planned spend is on engineers and the installer channel, and a third of it could be postponed without losing customers. The company has not yet tested how quickly it could cut costs if it had to.",
        likelihoodWhy: "growth has been steady, but the plan is ambitious.",
        impactWhy: "a slower year would bring the next round forward by about six months.",
        mitigation:
          "Ask for the plan at half the growth and the cost cuts it would need. Size the round so the company reaches the next milestone even in that case. The fund should only lead if the round reaches that size.",
        evidence: ["finance"],
        module: "fund_finance_deal",
      },
    ],
    strengths: [
      "Founders come from both the grid operator and the power exchange.",
      "Reference customer saves 14 % and has expanded twice.",
      "Flexibility market expected to almost quadruple by 2030.",
    ],
    weaknesses: [
      "Revenue depends partly on market rules the grid operator sets.",
      "Bidding logic rests on the CTO.",
    ],
    openQuestions: [
      "How does revenue per MW change at lower flexibility prices?",
      "Who besides the CTO can change the bidding engine?",
      "What does the plan look like at half the growth?",
    ],
    summary:
      "Fjordgrid fits the thesis and has a founding team from both sides of the flexibility market. Customers save money and expand. The main questions are how revenue holds up if grid market rules change, and how much the bidding engine depends on the CTO.",
    contrary:
      "If flexibility prices fall faster than volume grows, the savings that sell the product shrink, and Fjordgrid becomes a cost centre for property owners.",
    keyFindings: [
      {
        statement: "Reference customer reports 14 % lower energy cost across 12 buildings.",
        direction: "up",
        category: "product_market_fit",
        importance: 3,
      },
      {
        statement: "Flexibility market from EUR 420 million (2025) to EUR 1.6 billion (2030).",
        direction: "up",
        category: "market_timing",
        importance: 2,
      },
      {
        statement: "Revenue partly depends on grid market rules under review.",
        direction: "down",
        category: "market_timing",
        importance: 2,
      },
    ],
    nextSteps: [
      {
        title: "Price sensitivity",
        question: "Model revenue per MW at 30 % lower flexibility prices.",
        why: "Market rules are under review for 2028.",
        kind: "research",
        category: "market_timing",
      },
      {
        title: "Bidding engine hand-over",
        question: "Who besides the CTO can change the bidding engine today?",
        why: "Key-person risk on the core logic.",
        kind: "question",
        category: "team_market_fit",
      },
      {
        title: "Downside plan",
        question: "Ask for the plan at half the growth and the cost cuts it needs.",
        why: "Tests the runway.",
        kind: "document",
        category: "financial_strength",
      },
    ],
    profile: {
      business:
        "Fjordgrid (fictional) sells software that lets commercial buildings earn money from their batteries at peak hours.",
      productModel:
        "Subscription per MW of controlled battery capacity plus a share of flexibility revenue.",
      market:
        "Nordic flexibility market of EUR 420 million in 2025, expected EUR 1.6 billion by 2030.",
      team: "Founders from a grid operator and a power exchange, plus a partnerships lead from a battery installer.",
      economyCapital: "EUR 640,000 ARR, EUR 2.1 million cash; raising a seed round.",
      status: "57 buildings connected in Norway; Sweden planned for 2027.",
    },
    notes: [
      "Deep analysis started after a strong screening. Focus: market rule risk and the bidding engine.",
      "Called the reference customer (fictional): savings confirmed, they plan 8 more buildings next year.",
    ],
    deep: {
      notes: {
        fund_thesis_fit:
          "The business model ties revenue to installed capacity, which grows with the customers' own battery investments.",
        founder_market_fit:
          "Few teams combine grid-operator insight with trading software experience; that combination shortens sales to property owners.",
        team_market_fit:
          "The team is still thin in engineering beyond the CTO, which the round should address.",
        product_market_fit:
          "Expansion by the reference customer is the strongest sign so far; more references of this kind are needed.",
        market_timing:
          "Timing is good, but prices per MW will likely fall as the market fills; volume has to outgrow that.",
        traction_gtm:
          "The installer channel brought a third of new sites this year, which suggests a repeatable route.",
        product_technology:
          "Dispatch speed matters for the fastest flexibility products, where prices are highest.",
        financial_strength:
          "The round should cover at least 24 months at the planned hiring pace, including the downside case.",
        evidence_quality:
          "The figures that matter most are corroborated; the plan's growth is the company's own assumption.",
      },
      overall:
        "Fjordgrid is a strong seed case inside the fund's thesis. The founders come from the grid operator and the power exchange, and that shows in how the product is built and sold. Customers save money and expand, and the installer channel is starting to bring sites without the founders.\n\nThe two questions for the committee are how revenue holds up if the grid operator changes market rules for 2028, and how much the bidding engine still depends on the CTO. Both can be tested before an offer: a price-sensitivity model and a hiring plan for a second senior engineer.",
      contrary:
        "If flexibility prices fall faster than volume grows, the savings that sell the product shrink, and the installer channel loses interest.",
      recommendation: "go_forward",
      investmentCondition:
        "A second senior engineer on the bidding engine is hired within six months of the round.",
      specialists: {
        people_team: {
          summary:
            "The founders cover both sides of the flexibility market, and the partnerships lead adds a channel. Engineering depth beyond the CTO is the gap.",
          headline: "Rare founder mix, but the bidding engine rests on the CTO",
          questions: ["Who besides the CTO can change the bidding engine today?"],
        },
        product_market_gtm: {
          summary:
            "Customers save money and expand, and the market grows fast. Revenue per MW is exposed to market rules the grid operator is reviewing.",
          headline: "Growing market and real savings; prices per MW will fall",
          questions: ["How does revenue per MW change at 30 % lower prices?"],
        },
        technology_risk: {
          summary:
            "Dispatch is fast and reliable. The platform's response to a change in market rules has not been tested yet.",
          headline: "Fast, reliable dispatch; rule changes untested",
          questions: ["When did the platform last adapt to a market rule change?"],
        },
        fund_finance_deal: {
          summary:
            "About two years of runway at the current burn. The round should cover the downside case where growth halves.",
          headline: "Two years of runway; plan assumes ARR doubles",
          questions: ["What does the plan look like at half the growth?"],
        },
      },
      finance: [
        {
          metric: "arr",
          label: "ARR",
          value: 640000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "arr",
        },
        {
          metric: "mrr",
          label: "MRR",
          value: 53000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "monthly_operating_expenses",
          label: "Operating cost per month",
          value: 140000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "cash",
          label: "Cash",
          value: 2100000,
          unit: "EUR",
          periodStart: null,
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "customers",
          label: "Customers",
          value: 19,
          unit: "customers",
          periodStart: null,
          periodEnd: "2026-09-30",
          evidence: "sites",
        },
      ],
      market: {
        label: "Flexibility market, Nordics",
        scope: "market",
        geography: "Nordics",
        unit: "million",
        evidence: "market",
        points: [
          [2024, 310, "actual"],
          [2025, 420, "actual"],
          [2026, 560, "forecast"],
          [2027, 760, "forecast"],
          [2028, 1000, "forecast"],
          [2030, 1600, "forecast"],
        ],
      },
      tech: [
        {
          metric: "Platform uptime",
          unit: "%",
          company: 99.95,
          industry: 99.5,
          higherIsBetter: true,
          evidence: "uptime",
        },
        {
          metric: "Dispatch time",
          unit: "seconds",
          company: 2,
          industry: 30,
          higherIsBetter: false,
          evidence: "uptime",
        },
        {
          metric: "Battery capacity controlled",
          unit: "MW",
          company: 31,
          industry: 20,
          higherIsBetter: true,
          evidence: "sites",
        },
      ],
      ownership: {
        asOf: "2026-09-30",
        evidence: "captable",
        holders: [
          { holder: "Founders", type: "founder", percent: 68 },
          { holder: "Angel investors", type: "investor", percent: 14 },
          { holder: "Pre-seed fund (fictional)", type: "investor", percent: 10 },
          { holder: "Option pool", type: "employee_pool", percent: 8 },
        ],
        rounds: [
          { name: "Angel round", date: "2024-03", amount: 400000, investors: ["Angel investors"] },
          {
            name: "Pre-seed",
            date: "2025-05",
            amount: 1500000,
            investors: ["Pre-seed fund (fictional)"],
          },
        ],
      },
    },
  },

  // 6 · Deep analysis ----------------------------------------------------------------------------
  {
    key: "shiftloom",
    name: "Shiftloom",
    website: "https://shiftloom.example",
    sector: "b2b_saas",
    sectorLabel: "B2B software",
    geography: "FI",
    stage: "seed",
    description:
      "Fictional demo company. Shiftloom plans shifts in factories: it matches staff skills, labour rules and production orders, and lets workers swap shifts in an app.",
    path: "deep",
    recommendation: "go_forward",
    people: [
      {
        key: "shiftloom-ceo",
        name: "Aino Kettunen",
        role: "CEO and co-founder",
        founder: true,
        scores: [7, 8, 7, 5, 7],
        evidence: ["team"],
      },
      {
        key: "shiftloom-cto",
        name: "Mikko Rautio",
        role: "CTO and co-founder",
        founder: true,
        scores: [6, 7, 4, 8, 6],
        evidence: ["team"],
      },
    ],
    evidence: [
      {
        key: "arr",
        claim: "Annual recurring revenue (ARR)",
        value: "EUR 820,000",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-09-30",
      },
      {
        key: "customers",
        claim: "Customers and churn",
        value: "23 factories, monthly logo churn 1.2 %",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-09-30",
      },
      {
        key: "team",
        claim: "Founders' background",
        value:
          "CEO ran production planning at a paper mill; CTO built scheduling software for hospitals",
        statedBy: CALL,
        status: "company_stated",
        observed: "2026-10-05",
      },
      {
        key: "market",
        claim: "Workforce management for manufacturing, Europe",
        value: "EUR 1.9 billion in 2025, growing about 9 % a year",
        statedBy: MARKET,
        status: "corroborated",
        observed: "2026-02-01",
      },
      {
        key: "finance",
        claim: "Monthly figures",
        value:
          "MRR EUR 68,000, operating cost EUR 150,000, cash EUR 1.4 million, S&M EUR 38,000, 2 new customers a month",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-09-30",
      },
      {
        key: "captable",
        claim: "Cap table",
        value: "Founders 72 %, seed angels 12 %, regional fund 9 %, option pool 7 %",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-09-30",
      },
      {
        key: "reference",
        claim: "Customer reference",
        value: "Factory reports overtime down 22 % after six months",
        statedBy: REFERENCE,
        status: "corroborated",
        observed: "2026-10-10",
      },
    ],
    scores: {
      fund_thesis_fit: 78,
      founder_market_fit: 76,
      team_market_fit: 66,
      product_market_fit: 76,
      market_timing: 68,
      traction_gtm: 72,
      product_technology: 70,
      financial_strength: 58,
      evidence_quality: 70,
    },
    facts: {
      fund_thesis_fit: {
        text: "Shiftloom is Nordic B2B software at seed with recurring revenue from industrial customers.",
        evidence: ["arr"],
        up: "Nordic B2B software with recurring revenue.",
      },
      founder_market_fit: {
        text: "The CEO planned production at a paper mill and the CTO has built scheduling software before.",
        evidence: ["team"],
        up: "Founders know both the factory floor and scheduling software.",
      },
      team_market_fit: {
        text: "The team of 11 has no one who has sold to large industrial groups.",
        evidence: ["team"],
        down: "No enterprise sales experience.",
      },
      product_market_fit: {
        text: "A reference factory reports overtime down 22 % after six months, and monthly logo churn is 1.2 %.",
        evidence: ["reference", "customers"],
        up: "Measurable savings and low churn.",
      },
      market_timing: {
        text: "The European market for workforce management in manufacturing is EUR 1.9 billion and grows about 9 % a year.",
        evidence: ["market"],
      },
      traction_gtm: {
        text: "ARR is EUR 820,000 across 23 factories, with about two new customers a month.",
        evidence: ["arr", "finance"],
      },
      product_technology: {
        text: "The planning engine handles labour rules for four countries; adding a country takes about two months.",
        evidence: ["team"],
        unknown: "How the engine scales to plants with more than 2,000 workers.",
      },
      financial_strength: {
        text: "Cash of EUR 1.4 million against a net burn of about EUR 82,000 a month gives roughly 17 months of runway.",
        evidence: ["finance"],
        down: "About 17 months of runway.",
      },
      evidence_quality: {
        text: "Revenue, churn and the reference are confirmed; the cap table is the company's own statement.",
        evidence: ["arr", "customers", "reference"],
        nature: "fact",
      },
    },
    risks: [
      {
        key: "enterprise_sales",
        label: "Enterprise sales are untested",
        level: "medium",
        likelihood: 3,
        impact: 3,
        cause:
          "Growth beyond mid-sized factories needs deals with industrial groups, which buy centrally and slowly.",
        evidenceNote: "All 23 current customers are single plants that bought locally.",
        context:
          "Group buyers usually run a pilot in one plant first and then negotiate a framework agreement centrally, which can take nine to twelve months. Shiftloom has had first conversations with two groups but no pilot yet.",
        likelihoodWhy: "nobody on the team has run a group-level sale before.",
        impactWhy: "without group deals, growth stays at about two plants a month.",
        mitigation:
          "Ask for the pipeline of group-level deals and who leads them. Consider a senior enterprise hire as part of the round. A first group pilot before the next round would show whether the step can be taken.",
        evidence: ["customers", "team"],
        module: "people_team",
      },
      {
        key: "runway",
        label: "Runway of 17 months",
        level: "medium",
        likelihood: 3,
        impact: 3,
        cause: "Net burn of about EUR 82,000 a month leaves roughly 17 months of runway.",
        evidenceNote: "The data room shows cash of EUR 1.4 million at the end of September.",
        context:
          "Revenue grows by about two plants a month, which covers only part of the extra cost from new hires. Without the round, the company would have to slow hiring by the middle of 2027.",
        likelihoodWhy: "the plan adds six hires in 2027, which raises the burn.",
        impactWhy:
          "the company would need its next round before group deals can show up in the figures.",
        mitigation:
          "Size the round to give at least 24 months at the planned hiring pace. Ask which hires can wait if group deals are slower. The fund should check the hiring plan line by line before an offer is made.",
        evidence: ["finance"],
        module: "fund_finance_deal",
      },
    ],
    strengths: [
      "Overtime down 22 % at a reference factory.",
      "Monthly logo churn of only 1.2 %.",
      "Founders know both the factory floor and scheduling software.",
    ],
    weaknesses: ["No enterprise sales experience.", "About 17 months of runway."],
    openQuestions: [
      "Which industrial groups are in the pipeline?",
      "How does the engine perform in plants with more than 2,000 workers?",
    ],
    summary:
      "Shiftloom shows measurable savings for customers and very low churn, and fits the thesis. Growth so far comes from single plants; the step to industrial groups is untested, and the runway is about 17 months.",
    contrary:
      "Large workforce-management suites could add factory-specific planning and win the groups before Shiftloom gets there.",
    keyFindings: [
      {
        statement: "Overtime down 22 % after six months at a reference factory.",
        direction: "up",
        category: "product_market_fit",
        importance: 3,
      },
      {
        statement: "All customers are single plants; group sales untested.",
        direction: "down",
        category: "traction_gtm",
        importance: 2,
      },
    ],
    nextSteps: [
      {
        title: "Group pipeline",
        question: "Which industrial groups are in the pipeline, and who leads those deals?",
        why: "Growth beyond single plants needs group deals.",
        kind: "question",
        category: "traction_gtm",
      },
      {
        title: "Large-plant test",
        question: "Ask for performance data from the largest plant on the platform.",
        why: "Engine scale is untested above 2,000 workers.",
        kind: "verification",
        category: "product_technology",
      },
    ],
    profile: {
      business: "Shiftloom (fictional) sells shift planning software to factories.",
      productModel: "Subscription per worker per month, with an app for shift swaps.",
      market: "European workforce management for manufacturing, EUR 1.9 billion in 2025.",
      team: "Founders from a paper mill and hospital scheduling software; team of 11.",
      economyCapital: "EUR 820,000 ARR, EUR 1.4 million cash; raising a seed round.",
      status: "23 factories in Finland and Sweden.",
    },
    notes: ["Deep analysis running. Key question: can they sell to industrial groups?"],
    deep: {
      notes: {
        fund_thesis_fit:
          "Revenue grows with the number of workers per plant, which suits expansion within groups.",
        founder_market_fit:
          "The CEO's background in production planning makes the product credible on the factory floor.",
        team_market_fit: "An enterprise sales hire would close the most visible gap.",
        product_market_fit:
          "Low churn and measured savings point to real product-market fit in mid-sized plants.",
        market_timing: "Labour shortages in manufacturing make better planning a priority now.",
        traction_gtm: "Two new plants a month is steady but not yet venture-scale.",
        product_technology:
          "Supporting labour rules per country is a moat once built, but each new country costs time.",
        financial_strength:
          "The round must extend runway to 24 months to give group sales time to land.",
        evidence_quality: "Most figures that matter are confirmed by the data room or a reference.",
      },
      overall:
        "Shiftloom is a solid seed case with real savings for its customers and very low churn. The founders know the factory floor and scheduling software, and the product fits mid-sized plants well.\n\nThe open question is the step to industrial groups, which buy centrally and slowly and which nobody on the team has sold to. Together with a runway of about 17 months, this makes the size of the round and an enterprise hire the key points for the committee.",
      contrary:
        "Large workforce-management suites could add factory planning and win the industrial groups first, leaving Shiftloom with mid-sized plants only.",
      recommendation: "go_forward",
      investmentCondition:
        "The round gives at least 24 months of runway at the planned hiring pace.",
      specialists: {
        people_team: {
          summary:
            "Founders with the right background; the team lacks enterprise sales experience.",
          headline: "Credible founders; no enterprise seller yet",
          questions: ["Who will lead group-level deals?"],
        },
        product_market_gtm: {
          summary: "Clear savings and low churn in mid-sized plants; group sales untested.",
          headline: "Overtime down 22 %; churn 1.2 % a month",
          questions: ["Which industrial groups are in the pipeline?"],
        },
        technology_risk: {
          summary:
            "A planning engine that handles labour rules for four countries; scale above 2,000 workers untested.",
          headline: "Strong engine; large plants not yet proven",
          questions: ["How does the engine perform at the largest plant?"],
        },
        fund_finance_deal: {
          summary: "About 17 months of runway; the round must reach 24 months.",
          headline: "17 months of runway at today's burn",
          questions: ["Which hires can wait if group deals are slower?"],
        },
      },
      finance: [
        {
          metric: "arr",
          label: "ARR",
          value: 820000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "arr",
        },
        {
          metric: "mrr",
          label: "MRR",
          value: 68000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "monthly_operating_expenses",
          label: "Operating cost per month",
          value: 150000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "cash",
          label: "Cash",
          value: 1400000,
          unit: "EUR",
          periodStart: null,
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "sales_marketing_spend",
          label: "Sales and marketing per month",
          value: 38000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "new_customers",
          label: "New customers per month",
          value: 2,
          unit: "customers",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "customers",
          label: "Customers",
          value: 23,
          unit: "customers",
          periodStart: null,
          periodEnd: "2026-09-30",
          evidence: "customers",
        },
        {
          metric: "monthly_churn_rate",
          label: "Monthly churn",
          value: 0.012,
          unit: "ratio",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "customers",
        },
      ],
      market: {
        label: "Workforce management for manufacturing, Europe",
        scope: "sam",
        geography: "Europe",
        unit: "million",
        evidence: "market",
        points: [
          [2024, 1740, "actual"],
          [2025, 1900, "actual"],
          [2026, 2070, "forecast"],
          [2027, 2260, "forecast"],
          [2028, 2460, "forecast"],
        ],
      },
      tech: [
        {
          metric: "Countries' labour rules supported",
          unit: "countries",
          company: 4,
          industry: 2,
          higherIsBetter: true,
          evidence: "team",
        },
        {
          metric: "Time to add a country",
          unit: "months",
          company: 2,
          industry: 6,
          higherIsBetter: false,
          evidence: "team",
        },
        {
          metric: "Overtime reduction",
          unit: "%",
          company: 22,
          industry: 10,
          higherIsBetter: true,
          evidence: "reference",
        },
      ],
      ownership: {
        asOf: "2026-09-30",
        evidence: "captable",
        holders: [
          { holder: "Founders", type: "founder", percent: 72 },
          { holder: "Seed angels", type: "investor", percent: 12 },
          { holder: "Regional fund (fictional)", type: "investor", percent: 9 },
          { holder: "Option pool", type: "employee_pool", percent: 7 },
        ],
        rounds: [
          { name: "Angel round", date: "2024-09", amount: 600000, investors: ["Seed angels"] },
          {
            name: "Bridge",
            date: "2025-11",
            amount: 900000,
            investors: ["Regional fund (fictional)"],
          },
        ],
      },
    },
  },

  // 7 · Committee --------------------------------------------------------------------------------
  {
    key: "mailmoat",
    name: "Mailmoat",
    website: "https://mailmoat.example",
    sector: "cybersecurity",
    sectorLabel: "Cybersecurity",
    geography: "DK",
    stage: "series_a",
    description:
      "Fictional demo company. Mailmoat stops invoice fraud and supplier impersonation in company email by learning how each supplier normally writes and pays.",
    path: "committee",
    recommendation: "go_forward",
    people: [
      {
        key: "mailmoat-ceo",
        name: "Signe Kjær",
        role: "CEO and co-founder",
        founder: true,
        scores: [8, 9, 8, 6, 9],
        evidence: ["team"],
      },
      {
        key: "mailmoat-cto",
        name: "Rasmus Tolstrup",
        role: "CTO and co-founder",
        founder: true,
        scores: [9, 8, 5, 9, 7],
        evidence: ["team"],
      },
      {
        key: "mailmoat-cro",
        name: "Olivia Brandt",
        role: "Chief revenue officer",
        founder: false,
        scores: [7, 8, 9, 4, 7],
        evidence: ["team"],
      },
    ],
    evidence: [
      {
        key: "arr",
        claim: "Annual recurring revenue (ARR)",
        value: "EUR 4.2 million, up from EUR 1.9 million a year earlier",
        statedBy: DATA_ROOM,
        status: "verified",
        observed: "2026-09-30",
      },
      {
        key: "customers",
        claim: "Customers and retention",
        value: "540 companies; net revenue retention 126 %; monthly churn 0.8 %",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-09-30",
      },
      {
        key: "team",
        claim: "Founders' background",
        value:
          "CEO led fraud operations at a Nordic bank; CTO built email filtering at a security vendor",
        statedBy: CALL,
        status: "company_stated",
        observed: "2026-09-25",
      },
      {
        key: "market",
        claim: "Business email security, Europe",
        value: "EUR 2.4 billion in 2025, growing about 14 % a year",
        statedBy: MARKET,
        status: "corroborated",
        observed: "2026-05-01",
      },
      {
        key: "detection",
        claim: "Detection performance",
        value: "Caught 97 % of test fraud attempts with a false-positive rate of 0.02 %",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-08-31",
      },
      {
        key: "finance",
        claim: "Monthly figures",
        value:
          "MRR EUR 350,000, operating cost EUR 520,000, cash EUR 6.8 million, gross margin 82 %",
        statedBy: DATA_ROOM,
        status: "verified",
        observed: "2026-09-30",
      },
      {
        key: "captable",
        claim: "Cap table",
        value:
          "Founders 51 %, seed fund 18 %, angels 9 %, venture debt warrants 2 %, option pool 20 %",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-09-30",
      },
      {
        key: "reference",
        claim: "Customer reference",
        value: "Logistics group reports two stopped fraud attempts worth EUR 380,000 in Q2",
        statedBy: REFERENCE,
        status: "corroborated",
        observed: "2026-10-03",
      },
    ],
    scores: {
      fund_thesis_fit: 82,
      founder_market_fit: 88,
      team_market_fit: 82,
      product_market_fit: 84,
      market_timing: 78,
      traction_gtm: 84,
      product_technology: 80,
      financial_strength: 74,
      evidence_quality: 80,
    },
    facts: {
      fund_thesis_fit: {
        text: "Mailmoat is Nordic B2B software at Series A with strong recurring revenue, inside the thesis.",
        evidence: ["arr"],
        up: "Nordic B2B software at Series A.",
      },
      founder_market_fit: {
        text: "The CEO led fraud operations at a bank and the CTO built email filtering at a security vendor.",
        evidence: ["team"],
        up: "Founders from fraud operations and email security.",
      },
      team_market_fit: {
        text: "A chief revenue officer joined from a security vendor and built a sales team of eight.",
        evidence: ["team"],
        up: "Experienced revenue leader in place.",
      },
      product_market_fit: {
        text: "Net revenue retention is 126 % and monthly churn 0.8 % across 540 companies.",
        evidence: ["customers"],
        up: "Retention of 126 % with very low churn.",
      },
      market_timing: {
        text: "Business email security in Europe is EUR 2.4 billion and grows about 14 % a year as invoice fraud rises.",
        evidence: ["market"],
      },
      traction_gtm: {
        text: "ARR more than doubled in a year, from EUR 1.9 million to EUR 4.2 million.",
        evidence: ["arr"],
        up: "ARR more than doubled in a year.",
      },
      product_technology: {
        text: "In tests the product caught 97 % of fraud attempts with a false-positive rate of 0.02 %.",
        evidence: ["detection"],
        up: "High detection with very few false alarms.",
      },
      financial_strength: {
        text: "Gross margin is 82 %, and cash of EUR 6.8 million covers about three years at the current net burn.",
        evidence: ["finance"],
        up: "82 % gross margin and about three years of runway.",
      },
      evidence_quality: {
        text: "Revenue is verified against bank statements; retention and detection are corroborated by references and test reports.",
        evidence: ["arr", "detection"],
        nature: "fact",
      },
    },
    risks: [
      {
        key: "platform_bundling",
        label: "Email platforms could add the feature",
        level: "high",
        likelihood: 3,
        impact: 4,
        cause:
          "The largest email platforms are adding fraud detection to their own security packages.",
        evidenceNote:
          "The market report lists platform bundling as the main pressure on independent vendors.",
        likelihoodWhy:
          "platforms move slowly into niches, but invoice fraud is now a board-level topic.",
        impactWhy:
          "bundled detection would squeeze prices for the smaller customers that make up most of the base.",
        mitigation:
          "Ask for win and loss data against bundled tools and the share of revenue from customers above 500 employees. Test how much of the detection depends on payment data the platforms do not have.",
        evidence: ["market", "customers"],
        module: "product_market_gtm",
      },
      {
        key: "false_positives",
        label: "False alarms at scale",
        level: "medium",
        likelihood: 2,
        impact: 3,
        cause: "A false alarm can block a real supplier payment.",
        evidenceNote:
          "The test reports a false-positive rate of 0.02 %, measured on customers' historic mail.",
        context:
          "So far the company has handled every reported false alarm within four hours, according to the data room, but the largest customer has only been live for three months.",
        likelihoodWhy: "the rate is low today, but larger customers send far more invoices.",
        impactWhy:
          "a blocked payment to a key supplier would damage trust with exactly the customers Mailmoat wants to grow.",
        mitigation:
          "Ask for the false-positive rate per customer size and the process when a payment is wrongly held. Check the incident log for the last 12 months. A false alarm that blocks a payment should be followed up by a named person on the customer's side.",
        evidence: ["detection"],
        module: "technology_risk",
      },
      {
        key: "valuation",
        label: "Price of the round",
        level: "medium",
        likelihood: 3,
        impact: 2,
        cause: "The company asks for a valuation near 20 times ARR.",
        evidenceNote: "The round is led by a growth investor with a competing term sheet.",
        context:
          "The competing term sheet comes from a growth investor who usually pays more for growth than early-stage funds do. The company does not need the money right away, which strengthens its hand in the negotiation.",
        likelihoodWhy: "the competing term sheet sets a high reference price.",
        impactWhy: "a high entry price lowers the fund's return even if the company does well.",
        mitigation:
          "Agree the fund's maximum price before the committee. Consider a smaller ticket in the round rather than leading it. The fund should be ready to walk away if the price moves above that maximum.",
        evidence: ["captable"],
        module: "fund_finance_deal",
      },
    ],
    strengths: [
      "ARR more than doubled in a year to EUR 4.2 million.",
      "Net revenue retention of 126 % and churn of 0.8 % a month.",
      "Founders from fraud operations and email security.",
    ],
    weaknesses: ["Email platforms may bundle similar features.", "High price asked for the round."],
    openQuestions: [
      "How much revenue comes from customers above 500 employees?",
      "What is the false-positive rate for the largest customers?",
      "What is the fund's maximum price?",
    ],
    summary:
      "Mailmoat is the strongest case in the pipeline: fast growth, very high retention and founders who know the problem from both sides. The committee needs to weigh the risk of email platforms bundling similar features and the price of the round.",
    contrary:
      "If the largest email platforms bundle invoice-fraud detection, Mailmoat's growth among smaller customers could stall within two years.",
    keyFindings: [
      {
        statement: "ARR from EUR 1.9 million to EUR 4.2 million in a year.",
        direction: "up",
        category: "traction_gtm",
        importance: 3,
      },
      {
        statement: "Net revenue retention of 126 %.",
        direction: "up",
        category: "product_market_fit",
        importance: 3,
      },
      {
        statement: "Email platforms may bundle fraud detection.",
        direction: "down",
        category: "market_timing",
        importance: 2,
      },
    ],
    nextSteps: [
      {
        title: "Revenue by customer size",
        question: "How much revenue comes from customers above 500 employees?",
        why: "Larger customers are less exposed to bundling.",
        kind: "question",
        category: "traction_gtm",
      },
      {
        title: "Maximum price",
        question: "Agree the fund's maximum price before the committee meeting.",
        why: "A competing term sheet sets a high reference.",
        kind: "meeting",
        category: "fund_thesis_fit",
      },
    ],
    profile: {
      business:
        "Mailmoat (fictional) protects company email against invoice fraud and supplier impersonation.",
      productModel: "Subscription per mailbox, sold directly and through IT partners.",
      market: "European business email security, EUR 2.4 billion in 2025.",
      team: "Founders from bank fraud operations and email security; experienced CRO with a sales team of eight.",
      economyCapital:
        "EUR 4.2 million ARR, 82 % gross margin, EUR 6.8 million cash; raising a Series A.",
      status: "540 customers in the Nordics and Germany.",
    },
    notes: [
      "Committee meeting booked. Partners agree on the team; the debate is price and platform risk.",
      "Reference call (fictional) with a logistics group: two stopped fraud attempts in Q2.",
    ],
    deep: {
      notes: {
        fund_thesis_fit:
          "Mailmoat would be one of the fund's larger tickets, which fits a Series A with this traction.",
        founder_market_fit:
          "The founders' background gives them credibility with security buyers and finance teams alike.",
        team_market_fit:
          "The revenue organisation is already built, which lowers execution risk after the round.",
        product_market_fit:
          "Expansion within customers is the clearest sign that the product earns its place.",
        market_timing:
          "Invoice fraud is rising, and boards now ask for controls; the timing is strong.",
        traction_gtm:
          "Partner sales bring about a third of new revenue, which scales without direct headcount.",
        product_technology:
          "Combining email patterns with payment data is harder for email platforms to copy.",
        financial_strength:
          "The company does not need this round to survive, which makes the price discussion harder.",
        evidence_quality: "The most important figures are verified or corroborated.",
      },
      overall:
        "Mailmoat is the strongest case in the pipeline. ARR more than doubled in a year, customers expand with a net revenue retention of 126 %, and churn is very low. The founders know invoice fraud from the bank side and email security from the vendor side, and a seasoned revenue leader has built the sales team.\n\nThe committee's two questions are platform risk and price. The largest email platforms are moving into fraud detection, which could press prices for smaller customers. And the company asks for a valuation near 20 times ARR with a competing term sheet on the table. The analysis supports going forward with a firm maximum price.",
      contrary:
        "Bundled fraud detection from the email platforms could stall growth among smaller customers, and the high entry price would then leave little room for a return.",
      recommendation: "go_forward",
      investmentCondition:
        "The fund invests only up to its agreed maximum price, and not as lead if the price is above it.",
      specialists: {
        people_team: {
          summary: "An exceptional founding team with a seasoned revenue leader already in place.",
          headline: "Strong founders and a built sales team",
          questions: ["How is the CRO incentivised after the round?"],
        },
        product_market_gtm: {
          summary: "Fast growth and high retention; platform bundling is the main market risk.",
          headline: "ARR doubled; platforms are the threat",
          questions: ["How much revenue comes from customers above 500 employees?"],
        },
        technology_risk: {
          summary:
            "High detection and very few false alarms; false alarms at large customers need watching.",
          headline: "97 % detection, 0.02 % false alarms",
          questions: ["What is the false-positive rate for the largest customers?"],
        },
        fund_finance_deal: {
          summary: "Healthy margin and three years of runway; the price asked is high.",
          headline: "82 % margin; price near 20x ARR",
          questions: ["What is the fund's maximum price?"],
        },
      },
      finance: [
        {
          metric: "arr",
          label: "ARR",
          value: 4200000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "arr",
        },
        {
          metric: "mrr",
          label: "MRR",
          value: 350000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "monthly_operating_expenses",
          label: "Operating cost per month",
          value: 520000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "cogs",
          label: "Cost of revenue per month",
          value: 63000,
          unit: "EUR",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "cash",
          label: "Cash",
          value: 6800000,
          unit: "EUR",
          periodStart: null,
          periodEnd: "2026-09-30",
          evidence: "finance",
        },
        {
          metric: "customers",
          label: "Customers",
          value: 540,
          unit: "customers",
          periodStart: null,
          periodEnd: "2026-09-30",
          evidence: "customers",
        },
        {
          metric: "monthly_churn_rate",
          label: "Monthly churn",
          value: 0.008,
          unit: "ratio",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          evidence: "customers",
        },
      ],
      market: {
        label: "Business email security, Europe",
        scope: "market",
        geography: "Europe",
        unit: "million",
        evidence: "market",
        points: [
          [2023, 1850, "actual"],
          [2024, 2100, "actual"],
          [2025, 2400, "actual"],
          [2026, 2740, "forecast"],
          [2027, 3120, "forecast"],
          [2028, 3560, "forecast"],
        ],
      },
      tech: [
        {
          metric: "Fraud attempts caught",
          unit: "%",
          company: 97,
          industry: 85,
          higherIsBetter: true,
          evidence: "detection",
        },
        {
          metric: "False-positive rate",
          unit: "%",
          company: 0.02,
          industry: 0.1,
          higherIsBetter: false,
          evidence: "detection",
        },
        {
          metric: "Gross margin",
          unit: "%",
          company: 82,
          industry: 75,
          higherIsBetter: true,
          evidence: "finance",
        },
      ],
      ownership: {
        asOf: "2026-09-30",
        evidence: "captable",
        holders: [
          { holder: "Founders", type: "founder", percent: 51 },
          { holder: "Seed fund (fictional)", type: "investor", percent: 18 },
          { holder: "Angel investors", type: "investor", percent: 9 },
          { holder: "Venture debt warrants", type: "other", percent: 2 },
          { holder: "Option pool", type: "employee_pool", percent: 20 },
        ],
        rounds: [
          { name: "Pre-seed", date: "2022-10", amount: 800000, investors: ["Angel investors"] },
          { name: "Seed", date: "2024-02", amount: 4500000, investors: ["Seed fund (fictional)"] },
          {
            name: "Venture debt",
            date: "2025-06",
            amount: 2000000,
            investors: ["Venture lender (fictional)"],
          },
        ],
      },
    },
  },

  // 8 · Invested ---------------------------------------------------------------------------------
  {
    key: "pickwright",
    name: "Pickwright Robotics",
    website: "https://pickwright.example",
    sector: "deeptech_hardware",
    sectorLabel: "Robotics",
    geography: "SE",
    stage: "series_a",
    description:
      "Fictional demo company. Pickwright Robotics sells picking robots to warehouses as a service: the robot arms pick mixed items from bins, and customers pay per pick.",
    path: "invested",
    recommendation: "go_forward",
    people: [
      {
        key: "pickwright-ceo",
        name: "Elin Strand",
        role: "CEO and co-founder",
        founder: true,
        scores: [8, 9, 8, 7, 9],
        evidence: ["team"],
      },
      {
        key: "pickwright-cto",
        name: "Viktor Ahlgren",
        role: "CTO and co-founder",
        founder: true,
        scores: [9, 8, 4, 10, 7],
        evidence: ["team"],
      },
      {
        key: "pickwright-vpops",
        name: "Nora Falk",
        role: "VP operations",
        founder: false,
        scores: [7, 9, 6, 6, 7],
        evidence: ["team"],
      },
    ],
    evidence: [
      {
        key: "arr",
        claim: "Annual recurring revenue (ARR)",
        value: "EUR 5.6 million from pick-based contracts",
        statedBy: DATA_ROOM,
        status: "verified",
        observed: "2026-06-30",
      },
      {
        key: "fleet",
        claim: "Robots in operation",
        value: "186 robots at 21 warehouses; 1.9 million picks a week",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-06-30",
      },
      {
        key: "team",
        claim: "Founders' background",
        value:
          "CEO ran automation at a large retailer's warehouses; CTO did a PhD in robotic grasping",
        statedBy: CALL,
        status: "company_stated",
        observed: "2026-06-12",
      },
      {
        key: "market",
        claim: "Warehouse piece-picking automation, Europe",
        value: "EUR 1.2 billion in 2025, expected EUR 3.5 billion by 2030",
        statedBy: MARKET,
        status: "corroborated",
        observed: "2026-03-15",
      },
      {
        key: "performance",
        claim: "Pick performance",
        value: "620 picks per hour per robot, 99.6 % success rate",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-06-30",
      },
      {
        key: "finance",
        claim: "Monthly figures",
        value:
          "MRR EUR 470,000, operating cost EUR 690,000, cost of revenue EUR 190,000, cash EUR 14.5 million after the round",
        statedBy: DATA_ROOM,
        status: "verified",
        observed: "2026-06-30",
      },
      {
        key: "captable",
        claim: "Cap table after the round",
        value:
          "Founders 38 %, this fund 12 %, lead investor 18 %, earlier investors 17 %, option pool 15 %",
        statedBy: DATA_ROOM,
        status: "verified",
        observed: "2026-07-31",
      },
      {
        key: "reference",
        claim: "Customer reference",
        value: "E-commerce warehouse reports pick cost down 41 % and peak capacity up 60 %",
        statedBy: REFERENCE,
        status: "corroborated",
        observed: "2026-06-20",
      },
    ],
    scores: {
      fund_thesis_fit: 78,
      founder_market_fit: 88,
      team_market_fit: 84,
      product_market_fit: 86,
      market_timing: 84,
      traction_gtm: 82,
      product_technology: 88,
      financial_strength: 72,
      evidence_quality: 82,
    },
    facts: {
      fund_thesis_fit: {
        text: "Pickwright is Nordic deep tech sold as a recurring service, which fits the thesis despite the hardware.",
        evidence: ["arr"],
        up: "Hardware sold as a recurring service.",
      },
      founder_market_fit: {
        text: "The CEO ran warehouse automation at a large retailer and the CTO did a PhD in robotic grasping.",
        evidence: ["team"],
        up: "Founders from warehouse operations and grasping research.",
      },
      team_market_fit: {
        text: "A VP of operations runs deployments; a new site goes live in about six weeks.",
        evidence: ["team"],
        up: "Deployments in about six weeks.",
      },
      product_market_fit: {
        text: "A reference warehouse reports pick cost down 41 % and peak capacity up 60 %.",
        evidence: ["reference"],
        up: "Pick cost down 41 % at a reference site.",
      },
      market_timing: {
        text: "European piece-picking automation is expected to grow from EUR 1.2 billion in 2025 to EUR 3.5 billion by 2030.",
        evidence: ["market"],
        up: "Market expected to almost triple by 2030.",
      },
      traction_gtm: {
        text: "ARR of EUR 5.6 million from 186 robots at 21 warehouses.",
        evidence: ["arr", "fleet"],
      },
      product_technology: {
        text: "Each robot picks 620 items an hour with a 99.6 % success rate.",
        evidence: ["performance"],
        up: "High pick rate and success rate.",
      },
      financial_strength: {
        text: "After the round the company has EUR 14.5 million in cash; robots are financed per contract.",
        evidence: ["finance"],
      },
      evidence_quality: {
        text: "Revenue and the cap table are verified; performance is corroborated by references.",
        evidence: ["arr", "captable", "performance"],
        nature: "fact",
      },
    },
    risks: [
      {
        key: "hardware_capital",
        label: "Robots tie up capital",
        level: "medium",
        likelihood: 3,
        impact: 3,
        cause:
          "Pickwright owns the robots and earns per pick, so growth needs capital for every new robot.",
        evidenceNote:
          "The data room shows robots financed contract by contract through an asset lender.",
        context:
          "Each robot is financed over five years and earns back its cost in about two and a half years at current pick volumes. A rise in interest rates would lengthen that payback but not break the model.",
        likelihoodWhy: "the model needs financing for every new site, and rates can rise.",
        impactWhy: "more expensive financing would slow roll-out and lower the margin per pick.",
        mitigation:
          "Follow the asset financing terms at every board meeting. Ask for the plan if the lender's rate rises by two percentage points. The company should keep at least one alternative lender ready.",
        evidence: ["finance"],
        module: "fund_finance_deal",
      },
      {
        key: "large_competitors",
        label: "Large automation vendors",
        level: "medium",
        likelihood: 3,
        impact: 3,
        cause: "Established warehouse automation vendors are launching their own picking arms.",
        evidenceNote: "The market report names three vendors with picking products in pilot.",
        context:
          "So far Pickwright has won four of the six tenders where a large vendor also bid, mostly because customers did not want to pay upfront.",
        likelihoodWhy: "the large vendors already have the warehouse relationships.",
        impactWhy:
          "they could bundle picking into larger automation projects and squeeze Pickwright out of big tenders.",
        mitigation:
          "Track win rates in tenders where a large vendor bids. Keep the pay-per-pick model as the difference: no upfront capex for the customer. A lost tender should be reviewed with the customer to learn why.",
        evidence: ["market"],
        module: "product_market_gtm",
      },
    ],
    strengths: [
      "Pick cost down 41 % at a reference warehouse.",
      "620 picks an hour with 99.6 % success.",
      "Founders from warehouse operations and grasping research.",
    ],
    weaknesses: [
      "Growth needs capital for every robot.",
      "Large automation vendors entering the market.",
    ],
    openQuestions: ["How do financing costs change the margin per pick?"],
    summary:
      "Pickwright combines strong technology with a service model customers like: no upfront cost and a clear saving per pick. The fund invested in the Series A; the main risks to follow are the cost of financing robots and large vendors entering the market.",
    contrary:
      "Large automation vendors could bundle picking into bigger projects and take the largest warehouses before Pickwright scales.",
    keyFindings: [
      {
        statement: "Pick cost down 41 % and peak capacity up 60 % at a reference site.",
        direction: "up",
        category: "product_market_fit",
        importance: 3,
      },
      {
        statement: "620 picks an hour with a 99.6 % success rate.",
        direction: "up",
        category: "product_technology",
        importance: 2,
      },
    ],
    nextSteps: [
      {
        title: "Board follow-up",
        question: "Review the asset financing terms at the next board meeting.",
        why: "Financing cost drives the margin per pick.",
        kind: "task",
        category: "financial_strength",
      },
    ],
    profile: {
      business:
        "Pickwright Robotics (fictional) provides picking robots to warehouses as a service.",
      productModel: "Customers pay per pick; Pickwright owns, installs and maintains the robots.",
      market:
        "European piece-picking automation, EUR 1.2 billion in 2025, expected EUR 3.5 billion by 2030.",
      team: "Founders from retail warehouse automation and robotics research; VP operations runs deployments.",
      economyCapital: "EUR 5.6 million ARR; EUR 14.5 million cash after the Series A.",
      status: "186 robots at 21 warehouses in Sweden, Denmark and Germany.",
    },
    notes: [
      "Invested in the Series A as co-investor (fictional). Board observer seat agreed.",
      "First board meeting after closing: deployments on plan, financing terms to be reviewed each quarter.",
    ],
    decision:
      "Invested: strong technology and a service model customers like; co-investor in the Series A.",
    deep: {
      notes: {
        fund_thesis_fit:
          "The pay-per-pick model gives software-like recurring revenue on top of hardware.",
        founder_market_fit:
          "The CEO's years running warehouses give the company unusual credibility with operations buyers.",
        team_market_fit: "Six-week deployments show an operations team that can scale roll-out.",
        product_market_fit: "Savings at the reference site are large enough to sell themselves.",
        market_timing: "Labour shortages in warehouses make automation urgent.",
        traction_gtm: "Most new sites come from existing customers adding warehouses.",
        product_technology:
          "Grasping of mixed items is the hard part, and Pickwright's success rate leads the field.",
        financial_strength:
          "Asset financing keeps robots off the balance sheet but adds interest-rate risk.",
        evidence_quality: "The key figures are verified or corroborated.",
      },
      overall:
        "Pickwright Robotics is a strong Series A case. The technology leads on the hardest part of piece picking, mixed items, and customers see large savings without paying upfront. The founders know both the warehouse floor and the research behind grasping, and the operations team brings new sites live in about six weeks.\n\nThe model ties up capital in robots, financed contract by contract, and large automation vendors are moving into picking. Both are risks to follow rather than reasons to stop. The analysis supports an investment as co-investor in the round.",
      contrary:
        "Large automation vendors could bundle picking into larger projects, and rising financing costs could squeeze the margin per pick at the same time.",
      recommendation: "go_forward",
      investmentCondition:
        "The fund takes a board observer seat and reviews financing terms every quarter.",
      specialists: {
        people_team: {
          summary:
            "Founders from warehouse operations and grasping research, with a strong operations lead.",
          headline: "Operator-founder and a grasping PhD",
          questions: ["How will the team scale deployments to 50 sites?"],
        },
        product_market_gtm: {
          summary: "Large savings per pick and a fast-growing market; large vendors are entering.",
          headline: "Pick cost down 41 %; vendors entering",
          questions: ["What is the win rate in tenders against large vendors?"],
        },
        technology_risk: {
          summary: "Leading success rate on mixed items; maintenance costs are tracked per robot.",
          headline: "99.6 % success on mixed items",
          questions: ["What is the maintenance cost per robot per year?"],
        },
        fund_finance_deal: {
          summary: "Well funded after the round; robot financing adds interest-rate risk.",
          headline: "EUR 14.5 million cash; robots financed per contract",
          questions: ["How do financing costs change the margin per pick?"],
        },
      },
      finance: [
        {
          metric: "arr",
          label: "ARR",
          value: 5600000,
          unit: "EUR",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          evidence: "arr",
        },
        {
          metric: "mrr",
          label: "MRR",
          value: 470000,
          unit: "EUR",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          evidence: "finance",
        },
        {
          metric: "monthly_operating_expenses",
          label: "Operating cost per month",
          value: 690000,
          unit: "EUR",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          evidence: "finance",
        },
        {
          metric: "cogs",
          label: "Cost of revenue per month",
          value: 190000,
          unit: "EUR",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          evidence: "finance",
        },
        {
          metric: "cash",
          label: "Cash",
          value: 14500000,
          unit: "EUR",
          periodStart: null,
          periodEnd: "2026-07-31",
          evidence: "finance",
        },
        {
          metric: "customers",
          label: "Customers",
          value: 21,
          unit: "customers",
          periodStart: null,
          periodEnd: "2026-06-30",
          evidence: "fleet",
        },
      ],
      market: {
        label: "Warehouse piece-picking automation, Europe",
        scope: "market",
        geography: "Europe",
        unit: "million",
        evidence: "market",
        points: [
          [2024, 900, "actual"],
          [2025, 1200, "actual"],
          [2026, 1550, "forecast"],
          [2027, 1950, "forecast"],
          [2028, 2400, "forecast"],
          [2030, 3500, "forecast"],
        ],
      },
      tech: [
        {
          metric: "Picks per hour per robot",
          unit: "picks",
          company: 620,
          industry: 450,
          higherIsBetter: true,
          evidence: "performance",
        },
        {
          metric: "Pick success rate",
          unit: "%",
          company: 99.6,
          industry: 98.5,
          higherIsBetter: true,
          evidence: "performance",
        },
        {
          metric: "Time to go live at a new site",
          unit: "weeks",
          company: 6,
          industry: 16,
          higherIsBetter: false,
          evidence: "team",
        },
      ],
      ownership: {
        asOf: "2026-07-31",
        evidence: "captable",
        holders: [
          { holder: "Founders", type: "founder", percent: 38 },
          { holder: "Lead investor (fictional)", type: "investor", percent: 18 },
          { holder: "Earlier investors", type: "investor", percent: 17 },
          { holder: "This fund", type: "investor", percent: 12 },
          { holder: "Option pool", type: "employee_pool", percent: 15 },
        ],
        rounds: [
          { name: "Seed", date: "2023-04", amount: 3000000, investors: ["Earlier investors"] },
          {
            name: "Series A",
            date: "2026-07",
            amount: 12000000,
            investors: ["Lead investor (fictional)", "This fund"],
          },
        ],
      },
    },
  },

  // 9 · Declined at committee --------------------------------------------------------------------
  {
    key: "carelingo",
    name: "Carelingo",
    website: "https://carelingo.example",
    sector: "edtech",
    sectorLabel: "Edtech",
    geography: "DE",
    stage: "seed",
    description:
      "Fictional demo company. Carelingo teaches German to foreign nurses with short daily lessons built around real hospital situations, paid for by the hiring hospitals.",
    path: "declined",
    recommendation: "follow",
    people: [
      {
        key: "carelingo-ceo",
        name: "Lena Hoffmann",
        role: "CEO and co-founder",
        founder: true,
        scores: [7, 6, 7, 4, 6],
        evidence: ["team"],
      },
      {
        key: "carelingo-cpo",
        name: "Tobias Brenner",
        role: "Chief product officer and co-founder",
        founder: true,
        scores: [6, 6, 5, 7, 5],
        evidence: ["team"],
      },
    ],
    evidence: [
      {
        key: "arr",
        claim: "Annual recurring revenue (ARR)",
        value: "EUR 380,000",
        statedBy: DATA_ROOM,
        status: "corroborated",
        observed: "2026-08-31",
      },
      {
        key: "learners",
        claim: "Learners and completion",
        value: "2,100 nurses enrolled; 46 % reach the B2 exam level within 9 months",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-08-31",
      },
      {
        key: "team",
        claim: "Founders' background",
        value: "CEO recruited foreign nurses for a hospital group; CPO built a language app",
        statedBy: CALL,
        status: "company_stated",
        observed: "2026-09-10",
      },
      {
        key: "market",
        claim: "Language training for foreign health workers, Germany",
        value: "EUR 260 million a year, growing with recruitment abroad",
        statedBy: MARKET,
        status: "corroborated",
        observed: "2026-04-01",
      },
      {
        key: "finance",
        claim: "Monthly figures",
        value:
          "MRR EUR 32,000, operating cost EUR 110,000, cash EUR 0.9 million, monthly churn 3.5 % of hospitals",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-08-31",
      },
      {
        key: "captable",
        claim: "Cap table",
        value: "Founders 78 %, angels 15 %, option pool 7 %",
        statedBy: DATA_ROOM,
        status: "company_stated",
        observed: "2026-08-31",
      },
      {
        key: "retention",
        claim: "Hospital renewals",
        value: "6 of 14 hospitals renewed after the first year",
        statedBy: REFERENCE,
        status: "corroborated",
        observed: "2026-09-15",
      },
    ],
    gates: { geography_fit: null },
    scores: {
      fund_thesis_fit: 60,
      founder_market_fit: 72,
      team_market_fit: 58,
      product_market_fit: 52,
      market_timing: 74,
      traction_gtm: 56,
      product_technology: 60,
      financial_strength: 44,
      evidence_quality: 60,
    },
    facts: {
      fund_thesis_fit: {
        text: "Carelingo is B2B software sold to hospitals, but headquartered in Germany, at the edge of the fund's geography.",
        evidence: ["arr"],
      },
      founder_market_fit: {
        text: "The CEO recruited foreign nurses for a hospital group and knows the buyer's problem first hand.",
        evidence: ["team"],
        up: "CEO knows the hospitals' recruiting problem.",
      },
      team_market_fit: {
        text: "A small team of nine with limited sales capacity towards hospital groups.",
        evidence: ["team"],
      },
      product_market_fit: {
        text: "Only 6 of 14 hospitals renewed after the first year, and 46 % of nurses reach exam level within nine months.",
        evidence: ["retention", "learners"],
        down: "Only 6 of 14 hospitals renewed.",
      },
      market_timing: {
        text: "German hospitals recruit more nurses abroad every year, and language is the main bottleneck.",
        evidence: ["market"],
        up: "Recruitment abroad keeps growing.",
      },
      traction_gtm: { text: "ARR is EUR 380,000 after two years of selling.", evidence: ["arr"] },
      product_technology: {
        text: "The lessons are built on hospital situations, but the app is not clearly different from general language apps.",
        evidence: ["team"],
      },
      financial_strength: {
        text: "Cash of EUR 0.9 million against a net burn of about EUR 78,000 a month gives under a year of runway.",
        evidence: ["finance"],
        down: "Under a year of runway.",
      },
      evidence_quality: {
        text: "Revenue and renewals are corroborated; learning outcomes are the company's own figures.",
        evidence: ["arr", "retention"],
        nature: "fact",
      },
    },
    risks: [
      {
        key: "renewals",
        label: "Hospitals do not renew",
        level: "high",
        likelihood: 4,
        impact: 4,
        cause: "Fewer than half of the hospitals renewed after the first year.",
        evidenceNote: "A reference check showed that 6 of 14 hospitals renewed.",
        context:
          "Hospitals that did not renew mostly said that results varied too much between nurses, and two moved to in-person courses.",
        likelihoodWhy: "hospitals say results vary too much between nurses to justify the price.",
        impactWhy:
          "low renewals mean growth must come from new hospitals at a high sales cost, which the runway cannot carry.",
        mitigation:
          "Declined for now. If renewals rise above 80 % on the new programme, the team can look again with fresh data. Ask the founders to share the next cohort's results. The team can then check whether the new programme closes the gap.",
        evidence: ["retention"],
        module: "product_market_gtm",
      },
      {
        key: "runway",
        label: "Under a year of runway",
        level: "high",
        likelihood: 4,
        impact: 3,
        cause: "Net burn of about EUR 78,000 a month against EUR 0.9 million in cash.",
        evidenceNote: "The data room shows no committed investors beyond the angels.",
        context:
          "The angels have said they will not lead the next round, and no new investor has committed yet, so the company may have to accept a bridge on hard terms.",
        likelihoodWhy: "the company must raise within months.",
        impactWhy:
          "a rushed round would come at a low price and with little room to fix the renewals.",
        mitigation:
          "Not pursued at this stage. The fund keeps in touch and can revisit if a lead investor commits and renewals improve. A bridge on fair terms from existing investors would change the picture.",
        evidence: ["finance"],
        module: "fund_finance_deal",
      },
    ],
    strengths: [
      "CEO knows the hospitals' recruiting problem.",
      "Recruitment of foreign nurses keeps growing.",
    ],
    weaknesses: ["Only 6 of 14 hospitals renewed.", "Under a year of runway."],
    openQuestions: [
      "Why did eight hospitals not renew?",
      "Does the new programme lift exam pass rates?",
    ],
    summary:
      "Carelingo addresses a real and growing problem, and the CEO knows the buyer. But fewer than half of the hospitals renewed, and the runway is under a year. The committee declined.",
    contrary:
      "A new programme could lift renewals, and with recruitment abroad growing, Carelingo could become the standard partner for hospital groups.",
    keyFindings: [
      {
        statement: "Only 6 of 14 hospitals renewed after the first year.",
        direction: "down",
        category: "product_market_fit",
        importance: 3,
      },
      {
        statement: "Under a year of runway.",
        direction: "down",
        category: "financial_strength",
        importance: 2,
      },
    ],
    nextSteps: [
      {
        title: "Keep in touch",
        question: "Ask the founders to share renewals for the next cohort.",
        why: "Renewals decide whether to revisit.",
        kind: "task",
        category: "product_market_fit",
      },
    ],
    profile: {
      business:
        "Carelingo (fictional) teaches German to foreign nurses on behalf of hiring hospitals.",
      productModel: "Hospitals pay per nurse per year for daily lessons and exam preparation.",
      market: "Language training for foreign health workers in Germany, EUR 260 million a year.",
      team: "CEO from hospital recruiting, CPO from a language app; team of nine.",
      economyCapital: "EUR 380,000 ARR, EUR 0.9 million cash; raising a seed round.",
      status: "14 hospitals as customers, 6 renewed.",
    },
    notes: ["Committee declined: renewals and runway. Founders open to staying in touch."],
    decision: "Declined at the committee: low renewals among hospitals and under a year of runway.",
    deep: {
      notes: {
        fund_thesis_fit:
          "Germany is at the edge of the fund's geography, which would need an exception.",
        founder_market_fit:
          "The CEO's recruiting background is a real advantage in hospital sales.",
        team_market_fit:
          "The team is too small to sell to hospital groups and improve the product at the same time.",
        product_market_fit:
          "Renewals below half point to a product that does not yet deliver reliably.",
        market_timing: "The need is real and growing; timing is not the problem.",
        traction_gtm: "Two years to EUR 380,000 ARR is slow for the market's size.",
        product_technology:
          "The content is relevant, but little protects it from general language apps.",
        financial_strength: "The company needs money within months, which weakens its position.",
        evidence_quality: "Renewals were checked independently and confirm the concern.",
      },
      overall:
        "Carelingo addresses a real problem that grows every year: German hospitals recruit more nurses abroad, and language is the bottleneck. The CEO knows the hospitals' side first hand.\n\nBut the product does not yet deliver reliably. Fewer than half of the hospitals renewed after the first year, and learning outcomes vary widely between nurses. With under a year of runway, the company has little room to fix this before it must raise. The analysis does not support an investment now; the fund should follow the next cohort's renewals.",
      contrary:
        "A new programme could lift renewals quickly, and the fund would then miss a company with a clear position in a growing market.",
      recommendation: "follow",
      investmentCondition: null,
      specialists: {
        people_team: {
          summary: "A founder who knows the buyer, but a team too small for the task ahead.",
          headline: "Strong buyer insight; thin team",
          questions: ["Who would lead sales to hospital groups?"],
        },
        product_market_gtm: {
          summary: "A growing need, but renewals below half.",
          headline: "Only 6 of 14 hospitals renewed",
          questions: ["Why did eight hospitals not renew?"],
        },
        technology_risk: {
          summary: "Relevant content with little protection against general language apps.",
          headline: "Relevant content, weak moat",
          questions: ["What would stop a general language app from adding hospital lessons?"],
        },
        fund_finance_deal: {
          summary: "Under a year of runway and no lead investor.",
          headline: "Runway under a year",
          questions: ["Is any investor ready to lead the round?"],
        },
      },
      finance: [
        {
          metric: "arr",
          label: "ARR",
          value: 380000,
          unit: "EUR",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          evidence: "arr",
        },
        {
          metric: "mrr",
          label: "MRR",
          value: 32000,
          unit: "EUR",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          evidence: "finance",
        },
        {
          metric: "monthly_operating_expenses",
          label: "Operating cost per month",
          value: 110000,
          unit: "EUR",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          evidence: "finance",
        },
        {
          metric: "cash",
          label: "Cash",
          value: 900000,
          unit: "EUR",
          periodStart: null,
          periodEnd: "2026-08-31",
          evidence: "finance",
        },
        {
          metric: "customers",
          label: "Hospitals",
          value: 14,
          unit: "customers",
          periodStart: null,
          periodEnd: "2026-08-31",
          evidence: "retention",
        },
        {
          metric: "monthly_churn_rate",
          label: "Monthly churn",
          value: 0.035,
          unit: "ratio",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          evidence: "finance",
        },
      ],
      market: {
        label: "Language training for foreign health workers, Germany",
        scope: "market",
        geography: "Germany",
        unit: "million",
        evidence: "market",
        points: [
          [2023, 190, "actual"],
          [2024, 225, "actual"],
          [2025, 260, "actual"],
          [2026, 295, "forecast"],
          [2027, 330, "forecast"],
        ],
      },
      tech: [
        {
          metric: "Nurses reaching exam level in 9 months",
          unit: "%",
          company: 46,
          industry: 40,
          higherIsBetter: true,
          evidence: "learners",
        },
        {
          metric: "Hospital renewals after year one",
          unit: "%",
          company: 43,
          industry: 75,
          higherIsBetter: true,
          evidence: "retention",
        },
      ],
      ownership: {
        asOf: "2026-08-31",
        evidence: "captable",
        holders: [
          { holder: "Founders", type: "founder", percent: 78 },
          { holder: "Angel investors", type: "investor", percent: 15 },
          { holder: "Option pool", type: "employee_pool", percent: 7 },
        ],
        rounds: [
          { name: "Angel round", date: "2024-10", amount: 1200000, investors: ["Angel investors"] },
        ],
      },
    },
  },

  // 10 · Screened, reject recommended (still open) -----------------------------------------------
  {
    key: "stackmoss",
    name: "Stackmoss",
    website: "https://stackmoss.example",
    sector: "developer_tools",
    sectorLabel: "Developer tools",
    geography: "FI",
    stage: "pre_seed",
    description:
      "Fictional demo company. Stackmoss is a command-line tool that finds unused cloud resources and suggests how to shut them down safely.",
    path: "screened",
    recommendation: "reject",
    people: [
      {
        key: "stackmoss-ceo",
        name: "Joonas Lehto",
        role: "Founder",
        founder: true,
        scores: [6, 6, 3, 8, 4],
        evidence: ["team"],
      },
    ],
    evidence: [
      {
        key: "users",
        claim: "Open-source users",
        value: "3,400 GitHub stars; 41 companies on the paid plan",
        statedBy: DECK,
        status: "company_stated",
        observed: "2026-10-01",
      },
      {
        key: "team",
        claim: "Founder's background",
        value: "Solo founder, former platform engineer at a game studio",
        statedBy: CALL,
        status: "company_stated",
        observed: "2026-10-14",
      },
      {
        key: "market",
        claim: "Cloud cost management tools",
        value: "Crowded market with several funded competitors",
        statedBy: MARKET,
        status: "corroborated",
        observed: "2026-05-01",
      },
      {
        key: "revenue",
        claim: "Monthly revenue",
        value: "EUR 6,800 a month",
        statedBy: DECK,
        status: "company_stated",
        observed: "2026-10-01",
      },
    ],
    scores: {
      fund_thesis_fit: 64,
      founder_market_fit: 60,
      team_market_fit: 38,
      product_market_fit: 52,
      market_timing: 46,
      traction_gtm: 44,
      product_technology: 64,
      evidence_quality: 48,
    },
    facts: {
      fund_thesis_fit: {
        text: "Stackmoss is Nordic developer software at pre-seed, inside the thesis on paper.",
        evidence: ["users"],
      },
      founder_market_fit: {
        text: "The founder ran cloud platforms at a game studio and built the tool for his own team.",
        evidence: ["team"],
      },
      team_market_fit: {
        text: "Stackmoss is a solo founder with no co-founder or first hires planned.",
        evidence: ["team"],
        down: "Solo founder with no team.",
      },
      product_market_fit: {
        text: "3,400 GitHub stars, but only 41 companies pay.",
        evidence: ["users"],
      },
      market_timing: {
        text: "Cloud cost tools are a crowded market with several funded competitors.",
        evidence: ["market"],
        down: "Crowded market.",
      },
      traction_gtm: { text: "Revenue is EUR 6,800 a month.", evidence: ["revenue"] },
      product_technology: {
        text: "The tool is well regarded by users for its safe shut-down suggestions.",
        evidence: ["users"],
      },
      evidence_quality: {
        text: "All figures are the founder's own.",
        evidence: ["users", "revenue"],
        nature: "fact",
      },
    },
    risks: [
      {
        key: "solo_founder",
        label: "Solo founder",
        level: "high",
        likelihood: 4,
        impact: 4,
        cause: "Everything rests on one person.",
        evidenceNote: "The founder call confirms no co-founder and no hiring plan.",
        likelihoodWhy: "a solo founder must build, sell and raise at the same time.",
        impactWhy: "illness or burnout would stop the company.",
        mitigation:
          "Revisit if the founder brings in a commercial co-founder. Share the fund's view openly.",
        evidence: ["team"],
        module: "people_team",
      },
    ],
    strengths: ["Users like the tool's safe shut-down suggestions."],
    weaknesses: ["Solo founder with no team.", "Crowded market with funded competitors."],
    openQuestions: ["Is the founder looking for a commercial co-founder?"],
    summary:
      "Stackmoss has a well-liked open-source tool, but a solo founder in a crowded market and little paid traction. The screening recommends not going further unless a commercial co-founder joins.",
    contrary:
      "Open-source tools with this kind of following can convert to paid quickly once a commercial lead joins.",
    keyFindings: [
      {
        statement: "Solo founder with no team.",
        direction: "down",
        category: "team_market_fit",
        importance: 3,
      },
      {
        statement: "3,400 GitHub stars, 41 paying companies.",
        direction: "up",
        category: "product_market_fit",
        importance: 1,
      },
    ],
    nextSteps: [
      {
        title: "Co-founder question",
        question: "Is the founder looking for a commercial co-founder?",
        why: "The team is the main gap.",
        kind: "question",
        category: "team_market_fit",
      },
    ],
    profile: {
      business: "Stackmoss (fictional) finds unused cloud resources and suggests safe shut-downs.",
      productModel: "Free open-source tool with a paid team plan.",
      market: "Cloud cost management tools, a crowded market.",
      team: "Solo founder, former platform engineer.",
      economyCapital: "EUR 6,800 monthly revenue; raising a pre-seed round.",
      status: "41 paying companies.",
    },
    notes: [],
  },
];

/** The first paths of the case: what transition_case is asked to do, in order. */
export const DEMO_PATH_MOVES: Record<
  DemoPath,
  Array<{ toPhase: string | null; toStatus: string; reason: string | null; from: string }>
> = {
  screened: [],
  hold: [{ toPhase: null, toStatus: "on_hold", reason: "hold", from: "screening" }],
  rejected: [{ toPhase: "decided", toStatus: "closed", reason: "reject", from: "screening" }],
  deep: [{ toPhase: "deep_analysis", toStatus: "active", reason: null, from: "screening" }],
  committee: [
    { toPhase: "deep_analysis", toStatus: "active", reason: null, from: "screening" },
    { toPhase: "committee", toStatus: "active", reason: null, from: "deep_analysis" },
  ],
  invested: [
    { toPhase: "deep_analysis", toStatus: "active", reason: null, from: "screening" },
    { toPhase: "committee", toStatus: "active", reason: null, from: "deep_analysis" },
    { toPhase: "decided", toStatus: "invested", reason: "invest", from: "committee" },
  ],
  declined: [
    { toPhase: "deep_analysis", toStatus: "active", reason: null, from: "screening" },
    { toPhase: "committee", toStatus: "active", reason: null, from: "deep_analysis" },
    { toPhase: "decided", toStatus: "closed", reason: "decline_ic", from: "committee" },
  ],
};

/** Does the case get a deep analysis? */
export function hasDeepAnalysis(item: Pick<DemoCase, "path">): boolean {
  return ["deep", "committee", "invested", "declined"].includes(item.path);
}
