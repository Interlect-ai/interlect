/**
 * The place "Jeres tese", ported 1:1 from the prototype `Teamopsaetning v3.dc.html`
 * (`frameEditor`): six boxes on the page, nothing else in view.
 *
 *   Stadier · Geografi · Sektorer   chips + "+ Tilføj", each with the shared rule as
 *                                   "Bindende | Op til vurdering" (the delt mandat)
 *   Ticket pr. selskab              "Fra" / "Til" and a logarithmic bar with two thumbs
 *   Hvad tror I på?                 the thesis
 *   Hvem er I, og hvordan tænker I? `setup.about`, which replaces the risk lens
 *
 * The shared rule of a list is its rule without a stage (`stage_fit`, `geography_fit`,
 * `sector_fit`). A list with no rule yet shows neither choice pressed; the first choice adds the
 * rule worded as the editor's suggestion (`sharedBasisGate`). The fields the prototype does not
 * show (name, investment model, the old risk text, expectations per stage, dealbreakers, fund size,
 * a note on the ticket) are kept behind one "Vis mere", so nothing a team saved becomes unreachable.
 * `readOnly` shows the same boxes to Member and Reader without the means to change them.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Collapse } from "@/components/ds/Collapse";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import {
  geographyKeys,
  geographyText,
  sectorText,
  stageKeys,
  stageText,
} from "@/lib/funds/basis-labels";
import { sharedBasisGate, type SharedBasisGateKey } from "@/lib/funds/gate-suggestions";
import { ABOUT_MAX_CHARS } from "@/lib/funds/setup-input";
import {
  TICKET_POSITIONS,
  TICKET_TICKS,
  nearestThumb,
  parseTicketAmount,
  parseWholeAmount,
  ticketAtPosition,
  ticketPosition,
  withTicketMax,
  withTicketMin,
} from "@/lib/funds/ticket-range";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { AmountTextField, ListField, TextArea, TextField } from "@/components/funds/editor/fields";
import { WhoBlock, type PlaceBlockProps } from "./ThesisPlace";
import { AskRow } from "./SetupAssistant";

type EditorState = SaveFundConfigInput;
type Gate = EditorState["gates"][number];

/** The prototype's choices, in its order (`stageOpts`, `geoOpts`, `sectorOpts`). */
const STAGE_CHOICES = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b_plus",
  "growth",
  "buyout",
  "later",
] as const;
const GEOGRAPHY_CHOICES = [
  "DK",
  "nordics",
  "baltics",
  "dach",
  "europe",
  "GB",
  "north_america",
  "global",
] as const;
const SECTOR_CHOICES = [
  "B2B software",
  "Fintech",
  "Climate",
  "Deep tech",
  "Health",
  "Consumer",
  "Marketplaces",
  "Industrials",
  "Energy",
] as const;

// i18n-keep: the ISO code of the currency the setup stores the ticket in (the same in every language).
const CURRENCY = "EUR";
// i18n-keep: the prototype's currency pill, code and sign.
const CURRENCY_PILL = "EUR €";

/** A box on the page (prototype `.box`). */
function Box({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3.5 rounded-lg bg-surface px-5 py-[18px] shadow-[inset_0_0_0_1px_var(--line-strong)]">
      {children}
    </div>
  );
}

const LABEL = "text-list font-medium text-ink-1";
const FIELD_AREA =
  "w-full resize-y rounded-[12px] border-0 bg-sunken px-3.5 py-3 font-[inherit] text-[14px] leading-[1.5] text-ink-1 outline-none [field-sizing:content] placeholder:text-ink-4 focus-visible:shadow-[0_0_0_2px_var(--action)]";

/** "Bindende | Op til vurdering" (prototype `modeSeg`); neither pressed while there is no rule. */
export function ModeSeg({
  value,
  onChange,
  disabled,
}: {
  value: Gate["treatment"] | null;
  onChange: (treatment: Gate["treatment"]) => void;
  disabled?: boolean | undefined;
}) {
  const t = useT();
  const option = (treatment: Gate["treatment"], label: ReactNode) => (
    <button
      type="button"
      aria-pressed={value === treatment}
      disabled={disabled}
      onClick={() => onChange(treatment)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border-0 px-3.5 py-1.5 font-[inherit] text-meta font-medium transition-[background,color,box-shadow] duration-200",
        disabled ? "cursor-default" : "cursor-pointer",
        value === treatment ? "bg-surface text-ink-1 shadow-pill" : "bg-transparent text-ink-3",
      )}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label={t("fundSetup.frame.modeGroup")}
      className="inline-flex rounded-pill bg-sunken p-[3px]"
    >
      {option(
        "hard",
        <>
          <Lock className="size-[13px]" strokeWidth={2} aria-hidden />
          {t("fundSetup.frame.binding")}
        </>,
      )}
      {option("review", t("fundSetup.frame.review"))}
    </div>
  );
}

/** Chips for a list plus "+ Tilføj" (prototype `chipsPick`): a click toggles, Enter adds. */
function ChipsPick({
  label,
  choices,
  value,
  display,
  normalize,
  onChange,
  readOnly,
}: {
  label: string;
  choices: readonly string[];
  value: readonly string[];
  display: (item: string) => string;
  normalize: (items: string[]) => string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean | undefined;
}) {
  const t = useT();
  const [text, setText] = useState("");
  // The choices, then what the team chose outside them (prototype: opts + list).
  const all = [...choices, ...value.filter((item) => !choices.includes(item))];
  const shown = readOnly ? all.filter((item) => value.includes(item)) : all;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.map((item) => {
        const on = value.includes(item);
        return (
          <button
            key={item}
            type="button"
            aria-pressed={on}
            disabled={readOnly}
            onClick={() =>
              onChange(on ? value.filter((entry) => entry !== item) : [...value, item])
            }
            className={cn(
              "inline-flex h-[34px] items-center whitespace-nowrap rounded-pill border-0 px-3.5 font-[inherit] text-list font-medium transition-colors duration-150",
              readOnly ? "cursor-default" : "cursor-pointer",
              on
                ? "bg-inverse text-ink-inverse shadow-none"
                : "bg-surface text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-hover",
            )}
          >
            {display(item)}
          </button>
        );
      })}
      {readOnly && shown.length === 0 && <span className="text-list text-ink-3">–</span>}
      {!readOnly && (
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const next = text.trim().slice(0, 120);
            if (!next) return;
            const added = [...new Set(normalize([...value, next]))];
            // At most 24 of your own (as before); a team that already has more keeps them all.
            if (added.length > value.length && value.length < 24) onChange(added);
            setText("");
          }}
          aria-label={t("fundSetup.frame.addAria", { list: label })}
          placeholder={t("fundSetup.frame.add")}
          className="h-[34px] w-[140px] rounded-pill border-0 bg-canvas px-3.5 font-[inherit] text-list text-ink-1 outline-none placeholder:text-ink-4 focus-visible:shadow-[0_0_0_2px_var(--action)]"
        />
      )}
    </div>
  );
}

/** The chips of one of the three shared lists (prototype `chipsPick`), for the rules in Sådan screener vi. */
export function SharedListPick({
  list,
  value,
  onChange,
}: {
  list: "stages" | "geographies" | "sectors";
  value: EditorState;
  onChange: (value: EditorState) => void;
}) {
  const t = useT();
  const language = useLanguage();
  if (list === "stages")
    return (
      <ChipsPick
        label={t("fundSetup.frame.stages")}
        choices={STAGE_CHOICES}
        value={value.stages}
        display={(stage) => stageText(stage, language)}
        normalize={stageKeys}
        onChange={(stages) => onChange({ ...value, stages: stageKeys(stages) })}
      />
    );
  if (list === "geographies")
    return (
      <ChipsPick
        label={t("fundSetup.frame.geography")}
        choices={GEOGRAPHY_CHOICES}
        value={value.geographies}
        display={(geography) => geographyText(geography, language)}
        normalize={geographyKeys}
        onChange={(geographies) => onChange({ ...value, geographies: geographyKeys(geographies) })}
      />
    );
  return (
    <ChipsPick
      label={t("fundSetup.frame.sectors")}
      choices={SECTOR_CHOICES}
      value={value.sectors}
      display={(sector) => sectorText(sector, language)}
      normalize={(sectors) => [...new Set(sectors)]}
      onChange={(sectors) => onChange({ ...value, sectors })}
    />
  );
}

/** One of the three lists with its shared rule (prototype `frameEditor` → `sh`). */
function MandateBox({
  label,
  gateKey,
  value,
  onChange,
  readOnly,
  children,
}: PlaceBlockProps & { label: string; gateKey: SharedBasisGateKey; children: ReactNode }) {
  const language = useLanguage();
  const gate = value.gates.find((entry) => entry.key === gateKey && !entry.stage);
  const setMode = (treatment: Gate["treatment"]) => {
    if (gate) {
      if (gate.treatment === treatment) return;
      onChange({
        ...value,
        gates: value.gates.map((entry) => (entry === gate ? { ...entry, treatment } : entry)),
      });
      return;
    }
    onChange({ ...value, gates: [...value.gates, sharedBasisGate(gateKey, treatment, language)] });
  };
  return (
    <Box>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={LABEL}>{label}</span>
        <ModeSeg value={gate?.treatment ?? null} onChange={setMode} disabled={readOnly} />
      </div>
      {children}
    </Box>
  );
}

/** "Fra" or "Til": the amount grouped, typed freely and read when the field is left. */
function AmountField({
  label,
  ariaLabel,
  value,
  onCommit,
  readOnly,
}: {
  label: string;
  ariaLabel: string;
  value: number | null;
  /** The amount, or null when the field was emptied (the limit is removed). */
  onCommit: (amount: number | null) => void;
  readOnly?: boolean | undefined;
}) {
  const localeTag = useLocaleTag();
  const [typing, setTyping] = useState<string | null>(null);
  const formatted = value === null ? "" : value.toLocaleString(localeTag);
  const commit = () => {
    if (typing !== null) {
      // An emptied field removes the limit; text that is not an amount keeps the old one.
      const amount = typing.trim() ? parseTicketAmount(typing) : null;
      if (!typing.trim()) {
        if (value !== null) onCommit(null);
      } else if (amount !== null && amount !== value) onCommit(amount);
    }
    setTyping(null);
  };
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="text-meta text-ink-3">{label}</span>
      <span className="flex h-[46px] min-w-0 items-center gap-2 rounded-[12px] bg-sunken pr-1.5 pl-3.5 focus-within:shadow-[0_0_0_2px_var(--action)]">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          readOnly={readOnly}
          value={typing ?? formatted}
          onChange={(event) => setTyping(event.target.value.slice(0, 24))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
          }}
          aria-label={ariaLabel}
          className="w-full min-w-0 border-0 bg-transparent font-[inherit] text-[15px] font-medium text-ink-1 tabular-nums outline-none"
        />
        <span className="pr-2 text-meta font-medium text-ink-3">{CURRENCY}</span>
      </span>
    </label>
  );
}

/** "Ticket pr. selskab" (prototype `ticketBox`). */
function TicketBox({
  value,
  onChange,
  readOnly,
  ticketTooLarge,
}: PlaceBlockProps & { ticketTooLarge: boolean }) {
  const t = useT();
  const localeTag = useLocaleTag();
  const range = { ticketMinEur: value.ticketMinEur, ticketMaxEur: value.ticketMaxEur };
  const set = (next: typeof range) => onChange({ ...value, ...next });
  const lowAmount = value.ticketMinEur ?? 10_000;
  const highAmount = value.ticketMaxEur ?? value.ticketMinEur ?? 10_000;
  const low = ticketPosition(Math.min(lowAmount, highAmount));
  const high = ticketPosition(Math.max(lowAmount, highAmount));
  const bar = useRef<HTMLDivElement>(null);
  const thumbs = [useRef<HTMLButtonElement>(null), useRef<HTMLButtonElement>(null)] as const;
  const drag = useRef<{ thumb: 0 | 1; pointer: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const positionOf = (event: PointerEvent) => {
    const box = bar.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(TICKET_POSITIONS, ((event.clientX - box.left) / box.width) * TICKET_POSITIONS),
    );
  };
  const moveTo = (thumb: 0 | 1, position: number) => {
    const amount = ticketAtPosition(position);
    set(
      thumb === 0
        ? { ...range, ticketMinEur: Math.min(amount, value.ticketMaxEur ?? amount) }
        : { ...range, ticketMaxEur: Math.max(amount, value.ticketMinEur ?? amount) },
    );
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (readOnly || event.button !== 0) return;
    event.preventDefault();
    const position = positionOf(event);
    const pressed = (event.target as HTMLElement).closest<HTMLElement>("[data-thumb]");
    const thumb = pressed
      ? (Number(pressed.dataset["thumb"]) as 0 | 1)
      : nearestThumb(position, range);
    drag.current = { thumb, pointer: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!pressed) moveTo(thumb, position);
    thumbs[thumb].current?.focus({ preventScroll: true });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointer !== event.pointerId) return;
    setDragging(true);
    moveTo(drag.current.thumb, positionOf(event));
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragging(false);
  };
  const onThumbKey = (thumb: 0 | 1) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowRight: 25, ArrowUp: 25, ArrowLeft: -25, ArrowDown: -25 }[event.key];
    const current = thumb === 0 ? low : high;
    let position: number | null = null;
    if (step !== undefined) position = current + step;
    else if (event.key === "Home") position = 0;
    else if (event.key === "End") position = TICKET_POSITIONS;
    if (position === null) return;
    event.preventDefault();
    moveTo(thumb, position);
  };

  const amount = (value: number) => value.toLocaleString(localeTag);
  const thumb = (index: 0 | 1, position: number, current: number | null, label: string) => (
    <button
      ref={thumbs[index]}
      type="button"
      role="slider"
      data-thumb={index}
      aria-label={label}
      aria-valuemin={TICKET_TICKS[0]}
      aria-valuemax={TICKET_TICKS[TICKET_TICKS.length - 1]}
      aria-valuenow={current ?? undefined}
      aria-valuetext={current === null ? undefined : `${amount(current)} ${CURRENCY}`}
      disabled={readOnly}
      onKeyDown={onThumbKey(index)}
      className={cn(
        "absolute top-[3px] -ml-3 size-6 rounded-full border-0 bg-surface p-0 shadow-[0_0_0_1px_var(--line-strong),0_3px_8px_rgba(23,21,28,.25)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-action disabled:opacity-50 motion-reduce:transition-none",
        readOnly ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        !dragging && "transition-[left] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]",
      )}
      style={{ left: `${position / 10}%` }}
    >
      <span
        aria-hidden
        className="absolute inset-[7px] rounded-full"
        style={{ background: index === 0 ? "var(--series-1)" : "var(--series-7)" }}
      />
    </button>
  );

  return (
    <Box>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={LABEL}>{t("fundSetup.frame.ticket")}</span>
        {/* The setup stores the ticket in euro; a choice of currency needs its own field. */}
        <span
          aria-label={t("fundSetup.frame.currency")}
          className="inline-flex h-[34px] items-center rounded-pill bg-surface px-3 text-list font-medium text-ink-1 shadow-pill"
        >
          {CURRENCY_PILL}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <AmountField
          label={t("fundSetup.frame.from")}
          ariaLabel={t("fundSetup.frame.fromAria")}
          value={value.ticketMinEur}
          onCommit={(next) =>
            set(next === null ? { ...range, ticketMinEur: null } : withTicketMin(range, next))
          }
          readOnly={readOnly}
        />
        <AmountField
          label={t("fundSetup.frame.to")}
          ariaLabel={t("fundSetup.frame.toAria")}
          value={value.ticketMaxEur}
          onCommit={(next) =>
            set(next === null ? { ...range, ticketMaxEur: null } : withTicketMax(range, next))
          }
          readOnly={readOnly}
        />
      </div>
      <div
        ref={bar}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "relative mx-3 mt-2 h-[30px] touch-none select-none",
          readOnly ? "cursor-default" : "cursor-pointer",
        )}
      >
        <span className="absolute -inset-x-3 top-3 h-1.5 rounded-[3px] bg-sunken" aria-hidden />
        <span
          aria-hidden
          className={cn(
            "absolute top-3 h-1.5 rounded-[3px] bg-[linear-gradient(90deg,var(--series-5),var(--series-1)_55%,var(--series-7))] motion-reduce:transition-none",
            !dragging && "transition-[left,width] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]",
          )}
          style={{ left: `${low / 10}%`, width: `${(high - low) / 10}%` }}
        />
        {thumb(0, ticketPosition(lowAmount), value.ticketMinEur, t("fundSetup.frame.fromAria"))}
        {thumb(1, ticketPosition(highAmount), value.ticketMaxEur, t("fundSetup.frame.toAria"))}
      </div>
      <div className="relative mx-3 mt-0.5 h-4" aria-hidden>
        {TICKET_TICKS.map((tick, index) => (
          <span
            key={tick}
            className={cn(
              "absolute top-0 text-micro whitespace-nowrap text-ink-3 tabular-nums",
              index === 0
                ? ""
                : index === TICKET_TICKS.length - 1
                  ? "-translate-x-full"
                  : "-translate-x-1/2",
            )}
            style={{ left: `${(index / (TICKET_TICKS.length - 1)) * 100}%` }}
          >
            {amount(tick)}
          </span>
        ))}
      </div>
      <p className="m-0 text-list text-ink-2">
        {value.ticketMinEur !== null && value.ticketMaxEur !== null ? (
          <>
            {t("fundSetup.frame.sumLead")}{" "}
            <b className="font-semibold text-ink-1 tabular-nums">
              {amount(Math.min(value.ticketMinEur, value.ticketMaxEur))} –{" "}
              {amount(Math.max(value.ticketMinEur, value.ticketMaxEur))} {CURRENCY}
            </b>{" "}
            {t("fundSetup.frame.sumTail")}
          </>
        ) : (
          t("fundSetup.frame.sumEmpty")
        )}
      </p>
      {ticketTooLarge && (
        <p role="alert" className="m-0 text-meta text-critical">
          {t("fundEditor.basic.ticketTooLarge")}
        </p>
      )}
    </Box>
  );
}

/** What the prototype does not show, kept so nothing a team saved becomes unreachable. */
function MoreFields({ value, onChange, readOnly }: PlaceBlockProps) {
  const t = useT();
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="thesis-frame-more"
        onClick={() => setOpen((shown) => !shown)}
        className="flex w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0 py-1 font-[inherit] text-list font-medium text-ink-2 hover:text-ink-1"
      >
        <ChevronDown
          className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
        {t("fundSetup.frame.more")}
      </button>
      <Collapse open={open} id="thesis-frame-more">
        <div className="flex flex-col gap-4">
          <WhoBlock value={value} onChange={onChange} readOnly={readOnly} />
          <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            {value.riskPosture.trim() && (
              <TextArea
                label={t("fundSetup.visual.riskOwnLabel")}
                value={value.riskPosture}
                onChange={(riskPosture) => onChange({ ...value, riskPosture })}
                rows={3}
              />
            )}
            {value.stages.length > 0 && (
              <section className="flex flex-col gap-3.5 rounded-lg bg-canvas p-[18px]">
                <div>
                  <p className="m-0 text-list font-semibold text-ink-1">
                    {t("fundEditor.basic.stageExpectations")}
                  </p>
                  <p className="mt-0.5 mb-0 text-meta leading-4 text-ink-3">
                    {t("fundEditor.basic.stageExpectationsHint")}
                  </p>
                </div>
                {value.stages.map((stage) => (
                  <TextArea
                    key={stage}
                    label={stageText(stage, language)}
                    value={value.stageExpectations[stage] ?? ""}
                    onChange={(next) =>
                      onChange({
                        ...value,
                        stageExpectations: { ...value.stageExpectations, [stage]: next },
                      })
                    }
                  />
                ))}
              </section>
            )}
            <ListField
              label={t("fundEditor.basic.dealbreakers")}
              value={value.dealbreakers}
              onChange={(dealbreakers) => onChange({ ...value, dealbreakers })}
              hint={t("fundEditor.basic.dealbreakersHint")}
              separator="newline"
            />
            <AmountTextField
              label={t("fundEditor.basic.fundSize")}
              value={value.fundSizeEur}
              // A positive size or none (the server refuses 0); both formats are read.
              parse={parseWholeAmount}
              onChange={(fundSizeEur) => onChange({ ...value, fundSizeEur })}
            />
            <TextField
              label={t("fundEditor.basic.ticketNote")}
              value={value.ticketNote}
              onChange={(ticketNote) => onChange({ ...value, ticketNote })}
            />
          </fieldset>
        </div>
      </Collapse>
    </div>
  );
}

export function ThesisFrame({
  value,
  onChange,
  readOnly,
  ticketTooLarge = false,
}: PlaceBlockProps & { ticketTooLarge?: boolean }) {
  const t = useT();
  const language = useLanguage();
  const about = value.setup?.about ?? "";
  return (
    // Prototype `.stage`: 26 px between the boxes.
    <div className="flex flex-col gap-[26px]">
      <MandateBox
        label={t("fundSetup.frame.stages")}
        gateKey="stage_fit"
        value={value}
        onChange={onChange}
        readOnly={readOnly}
      >
        <ChipsPick
          label={t("fundSetup.frame.stages")}
          choices={STAGE_CHOICES}
          value={value.stages}
          display={(stage) => stageText(stage, language)}
          normalize={stageKeys}
          onChange={(stages) => onChange({ ...value, stages: stageKeys(stages) })}
          readOnly={readOnly}
        />
      </MandateBox>
      <MandateBox
        label={t("fundSetup.frame.geography")}
        gateKey="geography_fit"
        value={value}
        onChange={onChange}
        readOnly={readOnly}
      >
        <ChipsPick
          label={t("fundSetup.frame.geography")}
          choices={GEOGRAPHY_CHOICES}
          value={value.geographies}
          display={(geography) => geographyText(geography, language)}
          normalize={geographyKeys}
          onChange={(geographies) =>
            onChange({ ...value, geographies: geographyKeys(geographies) })
          }
          readOnly={readOnly}
        />
      </MandateBox>
      <MandateBox
        label={t("fundSetup.frame.sectors")}
        gateKey="sector_fit"
        value={value}
        onChange={onChange}
        readOnly={readOnly}
      >
        <ChipsPick
          label={t("fundSetup.frame.sectors")}
          choices={SECTOR_CHOICES}
          value={value.sectors}
          display={(sector) => sectorText(sector, language)}
          normalize={(sectors) => [...new Set(sectors)]}
          onChange={(sectors) => onChange({ ...value, sectors })}
          readOnly={readOnly}
        />
      </MandateBox>
      <TicketBox
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        ticketTooLarge={ticketTooLarge}
      />
      <Box>
        <label className={LABEL} htmlFor="thesis-frame-thesis">
          {t("fundSetup.frame.thesis")}
        </label>
        <textarea
          id="thesis-frame-thesis"
          rows={4}
          value={value.thesis}
          readOnly={readOnly}
          onChange={(event) => onChange({ ...value, thesis: event.target.value.slice(0, 5000) })}
          className={cn(FIELD_AREA, "min-h-[84px]")}
        />
        {!readOnly && <AskRow field="thesis" />}
      </Box>
      <Box>
        <label className={LABEL} htmlFor="thesis-frame-about">
          {t("fundSetup.frame.about")}
        </label>
        <textarea
          id="thesis-frame-about"
          rows={3}
          value={about}
          readOnly={readOnly}
          maxLength={ABOUT_MAX_CHARS}
          onChange={(event) => {
            const text = event.target.value.slice(0, ABOUT_MAX_CHARS);
            const { setup: _old, ...rest } = value;
            const setup = { ...value.setup, about: text };
            // Typed and deleted again on an old version: send no setup, so the version is saved
            // as before (a setup turns it into storage per stage).
            const onlyAbout = Object.keys(setup).every((key) => key === "about");
            onChange(!text && onlyAbout ? rest : { ...value, setup });
          }}
          className={cn(FIELD_AREA, "min-h-[84px]")}
        />
      </Box>
      <MoreFields value={value} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
