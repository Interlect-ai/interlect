/**
 * /intern/velaris: the dark tones of Velaris side by side, each with the text that sits
 * on it in the product (a title, a sentence and a muted line, as in Brain's empty state), so
 * The product owner can pick one. The product's choice is `VELARIS_DARK_DEFAULT`; light is
 * unchanged.
 * All four stand still (only one thing moves on a screen); hover one to see it flow.
 */
import { useState } from "react";
import { AiOrb } from "@/components/ai/AiOrb";
import {
  Velaris,
  VELARIS_DARK_DEFAULT,
  VELARIS_DARK_TONES,
  type VelarisDarkToneId,
} from "@/components/ds/Velaris";

/** Each tone's name and what it does, in the order of `VELARIS_DARK_TONES`. */
const COPY: Record<VelarisDarkToneId, { label: string; note: string }> = {
  foer: {
    label: "Før (til sammenligning)",
    note: "Det gamle: de lyse farver, 40 % farve, gråtonet som lyst. Næsten gråt.",
  },
  rolig: {
    label: "A · Rolig",
    note: "Dybere udgaver af de fire farver (koral, lilla, blå, fersken), 50 % farve, lidt gråtonet.",
  },
  klar: { label: "B · Klar", note: "Samme dybe farver, 62 % farve, næsten ikke gråtonet." },
  staerk: {
    label: "C · Stærk",
    note: "Samme dybe farver, 75 % farve, ikke gråtonet. Tydeligst, tættest på for meget.",
  },
};

export function VelarisGallery() {
  const [lively, setLively] = useState<VelarisDarkToneId | null>(null);
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr))]">
      {VELARIS_DARK_TONES.map((tone) => (
        <section
          key={tone.id}
          data-velaris-tone={tone.id}
          data-velaris-default={tone.id === VELARIS_DARK_DEFAULT || undefined}
          onPointerEnter={() => setLively(tone.id)}
          onPointerLeave={() => setLively(null)}
          className="flex min-w-0 flex-col gap-3 rounded-lg bg-surface p-[18px] shadow-card"
        >
          <div className="flex flex-col gap-0.5">
            <h3 className="m-0 flex items-center gap-2 text-section font-semibold">
              {COPY[tone.id].label}
              {tone.id === VELARIS_DARK_DEFAULT && (
                <span className="rounded-pill bg-sunken px-2 py-0.5 text-micro font-medium text-ink-2">
                  I produktet nu
                </span>
              )}
            </h3>
            <span className="text-meta text-ink-3">{COPY[tone.id].note}</span>
          </div>
          <Velaris
            darkTone={tone.id}
            paused={lively !== tone.id}
            className="h-[260px] rounded-[16px]"
          >
            <div className="grid h-full place-items-center p-6">
              <div className="flex max-w-[300px] flex-col items-center gap-2.5 text-center">
                <AiOrb size={32} tone="ai" paused />
                <span className="text-[20px] leading-tight font-semibold text-ink-1">
                  Hvad vil du vide?
                </span>
                <span className="text-body leading-snug text-ink-2">
                  Brain svarer ud fra jeres cases, noter og beslutninger.
                </span>
                <span className="text-meta text-ink-3">Kilder vises ved hvert svar</span>
              </div>
            </div>
          </Velaris>
        </section>
      ))}
    </div>
  );
}
