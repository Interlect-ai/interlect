/**
 * Step "Vægtning" (prototype Fondsopsaetning v2 + "Vægtning"): the donut, one slider per
 * criterion (5-40 %, the limits the server and the database enforce), and the sum always 100 %:
 * moving one slider shares the rest of the weight between the others in proportion. A click on a
 * criterion unfolds "Hvad skal Interlect kigge efter?", the category, "Hjælp mig" and "Ret med AI".
 * A criterion without a description says so in coral. The text of a criterion is what the analyses
 * read; the weight decides its share of the score (calculated in code, never by the AI).
 */
import { useRef, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { showToast } from "@/components/ds/Toast";
import { Collapse } from "@/components/ds/Collapse";
import { SCORE_CATEGORY_GROUPS } from "@/lib/cases/presentation";
import { CriterionAssist } from "@/components/funds/CriterionAssist";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import { fundConfigTemplatesIn } from "@/lib/funds/config-templates";
import {
  WEIGHT_MAX_PERCENT,
  WEIGHT_MIN_PERCENT,
  WEIGHT_TOTAL_PERCENT,
} from "@/lib/funds/config-limits";
import { defaultCriterionDescription, isCustomCriterion } from "@/lib/funds/criterion-defaults";
import {
  normalizeWeights,
  redistributeWeights,
  uniqueKey,
  weightTotal,
  weightsWithNewCriterion,
  weightsWithoutCriterion,
} from "@/lib/funds/editor-rules";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { CriterionAiFix } from "./CriterionAiFix";
import {
  categoryGroupLabelKey,
  moveItem,
  scoreCategoryOptionsByGroup,
  TextInput,
  textareaClass,
} from "./fields";
import { Disclosure } from "./Disclosure";
import { WeightDonut, weightColor } from "./WeightDonut";

type EditorState = SaveFundConfigInput;
type Criterion = EditorState["criteria"][number];

// The page's language first: "Nulstil til standard" writes that text, and a criterion with the
// standard text in either language is not "Tilpasset".
const TEMPLATES = {
  da: [...fundConfigTemplatesIn("da"), ...fundConfigTemplatesIn("en")],
  en: [...fundConfigTemplatesIn("en"), ...fundConfigTemplatesIn("da")],
};

export function WeightsStep({
  fundId,
  value,
  onChange,
  canAi,
  ensureSaved,
  onProposalApplied,
}: {
  fundId: string;
  value: EditorState;
  onChange: (value: EditorState) => void;
  /** Admin and Lead: "Ret med AI" is shown. */
  canAi: boolean;
  ensureSaved: () => Promise<boolean>;
  onProposalApplied: () => void | Promise<void>;
}) {
  const t = useT();
  const templates = TEMPLATES[useLanguage()];
  const localeTag = useLocaleTag();
  const format = (weight: number) => weight.toLocaleString(localeTag, { maximumFractionDigits: 1 });
  const [hovered, setHovered] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Stable row ids: the key changes when the name is edited, and a row must not lose its open
  // panel (or a paid "Ret med AI" in flight) when the one above it is removed.
  const rowIds = useRef<string[]>([]);
  while (rowIds.current.length < value.criteria.length) rowIds.current.push(crypto.randomUUID());
  rowIds.current.length = value.criteria.length;

  const criteria = value.criteria;
  const total = weightTotal(criteria.map((criterion) => criterion.weight));
  const sumOk = Math.abs(total - 100) < 0.05;
  // A weight outside 5-40 % (an import, an AI proposal or an old version) blocks a publish too.
  const outOfRange = criteria.filter(
    (criterion) => criterion.weight < WEIGHT_MIN_PERCENT || criterion.weight > WEIGHT_MAX_PERCENT,
  );
  const weightsOk = sumOk && outOfRange.length === 0;
  // With too few or too many criteria no split can keep every weight within 5-40 %.
  const minCount = Math.ceil(WEIGHT_TOTAL_PERCENT / WEIGHT_MAX_PERCENT);
  const maxCount = Math.floor(WEIGHT_TOTAL_PERCENT / WEIGHT_MIN_PERCENT);
  const feasible = criteria.length >= minCount && criteria.length <= maxCount;
  const limits = t("fundEditor.weights.limits", {
    min: WEIGHT_MIN_PERCENT,
    max: WEIGHT_MAX_PERCENT,
  });
  const weightMessage = weightsOk
    ? t("fundEditor.weights.ok", { limits })
    : criteria.length > 0 && !feasible
      ? criteria.length < minCount
        ? t("fundEditor.weights.tooFew", { count: criteria.length, limits, min: minCount })
        : t("fundEditor.weights.tooMany", { count: criteria.length, limits, max: maxCount })
      : sumOk
        ? t("fundEditor.weights.outOfRange", {
            items: outOfRange
              .map((criterion) =>
                t("fundEditor.weights.itemWeight", {
                  name: criterion.label || t("fundEditor.weights.aCriterion"),
                  weight: format(criterion.weight),
                }),
              )
              .join(", "),
            limits,
          })
        : total < 100
          ? t("fundEditor.weights.missing", { amount: format(100 - total) })
          : t("fundEditor.weights.excess", { amount: format(total - 100) });
  const otherKeys = (index: number) => criteria.filter((_, i) => i !== index).map((c) => c.key);
  const setCriteria = (next: Criterion[]) => onChange({ ...value, criteria: next });
  const patchCriterion = (index: number, patch: Partial<Criterion>) =>
    setCriteria(criteria.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setWeights = (weights: number[]) =>
    setCriteria(criteria.map((item, i) => ({ ...item, weight: weights[i] ?? item.weight })));

  const addCriterion = () => {
    const weights = weightsWithNewCriterion(criteria.map((criterion) => criterion.weight));
    const id = crypto.randomUUID();
    rowIds.current.push(id);
    setOpen((current) => new Set(current).add(id));
    onChange({
      ...value,
      criteria: [
        ...criteria.map((item, i) => ({ ...item, weight: weights[i] ?? item.weight })),
        {
          key: uniqueKey(
            `criterion_${criteria.length + 1}`,
            "criterion",
            criteria.map((criterion) => criterion.key),
          ),
          label: "Nyt kriterium", // stored in the draft (data), so it stays Danish
          description: "",
          category: "fund_thesis_fit",
          weight: weights[criteria.length] ?? WEIGHT_MIN_PERCENT,
        },
      ],
    });
  };

  const latest = useRef(value);
  latest.current = value;
  const removeCriterion = (index: number) => {
    const removed = criteria[index];
    if (!removed) return;
    const before = criteria;
    const beforeIds = [...rowIds.current];
    const weights = weightsWithoutCriterion(
      criteria.map((criterion) => criterion.weight),
      index,
    );
    rowIds.current.splice(index, 1);
    const after = criteria
      .filter((_, i) => i !== index)
      .map((item, i) => ({ ...item, weight: weights[i] ?? item.weight }));
    onChange({ ...value, criteria: after });
    // One click removes, so the toast can take it back (as a removed gate can be).
    showToast({
      message: t("fundEditor.weights.removed", {
        name: removed.label || t("fundEditor.weights.theCriterion"),
      }),
      onUndo: () => {
        const current = latest.current.criteria;
        if (current === after) {
          rowIds.current = beforeIds;
          onChange({ ...latest.current, criteria: before });
          return;
        }
        if (current.some((item) => item.key === removed.key)) return;
        const at = Math.min(index, current.length);
        const restored = [...current.slice(0, at), removed, ...current.slice(at)];
        const normalized = normalizeWeights(restored.map((item) => item.weight));
        rowIds.current.splice(at, 0, crypto.randomUUID());
        onChange({
          ...latest.current,
          criteria: restored.map((item, i) => ({ ...item, weight: normalized[i] ?? item.weight })),
        });
      },
    });
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-6 gap-y-4 rounded-md px-[18px] py-3.5 transition-colors duration-300",
          weightsOk ? "bg-positive-wash" : "bg-warning-wash",
        )}
      >
        <WeightDonut
          items={criteria.map((criterion) => ({
            label: criterion.label,
            weight: criterion.weight,
          }))}
          hovered={hovered}
          onHover={setHovered}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-list text-ink-2" aria-live="polite">
            {weightMessage}
          </span>
          {!weightsOk && feasible && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-1.5 self-start"
              onClick={() => setWeights(normalizeWeights(criteria.map((c) => c.weight)))}
            >
              {t("fundEditor.weights.distribute")}
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-surface shadow-card">
        {criteria.map((criterion, index) => {
          const id = rowIds.current[index]!;
          const expanded = open.has(id);
          const custom = isCustomCriterion(templates, criterion, value.strategyType);
          const standard = defaultCriterionDescription(
            templates,
            criterion.key,
            value.strategyType,
          );
          const missingText = !criterion.description.trim();
          return (
            <div
              key={id}
              className={cn("transition-colors duration-300", index > 0 && "border-t border-line")}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="grid min-h-[56px] grid-cols-[10px_minmax(0,1fr)_minmax(0,1.2fr)_72px_28px_28px] items-center gap-3.5 px-[18px] py-1.5 max-md:grid-cols-[10px_minmax(0,1fr)_72px_28px_28px]">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ background: weightColor(index) }}
                />
                <button
                  type="button"
                  aria-expanded={expanded}
                  data-criterion-toggle=""
                  onClick={() => toggle(id)}
                  className="flex min-w-0 cursor-pointer flex-col items-start gap-0.5 border-0 bg-transparent p-0 text-left font-[inherit]"
                >
                  <span className="flex max-w-full items-center gap-2 text-[14px] font-semibold">
                    <span className="truncate">
                      {criterion.label || t("fundEditor.weights.unnamed")}
                    </span>
                    {custom && (
                      <span className="inline-flex shrink-0 items-center gap-[5px] text-micro font-medium text-ink-3">
                        <span aria-hidden className="size-1.5 rounded-full bg-action" />
                        {t("fundEditor.weights.custom")}
                      </span>
                    )}
                  </span>
                  {missingText && (
                    <span className="text-meta text-ai">{t("fundEditor.weights.describe")}</span>
                  )}
                </button>
                <input
                  type="range"
                  min={WEIGHT_MIN_PERCENT}
                  max={WEIGHT_MAX_PERCENT}
                  step={1}
                  value={Math.min(
                    WEIGHT_MAX_PERCENT,
                    Math.max(WEIGHT_MIN_PERCENT, Math.round(criterion.weight)),
                  )}
                  onChange={(event) =>
                    setWeights(
                      redistributeWeights(
                        criteria.map((item) => item.weight),
                        index,
                        Number(event.target.value),
                      ),
                    )
                  }
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                  aria-label={t("fundEditor.weights.weightFor", {
                    name: criterion.label || t("fundEditor.weights.theCriterion"),
                  })}
                  aria-valuetext={t("fundEditor.weights.percentText", {
                    weight: format(criterion.weight),
                  })}
                  className="w-full cursor-pointer accent-[var(--ink-1)] max-md:col-span-5 max-md:row-start-2 max-md:mb-1"
                />
                {/* The share can be typed, not only dragged. */}
                <WeightField
                  weight={criterion.weight}
                  display={format(criterion.weight)}
                  label={t("fundEditor.weights.typeWeightFor", {
                    name: criterion.label || t("fundEditor.weights.theCriterion"),
                  })}
                  onCommit={(typed) =>
                    setWeights(
                      redistributeWeights(
                        criteria.map((item) => item.weight),
                        index,
                        Math.min(WEIGHT_MAX_PERCENT, Math.max(WEIGHT_MIN_PERCENT, typed)),
                      ),
                    )
                  }
                />
                {/* Removing a criterion is one click on its row. */}
                <button
                  type="button"
                  aria-label={t("fundEditor.fields.removeNoun", {
                    noun: criterion.label || t("fundEditor.weights.theCriterion"),
                  })}
                  onClick={() => removeCriterion(index)}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ink-4 transition-colors hover:bg-canvas hover:text-critical focus-visible:outline-2 focus-visible:outline-action"
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
                {/* The arrow opens the row too (it was only an icon). */}
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={criterion.label || t("fundEditor.weights.theCriterion")}
                  onClick={() => toggle(id)}
                  className="grid size-7 cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-ink-3 transition-colors hover:bg-canvas hover:text-ink-1"
                >
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "size-4 transition-transform duration-[280ms] ease-standard",
                      expanded && "rotate-180",
                    )}
                  />
                </button>
              </div>
              <Collapse open={expanded}>
                <div className="flex flex-col gap-3.5 px-[18px] pt-1 pb-5 pl-[42px] max-md:pl-[18px]">
                  <div className="grid gap-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-meta text-ink-3">{t("fundEditor.weights.name")}</span>
                      <TextInput
                        ariaLabel={t("fundEditor.weights.criterionName")}
                        value={criterion.label}
                        onChange={(next) =>
                          patchCriterion(index, {
                            label: next,
                            key: uniqueKey(next, criterion.key, otherKeys(index)),
                          })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-meta text-ink-3">
                        {t("fundEditor.weights.category")}
                        <span className="text-ink-4">
                          {" "}
                          ·{" "}
                          {t("fundEditor.weights.assessedBy", {
                            group: t(categoryGroupLabelKey(criterion.category)).toLowerCase(),
                          })}
                        </span>
                      </span>
                      <select
                        aria-label={t("fundEditor.weights.category")}
                        value={criterion.category}
                        onChange={(event) =>
                          patchCriterion(index, {
                            category: event.target.value as Criterion["category"],
                          })
                        }
                        className="h-11 rounded-sm border-0 bg-sunken px-3 text-[14px] text-ink-1 outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]"
                      >
                        {scoreCategoryOptionsByGroup.map((group) => (
                          <optgroup key={group.groupLabelKey} label={t(group.groupLabelKey)}>
                            {group.options.map(([key, labelKey]) => (
                              <option key={key} value={key}>
                                {t(labelKey)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-meta text-ink-3">{t("fundEditor.weights.lookFor")}</span>
                    <textarea
                      aria-label={t("fundEditor.weights.criterionDescription")}
                      value={criterion.description}
                      rows={3}
                      placeholder={t("fundEditor.weights.descriptionPlaceholder")}
                      onChange={(event) =>
                        patchCriterion(index, { description: event.target.value })
                      }
                      className={cn(
                        textareaClass,
                        "min-h-[88px]",
                        missingText && "shadow-[inset_0_0_0_1.5px_var(--ai)]",
                      )}
                    />
                  </label>
                  {criterion.category === "financial_strength" && (
                    <label
                      className="flex items-start gap-2 text-meta leading-4 text-ink-2"
                      title={t("fundEditor.weights.codeAnchorHint")}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={criterion.codeAnchor !== false}
                        onChange={(event) =>
                          patchCriterion(index, { codeAnchor: event.target.checked })
                        }
                      />
                      {t("fundEditor.weights.codeAnchor")}
                    </label>
                  )}
                  {/* What each button does, in one line. */}
                  <p className="m-0 text-meta leading-[1.5] text-ink-3">
                    {t("fundSetup.map.criterionButtons")}
                  </p>
                  <div className="flex flex-wrap items-start gap-1.5">
                    <CriterionAssist
                      fundId={fundId}
                      criterion={criterion}
                      fund={value}
                      onAccept={(description) => patchCriterion(index, { description })}
                    />
                    {canAi && (
                      <CriterionAiFix
                        configId={value.configId}
                        criterion={{ key: criterion.key, label: criterion.label }}
                        ensureSaved={ensureSaved}
                        onApplied={onProposalApplied}
                      />
                    )}
                    {custom && standard && (
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => patchCriterion(index, { description: standard })}
                      >
                        {t("fundEditor.weights.reset")}
                      </Button>
                    )}
                    <span className="flex-1" />
                    <Button
                      size="sm"
                      variant="quiet"
                      aria-label={t("fundEditor.fields.moveUp", {
                        noun: criterion.label || t("fundEditor.weights.theCriterion"),
                      })}
                      disabled={index === 0}
                      onClick={() => {
                        rowIds.current = moveItem(rowIds.current, index, -1);
                        setCriteria(moveItem(criteria, index, -1));
                      }}
                    >
                      {t("fundEditor.weights.up")}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      aria-label={t("fundEditor.fields.moveDown", {
                        noun: criterion.label || t("fundEditor.weights.theCriterion"),
                      })}
                      disabled={index === criteria.length - 1}
                      onClick={() => {
                        rowIds.current = moveItem(rowIds.current, index, 1);
                        setCriteria(moveItem(criteria, index, 1));
                      }}
                    >
                      {t("fundEditor.weights.down")}
                    </Button>
                  </div>
                </div>
              </Collapse>
            </div>
          );
        })}
        {criteria.length === 0 && (
          <p className="m-0 px-[18px] py-5 text-list text-ink-3">{t("fundEditor.weights.empty")}</p>
        )}
      </div>

      <div>
        <Button size="md" variant="secondary" icon={Plus} onClick={addCriterion}>
          {t("fundEditor.weights.add")}
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_48px] items-center gap-3.5 rounded-lg bg-canvas px-[18px] py-4 max-md:grid-cols-[minmax(0,1fr)_48px]">
        <span className="text-[14px] font-semibold">{t("fundEditor.weights.threshold")}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.min(100, Math.max(0, value.analysisThreshold))}
          onChange={(event) =>
            onChange({ ...value, analysisThreshold: Number(event.target.value) })
          }
          aria-label={t("fundEditor.weights.threshold")}
          className="w-full cursor-pointer accent-[var(--ink-1)] max-md:col-span-2 max-md:row-start-2"
        />
        <span className="text-right text-[15px] font-semibold tabular-nums">
          {value.analysisThreshold}
        </span>
      </div>

      <Disclosure
        title={t("fundEditor.weights.groupsTitle")}
        description={t("fundEditor.weights.groupsDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {SCORE_CATEGORY_GROUPS.map((group) => {
            const inGroup = criteria.filter((criterion) =>
              (group.categories as readonly string[]).includes(criterion.category),
            );
            const groupWeight = inGroup.reduce((sum, criterion) => sum + criterion.weight, 0);
            return (
              <div key={group.key} className="rounded-md bg-canvas p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-list font-semibold text-ink-1">{t(group.labelKey)}</span>
                  <span className="text-meta text-ink-3 tabular-nums">{format(groupWeight)} %</span>
                </div>
                {inGroup.length === 0 ? (
                  <p className="mt-1.5 mb-0 text-meta text-ink-3">
                    {t("fundEditor.weights.noneInGroup")}
                  </p>
                ) : (
                  <ul className="mt-1.5 mb-0 list-none space-y-0.5 p-0">
                    {inGroup.map((criterion, i) => (
                      <li key={`${criterion.key}-${i}`} className="truncate text-meta text-ink-2">
                        {criterion.label || t("fundEditor.weights.unnamed")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </Disclosure>
    </div>
  );
}

/**
 * The typed share: what is typed stays as typed until Enter or leaving the field, so
 * "25" can be written; then it is kept within 5-40 % and the others share the rest. Shows the
 * same rounded value as the slider's text while not being edited.
 */
function WeightField({
  weight,
  display,
  label,
  onCommit,
}: {
  weight: number;
  display: string;
  label: string;
  onCommit: (typed: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const typed = Number(draft.replace(",", "."));
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(typed) && typed !== weight) onCommit(typed);
  };
  return (
    <label className="flex items-center justify-end gap-1 text-[15px] font-semibold tabular-nums">
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? display}
        onFocus={(event) => {
          setDraft(display);
          event.target.select();
        }}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d,.]/g, ""))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") setDraft(null);
        }}
        aria-label={label}
        className="w-12 rounded-sm border border-line bg-surface px-1.5 py-1 text-right font-[inherit] text-[15px] font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-action"
      />
      <span aria-hidden>%</span>
    </label>
  );
}
