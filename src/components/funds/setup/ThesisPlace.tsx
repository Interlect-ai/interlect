/**
 * "Jeres tese": the place itself is `ThesisFrame` (prototype Teamopsaetning v3). This
 * file keeps who you are, the thesis's name and the investment model as cards, which the frame
 * shows behind "Vis mere" (the prototype has them in the new-thesis flow, not on the page).
 * `readOnly` shows the same blocks to Member and Reader without the means to change them.
 */
import type { ComponentType, ReactNode } from "react";
import { motion } from "motion/react";
import { ChartColumn, Check, Layers, Pencil, Rocket } from "lucide-react";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import type { MessageKey } from "@/lib/i18n/translate";
import { useT } from "@/lib/i18n/useT";
import { PRESS } from "@/lib/motion";
import { cn } from "@/lib/utils";

type EditorState = SaveFundConfigInput;
type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export interface PlaceBlockProps {
  value: EditorState;
  onChange: (value: EditorState) => void;
  readOnly?: boolean | undefined;
}

const tint = (color: string) => `color-mix(in srgb,${color} 14%,transparent)`;

const FIELD =
  "border-0 bg-sunken text-ink-1 outline-none transition-[box-shadow] duration-150 placeholder:text-ink-4 focus-visible:shadow-[0_0_0_2px_var(--action)]";

function BlockCard({
  title,
  aside,
  children,
  className,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // The prototype's `.box`: white, a 1 px line, 20 px corners.
        "flex flex-col gap-3.5 rounded-lg bg-surface px-5 py-[18px] shadow-[inset_0_0_0_1px_var(--line-strong)]",
        className,
      )}
    >
      {(title || aside) && (
        <div className="flex items-baseline gap-2.5">
          {title && <span className="text-list font-medium text-ink-1">{title}</span>}
          {aside && <span className="text-list text-ink-3">{aside}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

const MODELS: ReadonlyArray<{
  id: EditorState["strategyType"];
  label: MessageKey;
  icon: Icon;
  color: string;
}> = [
  {
    id: "venture",
    label: "fundEditor.basic.strategyVenture",
    icon: Rocket,
    color: "var(--series-1)",
  },
  {
    id: "growth",
    label: "fundEditor.basic.strategyGrowth",
    icon: ChartColumn,
    color: "var(--series-2)",
  },
  {
    id: "thematic",
    label: "fundEditor.basic.strategyThematic",
    icon: Layers,
    color: "var(--series-7)",
  },
  { id: "custom", label: "fundEditor.basic.strategyCustom", icon: Pencil, color: "var(--ink-2)" },
];

/** Who you are: the thesis's name and the investment model as cards. */
export function WhoBlock({ value, onChange, readOnly }: PlaceBlockProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <BlockCard title={t("fundEditor.basic.thesisName")}>
        <input
          value={value.fundName}
          readOnly={readOnly}
          onChange={(event) => onChange({ ...value, fundName: event.target.value.slice(0, 160) })}
          aria-label={t("fundEditor.basic.thesisName")}
          placeholder={t("thesis.who.namePlaceholder")}
          className={cn(FIELD, "h-[46px] rounded-[12px] px-3.5 text-[14px]")}
        />
      </BlockCard>
      <div
        role="radiogroup"
        aria-label={t("fundEditor.basic.strategy")}
        className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3"
      >
        {MODELS.map((model) => {
          const on = value.strategyType === model.id;
          const Glyph = model.icon;
          return (
            <motion.button
              key={model.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={readOnly}
              onClick={() => onChange({ ...value, strategyType: model.id })}
              whileHover={readOnly ? {} : { y: -2 }}
              whileTap={readOnly ? {} : { scale: 0.98 }}
              transition={PRESS.transition}
              className={cn(
                "flex min-h-[104px] flex-col items-start gap-2.5 rounded-lg border-0 p-[18px] text-left font-[inherit] transition-[background,box-shadow] duration-200",
                readOnly ? "cursor-default" : "cursor-pointer",
              )}
              style={{
                background: on ? "var(--bg-surface)" : "var(--bg-canvas)",
                boxShadow: on ? "inset 0 0 0 1.5px var(--ink-1), var(--shadow-card)" : "none",
                opacity: readOnly && !on ? 0.55 : 1,
              }}
            >
              <span className="flex w-full items-start justify-between">
                <span
                  className="grid size-[38px] place-items-center rounded-[11px]"
                  style={{ background: tint(model.color), color: model.color }}
                >
                  <Glyph className="size-[17px]" aria-hidden />
                </span>
                {on && (
                  <span className="grid size-[22px] place-items-center rounded-full bg-inverse text-ink-inverse">
                    <Check className="size-3" strokeWidth={3} aria-hidden />
                  </span>
                )}
              </span>
              <span className="text-[15px] font-semibold text-ink-1">{t(model.label)}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
