/**
 * De syv trin i Ny investeringstese, porteret fra prototypen `Ny investeringstese v3`
 * (struktur, mål, tekster og ikoner 1:1). Trinnene ejer ingen data: de læser og ændrer
 * `WizardState` gennem `patch`. Reglerne for vægte, gates og ticket ligger i
 * `src/lib/funds/thesis-wizard.ts`.
 */
import { useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Ban,
  Building2,
  ChartColumn,
  ChartPie,
  Check,
  ChevronDown,
  CircleCheck,
  Coins,
  Cpu,
  Globe,
  House,
  Info,
  Landmark,
  Layers,
  LayoutGrid,
  Map,
  MapPin,
  Pencil,
  Plus,
  Quote,
  Rocket,
  Scale,
  ShieldCheck,
  Users,
  X,
  ArrowRight,
  ArrowUp,
} from "lucide-react";
import { motion } from "motion/react";
import { WeightDonut } from "@/components/funds/editor/WeightDonut";
import { SpecialistCards } from "@/components/funds/editor/SpecialistCards";
import { SpecialistBot } from "@/components/ai/SpecialistBot";
import { specialistKind } from "@/components/ai/specialist-kind";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { Collapse } from "@/components/ds/Collapse";
import { Reveal } from "@/components/ds/Reveal";
import { Toggle } from "@/components/ds/Toggle";
import {
  GEOGRAPHY_LABEL_KEYS,
  INVESTOR_TYPES,
  OTHER_TYPE_INDEX,
  PHASE_LABEL_KEYS,
  RISK_LABEL_KEYS,
  SECTOR_LABEL_KEYS,
  SPECIALISTS,
  TICKET_PRESETS,
  addCriterion,
  applyTicketPreset,
  currentGates,
  digitsOnly,
  fmtKr,
  removeCriterion,
  setWeight,
  summaryRows,
  ticketBar,
  uniqueKey,
  MAX_CRITERIA,
  MIN_CRITERIA,
  type WizardGate,
  type WizardState,
} from "@/lib/funds/thesis-wizard";
import { standardSpecialistCardIn } from "@/lib/funds/specialist-cards";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { PRESS, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { seriesSlot } from "@/lib/charts/colors";
import { WEIGHT_MAX_PERCENT, WEIGHT_MIN_PERCENT } from "@/lib/funds/config-limits";
import type { StepChat } from "./StepAsk";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
const ICONS: Record<string, Icon> = {
  rocket: Rocket,
  building: Building2,
  house: House,
  users: Users,
  pencil: Pencil,
  "map-pin": MapPin,
  layers: Layers,
  coins: Coins,
  ban: Ban,
  "chart-pie": ChartPie,
  "circle-check": CircleCheck,
  scale: Scale,
  "chart-column": ChartColumn,
  globe: Globe,
  cpu: Cpu,
  landmark: Landmark,
  map: Map,
  quote: Quote,
  "shield-check": ShieldCheck,
  "layout-grid": LayoutGrid,
};
const tint = (seriesVar: string) => `color-mix(in srgb,${seriesVar} 14%,transparent)`;

export interface StepProps {
  state: WizardState;
  patch: (change: Partial<WizardState> | ((state: WizardState) => Partial<WizardState>)) => void;
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
        "flex flex-col gap-2.5 rounded-lg bg-surface px-[22px] py-5 shadow-card",
        className,
      )}
    >
      {title && <span className="text-[15px] font-semibold">{title}</span>}
      {children}
    </div>
  );
}

const FIELD =
  "border-0 bg-canvas text-ink-1 outline-none transition-[background,box-shadow] duration-150 placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]";

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      transition={PRESS.transition}
      className={cn(
        "inline-flex h-10 cursor-pointer items-center whitespace-nowrap rounded-xl border-0 px-[15px] text-[14px] font-medium transition-colors duration-200",
        on
          ? "bg-inverse text-ink-inverse"
          : "bg-surface text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)]",
      )}
    >
      <span
        aria-hidden
        className="overflow-hidden transition-[width,margin] duration-200 ease-standard"
        style={{ width: on ? 14 : 0, marginRight: on ? 7 : 0 }}
      >
        <Check className="size-[13px]" aria-hidden />
      </span>
      {label}
    </motion.button>
  );
}

/** Valgmuligheder + egne tilføjelser (Enter), som Faser/Geografi/Sektorer i prototypen. */
function ChipGroup({
  title,
  options,
  picked,
  extra,
  addPlaceholder,
  onToggle,
  onAdd,
  onRemoveExtra,
}: {
  title: string;
  options: readonly string[];
  picked: readonly number[];
  extra?: readonly string[];
  addPlaceholder?: string;
  onToggle: (index: number) => void;
  onAdd?: (text: string) => void;
  onRemoveExtra?: (index: number) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Card title={title}>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((label, index) => (
          <Chip
            key={label}
            label={label}
            on={picked.includes(index)}
            onClick={() => onToggle(index)}
          />
        ))}
        {extra?.map((label, index) => (
          <Chip key={`x-${label}`} label={label} on onClick={() => onRemoveExtra?.(index)} />
        ))}
        {onAdd && (
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && text.trim()) {
                event.preventDefault();
                onAdd(text.trim().slice(0, 120));
                setText("");
              }
            }}
            aria-label={addPlaceholder}
            placeholder={addPlaceholder}
            className={cn(FIELD, "h-10 min-w-40 rounded-xl px-3.5 text-[14px]")}
          />
        )}
      </div>
    </Card>
  );
}

// ─── Trin 1 · Hvem er I? ─────────────────────────────────────────────────────────────────────
export function WhoStep({ state, patch }: StepProps) {
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

// ─── Trin 2 · Grundlag ───────────────────────────────────────────────────────────────────────
function KrField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (digits: string) => void;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  return (
    <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
      <span className="text-meta text-ink-3">{label}</span>
      <span className="flex h-[52px] cursor-text items-center gap-2 rounded-xl bg-surface px-4 shadow-[inset_0_0_0_1.5px_var(--line-strong)] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)] hover:shadow-[inset_0_0_0_1.5px_var(--ink-3)]">
        <input
          inputMode="numeric"
          value={fmtKr(value, localeTag)}
          onChange={(event) => onChange(digitsOnly(event.target.value))}
          aria-label={t("thesis.frames.amountLabel", { label })}
          placeholder="100.000"
          className="min-w-0 flex-1 border-0 bg-transparent text-[18px] font-medium text-ink-1 outline-none placeholder:text-ink-4"
        />
        <span className="text-[15px] text-ink-3">{t("thesis.frames.currency")}</span>
      </span>
    </label>
  );
}

export function FramesStep({
  state,
  patch,
  maxSet,
  setMaxSet,
}: StepProps & { maxSet: boolean; setMaxSet: (value: boolean) => void }) {
  const t = useT();
  const toggle = (key: "phases" | "geo" | "sectors", index: number) =>
    patch((current) => ({
      [key]: current[key].includes(index)
        ? current[key].filter((item) => item !== index)
        : [...current[key], index],
    }));
  const bar = ticketBar(state);
  return (
    <div className="flex flex-col gap-3">
      <ChipGroup
        title={t("thesis.frames.phases")}
        options={PHASE_LABEL_KEYS.map((key) => t(key))}
        picked={state.phases}
        onToggle={(index) => toggle("phases", index)}
      />
      <ChipGroup
        title={t("thesis.frames.geography")}
        options={GEOGRAPHY_LABEL_KEYS.map((key) => t(key))}
        picked={state.geo}
        extra={state.geoExtra}
        addPlaceholder={t("thesis.frames.geographyAdd")}
        onToggle={(index) => toggle("geo", index)}
        onAdd={(text) => patch((s) => ({ geoExtra: [...s.geoExtra, text].slice(0, 12) }))}
        onRemoveExtra={(index) =>
          patch((s) => ({ geoExtra: s.geoExtra.filter((_, k) => k !== index) }))
        }
      />
      <ChipGroup
        title={t("thesis.frames.sectors")}
        options={SECTOR_LABEL_KEYS.map((key) => t(key))}
        picked={state.sectors}
        extra={state.sectorExtra}
        addPlaceholder={t("thesis.frames.sectorAdd")}
        onToggle={(index) => toggle("sectors", index)}
        onAdd={(text) => patch((s) => ({ sectorExtra: [...s.sectorExtra, text].slice(0, 12) }))}
        onRemoveExtra={(index) =>
          patch((s) => ({ sectorExtra: s.sectorExtra.filter((_, k) => k !== index) }))
        }
      />
      <Card title={t("thesis.frames.ticket")}>
        <div className="flex flex-wrap items-end gap-3">
          <KrField
            label={t("thesis.frames.from")}
            value={state.ticketMin}
            onChange={(ticketMin) => patch({ ticketMin })}
          />
          <span className="grid h-[52px] place-items-center text-ink-4" aria-hidden>
            <ArrowRight className="size-4" />
          </span>
          <KrField
            label={t("thesis.frames.to")}
            value={state.ticketMax}
            onChange={(ticketMax) => patch({ ticketMax })}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TICKET_PRESETS.map((preset) => (
            <button
              key={preset.kr}
              type="button"
              onClick={() => {
                const next = applyTicketPreset(state, preset.kr, maxSet);
                patch({ ticketMin: next.ticketMin, ticketMax: next.ticketMax });
                setMaxSet(next.maxSet);
              }}
              className="h-8 cursor-pointer whitespace-nowrap rounded-[10px] border-0 bg-canvas px-3 text-meta text-ink-2 transition-colors hover:bg-hover hover:text-ink-1"
            >
              {t(preset.labelKey)}
            </button>
          ))}
        </div>
        <div className="relative mt-1.5 h-2 rounded bg-chart-track" aria-hidden>
          <div
            className="absolute inset-y-0 rounded bg-ink-1 transition-[left,width] duration-[400ms] ease-standard"
            style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
          />
        </div>
        <div className="flex justify-between text-micro text-ink-4" aria-hidden>
          <span>{t("thesis.frames.scaleZero")}</span>
          <span>{t("thesis.frames.scaleMid")}</span>
          <span>{t("thesis.frames.scaleMax")}</span>
        </div>
      </Card>
    </div>
  );
}

// ─── Trin 3 · Tese og risiko ─────────────────────────────────────────────────────────────────
export function ThesisStep({ state, patch }: StepProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <textarea
        value={state.thesis}
        onChange={(event) => patch({ thesis: event.target.value.slice(0, 5000) })}
        aria-label={t("thesis.thesisStep.label")}
        placeholder={t("thesis.thesisStep.placeholder")}
        className={cn(
          FIELD,
          "min-h-[120px] resize-y rounded-lg px-5 py-[18px] text-[17px] leading-[1.6]",
        )}
      />
      <Card className="gap-3.5 p-[22px]">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-semibold">{t("thesis.thesisStep.risk")}</span>
          <span className="text-list text-ink-3">{t(RISK_LABEL_KEYS[state.risk]!)}</span>
        </div>
        <div
          className="grid h-[70px] grid-cols-5 items-end gap-1.5"
          role="radiogroup"
          aria-label={t("thesis.thesisStep.risk")}
        >
          {RISK_LABEL_KEYS.map((labelKey, index) => (
            <motion.button
              key={labelKey}
              type="button"
              role="radio"
              aria-checked={state.risk === index}
              aria-label={t(labelKey)}
              onClick={() => patch({ risk: index })}
              whileHover={{ y: -2 }}
              transition={SPRING.snappy}
              className="cursor-pointer rounded-lg border-0 transition-colors duration-300"
              style={{
                height: `${30 + index * 17}%`,
                background:
                  index <= state.risk
                    ? `color-mix(in srgb,var(--ai) ${40 + index * 15}%,var(--bg-sunken))`
                    : "var(--bg-sunken)",
              }}
            />
          ))}
        </div>
        <div className="flex justify-between text-micro text-ink-4" aria-hidden>
          <span>{t("thesis.thesisStep.low")}</span>
          <span>{t("thesis.thesisStep.high")}</span>
        </div>
      </Card>
    </div>
  );
}

// ─── Trin 4 · Vægtning ───────────────────────────────────────────────────────────────────────
export function WeightsStep({ state, patch }: StepProps) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [text, setText] = useState("");
  const { criteria } = state;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-7 rounded-xl bg-canvas p-6">
        <WeightDonut
          items={criteria}
          hovered={hover}
          onHover={setHover}
          size={180}
          innerRatio={0.4}
          center={(current) => (
            <div className="flex flex-col items-center">
              <span className="text-[36px] font-semibold leading-none tracking-[var(--track-display)]">
                {current ? `${current.weight} %` : criteria.length}
              </span>
              <span className="max-w-[110px] text-center text-meta leading-[1.3] text-ink-3">
                {current ? current.label : t("thesis.weights.criteria")}
              </span>
            </div>
          )}
        />
        <span className="text-[15px] leading-[1.6] text-ink-2">{t("thesis.weights.intro")}</span>
      </div>
      <div className="flex flex-col overflow-hidden rounded-lg bg-surface shadow-card">
        {criteria.map((criterion, index) => {
          const described = criterion.description.trim().length > 20;
          const isOpen = open === index;
          return (
            <div
              key={criterion.key}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              className={cn("transition-colors duration-200", index > 0 && "border-t border-line")}
              style={{ background: hover === index ? "var(--bg-canvas)" : "transparent" }}
            >
              <div className="grid min-h-16 grid-cols-[10px_minmax(0,1fr)_minmax(120px,1.1fr)_48px_28px] items-center gap-3.5 py-1.5 pl-[18px] pr-3.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: seriesSlot(index) }}
                  aria-hidden
                />
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : index)}
                  className="flex min-w-0 cursor-pointer flex-col items-start gap-0.5 border-0 bg-transparent p-0 text-left font-[inherit]"
                >
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-[14px] font-medium text-ink-1">
                    {criterion.label}
                    <ChevronDown
                      className="size-3 text-ink-4 transition-transform duration-[280ms] ease-standard"
                      style={{ transform: isOpen ? "rotate(180deg)" : "none" }}
                      aria-hidden
                    />
                  </span>
                  <span
                    className="max-w-full truncate text-micro"
                    style={{ color: criterion.description ? "var(--ink-4)" : "var(--ai-ink)" }}
                  >
                    {criterion.description || t("thesis.weights.describePrompt")}
                  </span>
                </button>
                <input
                  type="range"
                  min={WEIGHT_MIN_PERCENT}
                  max={WEIGHT_MAX_PERCENT}
                  value={criterion.weight}
                  aria-label={t("thesis.weights.weightFor", { label: criterion.label })}
                  onChange={(event) =>
                    patch((s) => ({
                      criteria: setWeight(s.criteria, index, Number(event.target.value)),
                    }))
                  }
                  className="w-full accent-[var(--ink-1)]"
                />
                <span className="text-right text-[15px] font-semibold">{criterion.weight} %</span>
                <button
                  type="button"
                  aria-label={t("thesis.weights.remove", { label: criterion.label })}
                  disabled={criteria.length <= MIN_CRITERIA}
                  onClick={() => {
                    patch((s) => ({ criteria: removeCriterion(s.criteria, index) }));
                    setHover(null);
                    setOpen(null);
                  }}
                  className={cn(
                    "grid size-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink-4 transition-[opacity,background,color] duration-200 hover:bg-critical-wash hover:text-critical focus-visible:opacity-100 disabled:cursor-not-allowed",
                    hover === index && criteria.length > MIN_CRITERIA ? "opacity-100" : "opacity-0",
                  )}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <Collapse open={isOpen}>
                <div className="flex flex-col gap-2 pb-[18px] pl-[42px] pr-[18px]">
                  <span className="text-meta font-semibold text-ink-3">
                    {t("thesis.weights.lookFor")}
                  </span>
                  <textarea
                    value={criterion.description}
                    onChange={(event) => {
                      const description = event.target.value.slice(0, 1000);
                      patch((s) => ({
                        criteria: s.criteria.map((c, k) =>
                          k === index ? { ...c, description } : c,
                        ),
                      }));
                    }}
                    aria-label={t("thesis.weights.lookForAbout", { label: criterion.label })}
                    placeholder={t("thesis.weights.lookForPlaceholder")}
                    className="min-h-[70px] resize-y rounded-xl border-0 bg-surface px-3.5 py-3 text-[14px] leading-[1.55] text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]"
                  />
                  <span className="flex items-center gap-[7px] text-meta text-ink-3">
                    {described ? (
                      <CircleCheck className="size-3.5 text-positive" aria-hidden />
                    ) : (
                      <Info className="size-3.5 text-ink-4" aria-hidden />
                    )}
                    {described ? t("thesis.weights.described") : t("thesis.weights.notDescribed")}
                  </span>
                </div>
              </Collapse>
            </div>
          );
        })}
        <div className="flex items-center gap-2.5 border-t border-line py-2.5 pl-[18px] pr-3.5">
          <Plus className="size-4 text-ink-4" aria-hidden />
          <input
            value={text}
            disabled={criteria.length >= MAX_CRITERIA}
            onChange={(event) => setText(event.target.value.slice(0, 160))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && text.trim()) {
                event.preventDefault();
                patch((s) => ({ criteria: addCriterion(s.criteria, text) }));
                setOpen(criteria.length);
                setText("");
              }
            }}
            aria-label={t("thesis.weights.add")}
            placeholder={t("thesis.weights.addPlaceholder")}
            className="h-10 flex-1 border-0 bg-transparent text-[14px] text-ink-1 outline-none placeholder:text-ink-4"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Trin 5 · Mandat ─────────────────────────────────────────────────────────────────────────
function ModeSwitch({
  review,
  onToggle,
  label,
}: {
  review: boolean;
  onToggle: () => void;
  label: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={review}
      aria-label={`${label}: ${review ? t("thesis.mandate.review") : t("thesis.mandate.binding")}`}
      onClick={onToggle}
      className="relative grid cursor-pointer grid-cols-[repeat(2,88px)] rounded-pill border-0 bg-sunken p-[3px]"
    >
      <motion.span
        aria-hidden
        className="absolute bottom-[3px] left-[3px] top-[3px] w-[88px] rounded-pill bg-surface shadow-pill"
        initial={false}
        animate={{ x: review ? 88 : 0 }}
        transition={SPRING.snappy}
      />
      <span
        className="relative grid h-7 place-items-center text-meta font-medium"
        style={{ color: review ? "var(--ink-3)" : "var(--ink-1)" }}
      >
        {t("thesis.mandate.binding")}
      </span>
      <span
        className="relative grid h-7 place-items-center text-meta font-medium"
        style={{ color: review ? "var(--ink-1)" : "var(--ink-3)" }}
      >
        {t("thesis.mandate.review")}
      </span>
    </button>
  );
}

export function MandateStep({ state, patch }: StepProps) {
  const t = useT();
  const language = useLanguage();
  const gates = currentGates(state, language);
  const [text, setText] = useState("");
  const edit = (next: WizardGate[]) => patch({ gates: next });
  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-surface shadow-card">
      {gates.map((gate, index) => {
        const Glyph = ICONS[gate.icon]!;
        return (
          <div
            key={gate.key + index}
            className={cn(
              "grid min-h-[66px] grid-cols-[34px_minmax(0,1fr)_auto_28px] items-center gap-3.5 py-2.5 pl-[18px] pr-3.5",
              index > 0 && "border-t border-line",
            )}
          >
            <span
              className="grid size-[34px] place-items-center rounded-[10px] transition-colors duration-300"
              style={{
                background: gate.review ? "var(--warning-wash)" : "var(--critical-wash)",
                color: gate.review ? "var(--warning)" : "var(--critical)",
              }}
            >
              <Glyph className="size-[15px]" aria-hidden />
            </span>
            <span className="min-w-0 text-[15px] font-medium">{gate.label}</span>
            <ModeSwitch
              review={gate.review}
              label={gate.label}
              onToggle={() =>
                edit(gates.map((g, k) => (k === index ? { ...g, review: !g.review } : g)))
              }
            />
            <button
              type="button"
              aria-label={t("thesis.mandate.remove", { label: gate.label })}
              onClick={() => edit(gates.filter((_, k) => k !== index))}
              className="grid size-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink-4 transition-colors hover:bg-critical-wash hover:text-critical"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
      <div
        className={cn(
          "flex items-center gap-2.5 py-2.5 pl-[18px] pr-3.5",
          gates.length > 0 && "border-t border-line",
        )}
      >
        <Plus className="size-4 text-ink-4" aria-hidden />
        <input
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, 160))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && text.trim() && gates.length < 30) {
              event.preventDefault();
              const label = text.trim();
              edit([
                ...gates,
                {
                  key: uniqueKey(
                    label,
                    gates.map((g) => g.key),
                    "custom_",
                  ),
                  label,
                  icon: "pencil",
                  review: false,
                },
              ]);
              setText("");
            }
          }}
          aria-label={t("thesis.mandate.add")}
          placeholder={t("thesis.mandate.addPlaceholder")}
          className="h-10 flex-1 border-0 bg-transparent text-[14px] text-ink-1 outline-none placeholder:text-ink-4"
        />
      </div>
    </div>
  );
}

function ChoiceNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-meta leading-[1.45] text-ink-3">
      <Info className="mt-0.5 size-3.5 shrink-0 text-ink-4" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

// ─── Trin 6 · Specialister ───────────────────────────────────────────────────────────────────
/** Kladden, når den findes: så vises fondens rigtige sæt med samme kort som i Fondsopsætning. */
export interface SpecialistDraft {
  fundId: string;
  configId: string;
  /** Åbn "Lav jeres egen specialist" med det samme (kladden blev lige oprettet derfor). */
  openNew: boolean;
}

export function SpecialistsStep({
  state,
  patch,
  chat,
  chatDisabled,
  draft,
  creatingDraft,
  onCreateDraft,
}: StepProps & {
  chat: StepChat;
  chatDisabled: boolean;
  draft: SpecialistDraft | null;
  creatingDraft: boolean;
  onCreateDraft: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const submit = () => {
    if (chatDisabled || chat.pending || query.trim().length < 2) return;
    const text = `${t("thesis.specialistsStep.suggestLabel")}: ${query.trim()}`;
    setQuery("");
    void chat.send(text);
  };
  const ready = !chatDisabled && !chat.pending && query.trim().length >= 2;
  return (
    <div className="flex flex-col gap-3.5">
      {draft ? (
        <SpecialistCards
          fundId={draft.fundId}
          configId={draft.configId}
          moduleOverrides={{}}
          openNew={draft.openNew}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {SPECIALISTS.map((base, index) => {
            const spec = { ...base, ...standardSpecialistCardIn(base.id, language) };
            const on = state.specialists[index] ?? true;
            return (
              <Reveal key={spec.id} delay={index * 0.04}>
                <div
                  className="flex h-max flex-col gap-3.5 rounded-lg bg-surface p-[18px] shadow-card transition-opacity duration-300"
                  style={{ opacity: on ? 1 : 0.55 }}
                >
                  <div className="flex shrink-0 items-start justify-between">
                    <SpecialistBot kind={specialistKind(spec.id)} size={48} />
                    <Toggle
                      checked={on}
                      label={t("thesis.specialistsStep.toggle", { label: spec.label })}
                      onCheckedChange={(next) =>
                        patch((s) => ({
                          specialists: s.specialists.map((value, k) =>
                            k === index ? next : value,
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="flex shrink-0 flex-col gap-[3px]">
                    <span className="text-base font-semibold">{spec.label}</span>
                    <span className="text-meta text-ink-3">{spec.role}</span>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    {spec.focus.map((point) => (
                      <span
                        key={point}
                        className="flex items-start gap-2 text-list leading-[1.4] text-ink-2"
                      >
                        <span
                          className="mt-[7px] size-[5px] shrink-0 rounded-full"
                          style={{ background: spec.seriesVar }}
                        />
                        {point}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            );
          })}
          <Reveal delay={SPECIALISTS.length * 0.04}>
            <div className="flex h-full min-h-[240px] flex-col gap-3.5 rounded-lg border-[1.5px] border-dashed border-line-strong p-[18px]">
              <span
                aria-hidden
                className="grid size-12 place-items-center rounded-[14px] bg-ai-wash text-ai"
              >
                <Plus className="size-5" strokeWidth={1.75} />
              </span>
              <div className="flex flex-col gap-[3px]">
                <span className="text-base font-semibold">
                  {t("thesis.specialistsStep.createTitle")}
                </span>
                <span className="text-meta leading-[1.45] text-ink-3">
                  {t("thesis.specialistsStep.createBody")}
                </span>
              </div>
              <button
                type="button"
                onClick={onCreateDraft}
                disabled={creatingDraft}
                className="mt-auto inline-flex h-8 cursor-pointer items-center gap-[7px] self-start rounded-pill border-0 bg-inverse px-[13px] font-[inherit] text-meta font-medium whitespace-nowrap text-ink-inverse transition-transform active:scale-[.96] disabled:cursor-default disabled:opacity-50"
              >
                <Plus className="size-3.5" aria-hidden />
                {creatingDraft
                  ? t("thesis.specialistsStep.preparing")
                  : t("thesis.specialistsStep.create")}
              </button>
            </div>
          </Reveal>
        </div>
      )}
      <div className="flex items-center gap-2.5 rounded-pill bg-canvas py-1.5 pl-4 pr-1.5">
        <InterlectMark size={13} />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 400))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          disabled={chatDisabled}
          aria-label={t("thesis.specialistsStep.suggestLabel")}
          placeholder={t("thesis.specialistsStep.suggestPlaceholder")}
          className="flex-1 border-0 bg-transparent text-[14px] text-ink-1 outline-none placeholder:text-ink-4"
        />
        <button
          type="button"
          aria-label={t("thesis.specialistsStep.send")}
          disabled={!ready}
          onClick={submit}
          className="grid size-[34px] cursor-pointer place-items-center rounded-full border-0 text-ink-inverse transition-colors disabled:cursor-default"
          style={{ background: ready ? "var(--bg-inverse)" : "var(--ink-4)" }}
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
      </div>
      <ChoiceNote>
        {draft ? t("thesis.specialistsStep.noteDraft") : t("thesis.specialistsStep.noteNoDraft")}
      </ChoiceNote>
    </div>
  );
}

// ─── Trin 7 · Gennemse og udgiv ──────────────────────────────────────────────────────────────
export function ReviewStep({ state, goTo }: { state: WizardState; goTo: (step: number) => void }) {
  const t = useT();
  const language = useLanguage();
  return (
    <div className="flex flex-col gap-2.5">
      {summaryRows(state, language).map((row, index) => {
        const Glyph = ICONS[row.icon]!;
        return (
          <Reveal key={row.title} delay={index * 0.05}>
            <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-lg bg-surface px-[18px] py-4 shadow-card">
              <span
                className="grid size-10 place-items-center rounded-xl"
                style={{ background: tint(row.seriesVar), color: row.seriesVar }}
              >
                <Glyph className="size-[17px]" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{row.title}</span>
                <span className="truncate text-list text-ink-3">{row.value}</span>
              </span>
              <button
                type="button"
                aria-label={t("thesis.review.editRow", { title: row.title })}
                onClick={() => goTo(row.step)}
                className="h-8 cursor-pointer whitespace-nowrap rounded-pill border-0 bg-transparent px-3 text-meta font-medium text-action transition-colors hover:bg-action-wash"
              >
                {t("thesis.review.edit")}
              </button>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}
