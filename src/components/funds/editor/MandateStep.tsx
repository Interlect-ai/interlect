/**
 * Step "Mandat" (prototype Fondsopsaetning v2 + v0.7): the rules a case is checked
 * against. A row per rule: tile in the tone of the treatment (red = binding, orange = assessment),
 * name and question, a Bindende/Vurdering toggle with a sliding thumb, and a remove button that
 * says "Gate fjernet, Fortryd" for five seconds. "Tilføj gate" folds out a builder (type and
 * value, Enter adds). The suggestions from the basis and the finance rules from the annual
 * reports stay as lists. The fixed rules are shown with a lock. Nothing here reaches an analysis
 * before the draft is published.
 */
import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  Coins,
  Layers,
  MapPin,
  PieChart,
  Plus,
  ShieldCheck,
  SquareCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { showToast } from "@/components/ds/Toast";
import { fieldClass } from "@/components/ds/Field";
import { FINANCE_GATES, financeGateTreatment, isFinanceGate } from "@/lib/analysis/financial-gates";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import {
  GATE_BUILDER_TYPES,
  freeKey,
  gateFromBuilder,
  removeWithUndo,
  restoreItem,
  uniqueKey,
  type GateBuilderType,
} from "@/lib/funds/editor-rules";
import { BASIS_GATE_KEYS, suggestBasisGates } from "@/lib/funds/gate-suggestions";
import { SPRING } from "@/lib/motion";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { moveItem } from "./fields";
import { Disclosure } from "./Disclosure";
import { ReasonCodesEditor } from "./ReasonCodesEditor";

type EditorState = SaveFundConfigInput;
type Gate = EditorState["gates"][number];

const BUILDER_ICON: Record<GateBuilderType, LucideIcon> = {
  geography: MapPin,
  stage: Layers,
  ticket: Coins,
  sector: PieChart,
  ownership: Users,
  custom: SquareCheck,
};

function gateIcon(gate: Gate): LucideIcon {
  if (gate.key.includes("geo")) return MapPin;
  if (gate.key.includes("stage")) return Layers;
  if (gate.key.includes("ticket") || gate.key.includes("liquid")) return Coins;
  if (gate.key.includes("sector")) return PieChart;
  if (gate.key.includes("owner")) return Users;
  if (isFinanceGate(gate.key)) return Coins;
  return gate.treatment === "hard" ? ShieldCheck : Ban;
}

/** Bindende / Vurdering: the thumb slides between the two (the prototype's 92 px halves). */
function GateToggle({
  hard,
  locked,
  lockedReason,
  onChange,
  label,
}: {
  hard: boolean;
  locked: boolean;
  lockedReason?: string;
  onChange: (hard: boolean) => void;
  label: string;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const options = [
    { hard: true, label: t("fundEditor.mandate.binding"), dot: "var(--critical)" },
    { hard: false, label: t("fundEditor.mandate.assessment"), dot: "var(--warning)" },
  ] as const;
  return (
    <div
      role="radiogroup"
      aria-label={t("fundEditor.mandate.treatmentOf", { name: label })}
      title={locked ? lockedReason : undefined}
      className={cn(
        "relative grid grid-cols-[repeat(2,92px)] rounded-pill bg-sunken p-[3px]",
        locked && "opacity-60",
      )}
    >
      <motion.span
        aria-hidden
        className="absolute top-[3px] bottom-[3px] left-[3px] w-[92px] rounded-pill bg-surface shadow-pill"
        initial={false}
        animate={{ x: hard ? 0 : 92 }}
        transition={reduced ? { duration: 0 } : SPRING.snappy}
      />
      {options.map((option) => {
        const selected = option.hard === hard;
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={locked}
            onClick={() => onChange(option.hard)}
            className={cn(
              "relative flex h-7 items-center justify-center gap-1.5 rounded-pill border-0 bg-transparent font-[inherit] text-meta font-medium transition-colors duration-[240ms]",
              locked ? "cursor-not-allowed" : "cursor-pointer",
              selected ? "text-ink-1" : "text-ink-3",
            )}
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full transition-opacity duration-[240ms]"
              style={{ background: option.dot, opacity: selected ? 1 : 0 }}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function GateRow({
  gate,
  index,
  count,
  otherKeys,
  onPatch,
  onMove,
  onRemove,
}: {
  gate: Gate;
  index: number;
  count: number;
  /** The keys of the other rules, so a new name never gives two rules the same key. */
  otherKeys: string[];
  onPatch: (patch: Partial<Gate>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const finance = isFinanceGate(gate.key);
  const treatment = isFinanceGate(gate.key) ? financeGateTreatment(gate.key) : gate.treatment;
  const hard = treatment === "hard";
  const Icon = gateIcon(gate);
  return (
    <div
      className={cn(
        "group grid min-h-[68px] grid-cols-[34px_minmax(0,1fr)_auto_auto] items-center gap-3.5 px-4 py-2.5 max-md:grid-cols-[34px_minmax(0,1fr)_auto]",
        index > 0 && "border-t border-line",
      )}
    >
      <span
        aria-hidden
        className="grid size-[34px] place-items-center rounded-[10px] transition-colors duration-300"
        style={{
          background: hard ? "var(--critical-wash)" : "var(--warning-wash)",
          color: hard ? "var(--critical)" : "var(--warning)",
        }}
      >
        <Icon className="size-[15px]" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <input
          aria-label={t("fundEditor.mandate.gateName")}
          value={gate.label}
          onChange={(event) =>
            onPatch({
              label: event.target.value,
              // Finance rules and the basis rules keep their fixed key: the code calculates the
              // finance rules, and a new name must not make a suggestion appear again.
              key:
                finance || BASIS_GATE_KEYS.has(gate.key)
                  ? gate.key
                  : uniqueKey(event.target.value, gate.key, otherKeys),
            })
          }
          className="w-full min-w-0 rounded-xs border-0 bg-transparent p-0 font-[inherit] text-[15px] font-medium text-ink-1 outline-none focus-visible:shadow-[0_0_0_2px_var(--action)]"
        />
        <textarea
          aria-label={t("fundEditor.mandate.gateDescription")}
          value={gate.description}
          rows={1}
          onChange={(event) => onPatch({ description: event.target.value })}
          className="field-sizing-content w-full min-w-0 resize-none rounded-xs border-0 bg-transparent p-0 font-[inherit] text-meta leading-[1.45] text-ink-3 outline-none focus-visible:shadow-[0_0_0_2px_var(--action)]"
        />
      </div>
      <GateToggle
        hard={hard}
        locked={finance}
        lockedReason={t("fundEditor.mandate.lockedReason")}
        label={gate.label || t("fundEditor.mandate.theRule")}
        onChange={(next) => onPatch({ treatment: next ? "hard" : "review" })}
      />
      <div className="flex items-center gap-0.5 max-md:col-span-3 max-md:justify-end">
        <button
          type="button"
          aria-label={t("fundEditor.fields.moveUp", {
            noun: gate.label || t("fundEditor.mandate.theMandateRule"),
          })}
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="grid size-[30px] cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink-4 transition-colors hover:bg-hover hover:text-ink-1 disabled:cursor-default disabled:opacity-30"
        >
          <ChevronUp className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("fundEditor.fields.moveDown", {
            noun: gate.label || t("fundEditor.mandate.theMandateRule"),
          })}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          className="grid size-[30px] cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink-4 transition-colors hover:bg-hover hover:text-ink-1 disabled:cursor-default disabled:opacity-30"
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          title={t("fundEditor.mandate.removeGate")}
          aria-label={t("fundEditor.fields.removeNoun", {
            noun: gate.label || t("fundEditor.mandate.theMandateRule"),
          })}
          onClick={onRemove}
          className="grid size-[30px] cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink-4 transition-colors hover:bg-critical-wash hover:text-critical"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** "Tilføj gate": type chips, one value, Enter adds. The rule starts as an assessment. */
function GateBuilder({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (gate: { label: string; description: string; treatment: "review" }) => void;
}) {
  const t = useT();
  const [type, setType] = useState<GateBuilderType>("geography");
  const [text, setText] = useState("");
  const current = GATE_BUILDER_TYPES.find((item) => item.id === type)!;
  const language = useLanguage();
  const built = gateFromBuilder(type, text, language);
  const submit = () => {
    if (!built) return;
    onAdd(built);
    setText("");
    onClose();
  };
  return (
    <Collapse open={open} className="px-1 pt-1 pb-2">
      <div className="flex flex-col gap-3.5 rounded-lg bg-surface p-[18px] shadow-raised">
        <span className="text-list font-semibold">{t("fundEditor.mandate.newGate")}</span>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t("fundEditor.mandate.gateType")}
        >
          {GATE_BUILDER_TYPES.map((item) => {
            const Icon = BUILDER_ICON[item.id];
            const selected = item.id === type;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setType(item.id)}
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center gap-[7px] rounded-[10px] border-0 px-3 font-[inherit] text-list whitespace-nowrap transition-[background,color,transform] duration-200 active:scale-[.96]",
                  selected
                    ? "bg-inverse text-ink-inverse"
                    : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)]",
                )}
              >
                <Icon className="size-[13px]" aria-hidden />
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-meta text-ink-3">{t(current.valueLabelKey)}</span>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            className={fieldClass}
          />
        </label>
        <div className="flex justify-end gap-1.5">
          <Button variant="quiet" size="md" onClick={onClose}>
            {t("fundEditor.mandate.cancel")}
          </Button>
          <Button variant="primary" size="md" disabled={!built} onClick={submit}>
            {t("fundEditor.mandate.addGate")}
          </Button>
        </div>
      </div>
    </Collapse>
  );
}

export function MandateStep({
  fundId,
  value,
  onChange,
}: {
  fundId: string;
  value: EditorState;
  onChange: (value: EditorState) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const [building, setBuilding] = useState(false);
  // "Fortryd" must put the rule back into the newest list, not the one the toast was made from.
  const latest = useRef(value);
  latest.current = value;

  const gates = value.gates;
  const setGates = (next: Gate[]) => onChange({ ...value, gates: next });
  // Stable row ids: the key changes while the name is typed, and a row keyed by it would be
  // rebuilt on every keystroke (the field lost focus after each letter).
  const rowIds = useRef<string[]>([]);
  while (rowIds.current.length < gates.length) rowIds.current.push(crypto.randomUUID());
  rowIds.current.length = gates.length;
  const suggestions = suggestBasisGates(
    value,
    gates.map((gate) => gate.key),
    language,
  );
  const financeLeft = FINANCE_GATES.filter((gate) => !gates.some((item) => item.key === gate.key));

  const remove = (index: number) => {
    const result = removeWithUndo(gates, index);
    if (!result) return;
    rowIds.current.splice(index, 1);
    setGates(result.items);
    showToast({
      message: t("fundEditor.mandate.gateRemoved"),
      onUndo: () => {
        const current = latest.current.gates;
        const restored = restoreItem(current, result.removed, (a, b) => a.key === b.key);
        if (restored.length > current.length) {
          const at = Math.min(Math.max(result.removed.index, 0), current.length);
          rowIds.current.splice(at, 0, crypto.randomUUID());
        }
        onChange({ ...latest.current, gates: restored });
      },
    });
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="overflow-hidden rounded-lg bg-surface shadow-card">
        {gates.map((gate, index) => (
          <GateRow
            key={rowIds.current[index]}
            gate={gate}
            index={index}
            count={gates.length}
            otherKeys={gates.filter((_, i) => i !== index).map((item) => item.key)}
            onPatch={(patch) =>
              setGates(gates.map((item, i) => (i === index ? { ...item, ...patch } : item)))
            }
            onMove={(delta) => {
              rowIds.current = moveItem(rowIds.current, index, delta);
              setGates(moveItem(gates, index, delta));
            }}
            onRemove={() => remove(index)}
          />
        ))}
        {gates.length === 0 && (
          <p className="m-0 px-4 py-5 text-list text-ink-3">{t("fundEditor.mandate.empty")}</p>
        )}
      </div>

      <GateBuilder
        open={building}
        onClose={() => setBuilding(false)}
        onAdd={(built) =>
          setGates([
            ...gates,
            {
              key: freeKey(
                built.label,
                gates.map((gate) => gate.key),
              ),
              label: built.label,
              description: built.description,
              treatment: built.treatment,
            },
          ])
        }
      />
      {!building && (
        <div>
          <Button variant="secondary" size="md" icon={Plus} onClick={() => setBuilding(true)}>
            {t("fundEditor.mandate.addGate")}
          </Button>
        </div>
      )}

      {suggestions.length > 0 && (
        <section className="rounded-lg bg-canvas p-[18px]">
          <p className="m-0 text-list font-semibold text-ink-1">
            {t("fundEditor.mandate.suggestionsTitle")}
          </p>
          <p className="mt-1 mb-0 text-meta leading-4 text-ink-3">
            {t("fundEditor.mandate.suggestionsHint")}
          </p>
          <ul className="m-0 mt-3 list-none divide-y divide-line p-0">
            {suggestions.map((gate) => (
              <li key={gate.key} className="flex items-start justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-list text-ink-1">{gate.label}</span>
                  <span className="block text-meta text-ink-3">{gate.basis}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={t("fundEditor.mandate.addNamed", { name: gate.label })}
                  onClick={() =>
                    setGates([
                      ...gates,
                      {
                        key: gate.key,
                        label: gate.label,
                        description: gate.description,
                        treatment: gate.treatment,
                      },
                    ])
                  }
                >
                  {t("fundEditor.mandate.add")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {financeLeft.length > 0 && (
        <section className="rounded-lg bg-canvas p-[18px]">
          <p className="m-0 text-list font-semibold text-ink-1">
            {t("fundEditor.mandate.financeTitle")}
          </p>
          <p className="mt-1 mb-0 text-meta leading-4 text-ink-3">
            {t("fundEditor.mandate.financeHint")}
          </p>
          <ul className="m-0 mt-3 list-none divide-y divide-line p-0">
            {financeLeft.map((gate) => (
              <li key={gate.key} className="flex items-start justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-list text-ink-1">{gate.label}</span>
                  <span className="block text-meta text-ink-3">{gate.description}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={t("fundEditor.mandate.addNamed", { name: gate.label })}
                  onClick={() =>
                    setGates([
                      ...gates,
                      {
                        key: gate.key,
                        label: gate.label,
                        description: gate.description,
                        treatment: gate.treatment,
                      },
                    ])
                  }
                >
                  {t("fundEditor.mandate.add")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Disclosure
        title={t("fundEditor.mandate.reasonsTitle")}
        description={t("fundEditor.mandate.reasonsDescription")}
      >
        <ReasonCodesEditor fundId={fundId} />
      </Disclosure>
    </div>
  );
}
