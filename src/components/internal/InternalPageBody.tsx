/**
 * The internal pages' header and pill group, without data (also used by the visual
 * harness in scripts/visual-harness, which draws the pages without signing in).
 */
import type { ReactNode } from "react";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { Reveal } from "@/components/ds/Reveal";

export type InternalSection = "komponenter" | "grafer" | "orbs" | "velaris" | "prompts";

const SECTIONS = [
  { value: "komponenter", label: "Komponenter" },
  { value: "grafer", label: "Grafer" },
  { value: "orbs", label: "Orbs" },
  { value: "velaris", label: "Velaris" },
  { value: "prompts", label: "Prompts" },
] as const;

export const INTERNAL_TITLES: Record<
  InternalSection,
  { title: string; intro: string; note?: string }
> = {
  komponenter: {
    title: "Komponenter",
    intro:
      "Alle fælles komponenter i designsystemets rækkefølge. Sammenlign med Interlect Designsystem.dc.html.",
  },
  grafer: {
    title: "Grafer",
    intro: "Ét preset pr. graf i designet. Finjustér motion her, og kopiér presettet til koden.",
  },
  orbs: {
    title: "Orbs",
    intro:
      "Hver anledning i orb-kataloget med tilstande, størrelser og tekst. Klik et kort for at se det bevæge sig.",
  },
  velaris: {
    title: "Velaris",
    intro:
      "Baggrunden bag AI-flader i mørk tilstand, i fire varianter side om side med tekst ovenpå. Skift til mørk tilstand for at sammenligne; lyst er uændret.",
  },
  prompts: {
    title: "Prompts",
    intro:
      "De bogstavelige instruktioner, modellerne modtager for den valgte investeringstese. Kunderne ser dem aldrig.",
    note: "Intern side kun for Admin. Serveren leverer kun teksterne til en Admin.",
  },
};

export function InternalPageBody({
  section,
  onSection,
  children,
}: {
  section: InternalSection;
  onSection: (section: InternalSection) => void;
  children: ReactNode;
}) {
  const copy = INTERNAL_TITLES[section];
  return (
    <div className="flex max-w-[1240px] flex-col gap-10 px-4 pt-6 pb-20 md:px-10 md:pt-[30px]">
      <Reveal className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="m-0 text-[30px] leading-[1.05] font-semibold tracking-display md:text-[40px]">
            {copy.title}
          </h1>
          <p className="m-0 max-w-[640px] text-[15px] text-ink-3">{copy.intro}</p>
          <p className="m-0 text-meta text-ink-4">
            {copy.note ?? "Intern side med eksempeldata fra designsystemet."}
          </p>
        </div>
        <div className="flex-1" />
        <SegmentedControl
          aria-label="Interne sider"
          options={SECTIONS}
          value={section}
          onChange={onSection}
        />
      </Reveal>
      <Reveal delay={0.06}>{children}</Reveal>
    </div>
  );
}
