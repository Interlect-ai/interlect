/**
 * /intern/komponenter: the shared components in the order of the design-system sheet
 * App shell, colours, typography,
 * form and depth, buttons and controls, status and actions, dialogs, fold-outs, the focus
 * page and the shared states. Used to approve side by side with the sheet.
 *
 * Everything shown here is the design system's example content (Nordhav Ventures II,
 * Havbrug Nord …), clearly marked at the top; no page reads from it.
 */
import { useState, type ReactNode } from "react";
import {
  CirclePause,
  CircleX,
  Gavel,
  Play,
  RefreshCw,
  Sparkles,
  ArrowUpRight,
  Clock,
  Ban,
  Users,
  Coins,
} from "lucide-react";
import { RailView, FundCardView, UserAreaView } from "@/components/ds/RailView";
import { Button, IconButton } from "@/components/ds/Button";
import { TextField } from "@/components/ds/Field";
import { Toggle } from "@/components/ds/Toggle";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { StatusChip, CASE_STATUS, type CaseStatusKey } from "@/components/ds/StatusChip";
import { SplitButton } from "@/components/ds/SplitButton";
import { MenuHeader, MenuItem, MenuLabel } from "@/components/ds/Menu";
import { ReasonChip, ReasonDialog } from "@/components/ds/Dialog";
import { showToast } from "@/components/ds/Toast";
import { BulkBar } from "@/components/ds/BulkBar";
import { Collapse } from "@/components/ds/Collapse";
import { CountUp } from "@/components/ds/CountUp";
import { FocusHost, FocusPage } from "@/components/ds/FocusPage";
import { EmptyState, ErrorState, LoadingState, NoAccess } from "@/components/ds/States";
import { Reveal, RevealGroup } from "@/components/ds/Reveal";
import { AiOrb } from "@/components/ai/AiOrb";
import { AiBeam } from "@/components/ai/AiBeam";
import { AiImageFx } from "@/components/ai/AiImageFx";
import { AiMetal } from "@/components/ai/AiMetal";
import { SpecialistBot } from "@/components/ai/SpecialistBot";
import type { SpecialistKind } from "@/components/ai/specialist-kind";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { CASE_ACTIONS } from "@/lib/copy/actions";
import { primaryNavigation, secondaryNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { CaseBlocksGallery } from "@/components/internal/CaseBlocksGallery";

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-7">
      <div className="flex max-w-[640px] flex-col gap-2">
        <h2 className="m-0 text-page leading-[1.1] font-semibold tracking-title">{title}</h2>
        {intro && <p className="m-0 text-body text-ink-3">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 overflow-hidden rounded-lg bg-surface p-[22px] shadow-card",
        className,
      )}
    >
      {title && <span className="text-list font-semibold">{title}</span>}
      {children}
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <span className="text-micro whitespace-nowrap text-ink-4">{children}</span>;
}

// ---------------------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------------------

const TABS = [
  { value: "igang", label: "I gang", count: 1 },
  { value: "screenet", label: "Screenet", count: 6 },
  { value: "dyb", label: "Dyb analyse", count: 4 },
  { value: "komite", label: "Komité", count: 2 },
  { value: "hold", label: "På hold", count: 3 },
] as const;

const ROWS: Array<{
  name: string;
  meta: string;
  score: number;
  line: string;
  status: CaseStatusKey;
}> = [
  {
    name: "Havbrug Nord",
    meta: "Seed, DK",
    score: 81,
    line: "Stærkt founder-marked-fit. Unit economics fra piloten er bekræftet mod regnskabet.",
    status: "active",
  },
  {
    name: "Klimalag",
    meta: "Pre-seed, SE",
    score: 76,
    line: "Trækkraft hos tre boligselskaber. Runway kan ikke beregnes endnu.",
    status: "awaiting_decision",
  },
  {
    name: "Fjordlys Energi",
    meta: "Serie A, NO",
    score: 74,
    line: "Solid ordrebog i Vestlandet. Marginen er presset af komponentpriser.",
    status: "on_hold",
  },
];

function ShellDemo() {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("screenet");
  return (
    <div className="flex h-[640px] overflow-hidden rounded-xl bg-canvas p-2.5 shadow-[0_0_0_1px_var(--line),0_40px_100px_-40px_rgba(23,21,28,.25)]">
      <div
        className={cn(
          "hidden shrink-0 flex-col pt-3.5 pr-2.5 pb-2.5 pl-3 md:flex",
          collapsed ? "w-[68px]" : "w-[236px]",
        )}
      >
        <RailView
          collapsed={collapsed}
          pathname="/cases"
          main={primaryNavigation.filter((item) => !item.brainOnly)}
          secondary={secondaryNavigation}
          onToggle={() => setCollapsed((c) => !c)}
          fund={
            <FundCardView
              collapsed={collapsed}
              name="Nordhav Ventures II"
              meta="Tese v4"
              chevron
              as="button"
            />
          }
          user={<UserAreaView collapsed={collapsed} userName="Maja Holm" roleLabel="Lead" />}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface px-8 py-7 shadow-card">
        <div className="mb-[26px] flex items-center gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[28px] leading-[1.1] font-semibold tracking-title">Cases</span>
            <span className="text-meta text-ink-3">29 aktive mod Nordhav Ventures II</span>
          </div>
          <div className="flex-1" />
          <Button variant="primary" size="md" icon={Sparkles}>
            Opret case
          </Button>
        </div>
        <SegmentedControl
          aria-label="Casernes trin"
          options={TABS}
          value={tab}
          onChange={setTab}
          className="mb-[22px] self-start"
        />
        <RevealGroup key={tab} start={0} step={0.05}>
          {ROWS.map((row) => (
            <Reveal key={row.name} y={6} duration={0.3}>
              <div className="flex items-center gap-4 border-b border-line py-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-full text-list font-semibold shadow-[inset_0_0_0_2.5px_var(--ink-1)]">
                  {row.score}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[15px] font-medium">{row.name}</span>
                    <span className="text-meta text-ink-4">{row.meta}</span>
                  </span>
                  <span className="truncate text-list text-ink-3">{row.line}</span>
                </span>
                <StatusChip status={row.status} className="hidden sm:inline-flex" />
              </div>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Colours, type, form
// ---------------------------------------------------------------------------------------

const NEUTRALS = [
  ["Lærred", "--bg-canvas"],
  ["Flade", "--bg-surface"],
  ["Sænket", "--bg-sunken"],
  ["Blæk 1", "--ink-1"],
  ["Blæk 2", "--ink-2"],
  ["Blæk 3", "--ink-3"],
  ["Blæk 4", "--ink-4"],
] as const;

const SIGNALS = [
  ["Handling", "--action", "--action-wash", "Links, fokusring, valgt tilstand, tærskelmarkør."],
  ["AI", "--ai", "--ai-wash", "Kun når AI arbejder eller har skrevet noget. Orb og byline."],
  ["Positiv", "--positive", "--positive-wash", "Bekræftet, anbefalet, vækst."],
  ["Advarsel", "--warning", "--warning-wash", "Kræver menneskelig vurdering. Ikke en fejl."],
  ["Kritisk", "--critical", "--critical-wash", "Kun bindende gate-brud og kritisk risiko."],
  ["Ukendt", "--unknown", "--unknown-wash", "Manglende data. Tegnes som kontur, aldrig som 0."],
] as const;

const TYPE_SCALE = [
  ["Hero", "72 · 600 · −3,5 %", "text-hero tracking-display leading-none", "81"],
  [
    "Display",
    "48 · 600 · −3,5 %",
    "text-display tracking-display leading-[1.05]",
    "3 beslutninger venter",
  ],
  ["Side", "32 · 600 · −2,2 %", "text-page tracking-title leading-[1.1]", "Havbrug Nord"],
  ["Titel", "22 · 600 · −2,2 %", "text-title tracking-title leading-[1.2]", "Profil mod tesen"],
  [
    "Sektion",
    "17 · 600 · −1 %",
    "text-section tracking-[-0.01em] leading-[1.3]",
    "Risici og afværgehandlinger",
  ],
  [
    "Brød",
    "15 · 400 · 1,6",
    "text-body font-normal text-ink-2 leading-[1.6]",
    "Piloten har kørt i 14 måneder med tre betalende kunder.",
  ],
  ["Liste", "13 · 500", "text-list font-medium leading-[1.4]", "Fjordlys Energi, Serie A, Norge"],
  [
    "Meta",
    "12 · 400",
    "text-meta font-normal text-ink-3 tracking-[0.005em]",
    "Interlect, 42 kilder, 14:02",
  ],
  [
    "Mikro",
    "11 · 500 · minimum",
    "text-micro font-medium text-ink-4 tracking-[0.01em]",
    "3 af 6 trin, tærskel 72",
  ],
] as const;

function Foundations() {
  return (
    <>
      <Section
        title="Farver"
        intro="Neutrale flader bærer 90 % af skærmen. Signalfarver har én betydning hver. Datafarverne må gerne være mange, men kun inde i grafer."
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {NEUTRALS.map(([name, token]) => (
            <div key={token} className="flex flex-col gap-2">
              <span
                className="h-[88px] rounded-md shadow-[0_0_0_1px_var(--line)]"
                style={{ background: `var(${token})` }}
              />
              <span className="text-list font-medium">{name}</span>
              <span className="font-mono text-micro text-ink-4">{token}</span>
            </div>
          ))}
        </div>
        <div className="grid gap-2.5 md:grid-cols-3">
          {SIGNALS.map(([name, color, wash, use]) => (
            <Card key={color} className="flex-row items-center gap-3.5 p-4">
              <span
                className="grid size-11 shrink-0 place-items-center rounded-sm"
                style={{ background: `var(${wash})` }}
              >
                <span className="size-3.5 rounded-full" style={{ background: `var(${color})` }} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-list font-semibold">
                  {name}{" "}
                  <span className="font-mono text-micro font-normal text-ink-4">{color}</span>
                </span>
                <span className="text-meta text-ink-2">{use}</span>
              </span>
            </Card>
          ))}
        </div>
        <Card title="Dataserier 1–10">
          <div className="grid grid-cols-5 gap-1.5 md:grid-cols-10">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <span
                  className="h-12 rounded-sm"
                  style={{ background: `var(--series-${i + 1})` }}
                />
                <span className="font-mono text-micro text-ink-4">--series-{i + 1}</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      <Section
        title="Typografi"
        intro="Én sans-serif i tre vægte. Store størrelser strammes, små får luft. Alle tal er tabular."
      >
        <Card className="gap-0 px-7 py-2">
          {TYPE_SCALE.map(([name, spec, cls, sample], index) => (
            <div
              key={name}
              className={cn(
                "grid grid-cols-[88px_minmax(0,1fr)] items-center gap-4 py-4 md:grid-cols-[150px_180px_minmax(0,1fr)]",
                index < TYPE_SCALE.length - 1 && "border-b border-line",
              )}
            >
              <span className="text-list font-medium">{name}</span>
              <span className="hidden font-mono text-micro text-ink-4 md:block">{spec}</span>
              <span className={cn("min-w-0 truncate font-semibold", cls)}>{sample}</span>
            </div>
          ))}
        </Card>
      </Section>

      <Section
        title="Form, luft og dybde"
        intro="Hjørner vokser med fladen: små kontroller er stramme, store kort er bløde, handlinger er piller. Elevation er en hårstreg plus blød, lav skygge."
      >
        <div className="grid gap-2.5 md:grid-cols-3">
          <Card title="Hjørner">
            <div className="flex flex-wrap gap-2.5">
              {(["xs", "sm", "md", "lg", "xl", "pill"] as const).map((r) => (
                <span key={r} className="flex flex-col items-center gap-1.5">
                  <span
                    className="size-11 bg-sunken shadow-[0_0_0_1px_var(--line)]"
                    style={{ borderRadius: `var(--radius-${r})` }}
                  />
                  <Caption>{r}</Caption>
                </span>
              ))}
            </div>
          </Card>
          <Card title="Mellemrum, 4-punkts skala">
            {[1, 2, 3, 4, 6, 8, 10, 14].map((n) => (
              <div key={n} className="flex items-center gap-3">
                <span className="w-20 font-mono text-micro text-ink-4">--space-{n}</span>
                <span
                  className="h-1.5 rounded-full bg-action/60"
                  style={{ width: `var(--space-${n})` }}
                />
                <span className="ml-auto text-micro text-ink-3">{n * 4}px</span>
              </div>
            ))}
          </Card>
          <Card title="Elevation" className="bg-sunken shadow-none">
            {[
              ["Pille", "shadow-pill", "knapper, faner"],
              ["Kort", "shadow-card", "moduler, paneler"],
              ["Løftet", "shadow-raised", "hover, popover"],
              ["Overlay", "shadow-overlay", "ark, dialog"],
            ].map(([name, shadow, use]) => (
              <div
                key={name}
                className={cn("flex items-center rounded-md bg-surface px-4 py-3", shadow)}
              >
                <span className="text-list font-medium">{name}</span>
                <span className="ml-auto text-micro text-ink-3">{use}</span>
              </div>
            ))}
          </Card>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------
// Controls, status, dialogs
// ---------------------------------------------------------------------------------------

const REASONS = [
  ["Uden for mandat", Ban],
  ["For tidligt", Clock],
  ["Svagt team", Users],
  ["Pris", Coins],
] as const;

function Controls() {
  const [pending, setPending] = useState(false);
  const [brain, setBrain] = useState(true);
  const [reasons, setReasons] = useState<string[]>(["Uden for mandat"]);
  return (
    <Section
      title="Knapper og kontroller"
      intro="Én primær handling pr. skærm: fyldt blæk-pille. Resten trappes ned i vægt. Alle knapper trykker sig 3 % sammen, mens du holder nede."
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="gap-4 p-[26px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="primary" icon={Play}>
              Kør dyb analyse
            </Button>
            <Button variant="secondary" icon={RefreshCw}>
              Kør screening igen
            </Button>
            <Button variant="quiet">Sæt på hold</Button>
            <Button variant="danger">Luk casen</Button>
          </div>
          <div className="flex flex-wrap gap-x-7 gap-y-2">
            <Caption>Primær, 1 pr. skærm</Caption>
            <Caption>Sekundær</Caption>
            <Caption>Stille</Caption>
            <Caption>Destruktiv, stille</Caption>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="primary"
              pending={pending ? "ai" : false}
              pendingLabel="Screener…"
              onClick={() => {
                setPending(true);
                window.setTimeout(() => setPending(false), 2400);
              }}
            >
              Screen igen
            </Button>
            <Button variant="primary" size="md">
              Lille, 36
            </Button>
            <Button variant="secondary" size="sm">
              Kompakt, 32
            </Button>
            <IconButton icon={ArrowUpRight} aria-label="Åbn" />
            <Button variant="primary" disabled>
              Opret og screen
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-7 gap-y-2">
            <Caption>Venter, orb i koral (klik)</Caption>
            <Caption>36 px</Caption>
            <Caption>32 px</Caption>
            <Caption>Ikon, rund</Caption>
            <Caption>Deaktiveret, 35 %</Caption>
          </div>
        </Card>
        <Card className="gap-[18px] p-[26px]">
          <TextField label="Website" placeholder="havbrugnord.dk" />
          <div className="flex flex-col gap-[7px]">
            <span className="text-meta font-medium text-ink-2">Årsag, vælg 1–3</span>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map(([label]) => (
                <ReasonChip
                  key={label}
                  selected={reasons.includes(label)}
                  onClick={() =>
                    setReasons((r) =>
                      r.includes(label) ? r.filter((x) => x !== label) : [...r, label].slice(-3),
                    )
                  }
                >
                  {label}
                </ReasonChip>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex flex-col">
              <span className="text-list font-medium">Brug Brain i analyser</span>
              <span className="text-meta text-ink-3">Fondens lektioner indgår i vurderingen</span>
            </span>
            <Toggle checked={brain} onCheckedChange={setBrain} label="Brug Brain i analyser" />
          </div>
        </Card>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Card title="AI-arbejde">
          <span className="inline-flex h-7 items-center gap-2 self-start rounded-pill bg-ai-wash pr-3 pl-1.5 text-meta font-medium text-ai-ink">
            <AiOrb size={20} tone="ai" state="searching" />
            Verificerer founders, 3/6
          </span>
          <span className="text-meta leading-[1.5] text-ink-3">
            Koral og orb. Kun én bevæger sig ad gangen.
          </span>
        </Card>
        <Card title="AI-anbefaling">
          <span className="flex items-center gap-2 text-list">
            <InterlectMark size={14} />
            <span className="text-ink-3">Interlect anbefaler</span>
            <span className="font-medium">dyb analyse</span>
          </span>
          <span className="text-list text-action">Hvorfor?</span>
          <span className="text-meta leading-[1.5] text-ink-3">
            Byline med logomærket i koral. Aldrig som knap eller badge.
          </span>
        </Card>
        <Card title="Status">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CASE_STATUS) as CaseStatusKey[]).map((key) => (
              <StatusChip key={key} status={key} />
            ))}
          </div>
          <span className="text-meta leading-[1.5] text-ink-3">
            Ikke-klikbar chip: tonet flade, ikon i signalfarven, ordet i blæk.
          </span>
        </Card>
      </div>
    </Section>
  );
}

/** AI-agent-laget (libraries.dev, personaliseret). Hver effekt kan slås til og fra. */
function AgentLayer() {
  const [working, setWorking] = useState(true);
  const [reading, setReading] = useState(true);
  const kinds: SpecialistKind[] = [
    "team",
    "market",
    "tech",
    "finance",
    "deal",
    "own1",
    "own2",
    "own3",
    "own4",
  ];
  return (
    <Section
      title="AI-agent-lag"
      intro="libraries.dev (MIT), personaliseret: kun koral/varm palet, appens tema, stille under reduceret bevægelse. Højst ét af dem pr. skærm i produktet."
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="AiBeam: glød om det, AI arbejder i">
          <div className="flex flex-col gap-3">
            <AiBeam active={working}>
              <div className="rounded-xl bg-canvas p-4 text-list text-ink-2">
                Brain skriver et svar til jer …
              </div>
            </AiBeam>
            <AiBeam active={working} size="line">
              <p className="m-0 text-[16px] leading-[1.7] text-ink-1">
                Svar der streames får en glød under teksten, mens det skrives.
              </p>
            </AiBeam>
            <Button variant="secondary" size="sm" onClick={() => setWorking((v) => !v)}>
              {working ? "Stop arbejdet" : "Start arbejdet"}
            </Button>
          </div>
        </Card>
        <Card title="AiMetal: den ene primære AI-handling">
          <div className="flex flex-wrap items-center gap-3 py-2">
            <AiMetal pillHeight={36}>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-pill bg-surface px-4 text-list font-medium text-ink-1 shadow-pill"
              >
                <Sparkles className="size-3.5 text-ai" aria-hidden />
                Kør dyb analyse
              </button>
            </AiMetal>
          </div>
        </Card>
        <Card title="AiImageFx: Interlect læser en fil">
          <div className="flex flex-col gap-3">
            <AiImageFx active={reading}>
              <div className="flex min-h-14 items-center gap-2.5 rounded-[14px] bg-surface px-4 py-3 text-list text-ink-2 shadow-pill">
                Læser Pitchdeck-2026.pdf
              </div>
            </AiImageFx>
            <Button variant="secondary" size="sm" onClick={() => setReading((v) => !v)}>
              {reading ? "Færdig med at læse" : "Læs igen"}
            </Button>
          </div>
        </Card>
        <Card title="SpecialistBot: egne figurer (hold musen over)">
          <div className="flex flex-wrap items-center gap-4 py-2">
            {kinds.map((kind) => (
              <SpecialistBot key={kind} kind={kind} size={56} label={kind} />
            ))}
          </div>
        </Card>
      </div>
    </Section>
  );
}

function StatusAndActions() {
  const [dialog, setDialog] = useState<"hold" | "close" | "markInvested" | null>(null);
  const [selected, setSelected] = useState(0);
  const action = dialog ? CASE_ACTIONS[dialog] : null;
  return (
    <Section
      title="Handlinger og status"
      intro="Split-knappen: venstre del udfører det anbefalede næste skridt, en synlig skillelinje, pilen åbner alle handlinger. Hver statusændring kræver en årsag."
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Casens top (36 px, statusmenu 360 px)">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status="active" className="h-9 px-3" />
            <SplitButton
              label="Kør dyb analyse"
              icon={Sparkles}
              iconColor="var(--ai)"
              onPrimary={() => showToast({ message: "Dyb analyse er startet" })}
              menuSize="status"
            >
              <MenuHeader
                title="Aktiv"
                status="Oprettet 18. sep af Maja Holm"
                icon={CASE_STATUS.active.icon}
                tone={{ color: "positive", wash: "positive-wash" }}
              />
              <MenuLabel>Fase</MenuLabel>
              <MenuItem
                icon={CASE_ACTIONS.rerunScreening.icon}
                tone={{ color: "action", wash: "action-wash" }}
                description="Screenes igen mod tesen"
              >
                Kør screening igen
              </MenuItem>
              <MenuItem
                icon={Sparkles}
                tone={{ color: "ai", wash: "ai-wash" }}
                description="Specialisterne går i dybden"
                recommended
              >
                Kør dyb analyse
              </MenuItem>
              <MenuItem
                icon={Gavel}
                tone={{ color: "warning", wash: "warning-wash" }}
                description="Klar til beslutning"
              >
                Send til komité
              </MenuItem>
              <MenuLabel>Status</MenuLabel>
              <MenuItem
                icon={CirclePause}
                tone={{ color: "warning", wash: "warning-wash" }}
                description="Bliver i fasen, kan genoptages"
                onSelect={() => setDialog("hold")}
              >
                Sæt på hold
              </MenuItem>
              <MenuLabel>Beslutning</MenuLabel>
              <MenuItem
                icon={CASE_STATUS.invested.icon}
                tone={{ color: "positive", wash: "positive-wash" }}
                description="Flyttes til Besluttet"
                onSelect={() => setDialog("markInvested")}
              >
                Marker som investeret
              </MenuItem>
              <MenuItem
                icon={CircleX}
                tone={{ color: "ink-3", wash: "bg-sunken" }}
                description="Flyttes til Besluttet"
                onSelect={() => setDialog("close")}
              >
                Luk casen
              </MenuItem>
            </SplitButton>
          </div>
        </Card>
        <Card title="Cases-listen (34 px, handlingsmenu 320 px)">
          <div className="flex flex-wrap items-start gap-3">
            <SplitButton label="Send til komité" icon={Gavel} size="sm" onPrimary={() => undefined}>
              <MenuHeader title="Klimalag" status="Dyb analyse, aktiv" dot="var(--ai)" />
              <MenuLabel>Fase</MenuLabel>
              <MenuItem
                icon={Sparkles}
                tone={{ color: "ai", wash: "ai-wash" }}
                description="Specialisterne går i dybden"
                current
              >
                Kør dyb analyse igen
              </MenuItem>
              <MenuItem
                icon={Gavel}
                tone={{ color: "warning", wash: "warning-wash" }}
                description="Klar til beslutning"
                recommended
              >
                Send til komité
              </MenuItem>
              <MenuLabel>Status</MenuLabel>
              <MenuItem
                icon={CirclePause}
                tone={{ color: "warning", wash: "warning-wash" }}
                description="Bliver i fasen, kan genoptages"
              >
                Sæt på hold
              </MenuItem>
            </SplitButton>
            <SplitButton
              label="Kør dyb analyse"
              icon={Sparkles}
              size="sm"
              nudgeDays={9}
              onPrimary={() => undefined}
            >
              <MenuItem icon={Sparkles} tone={{ color: "ai", wash: "ai-wash" }} recommended>
                Kør dyb analyse
              </MenuItem>
            </SplitButton>
          </div>
          <span className="text-meta text-ink-3">
            Nudge: en aktiv case uden handling i 7 dage eller mere bliver sort med orange tekst.
          </span>
        </Card>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Toast og bulk-bjælke">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() =>
                showToast({
                  message: "2 cases sat på hold",
                  onUndo: () => showToast({ message: "Fortrudt" }),
                })
              }
            >
              Vis toast med Fortryd
            </Button>
            <Button variant="secondary" size="md" onClick={() => setSelected((n) => (n ? 0 : 3))}>
              {selected ? "Skjul bulk-bjælke" : "Vis bulk-bjælke"}
            </Button>
          </div>
        </Card>
        <Card title="Fold-ud og tal">
          <FoldAndCount />
        </Card>
      </div>
      {action?.confirm && (
        <ReasonDialog
          open={dialog !== null}
          onOpenChange={(open) => !open && setDialog(null)}
          question={action.confirm.question}
          confirmLabel={action.confirm.confirm}
          reasons={action.confirm.reasons}
          notePlaceholder={action.confirm.notePlaceholder}
          icon={action.icon}
          tone={{ color: action.tone.color, wash: action.tone.wash }}
          onConfirm={() => {
            setDialog(null);
            showToast({ message: `${action.label}: gemt i historikken` });
          }}
        />
      )}
      <BulkBar
        count={selected}
        onClear={() => setSelected(0)}
        actions={[
          {
            key: "deep",
            label: "Kør dyb analyse",
            icon: Sparkles,
            highlighted: true,
            onClick: () => setSelected(0),
          },
          {
            key: "committee",
            label: "Send til komité",
            icon: Gavel,
            onClick: () => setSelected(0),
          },
          { key: "hold", label: "Sæt på hold", icon: CirclePause, onClick: () => setSelected(0) },
          { key: "close", label: "Luk", icon: CircleX, onClick: () => setSelected(0) },
        ]}
      />
    </Section>
  );
}

function FoldAndCount() {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(81);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md bg-canvas">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="gallery-collapse"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-list font-medium"
        >
          Team
          <span className="text-list tabular-nums text-ink-3">84</span>
        </button>
        <Collapse
          open={open}
          id="gallery-collapse"
          className="px-4 pb-4 text-meta leading-[1.6] text-ink-2"
        >
          Tre founders med komplementære profiler. CEO solgte AquaSense til Benchmark i 2021; salget
          drives af CEO, og første salgsansættelse er planlagt i Q1.
        </Collapse>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-display leading-none font-semibold tracking-display">
          <CountUp value={score} />
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setScore((s) => Math.max(0, s - 4))}>
            −4
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setScore((s) => Math.min(100, s + 4))}
          >
            +4
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Focus page and states
// ---------------------------------------------------------------------------------------

function FocusDemo() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"ring" | "rangering" | "radar">("ring");
  return (
    <div className="h-[420px] overflow-auto rounded-lg bg-surface shadow-card">
      <FocusHost
        focus={
          open ? (
            <FocusPage
              backLabel="Havbrug Nord"
              onBack={() => setOpen(false)}
              title="Profil mod tesen"
              subtitle="Tese v4, 10 vægtede kriterier, vægtet score 57"
              actions={
                <SegmentedControl
                  aria-label="Visning"
                  options={[
                    { value: "ring", label: "Ring" },
                    { value: "rangering", label: "Rangering" },
                    { value: "radar", label: "Radar" },
                  ]}
                  value={view}
                  onChange={setView}
                />
              }
            >
              <p className="m-0 max-w-[720px] text-body text-ink-2">
                Undersiden gentager kortets indhold i stor størrelse. Esc eller tilbage-pillen fører
                tilbage.
              </p>
            </FocusPage>
          ) : null
        }
      >
        <div className="grid gap-3 p-7 sm:grid-cols-3">
          {["Profil mod tesen", "Mandatfit", "Nøglefund"].map((title) => (
            <button
              key={title}
              type="button"
              onClick={() => setOpen(true)}
              className="flex h-[180px] flex-col justify-between rounded-lg bg-canvas p-5 text-left transition-[background-color,box-shadow,transform] duration-[var(--dur-quick)] hover:-translate-y-0.5 hover:bg-surface hover:shadow-raised"
            >
              <span className="flex items-center justify-between text-list font-semibold">
                {title}
                <ArrowUpRight className="size-3.5 text-ink-4" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="text-title font-semibold tracking-title">Åbn</span>
            </button>
          ))}
        </div>
      </FocusHost>
    </div>
  );
}

function StatesDemo() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card className="min-h-[300px] p-0">
        <EmptyState
          title="Ingen cases endnu"
          body="Opret den første case, så screener Interlect den mod tesen."
        >
          <Button variant="primary" size="md">
            Opret case
          </Button>
        </EmptyState>
      </Card>
      <Card className="min-h-[300px] p-0">
        <ErrorState onRetry={() => undefined} />
      </Card>
      <Card className="min-h-[300px] p-0">
        <NoAccess body="Brugere og adgang styres af jeres admins. Skal du have en anden rolle, så kontakt Maja Holm." />
      </Card>
      <Card className="min-h-[300px] p-0">
        <LoadingState title="Henter cases …" />
      </Card>
    </div>
  );
}

export function ComponentGallery({ extra }: { extra?: ReactNode }) {
  return (
    <div className="flex flex-col gap-24">
      <Section
        title="App-skal og navigation"
        intro="Interlect.ai og hovedsiderne står altid til venstre. Arbejdsområdet ligger som ét stort kort oven på lærredet. Underniveauer i en side er piller med en indikator, der glider mellem dem. Prøv at klikke."
      >
        <ShellDemo />
      </Section>
      <Foundations />
      <Controls />
      <AgentLayer />
      <StatusAndActions />
      <Section
        title="Fokus-side"
        intro="Et kort åbner en underside, der glider ind over siden. Tilbage-pillen øverst har sidens navn."
      >
        <FocusDemo />
      </Section>
      <CaseBlocksGallery />
      <Section
        title="Tilstande"
        intro="Tom, fejl, ingen adgang og venter. Altid en vej videre; ventetid er altid orben."
      >
        <StatesDemo />
      </Section>
      {extra}
    </div>
  );
}
