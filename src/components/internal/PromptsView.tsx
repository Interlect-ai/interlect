import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import {
  getAnalysisPromptDetail,
  type AnalysisMethodDetail,
} from "@/lib/analysis/method-detail.functions";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { scoreCategoryLabel } from "@/lib/domain/labels";
import type { FundProfile } from "@/lib/funds/profiles";
import { Disclosure } from "@/components/funds/FundConfigWorkspace";
import { RESEARCH_MODULE_LABELS } from "@/components/funds/editor/SpecialistEditors";
import { LoadingState, EmptyState } from "@/components/states/StateBlocks";
import { CriterionChainView, MessageBlock } from "@/components/funds/CriterionChainView";

/**
 * /intern/prompts (Admin only): the literal text the models receive, built by the server by
 * calling the same prompt functions as the analysis. Customers never see this; the server
 * refuses to deliver it to anyone but an Admin (getAnalysisPromptDetail).
 */
export function PromptsView() {
  const { fundId, fund } = useActiveFund();
  const getDetail = useServerFn(getAnalysisPromptDetail);
  const query = useQuery({
    queryKey: ["fund-analysis-prompts", fundId],
    queryFn: () => getDetail({ data: { fundId: fundId! } }),
    enabled: Boolean(fundId),
    retry: false,
  });

  if (query.isLoading) return <LoadingState title="Henter prompts …" />;
  if (query.isError || !query.data) {
    return (
      <EmptyState
        title="Prompts kunne ikke hentes"
        body={
          query.error instanceof Error
            ? query.error.message
            : `Investeringstesen ${fund?.name ?? ""} har ingen publiceret opsætning.`
        }
      />
    );
  }
  return <AnalysisMethodDetailView key={fundId} detail={query.data} />;
}

function AnalysisMethodDetailView({ detail }: { detail: AnalysisMethodDetail }) {
  const { profile } = detail;
  const screeningModules = detail.researchModules.filter((module) => module.mode === "screening");
  const deepModules = detail.researchModules.filter((module) => module.mode === "deep");

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <p className="max-w-prose text-list leading-6 text-ink-3">
        De bogstavelige instruktioner, modellerne modtager for den valgte investeringstese, fra
        offentlig research til komitésyntesen. Kun for Admin; kunderne ser dem ikke.
      </p>

      <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <InfoStat label="Tærskel for partnergodkendelse" value={`${profile.analysisThreshold}`} />
        <InfoStat
          label="Godkendelse"
          value={profile.approvalMode === "partner_approval" ? "Partnergodkendelse" : "Automatisk"}
        />
        <InfoStat label="Research-model, screening" value={detail.researchModel.screening} />
        <InfoStat label="Research-model, dyb analyse" value={detail.researchModel.deep} />
      </div>

      <CriterionChainView detail={detail} />

      {profile.gates.length > 0 && (
        <Disclosure
          title="Bindende mandatkontroller"
          description="Sådan afgør en gate mekanisk casens udfald -- uanset score."
          defaultOpen
        >
          <div className="space-y-3">
            <p className="text-list leading-5 text-ink-3">
              <strong className="text-ink-2">Hård gate:</strong> hvis AI'en rapporterer at casen
              ikke består, bliver casen automatisk blokeret og sat til afvisning i selve beregningen
              — uanset hvor høj den samlede score ellers er.{" "}
              <strong className="text-ink-2">Review-gate:</strong> et rapporteret nej ændrer i dag
              ikke automatisk udfaldet; den er til for at gøre teamet opmærksom på forholdet
              manuelt. Kun hvis AI'en slet ikke kan afgøre en gate, tæller det med i vurderingen af,
              om der mangler information til at konkludere.
            </p>
            <div className="divide-y divide-hairline">
              {profile.gates.map((gate) => (
                <div
                  key={gate.key}
                  className="grid gap-2 py-3 md:grid-cols-[210px_1fr_90px] md:items-center"
                >
                  <span className="text-list font-medium text-ink">{gate.label}</span>
                  <span className="text-list leading-5 text-ink-3">{gate.description}</span>
                  <span className="text-meta text-ink-4">
                    {gate.treatment === "hard" ? "Hård gate" : "Review"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Disclosure>
      )}

      <section className="panel space-y-4 p-[19px_21px]">
        <div>
          <h2 className="text-section font-semibold text-ink">1. Offentlig research</h2>
          <p className="mt-1 text-list leading-5 text-ink-3">
            Før noget vurderes, søger Interlect selskabet igennem på nettet — {""}
            {detail.researchModules.length} faste moduler, hver med sine egne søgespørgsmål sendt
            til en Perplexity-model. Websøgningen får selskabets navn, website, stadie, de founders
            der er oplyst på casen og én kort linje fra decket, så den finder det rigtige selskab.
            Resten af decket sendes ikke med. Decket og websitet bruges derefter direkte i
            screeningen som casens egen dokumentation.
          </p>
        </div>
        <ResearchModuleList
          title={`Screening (${screeningModules.length} moduler · ${detail.researchModel.screening})`}
          modules={screeningModules}
        />
        <ResearchModuleList
          title={`Dyb analyse (${deepModules.length} moduler · ${detail.researchModel.deep})`}
          modules={deepModules}
        />
      </section>

      <section className="panel space-y-3 p-[19px_21px]">
        <h2 className="text-section font-semibold text-ink">2. Screeningsvurdering</h2>
        <p className="text-list leading-5 text-ink-3">
          Den billige, hurtige første vurdering af casen mod fondens kriterier og gates.
        </p>
        <PromptTextDisclosure
          title="Vis den fulde systemtekst"
          text={detail.screeningPrompt.system}
        />
        <PromptTextDisclosure
          title="Vis beskeden med case-data"
          description="Eksempelcase uden kilder. I en rigtig case indeholder evidenslisten alle gemte kilder med ID, status og uddrag."
          text={detail.screeningPrompt.user}
        />
      </section>

      <section className="panel space-y-3 p-[19px_21px]">
        <h2 className="text-section font-semibold text-ink">3. Specialistmoduler (dyb analyse)</h2>
        <p className="text-list leading-5 text-ink-3">
          Fire specialister analyserer hver deres del af casen parallelt. Alle deler samme
          grundramme og ufravigelige regler, vist én gang herunder frem for gentaget under hvert
          modul.
        </p>
        <PromptTextDisclosure
          title="Vis den fælles grundramme (alle 4 specialister)"
          text={detail.globalDeepPreamble}
        />
        <div className="space-y-3">
          {detail.specialistModules.map((module) => (
            <SpecialistModuleCard key={module.id} module={module} profile={profile} />
          ))}
        </div>
      </section>

      <section className="panel space-y-3 p-[19px_21px]">
        <h2 className="text-section font-semibold text-ink">4. Investeringskomité-syntese</h2>
        <p className="text-list leading-5 text-ink-3">
          Samler de 4 specialistpakker til én sammenhængende analyse. Tilføjer aldrig nye fakta og
          beregner aldrig selv den samlede score — det sker deterministisk bagefter.
        </p>
        <PromptTextDisclosure
          title="Vis den fulde systemtekst"
          text={detail.synthesisPrompt.system}
        />
        <PromptTextDisclosure
          title="Vis beskeden med specialisternes resultater"
          description="Eksempel uden specialistpakker. I en rigtig analyse indeholder den de fire specialisters vurderinger."
          text={detail.synthesisPrompt.user}
        />
      </section>
    </div>
  );
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel space-y-1 p-3.5">
      <span className="block text-meta text-ink-4">{label}</span>
      <span className="block text-body font-medium text-ink">{value}</span>
    </div>
  );
}

function ResearchModuleList({
  title,
  modules,
}: {
  title: string;
  modules: AnalysisMethodDetail["researchModules"];
}) {
  if (!modules.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-list font-semibold text-ink-2">{title}</h3>
      <div className="space-y-2">
        {modules.map((module) => {
          const meta = RESEARCH_MODULE_LABELS[module.moduleId];
          return (
            <div
              key={`${module.mode}:${module.moduleId}`}
              className="rounded-sm border border-hairline p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-list font-medium text-ink">
                  {meta?.title ?? module.moduleId}
                </span>
                <span className="rounded-sm border border-hairline-strong px-1.5 py-0.5 text-meta text-ink-3">
                  {module.isCustomized ? "Tilpasset denne fond" : "Standard"}
                </span>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-list leading-5 text-ink-3">
                {module.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
              <div className="mt-2">
                <Disclosure
                  title="Vis den bogstavelige besked til Perplexity"
                  description="System- og user-besked med fondens rigtige brief og en eksempelcase."
                >
                  <div className="space-y-3">
                    <MessageBlock label="Systembesked" text={module.system} />
                    <MessageBlock label="Besked med case-data" text={module.user} />
                  </div>
                </Disclosure>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PromptTextDisclosure({
  title,
  description,
  text,
}: {
  title: string;
  description?: string;
  text: string;
}) {
  return (
    <Disclosure title={title} description={description ?? "Den præcise tekst, AI'en modtager."}>
      <pre className="max-h-[480px] overflow-y-auto text-wrap whitespace-pre-wrap text-meta leading-5 text-ink-2">
        {text}
      </pre>
    </Disclosure>
  );
}

function SpecialistModuleCard({
  module,
  profile,
}: {
  module: AnalysisMethodDetail["specialistModules"][number];
  profile: FundProfile;
}) {
  const moduleCriteria = profile.criteria.filter((criterion) =>
    module.categories.includes(criterion.category),
  );
  return (
    <section className="rounded-sm border border-hairline p-[17px_19px] space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-1.5 text-meta text-ink-4">
          <span>Screening</span>
          <ArrowRight className="size-3" aria-hidden />
          <span className="font-medium text-ink-2">{module.title}</span>
          <ArrowRight className="size-3" aria-hidden />
          <span>Syntese</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <h3 className="text-body font-semibold text-ink">{module.title}</h3>
          {module.isCustomized && (
            <span className="rounded-sm border border-hairline-strong px-1.5 py-0.5 text-meta text-ink-3">
              Tilpasset
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {module.categories.map((category) => {
          const categoryCriteria = moduleCriteria.filter(
            (criterion) => criterion.category === category,
          );
          return (
            <div key={category} className="rounded-sm border border-hairline p-3">
              <h4 className="text-list font-semibold text-ink">{scoreCategoryLabel[category]}</h4>
              {categoryCriteria.length === 0 ? (
                <p className="mt-1.5 text-list text-ink-4">
                  Ingen kriterier tilknyttet denne kategori endnu.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {categoryCriteria.map((criterion) => (
                    <li key={criterion.key} className="flex gap-3">
                      <span data-numeric className="shrink-0 text-list text-ink-3">
                        {criterion.weight}%
                      </span>
                      <div className="min-w-0">
                        <p className="text-list text-ink">{criterion.label}</p>
                        <p className="mt-0.5 text-list leading-5 text-ink-3">
                          {criterion.description}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <PromptTextDisclosure
        title="Vis den fulde systemtekst til dette modul"
        description={
          module.isCustomized
            ? "Tilpasset af denne investeringstese."
            : "Standardinstruktion. Fondens egne kriterier og tese flettes ind, når casen analyseres."
        }
        text={module.system}
      />
      <PromptTextDisclosure
        title="Vis beskeden med case-data til dette modul"
        description="Eksempelcase uden kilder. I en rigtig case indeholder den screeningsresultatet og alle gemte kilder."
        text={module.user}
      />
    </section>
  );
}
