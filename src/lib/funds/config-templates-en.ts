/**
 * The templates' text in English: a new English team gets an English first draft. The
 * Danish templates in `config-templates.ts` are the source (keys, weights, gates, thresholds);
 * this file only holds the words, looked up by key. `fundConfigTemplateIn` puts them together.
 * The text is saved in the team's setup as the team's own text, like the Danish.
 */
import type { FundTemplateKey } from "./config-templates.ts";

type Text = { label: string; description: string };

export interface TemplateTextEn {
  label: string;
  description: string;
  riskPosture: string;
  /** Keyed by the Danish template's stage name; the English stage name and its expectation. */
  stages: Record<string, { name: string; expectation: string }>;
  gates: Record<string, Text>;
  criteria: Record<string, Text>;
}

const evidenceQuality: Text = {
  label: "Evidence quality and transparency",
  description:
    "How strong, current and independently documented is the information the investment decision rests on?",
};

const legalDealbreakers = (description: string): Text => ({
  label: "No binding dealbreakers",
  description,
});

/** The finance gates (`FINANCE_GATES`), worked out in code from the registry's annual accounts. */
export const FINANCE_GATE_TEXT_EN: Record<string, Text> = {
  finance_positive_equity: {
    label: "Positive equity",
    description:
      "Equity in the latest approved annual report is positive. Worked out in code from the registry's accounts; binding only when the company match is certain.",
  },
  finance_runway_12m: {
    label: "Runway of at least 12 months today",
    description:
      "Cash lasts at least 12 months from today at the same operating burn, or the company does not burn cash. An estimate from the accounts.",
  },
  finance_min_filings: {
    label: "At least 2 approved financial years (3 for established companies)",
    description: "Number of annual accounts loaded for the company number.",
  },
  finance_filing_age_18m: {
    label: "Latest accounts at most 18 months old",
    description:
      "Months from the latest balance sheet date to today. Older figures give false comfort.",
  },
  finance_no_going_concern: {
    label: "No going concern note in the latest accounts",
    description:
      "The latest annual report has no note on material uncertainty about continued operations. Read in code from the registry's accounts; without the information the gate is unknown, not broken.",
  },
  finance_nibd_ebitda_3x: {
    label: "Net debt at most 3 × EBITDA",
    description:
      "Requires interest-bearing debt to be broken out in the accounts. Otherwise unknown, never a guess.",
  },
};

export const fundConfigTemplatesEn: Record<FundTemplateKey, TemplateTextEn> = {
  venture: {
    label: "Venture",
    description: "Early-stage technology companies assessed on team, market, product and traction.",
    riskPosture:
      "High technology and market risk can be accepted when the potential is venture-scale. Unknown traction is not automatically a rejection at pre-seed, but it should lower the confidence of the score.",
    stages: {
      "Pre-seed": {
        name: "Pre-seed",
        expectation:
          "Weigh problem strength, founder-market fit, technical realism and early validation signals above revenue.",
      },
      Seed: {
        name: "Seed",
        expectation:
          "Expect documented customer validation, a clear GTM hypothesis and early repeatable traction.",
      },
      "Series A": {
        name: "Series A",
        expectation:
          "Expect documented product-market fit, repeatable growth, cohorts and a sound capital need.",
      },
    },
    gates: {
      stage_fit: {
        label: "Stage fits the mandate",
        description:
          "The company's real maturity and current round must lie within the chosen stages. An unknown stage requires review.",
      },
      geography_fit: {
        label: "Geography fits the mandate",
        description:
          "The company's headquarters or primary investment jurisdiction must lie within the chosen geography.",
      },
      ticket_fit: {
        label: "Investment size can be accommodated",
        description:
          "The expected initial ticket and the possible ownership stake must fit within the mandate.",
      },
      legal_dealbreakers: legalDealbreakers(
        "Check explicit legal, regulatory and ethical exclusions. Missing evidence must be marked unknown, not passed.",
      ),
    },
    criteria: {
      thesis_fit: {
        label: "Match with the investment thesis",
        description:
          "How directly the case matches the stated investment thesis, the sectors and the differentiated investment view.",
      },
      founder_market_fit: {
        label: "Founder-market fit",
        description:
          "The founders' relevant experience, insight, execution track record and particular right to solve the problem.",
      },
      team: {
        label: "Team",
        description:
          "The team's combined skills, complementarity, ability to recruit, governance and significant gaps.",
      },
      product_market_fit: {
        label: "Product-market fit",
        description:
          "Problem strength, customer value, usage, retention, willingness to pay and proof of repeatable demand.",
      },
      market_timing: {
        label: "Market, timing and venture potential",
        description:
          "Market size, growth, competition, timing and the possibility of a venture-scale outcome.",
      },
      traction_gtm: {
        label: "Traction and GTM",
        description:
          "The quality of growth, customers, pipeline, unit economics and the documented route to market.",
      },
      technology: {
        label: "Technology and defensibility",
        description:
          "Technical realism, product quality, IP, data advantages, integration risk and lasting defensibility.",
      },
      evidence_quality: evidenceQuality,
    },
  },
  growth: {
    label: "Growth / Buyout",
    description:
      "Mature companies with more weight on financials, cash flow, operations and value creation.",
    riskPosture:
      "Product and market risk must be reduced. A higher level of documentation is required for revenue, margin, cash conversion, customer concentration, debt and the concrete value creation plan.",
    stages: {
      Growth: {
        name: "Growth",
        expectation:
          "Expect scalable growth, robust cohorts, clear unit economics and a realistic path to profitability.",
      },
      Buyout: {
        name: "Buyout",
        expectation:
          "Expect verifiable earnings, cash flow, management depth, a financeable capital structure and concrete value creation levers.",
      },
    },
    gates: {
      financial_materiality: {
        label: "Key financials can be verified",
        description:
          "Revenue, EBITDA or a relevant cash flow basis must reconcile with reliable accounts or diligence material.",
      },
      ticket_fit: {
        label: "Ticket and ownership fit",
        description:
          "Capital need, valuation and the desired ownership stake must lie within the published mandate.",
      },
      legal_dealbreakers: legalDealbreakers(
        "Check explicit legal, regulatory, leverage and ESG exclusions.",
      ),
      ...FINANCE_GATE_TEXT_EN,
    },
    criteria: {
      thesis_fit: {
        label: "Strategic fit",
        description:
          "Match with the market view, the value creation model, the ownership horizon and the return requirement.",
      },
      financial_quality: {
        label: "Financial quality",
        description:
          "Revenue quality, margin, cash conversion, debt, working capital and resilience in downside scenarios.",
      },
      market_position: {
        label: "Market and position",
        description:
          "Market structure, growth, competitive advantage, pricing power and resilience.",
      },
      commercial_engine: {
        label: "Commercial engine",
        description:
          "Customers, retention, concentration, pipeline, sales productivity and room for continued growth.",
      },
      management: {
        label: "Management and governance",
        description:
          "Management quality, incentives, succession, reporting and the ability to deliver the plan.",
      },
      value_creation: {
        label: "Value creation plan",
        description:
          "Concrete, measurable operational or strategic initiatives and the risk of delivering them.",
      },
      evidence_quality: evidenceQuality,
    },
  },
  financial: {
    label: "Financials first",
    description:
      "Established and profitable companies, growth around break-even and succession. Sector agnostic with weight on cash flow, liquidity and operations.",
    riskPosture:
      "Low to moderate. Capital preservation comes before upside. Requires verifiable earnings and liquidity. Missing accounts lower the data confidence markedly, but are uncertainty, not a rejection in themselves.",
    stages: {
      "Etableret og profitabel": {
        name: "Established and profitable",
        expectation:
          "Expect at least 3 years of annual reports, a positive operating result and stable cash flow from operations.",
      },
      Vækst: {
        name: "Growth",
        expectation:
          "Expect a documented gross margin, a path to positive cash flow within 24 months and financed runway.",
      },
      "Generationsskifte / Buyout": {
        name: "Succession / Buyout",
        expectation:
          "Expect owner-independent operations, documented management and a financeable price and capital structure.",
      },
    },
    gates: {
      ticket_fit: {
        label: "Ticket, ownership and control rights fit",
        description:
          "Capital need, valuation, the desired ownership stake and control rights must lie within the mandate.",
      },
      legal_dealbreakers: legalDealbreakers(
        "Check explicit legal, regulatory, leverage and ESG exclusions.",
      ),
      ...FINANCE_GATE_TEXT_EN,
    },
    criteria: {
      cashflow_earnings: {
        label: "Cash flow and quality of earnings",
        description:
          "Operating result, EBITDA margin, cash conversion and how repeatable and documented the earnings are.",
      },
      liquidity_balance: {
        label: "Liquidity, balance sheet and gearing",
        description:
          "Solvency, liquidity ratio, net debt relative to earnings, working capital and repayment profile.",
      },
      operating_model: {
        label: "Business model and operational quality",
        description: "Margins, efficiency, processes and how scalable the operations are.",
      },
      management_governance: {
        label: "Management, governance and owner independence",
        description:
          "Depth of management, governance, reporting, succession and how dependent operations are on the owner.",
      },
      commercial_robustness: {
        label: "Commercial robustness",
        description: "Customer concentration, contracts, retention and pricing power.",
      },
      market_resilience: {
        label: "Market position and cyclical resilience",
        description:
          "Market share, competition and resilience to economic cycles and interest rates.",
      },
      strategic_fit: {
        label: "Strategic fit and ownership horizon",
        description:
          "Match with the investment thesis, the ownership horizon, the return requirement and the value creation model.",
      },
      evidence_quality: evidenceQuality,
    },
  },
  thematic: {
    label: "Thematic / macro",
    description:
      "Companies assessed on an investment view, macro drivers and company-specific quality.",
    riskPosture:
      "Macro and thematic exposures may be central, but they must be translated into verifiable company drivers. Valuation, balance sheet, liquidity and catalysts must be assessable separately.",
    stages: {
      Listed: {
        name: "Listed",
        expectation:
          "Expect public accounts, segment data, guidance, valuation and clear catalysts.",
      },
      "Late stage": {
        name: "Late stage",
        expectation:
          "Expect institutional reporting, documented financials and a realistic route to the capital markets.",
      },
      Private: {
        name: "Private",
        expectation:
          "Expect management data, scenarios and clear documentation of how the thematic view creates company value.",
      },
    },
    gates: {
      theme_exposure: {
        label: "Real exposure to the investment thesis",
        description:
          "A significant part of the company's economics or future value creation must be linked to the chosen theme.",
      },
      liquidity_ticket: {
        label: "Ticket, liquidity and instrument fit",
        description:
          "Investment size, instrument, liquidity and ownership limits must be compatible with the mandate.",
      },
      legal_dealbreakers: legalDealbreakers(
        "Check explicit legal, regulatory, jurisdiction and ESG exclusions.",
      ),
    },
    criteria: {
      thesis_fit: {
        label: "Thesis and macro fit",
        description:
          "The strength of the link between the investment view, the relevant macro drivers and the company's actual earnings.",
      },
      market_timing: {
        label: "Timing and catalysts",
        description:
          "Cycle, regulatory shifts, supply and demand, catalysts and the risk that the thesis is right at the wrong time.",
      },
      business_quality: {
        label: "Business quality",
        description:
          "Competitive advantage, pricing power, customer loyalty and the ability to turn the theme into lasting value.",
      },
      financial_quality: {
        label: "Financial quality and valuation",
        description:
          "Balance sheet, earnings, cash flow, capital need and valuation in base, bull and bear scenarios.",
      },
      management: {
        label: "Management and capital allocation",
        description:
          "Management's execution, credibility, incentives and track record of capital allocation.",
      },
      risk_asymmetry: {
        label: "Risk and asymmetry",
        description:
          "Downside, sensitivity, liquidity, regulatory risk and the balance between likely loss and potential gain.",
      },
      evidence_quality: evidenceQuality,
    },
  },
  blank: {
    label: "Blank setup",
    description: "Start from scratch and define the mandate rules and scoring model yourself.",
    riskPosture: "",
    stages: {},
    gates: {},
    criteria: {},
  },
};
