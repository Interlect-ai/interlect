/**
 * "Ny tese" starts with who you are: the thesis's name and the kind of investor. Moved
 * unchanged from the old guide's first step (`thesis/StepViews.tsx`, deleted); it
 * reads and changes the guide's `WizardState`, which `NewThesisStart` turns into the first draft.
 */
import type { ComponentType, ReactNode } from "react";
import { Building2, House, Pencil, Rocket, Users } from "lucide-react";
import { motion } from "motion/react";
import { Reveal } from "@/components/ds/Reveal";
import { INVESTOR_TYPES, OTHER_TYPE_INDEX, type WizardState } from "@/lib/funds/thesis-wizard";
import { useT } from "@/lib/i18n/useT";
import { PRESS } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
const ICONS: Record<(typeof INVESTOR_TYPES)[number]["icon"], Icon> = {
  rocket: Rocket,
  building: Building2,
  house: House,
  users: Users,
  pencil: Pencil,
};
const tint = (seriesVar: string) => `color-mix(in srgb,${seriesVar} 14%,transparent)`;

const FIELD =
  "border-0 bg-canvas text-ink-1 outline-none transition-[background,box-shadow] duration-150 placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]";

export interface WhoStepProps {
  state: WizardState;
  patch: (change: Partial<WizardState> | ((state: WizardState) => Partial<WizardState>)) => void;
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-surface px-[22px] py-5 shadow-card">
      {title && <span className="text-[15px] font-semibold">{title}</span>}
      {children}
    </div>
  );
}

export function WhoStep({ state, patch }: WhoStepProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3.5">
      <Card title={t("thesis.who.name")}>
        <input
          value={state.name}
          onChange={(event) => patch({ name: event.target.value.slice(0, 160) })}
          aria-label={t("thesis.who.name")}
          placeholder={t("thesis.who.namePlaceholder")}
          className={cn(FIELD, "h-12 rounded-xl px-4 text-[17px]")}
        />
      </Card>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
        {INVESTOR_TYPES.map((type, index) => {
          const on = state.type === index;
          const Glyph = ICONS[type.icon]!;
          return (
            <motion.button
              key={type.label}
              type="button"
              aria-pressed={on}
              onClick={() => patch({ type: on ? null : index })}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              transition={PRESS.transition}
              className="flex min-h-32 cursor-pointer flex-col items-start gap-2.5 rounded-lg border-0 p-[18px] text-left font-[inherit] transition-[background,box-shadow] duration-200"
              style={{
                background: on ? "var(--bg-surface)" : "var(--bg-canvas)",
                boxShadow: on ? "inset 0 0 0 1.5px var(--ink-1), var(--shadow-card)" : "none",
              }}
            >
              <span
                className="grid size-[38px] place-items-center rounded-[11px]"
                style={{ background: tint(type.seriesVar), color: type.seriesVar }}
              >
                <Glyph className="size-[17px]" aria-hidden />
              </span>
              <span className="text-[15px] font-semibold text-ink-1">{t(type.labelKey)}</span>
              <span className="text-meta leading-[1.4] text-ink-3">{t(type.descriptionKey)}</span>
            </motion.button>
          );
        })}
      </div>
      {state.type === OTHER_TYPE_INDEX && (
        <Reveal>
          <input
            value={state.other}
            onChange={(event) => patch({ other: event.target.value.slice(0, 160) })}
            aria-label={t("thesis.who.otherLabel")}
            placeholder={t("thesis.who.otherLabel")}
            className={cn(FIELD, "h-12 w-full rounded-xl px-4 text-[15px]")}
          />
        </Reveal>
      )}
    </div>
  );
}
