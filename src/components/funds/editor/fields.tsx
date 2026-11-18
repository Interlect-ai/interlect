/**
 * The small building blocks of the editing flow: fields in the new design (44 px sunken inputs,
 * chips, the Lav/Middel/Høj pill), the option lists and the row helpers. Moved out of
 * FundConfigWorkspace.tsx batch 3; `Section` and `ReadCell` still serve the public
 * profile fallback.
 */
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { fieldClass } from "@/components/ds/Field";
import { SCORE_CATEGORY_GROUPS } from "@/lib/cases/presentation";
import { SPRING } from "@/lib/motion";
import { LANGUAGES } from "@/lib/i18n/language";
import { translate, type MessageKey } from "@/lib/i18n/translate";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

export function Section({
  title,
  description,
  children,
  missing = [],
}: {
  title: string;
  description: string;
  children: ReactNode;
  /** Det, der mangler i netop denne sektion før publicering. */
  missing?: string[];
}) {
  const t = useT();
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-section font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-list leading-5 text-ink-3">{description}</p>
        {missing.length > 0 && (
          <p className="mt-1.5 flex items-start gap-1.5 text-meta font-medium text-warning">
            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
            {t("fundEditor.fields.missingBeforePublish", {
              items: missing.join(", ").toLowerCase(),
            })}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

/** The sunken multi-line field of the new design (same ring and halo as `fieldClass`). */
export const textareaClass =
  "min-h-[110px] w-full min-w-0 resize-y rounded-sm bg-sunken px-3.5 py-3 text-[15px] leading-[1.6] text-ink-1 outline-none shadow-[inset_0_0_0_1px_transparent] transition-[box-shadow,background-color] duration-[var(--dur-quick)] placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)] disabled:opacity-50";

/** The label above a field (12 px, ink-3). */
function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-meta text-ink-3">{children}</span>;
}

/** A group of choices as the prototype's chips: ink fill when chosen, a thin ring when not. */
export function ChoiceField({
  label,
  value,
  onChange,
  options,
  placeholder,
  className,
  display,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: readonly string[];
  placeholder: string;
  className?: string;
  /** How a stored value is shown (stages and geographies are keys shown in the team's language). */
  display?: (item: string) => string;
}) {
  const t = useT();
  const [custom, setCustom] = useState("");
  const show = display ?? ((item: string) => item);
  const add = (item: string) => {
    const normalized = item.trim();
    if (
      normalized &&
      !value.some((existing) => existing.toLowerCase() === normalized.toLowerCase())
    ) {
      onChange([...value, normalized]);
    }
    setCustom("");
  };
  const extra = value.filter((item) => !options.includes(item));
  const chip =
    "inline-flex h-[38px] cursor-pointer items-center gap-1.5 rounded-[10px] border-0 px-3.5 font-[inherit] text-list whitespace-nowrap transition-[background,color,transform] duration-200 active:scale-[.96]";
  return (
    <fieldset className={cn("m-0 flex min-w-0 flex-col gap-2 border-0 p-0", className)}>
      <legend className="mb-2 p-0 text-meta text-ink-3">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() =>
                onChange(selected ? value.filter((item) => item !== option) : [...value, option])
              }
              className={cn(
                chip,
                selected
                  ? "bg-inverse text-ink-inverse"
                  : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)]",
              )}
            >
              {show(option)}
            </button>
          );
        })}
        {extra.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(value.filter((candidate) => candidate !== item))}
            title={t("fundEditor.fields.remove")}
            aria-label={t("fundEditor.fields.removeItem", { item: show(item) })}
            className={cn(chip, "bg-inverse text-ink-inverse")}
          >
            {show(item)}
            <X className="size-3 opacity-70" aria-hidden />
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(custom);
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn(fieldClass, "min-w-0 flex-1")}
        />
        <button
          type="button"
          onClick={() => add(custom)}
          disabled={!custom.trim()}
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-surface text-ink-1 shadow-pill transition-transform active:scale-[.94] disabled:cursor-default disabled:opacity-40"
          aria-label={t("fundEditor.fields.addItem", { placeholder })}
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </fieldset>
  );
}

/** Risk appetite: a sunken three-way pill (Lav, Middel, Høj) and, under it, the text itself. */
export function RiskPostureField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  // Lav, Middel, Høj = the three ready texts, from careful to bold.
  const options = [
    { id: "defensive", label: "fundEditor.fields.risk.low" },
    { id: "balanced", label: "fundEditor.fields.risk.medium" },
    { id: "early", label: "fundEditor.fields.risk.high" },
  ] as const;
  // The ready text is written in the team's language; a text saved in the other
  // language still shows as chosen.
  const presetKey = (id: (typeof options)[number]["id"]) =>
    `fundEditor.fields.risk.presets.${id}` as const;
  const selected = options.findIndex((option) =>
    LANGUAGES.some((language) => translate(language, presetKey(option.id)) === value.trim()),
  );
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <FieldLabel>{t("fundEditor.fields.risk.label")}</FieldLabel>
      <div
        role="radiogroup"
        aria-label={t("fundEditor.fields.risk.label")}
        className="relative grid w-fit grid-cols-[repeat(3,104px)] rounded-pill bg-sunken p-1"
      >
        {selected >= 0 && (
          <motion.span
            aria-hidden
            className="absolute top-1 bottom-1 left-1 w-[104px] rounded-pill bg-surface shadow-pill"
            initial={false}
            animate={{ x: selected * 104 }}
            transition={reduced ? { duration: 0 } : SPRING.snappy}
          />
        )}
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected === index}
            onClick={() => onChange(t(presetKey(option.id)))}
            className={cn(
              "relative h-[34px] cursor-pointer rounded-pill border-0 bg-transparent font-[inherit] text-list font-medium transition-colors duration-[var(--dur-quick)]",
              selected === index ? "text-ink-1" : "text-ink-3 hover:text-ink-1",
            )}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        aria-label={t("fundEditor.fields.risk.textLabel")}
        placeholder={t("fundEditor.fields.risk.placeholder")}
        className={textareaClass}
      />
    </div>
  );
}

export function ReadCell({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn("bg-background-elevated p-4", className)}>
      <h3 className="text-list font-semibold text-ink">{label}</h3>
      <p className="mt-2 text-list leading-5 text-ink-2">{value}</p>
      {note && <p className="mt-1 text-meta leading-4 text-ink-3">{note}</p>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel>{label}</FieldLabel>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass}
      />
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  className,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  rows?: number;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className={textareaClass}
      />
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : Number(event.target.value))
        }
        className={cn(fieldClass, "tabular-nums")}
      />
    </label>
  );
}

export function ListField({
  label,
  value,
  onChange,
  hint,
  separator = "comma",
  className,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint: string;
  separator?: "comma" | "newline";
  className?: string;
}) {
  const text = separator === "comma" ? value.join(", ") : value.join("\n");
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={text}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(separator === "comma" ? "," : /\n/)
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
        rows={separator === "newline" ? 3 : 2}
        className={cn(textareaClass, "min-h-[84px]")}
      />
      <span className="text-meta text-ink-3">{hint}</span>
    </label>
  );
}

export function TextInput({
  ariaLabel,
  value,
  onChange,
  className,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <input
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(fieldClass, className)}
    />
  );
}

export function slugKey(label: string, fallback: string): string {
  const key = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
  return key || fallback;
}

/** The categories with the dictionary key of their name; translate at render. */
export const scoreCategoryOptions = [
  ["fund_thesis_fit", "fundEditor.fields.category.fund_thesis_fit"],
  ["founder_market_fit", "fundEditor.fields.category.founder_market_fit"],
  ["team_market_fit", "fundEditor.fields.category.team_market_fit"],
  ["product_market_fit", "fundEditor.fields.category.product_market_fit"],
  ["product_technology", "fundEditor.fields.category.product_technology"],
  ["market_timing", "fundEditor.fields.category.market_timing"],
  ["traction_gtm", "fundEditor.fields.category.traction_gtm"],
  ["financial_strength", "fundEditor.fields.category.financial_strength"],
  ["evidence_quality", "fundEditor.fields.category.evidence_quality"],
] as const satisfies ReadonlyArray<readonly [string, MessageKey]>;

/** Grupperer scorekategori-valgene efter de 5 oversigtsgrupper, casen rent
 * faktisk vises i -- samme kilde (SCORE_CATEGORY_GROUPS) som selve
 * case-visningen ruller kriterier op efter, så dropdown og resultat aldrig
 * kan gå ud af sync. */
export const scoreCategoryOptionsByGroup = SCORE_CATEGORY_GROUPS.map((group) => ({
  groupLabelKey: group.labelKey,
  options: scoreCategoryOptions.filter(([key]) =>
    (group.categories as readonly string[]).includes(key),
  ),
})).filter((group) => group.options.length > 0);

export function categoryGroupLabelKey(category: string): MessageKey {
  return (
    SCORE_CATEGORY_GROUPS.find((group) =>
      (group.categories as readonly string[]).includes(category),
    )?.labelKey ?? "fundEditor.fields.unknownGroup"
  );
}

/** The stage choices as neutral keys; `stageText` shows them in the team's language. */
export const stageOptions = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b_plus",
  "growth",
  "buyout",
  "later",
  "listed",
  "private",
] as const;

/** The geography choices as country codes and region keys; `geographyText` shows them. */
export const geographyOptions = [
  "DK",
  "nordics",
  "baltics",
  "dach",
  "europe",
  "GB",
  "north_america",
  "global",
] as const;

export const sectorOptions = [
  "B2B software",
  "Fintech",
  "Climate",
  "Deep tech",
  "Health",
  "Consumer",
  "Marketplaces",
  "Industrials",
  "Energy",
  "Financial services",
] as const;

/** Flytter ét element op eller ned i en liste uden at ændre originalen. */
export function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Op/ned/fjern for én række. Rækkefølgen er den, casen og analysen viser. */
export function RowControls({
  noun,
  index,
  count,
  onMove,
  onRemove,
}: {
  noun: string;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-1 md:flex-col">
      <button
        type="button"
        aria-label={t("fundEditor.fields.moveUp", { noun })}
        disabled={index === 0}
        onClick={() => onMove(-1)}
        className="icon-control disabled:opacity-30"
      >
        <ChevronUp className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t("fundEditor.fields.removeNoun", { noun })}
        onClick={onRemove}
        className="icon-control"
      >
        ×
      </button>
      <button
        type="button"
        aria-label={t("fundEditor.fields.moveDown", { noun })}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        className="icon-control disabled:opacity-30"
      >
        <ChevronDown className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
