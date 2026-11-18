import { callCheapGateway, HelperRejected } from "./cheap-gateway.server";
import {
  PROPOSAL_JSON_SCHEMA,
  proposalResponseSchema,
  type DraftFields,
  type ProposalResponse,
} from "./config-ops";
import { serverText } from "@/lib/i18n/server-text";

/** One proposal may cost at most this (about 0.3 kr). */
export const PROPOSAL_BUDGET_USD = 0.05;

/** "screening": the user describes how the team screens, in their own words. */
export type ProposalKind = "fix" | "thesis" | "screening";

/** A failure whose Danish message is meant for the user as it stands. */
export { HelperRejected as ProposalRejected };

function systemPrompt(kind: ProposalKind): string {
  // i18n-keep: prompt to the model; a fund in English gets the language rule last.
  const common = `Du hjælper et investeringsteam med at rette i sin opsætning i Interlect.ai. Du foreslår kun en kort liste af redigeringer (maks. 12) som strukturerede operationer. Du skriver aldrig selv kladden, og intet ændres, før et menneske har set forslaget og lagt det i kladden.

Regler du skal holde:
- Foreslå kun det, brugeren beder om. Rør ikke andet.
- Kriterievægte er procent, skal summe til 100, og hvert kriterie skal vægte mellem 5 og 40. Ændrer du en vægt, så ret de andre, så summen stadig er 100.
- En bindende mandatregel (treatment "hard") stopper en case, når den med sikkerhed brydes; en vurderingsregel ("review") kræver et menneskes vurdering. Manglende oplysninger er ukendt, aldrig et brud.
- Nøgler (target) til eksisterende kriterier og regler skal være nøjagtigt dem, der står i kladden. Nye nøgler er små bogstaver, tal og understreg.
- Opfind ikke fakta om teamet, tal eller tærskler, som brugeren ikke har nævnt. Er noget uklart, så foreslå det mindste, der svarer til ønsket.
- Skriv på nøgternt dansk. "summary" er ét kort afsnit om, hvad forslaget ændrer og hvorfor.

Operationer (felter der ikke bruges, er null):
- set_thesis {text} · set_risk_posture {text} · set_threshold {number 0-100}
- set_list {target: stages|geographies|sectors|dealbreakers, values}
- set_weight {target: kriterienøgle, number}
- set_criterion_text {target, label?, text? (beskrivelsen)}
- add_criterion {target: ny nøgle, label, text (beskrivelse), category, number (vægt)}; category er en af fund_thesis_fit, founder_market_fit, team_market_fit, product_market_fit, product_technology, market_timing, traction_gtm, financial_strength, evidence_quality
- remove_criterion {target}
- set_gate_treatment {target: regelnøgle, treatment: hard|review}
- add_gate {target: ny nøgle, label, text (beskrivelse), treatment}
- remove_gate {target}
- set_screening_instruction {text}: teamets egen screeningsinstruktion (på skærmen hedder den "Instruktion"), som screeningen følger (højst 3.000 tegn; tom tekst fjerner den). Skriv konkrete råd om, hvad screeningen skal lægge vægt på, og hvordan evidensen skal vejes. Gentag ikke kriterier, vægte eller mandatregler; de står allerede i opsætningen.`;
  if (kind === "thesis") {
    // i18n-keep: prompt to the model; a fund in English gets the language rule last.
    return `${common}

Opgave: brugeren beskriver sit team og sin investeringstese med egne ord. Brug det til at udfylde eller præcisere tese, stadier, geografi, sektorer, risikotolerance og tærskel. Ændr kun kriterier og regler, hvis brugeren nævner dem.`;
  }
  if (kind === "screening") {
    // i18n-keep: prompt to the model; a fund in English gets the language rule last.
    return `${common}

Opgave: brugeren beskriver med egne ord, hvordan teamet screener en ny case. Omsæt beskrivelsen til opsætningen: skriv eller ret instruktionen (set_screening_instruction) med det, der ikke allerede står i kriterier og regler, og ret kriterier, vægte, mandatregler og risikotolerance dér, hvor beskrivelsen siger noget, som opsætningen ikke afspejler. Ændr ikke tese, stadier, geografi, sektorer eller tærskel.`;
  }
  // i18n-keep: prompt to the model; a fund in English gets the language rule last.
  return `${common}

Opgave: brugeren vil have noget i den nuværende kladde rettet. Følg ønsket så præcist som muligt.`;
}

export async function generateConfigProposal(input: {
  fundId: string;
  userId: string;
  kind: ProposalKind;
  instruction: string;
  draft: DraftFields;
}): Promise<{ response: ProposalResponse; costUsd: number | null }> {
  const { content, costUsd } = await callCheapGateway({
    fundId: input.fundId,
    credits: { userId: input.userId, loop: `fund_setup:proposal_${input.kind}` },
    system: systemPrompt(input.kind),
    user: JSON.stringify({
      // Brugerens ønske er betroet input; kladden er data.
      userRequest: input.instruction,
      currentDraft: {
        thesis: input.draft.thesis,
        riskPosture: input.draft.riskPosture,
        stages: input.draft.stages,
        geographies: input.draft.geographies,
        sectors: input.draft.sectors,
        dealbreakers: input.draft.dealbreakers,
        analysisThreshold: input.draft.analysisThreshold,
        gates: input.draft.gates.map(({ key, label, description, treatment }) => ({
          key,
          label,
          description,
          treatment,
        })),
        criteria: input.draft.criteria.map(({ key, label, description, category, weight }) => ({
          key,
          label,
          description,
          category,
          weight,
        })),
        screeningInstruction: input.draft.screeningInstruction ?? "",
      },
    }),
    // v2: the prompt says "teamet" and calls the instruction "Instruktion", as the screen does.
    schema: { name: "interlect_config_proposal_v2", schema: PROPOSAL_JSON_SCHEMA },
    maxOutputTokens: 3_000,
    budgetUsd: PROPOSAL_BUDGET_USD,
    // i18n-keep: the call's name in logs and the AI log, not shown to the person.
    label: "Forslaget til opsætningen",
  });
  const parsed = proposalResponseSchema.safeParse(safeJson(content));
  if (!parsed.success) {
    console.error(
      "[config-proposal] model answer did not match the schema",
      parsed.error.issues[0],
    );
    throw new Error(serverText("fundServer.proposals.aiFailed"));
  }
  return { response: parsed.data, costUsd };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
