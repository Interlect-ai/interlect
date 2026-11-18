/**
 * The fund's reasons for decisions ("årsagskoder") as an editable list. The dialogs in
 * Cases read them when a case is put on hold, rejected or invested in. They belong to the fund, not
 * to a version: a change applies at once and is not part of the draft. A reason is never deleted;
 * a deactivated one cannot be chosen any more, but older decisions keep it. Everyone in the fund
 * reads the list; only Admin and Lead change it (the server checks it too).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Collapse } from "@/components/ds/Collapse";
import { fieldClass } from "@/components/ds/Field";
import { LoadingState } from "@/components/ds/States";
import { showToast } from "@/components/ds/Toast";
import { Toggle } from "@/components/ds/Toggle";
import {
  listReasonCodes,
  saveReasonCode,
  setReasonCodeActive,
  type ReasonCodeView,
} from "@/lib/funds/reason-codes.functions";
import { REASON_APPLIES_TO, REASON_GROUPS, type ReasonGroup } from "@/lib/funds/reason-code-rules";
import type { MessageKey } from "@/lib/i18n/translate";
import { useT, useLanguage } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { userMessage } from "@/lib/errors/user-message";

const GROUP_LABEL: Record<ReasonGroup, MessageKey> = {
  thesis: "fundEditor.reasonCodes.group.thesis",
  team: "fundEditor.reasonCodes.group.team",
  market: "fundEditor.reasonCodes.group.market",
  product: "fundEditor.reasonCodes.group.product",
  traction: "fundEditor.reasonCodes.group.traction",
  economics: "fundEditor.reasonCodes.group.economics",
  timing: "fundEditor.reasonCodes.group.timing",
  portfolio: "fundEditor.reasonCodes.group.portfolio",
  process: "fundEditor.reasonCodes.group.process",
  positive: "fundEditor.reasonCodes.group.positive",
  other: "fundEditor.reasonCodes.group.other",
};

const APPLIES_LABEL: Record<(typeof REASON_APPLIES_TO)[number], MessageKey> = {
  advance: "fundEditor.reasonCodes.applies.advance",
  hold: "fundEditor.reasonCodes.applies.hold",
  reject: "fundEditor.reasonCodes.applies.reject",
  decline_ic: "fundEditor.reasonCodes.applies.decline_ic",
  invest: "fundEditor.reasonCodes.applies.invest",
  reopen: "fundEditor.reasonCodes.applies.reopen",
};

interface Draft {
  id: string | null;
  label: string;
  groupKey: ReasonGroup;
  appliesTo: string[];
  revisit: boolean;
  sortOrder: number;
}

const keyOf = (fundId: string) => ["reason-codes", fundId] as const;

function ReasonForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3.5 rounded-md bg-surface p-4 shadow-raised">
      <label className="flex flex-col gap-1.5">
        <span className="text-meta text-ink-3">{t("fundEditor.reasonCodes.reason")}</span>
        <input
          value={draft.label}
          maxLength={120}
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-meta text-ink-3">{t("fundEditor.reasonCodes.group.label")}</span>
        <select
          value={draft.groupKey}
          onChange={(event) => onChange({ ...draft, groupKey: event.target.value as ReasonGroup })}
          className="h-11 rounded-sm border-0 bg-sunken px-3 text-[14px] text-ink-1 outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]"
        >
          {REASON_GROUPS.map((group) => (
            <option key={group} value={group}>
              {t(GROUP_LABEL[group])}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 p-0 text-meta text-ink-3">
          {t("fundEditor.reasonCodes.usedAt")}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {REASON_APPLIES_TO.map((kind) => {
            const selected = draft.appliesTo.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onChange({
                    ...draft,
                    appliesTo: selected
                      ? draft.appliesTo.filter((item) => item !== kind)
                      : [...draft.appliesTo, kind],
                  })
                }
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center rounded-[10px] border-0 px-3 font-[inherit] text-list whitespace-nowrap transition-[background,color,transform] duration-200 active:scale-[.96]",
                  selected
                    ? "bg-inverse text-ink-inverse"
                    : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)]",
                )}
              >
                {t(APPLIES_LABEL[kind])}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <Toggle
          checked={draft.revisit}
          onCheckedChange={(checked) => onChange({ ...draft, revisit: checked })}
          label={t("fundEditor.reasonCodes.revisitLabel")}
        />
        <span className="text-list text-ink-2">{t("fundEditor.reasonCodes.revisitText")}</span>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button variant="quiet" size="md" onClick={onCancel} disabled={saving}>
          {t("fundEditor.reasonCodes.cancel")}
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={onSave}
          disabled={!draft.label.trim() || draft.appliesTo.length === 0}
          pending={saving}
          pendingLabel={t("fundEditor.reasonCodes.saving")}
        >
          {t("fundEditor.reasonCodes.save")}
        </Button>
      </div>
    </div>
  );
}

export function ReasonCodesEditor({ fundId }: { fundId: string }) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const list = useServerFn(listReasonCodes);
  const save = useServerFn(saveReasonCode);
  const setActive = useServerFn(setReasonCodeActive);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Its own key under the shared prefix: the move dialogs cache their list under
  // ["reason-codes", fundId, "dialog", …], and invalidating keyOf(fundId) refreshes both.
  const query = useQuery({
    queryKey: [...keyOf(fundId), "editor"],
    queryFn: () => list({ data: { fundId } }),
  });

  const onError = (cause: Error) =>
    showToast({
      message: userMessage(cause, t("system.actionFailed"), language),
      tone: "error",
      duration: 6000,
    });
  const saveMutation = useMutation({
    mutationFn: (input: Draft) =>
      save({
        data: {
          fundId,
          ...(input.id ? { id: input.id } : {}),
          label: input.label,
          groupKey: input.groupKey,
          appliesTo: input.appliesTo as Array<(typeof REASON_APPLIES_TO)[number]>,
          revisit: input.revisit,
          sortOrder: input.sortOrder,
        },
      }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: keyOf(fundId) });
      setDraft(null);
      showToast({ message: t("fundEditor.reasonCodes.saved", { label: saved.label }) });
    },
    onError,
  });
  const activeMutation = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      setActive({ data: { fundId, ...input } }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: keyOf(fundId) });
      showToast({
        message: saved.isActive
          ? t("fundEditor.reasonCodes.selectableAgain", { label: saved.label })
          : t("fundEditor.reasonCodes.notSelectable", { label: saved.label }),
      });
    },
    onError,
  });

  if (query.isLoading) return <LoadingState title={t("fundEditor.reasonCodes.loading")} />;
  if (query.isError || !query.data) {
    return <p className="m-0 text-list text-ink-3">{t("fundEditor.reasonCodes.loadFailed")}</p>;
  }
  const { codes, canEdit } = query.data;
  const nextOrder = codes.reduce((max, code) => Math.max(max, code.sortOrder), 0) + 10;
  const startEdit = (code: ReasonCodeView) =>
    setDraft({
      id: code.id,
      label: code.label,
      groupKey: code.groupKey,
      appliesTo: code.appliesTo,
      revisit: code.revisit,
      sortOrder: code.sortOrder,
    });

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-meta text-ink-3">
        {t("fundEditor.reasonCodes.intro")}
        {!canEdit && ` ${t("fundEditor.reasonCodes.readOnly")}`}
      </p>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-md bg-surface p-0 shadow-[inset_0_0_0_1px_var(--line)]">
        {codes.length === 0 && (
          <li className="px-4 py-4 text-list text-ink-3">{t("fundEditor.reasonCodes.empty")}</li>
        )}
        {codes.map((code, index) => (
          <li
            key={code.id}
            className={cn(
              "grid min-h-[54px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2",
              index > 0 && "border-t border-line",
              !code.isActive && "opacity-60",
            )}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[14px] font-medium">{code.label}</span>
              <span className="truncate text-meta text-ink-3">
                {t(GROUP_LABEL[code.groupKey])} ·{" "}
                {code.appliesTo
                  .map((kind) => {
                    const appliesKey = APPLIES_LABEL[kind as keyof typeof APPLIES_LABEL];
                    return appliesKey ? t(appliesKey) : kind;
                  })
                  .join(", ")}
                {code.revisit ? ` · ${t("fundEditor.reasonCodes.revisitShort")}` : ""}
              </span>
            </span>
            {canEdit ? (
              <>
                <Button size="sm" variant="quiet" onClick={() => startEdit(code)}>
                  {t("fundEditor.reasonCodes.edit")}
                </Button>
                <Toggle
                  checked={code.isActive}
                  disabled={activeMutation.isPending}
                  onCheckedChange={(checked) =>
                    activeMutation.mutate({ id: code.id, active: checked })
                  }
                  label={t("fundEditor.reasonCodes.activeLabel", { label: code.label })}
                />
              </>
            ) : (
              <span className="col-span-2 text-meta text-ink-3">
                {code.isActive
                  ? t("fundEditor.reasonCodes.active")
                  : t("fundEditor.reasonCodes.inactive")}
              </span>
            )}
          </li>
        ))}
      </ul>
      <Collapse open={draft !== null} className="px-1 pt-1 pb-2">
        {draft && (
          <ReasonForm
            draft={draft}
            onChange={setDraft}
            onSave={() => saveMutation.mutate(draft)}
            onCancel={() => setDraft(null)}
            saving={saveMutation.isPending}
          />
        )}
      </Collapse>
      {canEdit && draft === null && (
        <div>
          <Button
            size="md"
            variant="secondary"
            icon={Plus}
            onClick={() =>
              setDraft({
                id: null,
                label: "",
                groupKey: "other",
                appliesTo: ["reject"],
                revisit: false,
                sortOrder: nextOrder,
              })
            }
          >
            {t("fundEditor.reasonCodes.add")}
          </Button>
        </div>
      )}
    </div>
  );
}
