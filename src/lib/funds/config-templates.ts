import { FINANCE_GATES } from "../analysis/financial-gates.ts";
import type { Language } from "../i18n/language.ts";
import { fundConfigTemplatesEn } from "./config-templates-en.ts";
export const fundTemplateKeys = ["venture", "growth", "financial", "thematic", "blank"] as const;

export type FundTemplateKey = (typeof fundTemplateKeys)[number];
/** Svarer til databasens check på `strategy_type` (migration 0008). */
export type FundStrategyType = "venture" | "growth" | "thematic" | "custom";

type Gate = {
  key: string;
  label: string;
  description: string;
  treatment: "hard" | "review";
};

type Criterion = {
  key: string;
  label: string;
  description: string;
  category:
    | "fund_thesis_fit"
    | "founder_market_fit"
    | "team_market_fit"
    | "product_market_fit"
    | "product_technology"
    | "market_timing"
    | "traction_gtm"
    | "financial_strength"
    | "evidence_quality";
  weight: number;
};

export interface FundConfigTemplate {
  key: FundTemplateKey;
  label: string;
  description: string;
  strategyType: FundStrategyType;
  stages: string[];
  /** Forudfyldte sektorer (fx "Sektoragnostisk"); tom betyder, at fonden selv vælger. */
  sectors?: string[];
  analysisThreshold: number;
  riskPosture: string;
  stageExpectations: Record<string, string>;
  gates: Gate[];
  criteria: Criterion[];
}

const sharedEvidenceCriterion: Criterion = {
  key: "evidence_quality",
  label: "Evidenskvalitet og transparens",
  description:
    "Hvor stærkt, aktuelt og uafhængigt dokumenteret er de oplysninger, som investeringsbeslutningen bygger på?",
  category: "evidence_quality",
  weight: 8,
};

export const fundConfigTemplates: Record<FundTemplateKey, FundConfigTemplate> = {
  venture: {
    key: "venture",
    label: "Venture",
    description: "Tidlige teknologivirksomheder vurderet på team, marked, produkt og traction.",
    strategyType: "venture",
    stages: ["Pre-seed", "Seed", "Series A"],
    analysisThreshold: 70,
    riskPosture:
      "Høj teknologisk og markedsmæssig risiko kan accepteres, når potentialet er venture-skalerbart. Ukendt traction er ikke automatisk et afslag i pre-seed, men skal sænke sikkerheden i scoren.",
    stageExpectations: {
      "Pre-seed":
        "Vurder problemstyrke, founder-market fit, teknisk realisme og tidlige valideringssignaler højere end omsætning.",
      Seed: "Forvent dokumenteret kundevalidering, en tydelig GTM-hypotese og begyndende gentagelig traction.",
      "Series A":
        "Forvent dokumenteret product-market fit, reproducerbar vækst, kohorter og et forsvarligt kapitalbehov.",
    },
    gates: [
      {
        key: "stage_fit",
        label: "Stadie passer til mandatet",
        description:
          "Virksomhedens reelle modenhed og aktuelle runde skal ligge inden for de valgte stadier. Ukendt stadie kræver review.",
        treatment: "review",
      },
      {
        key: "geography_fit",
        label: "Geografi passer til mandatet",
        description:
          "Selskabets hovedsæde eller primære investeringsjurisdiktion skal ligge inden for den valgte geografi.",
        treatment: "review",
      },
      {
        key: "ticket_fit",
        label: "Investeringsstørrelse kan rummes",
        description:
          "Det forventede initiale ticket og den mulige ejerandel skal kunne rummes inden for mandatet.",
        treatment: "review",
      },
      {
        key: "legal_dealbreakers",
        label: "Ingen bindende dealbreakers",
        description:
          "Kontrollér eksplicitte juridiske, regulatoriske og etiske udelukkelser. Manglende evidens må markeres ukendt, ikke bestået.",
        treatment: "hard",
      },
    ],
    criteria: [
      {
        key: "thesis_fit",
        label: "Match med investeringstesen",
        description:
          "Hvor direkte casen matcher den erklærede investeringstese, sektorerne og det differentierede investeringssyn.",
        category: "fund_thesis_fit",
        weight: 14,
      },
      {
        key: "founder_market_fit",
        label: "Founder-market fit",
        description:
          "Foundernes relevante erfaring, indsigt, executionhistorik og særlige ret til at løse problemet.",
        category: "founder_market_fit",
        weight: 16,
      },
      {
        key: "team",
        label: "Team",
        description:
          "Teamets samlede kompetencer, komplementaritet, rekrutteringsevne, governance og væsentlige huller.",
        category: "team_market_fit",
        weight: 12,
      },
      {
        key: "product_market_fit",
        label: "Produkt-market fit",
        description:
          "Problemstyrke, kundeværdi, brug, retention, betalingsvilje og bevis for gentagelig efterspørgsel.",
        category: "product_market_fit",
        weight: 13,
      },
      {
        key: "market_timing",
        label: "Marked, timing og venturepotentiale",
        description:
          "Markedsstørrelse, vækst, konkurrence, timing og mulighed for et venture-skalerbart udfald.",
        category: "market_timing",
        weight: 13,
      },
      {
        key: "traction_gtm",
        label: "Traction og GTM",
        description:
          "Kvaliteten af vækst, kunder, pipeline, unit economics og den dokumenterede vej til markedet.",
        category: "traction_gtm",
        weight: 12,
      },
      {
        key: "technology",
        label: "Teknologi og defensibilitet",
        description:
          "Teknisk realisme, produktkvalitet, IP, datafordele, integrationsrisiko og varig defensibilitet.",
        category: "product_technology",
        weight: 12,
      },
      sharedEvidenceCriterion,
    ],
  },
  growth: {
    key: "growth",
    label: "Growth / Buyout",
    description:
      "Modne virksomheder med større vægt på økonomi, cash flow, drift og værdiskabelse.",
    strategyType: "growth",
    stages: ["Growth", "Buyout"],
    analysisThreshold: 72,
    riskPosture:
      "Produkt- og markedsrisiko skal være reduceret. Der kræves højere dokumentationsgrad for omsætning, margin, cash conversion, kundekoncentration, gæld og den konkrete værdiskabelsesplan.",
    stageExpectations: {
      Growth:
        "Forvent skalerbar vækst, robuste kohorter, tydelig unit economics og en realistisk vej til profitabilitet.",
      Buyout:
        "Forvent verificerbar indtjening, cash flow, ledelsesdybde, finansierbar kapitalstruktur og konkrete værdiskabelsesgreb.",
    },
    gates: [
      {
        key: "financial_materiality",
        label: "Finansielle nøgletal kan verificeres",
        description:
          "Omsætning, EBITDA eller relevant cash-flow-basis skal kunne afstemmes til pålidelige regnskaber eller diligence-materiale.",
        treatment: "review",
      },
      {
        key: "ticket_fit",
        label: "Ticket og ejerandel passer",
        description:
          "Kapitalbehov, værdiansættelse og ønsket ejerandel skal ligge inden for det publicerede mandat.",
        treatment: "hard",
      },
      {
        key: "legal_dealbreakers",
        label: "Ingen bindende dealbreakers",
        description:
          "Kontrollér eksplicitte juridiske, regulatoriske, leverage- og ESG-udelukkelser.",
        treatment: "hard",
      },
      // C7: finans-gates, der regnes i kode fra CVR-regnskabet (financial-gates.ts).
      ...FINANCE_GATES.filter((gate) => gate.key !== "finance_nibd_ebitda_3x").map((gate) => ({
        key: gate.key,
        label: gate.label,
        description: gate.description,
        treatment: gate.treatment,
      })),
    ],
    criteria: [
      {
        key: "thesis_fit",
        label: "Strategisk fit",
        description:
          "Match med markedssynet, værdiskabelsesmodellen, ejerhorisonten og afkastkravet.",
        category: "fund_thesis_fit",
        weight: 12,
      },
      {
        key: "financial_quality",
        label: "Finansiel kvalitet",
        description:
          "Omsætningskvalitet, margin, cash conversion, gæld, working capital og robusthed i downside-scenarier.",
        category: "financial_strength",
        weight: 24,
      },
      {
        key: "market_position",
        label: "Marked og position",
        description:
          "Markedsstruktur, vækst, konkurrencefordel, pricing power og modstandsdygtighed.",
        category: "market_timing",
        weight: 16,
      },
      {
        key: "commercial_engine",
        label: "Kommerciel motor",
        description:
          "Kunder, retention, koncentration, pipeline, salgsproduktivitet og mulighed for fortsat vækst.",
        category: "traction_gtm",
        weight: 16,
      },
      {
        key: "management",
        label: "Ledelse og governance",
        description:
          "Ledelseskvalitet, incitamenter, succession, rapportering og evne til at gennemføre planen.",
        category: "team_market_fit",
        weight: 12,
      },
      {
        key: "value_creation",
        label: "Værdiskabelsesplan",
        description:
          "Konkrete, målbare driftsmæssige eller strategiske initiativer og deres gennemførelsesrisiko.",
        category: "product_market_fit",
        weight: 12,
      },
      sharedEvidenceCriterion,
    ],
  },
  // E5: finans-først / økonomi-fokuseret (research 03 afsnit 5; tallene vurderet af Claude efter
  // produktejerens beslutning). Finans-gates regnes i kode fra CVR-regnskaberne.
  financial: {
    key: "financial",
    label: "Økonomi-fokuseret (finans-først)",
    description:
      "Etablerede og profitable virksomheder, vækst omkring break-even og generationsskifter. Sektoragnostisk med vægt på cashflow, likviditet og drift.",
    strategyType: "custom",
    stages: ["Etableret og profitabel", "Vækst", "Generationsskifte / Buyout"],
    sectors: ["Sektoragnostisk"],
    analysisThreshold: 68,
    riskPosture:
      "Lav til moderat. Kapitalbevarelse går forud for upside. Kræver verificerbar indtjening og likviditet. Manglende regnskaber sænker datatilliden markant, men er usikkerhed, ikke et afslag i sig selv.",
    stageExpectations: {
      "Etableret og profitabel":
        "Forvent mindst 3 års årsrapporter, positivt driftsresultat og stabil pengestrøm fra drift.",
      Vækst:
        "Forvent dokumenteret bruttomargin, en vej til positivt cashflow inden for 24 måneder og finansieret runway.",
      "Generationsskifte / Buyout":
        "Forvent ejeruafhængig drift, dokumenteret ledelse og en finansierbar pris og kapitalstruktur.",
    },
    gates: [
      {
        key: "ticket_fit",
        label: "Ticket, ejerandel og kontrolrettigheder passer",
        description:
          "Kapitalbehov, værdiansættelse, ønsket ejerandel og kontrolrettigheder skal ligge inden for mandatet.",
        treatment: "hard",
      },
      {
        key: "legal_dealbreakers",
        label: "Ingen bindende dealbreakers",
        description:
          "Kontrollér eksplicitte juridiske, regulatoriske, leverage- og ESG-udelukkelser.",
        treatment: "hard",
      },
      // Alle finans-gates, inkl. gearing (nettogæld højst 3 × EBITDA) og going concern-noten.
      ...FINANCE_GATES.map((gate) => ({
        key: gate.key,
        label: gate.label,
        description: gate.description,
        treatment: gate.treatment,
      })),
    ],
    criteria: [
      {
        key: "cashflow_earnings",
        label: "Cashflow og indtjeningskvalitet",
        description:
          "Driftsresultat, EBITDA-margin, cash conversion og hvor gentagelig og dokumenteret indtjeningen er.",
        category: "financial_strength",
        weight: 22,
      },
      {
        key: "liquidity_balance",
        label: "Likviditet, balance og gearing",
        description:
          "Soliditet, likviditetsgrad, nettogæld i forhold til indtjening, arbejdskapital og afdragsprofil.",
        category: "financial_strength",
        weight: 15,
      },
      {
        key: "operating_model",
        label: "Forretningsmodel og driftskvalitet",
        description: "Marginer, effektivitet, processer og hvor skalerbar driften er.",
        category: "product_market_fit",
        weight: 14,
      },
      {
        key: "management_governance",
        label: "Ledelse, governance og ejeruafhængighed",
        description:
          "Ledelsens dybde, governance, rapportering, succession og hvor afhængig driften er af ejeren.",
        category: "team_market_fit",
        weight: 13,
      },
      {
        key: "commercial_robustness",
        label: "Kommerciel robusthed",
        description: "Kundekoncentration, kontrakter, retention og prisstyrke.",
        category: "traction_gtm",
        weight: 12,
      },
      {
        key: "market_resilience",
        label: "Markedsposition og konjunkturrobusthed",
        description: "Markedsandel, konkurrence og robusthed over for konjunkturer og renter.",
        category: "market_timing",
        weight: 10,
      },
      {
        key: "strategic_fit",
        label: "Strategisk fit og ejerhorisont",
        description:
          "Match med investeringstesen, ejerhorisonten, afkastkravet og værdiskabelsesmodellen.",
        category: "fund_thesis_fit",
        weight: 8,
      },
      { ...sharedEvidenceCriterion, weight: 6 },
    ],
  },
  thematic: {
    key: "thematic",
    label: "Tematisk / makro",
    description:
      "Virksomheder vurderet ud fra et investeringssyn, makrodrivere og selskabsspecifik kvalitet.",
    strategyType: "thematic",
    stages: ["Listed", "Late stage", "Private"],
    analysisThreshold: 70,
    riskPosture:
      "Makro- og tematiske eksponeringer må være centrale, men de skal oversættes til verificerbare selskabsdrivere. Valuation, balance, likviditet og katalysatorer skal kunne vurderes særskilt.",
    stageExpectations: {
      Listed:
        "Forvent offentlige regnskaber, segmentdata, guidance, valuation og tydelige katalysatorer.",
      "Late stage":
        "Forvent institutionel rapportering, dokumenteret økonomi og en realistisk kapitalmarkedsvej.",
      Private:
        "Forvent ledelsesdata, scenarier og tydelig dokumentation for, hvordan det tematiske syn skaber selskabsværdi.",
    },
    gates: [
      {
        key: "theme_exposure",
        label: "Reel eksponering mod investeringstesen",
        description:
          "En væsentlig del af selskabets økonomi eller fremtidige værdiskabelse skal kunne knyttes til det valgte tema.",
        treatment: "review",
      },
      {
        key: "liquidity_ticket",
        label: "Ticket, likviditet og instrument passer",
        description:
          "Investeringsstørrelse, instrument, likviditet og ejerbegrænsninger skal være forenelige med mandatet.",
        treatment: "hard",
      },
      {
        key: "legal_dealbreakers",
        label: "Ingen bindende dealbreakers",
        description:
          "Kontrollér eksplicitte juridiske, regulatoriske, jurisdiktions- og ESG-udelukkelser.",
        treatment: "hard",
      },
    ],
    criteria: [
      {
        key: "thesis_fit",
        label: "Tese- og makrofit",
        description:
          "Styrken af koblingen mellem investeringssynet, de relevante makrodrivere og selskabets faktiske indtjening.",
        category: "fund_thesis_fit",
        weight: 22,
      },
      {
        key: "market_timing",
        label: "Timing og katalysatorer",
        description:
          "Cyklus, regulatoriske skift, supply-demand, katalysatorer og risikoen for at tesen er korrekt på forkert tidspunkt.",
        category: "market_timing",
        weight: 16,
      },
      {
        key: "business_quality",
        label: "Forretningskvalitet",
        description:
          "Konkurrencefordel, pricing power, kundeloyalitet og evne til at omsætte temaet til varig værdi.",
        category: "product_market_fit",
        weight: 16,
      },
      {
        key: "financial_quality",
        label: "Finansiel kvalitet og valuation",
        description:
          "Balance, indtjening, cash flow, kapitalbehov og værdiansættelse i base-, bull- og bear-scenarier.",
        category: "financial_strength",
        weight: 20,
      },
      {
        key: "management",
        label: "Ledelse og kapitalallokering",
        description:
          "Ledelsens execution, troværdighed, incitamenter og historik for kapitalallokering.",
        category: "team_market_fit",
        weight: 10,
      },
      {
        key: "risk_asymmetry",
        label: "Risiko og asymmetri",
        description:
          "Downside, sensitivitet, likviditet, regulatorisk risiko og forholdet mellem sandsynligt tab og potentiel gevinst.",
        category: "traction_gtm",
        weight: 8,
      },
      sharedEvidenceCriterion,
    ],
  },
  blank: {
    key: "blank",
    label: "Tom opsætning",
    description: "Start fra bunden og definér selv mandatregler og scoringsmodel.",
    strategyType: "custom",
    stages: [],
    analysisThreshold: 70,
    riskPosture: "",
    stageExpectations: {},
    gates: [],
    criteria: [],
  },
};

/**
 * A template in a team's language: Danish is the source above, English puts the words from
 * `config-templates-en.ts` on the same keys, weights, gates and thresholds. Text without an
 * English version stays Danish (a test checks that there is none).
 */
export function fundConfigTemplateIn(key: FundTemplateKey, language: Language): FundConfigTemplate {
  const template = fundConfigTemplates[key];
  if (language === "da") return template;
  const en = fundConfigTemplatesEn[key];
  const stageName = (stage: string) => en.stages[stage]?.name ?? stage;
  return {
    ...template,
    label: en.label,
    description: en.description,
    stages: template.stages.map(stageName),
    riskPosture: en.riskPosture,
    stageExpectations: Object.fromEntries(
      Object.entries(template.stageExpectations).map(([stage, text]) => [
        stageName(stage),
        en.stages[stage]?.expectation ?? text,
      ]),
    ),
    gates: template.gates.map((gate) => ({ ...gate, ...en.gates[gate.key] })),
    criteria: template.criteria.map((criterion) => ({
      ...criterion,
      ...en.criteria[criterion.key],
    })),
  };
}

/** Every template in a team's language. */
export function fundConfigTemplatesIn(language: Language): FundConfigTemplate[] {
  return fundTemplateKeys.map((key) => fundConfigTemplateIn(key, language));
}
