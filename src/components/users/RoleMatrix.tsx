/**
 * "Hvad hver rolle kan" (prototype Brugere og adgang). The ticks come from `roleMatrix()`,
 * which is derived from `hasCapability` in workflow.ts, so the page and the server cannot
 * disagree. Medlem's two orange cells are real switches in the foot (Admin only; the server
 * checks manage_users and writes an audit line first): turning one on makes the cell green.
 */
import { Check, Minus, ToggleLeft } from "lucide-react";
import { Toggle } from "@/components/ds/Toggle";
import { roleVisual } from "@/components/users/role-visual";
import { matrixRoles, roleMatrix, type MatrixCell } from "@/lib/domain/role-matrix";
import { roleLabel } from "@/lib/auth/roles";
import type { FundSettings } from "@/lib/domain/workflow";
import { useLanguage, useT } from "@/lib/i18n/useT";

const CELL: Record<MatrixCell, { color: string }> = {
  yes: { color: "var(--positive)" },
  optin: { color: "var(--warning)" },
  no: { color: "var(--ink-4)" },
};

function CellIcon({ cell }: { cell: MatrixCell }) {
  const t = useT();
  const { color } = CELL[cell];
  const text = t(`users.matrix.${cell}`);
  const Icon = cell === "yes" ? Check : cell === "optin" ? ToggleLeft : Minus;
  return (
    <>
      <Icon className="size-[15px]" style={{ color }} strokeWidth={1.75} aria-hidden />
      <span className="sr-only">{text}</span>
    </>
  );
}

export function RoleMatrix({
  settings,
  onChangeSetting,
  pending,
}: {
  settings: FundSettings;
  onChangeSetting: (change: Partial<FundSettings>) => void;
  /** A setting is being saved; both switches wait. */
  pending: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const rows = roleMatrix(settings, language);
  return (
    <aside className="flex min-w-0 flex-col gap-3.5 rounded-xl bg-canvas px-6 py-[22px]">
      <h2 className="m-0 text-section font-semibold">{t("users.matrix.title")}</h2>
      <div
        role="table"
        aria-label={t("users.matrix.title")}
        className="grid grid-cols-[minmax(0,1fr)_repeat(4,58px)] items-center"
      >
        <div role="row" className="contents">
          <span role="columnheader">
            <span className="sr-only">{t("users.matrix.feature")}</span>
          </span>
          {matrixRoles.map((role) => {
            const visual = roleVisual[role];
            const Icon = visual.icon;
            return (
              <span
                key={role}
                role="columnheader"
                className="flex flex-col items-center gap-1.5 pb-2.5"
              >
                <span
                  className="grid size-[30px] place-items-center rounded-[9px]"
                  style={{ background: visual.tint, color: visual.color }}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="text-meta font-semibold">{roleLabel(role, language)}</span>
              </span>
            );
          })}
        </div>
        {rows.map((row) =>
          row.head ? (
            <span
              key={row.label}
              role="row"
              className="col-span-full pt-3.5 pb-1.5 text-micro font-semibold text-ink-4"
            >
              {row.label}
            </span>
          ) : (
            <div key={row.label} role="row" className="contents">
              <span
                role="rowheader"
                className="border-t border-line py-[9px] pr-2 text-list leading-[1.35] text-ink-1"
              >
                {row.label}
              </span>
              {row.cells.map((cell, index) => (
                <span
                  key={matrixRoles[index]}
                  role="cell"
                  className="grid h-full min-h-[38px] place-items-center border-t border-line"
                >
                  <CellIcon cell={cell} />
                </span>
              ))}
            </div>
          ),
        )}
      </div>
      <div className="flex flex-wrap gap-3.5 text-meta text-ink-3">
        <span className="flex items-center gap-1.5">
          <Check className="size-3.5" style={{ color: "var(--positive)" }} aria-hidden />
          {t("users.matrix.yes")}
        </span>
        <span className="flex items-center gap-1.5">
          <ToggleLeft className="size-3.5" style={{ color: "var(--warning)" }} aria-hidden />
          {t("users.matrix.optin")}
        </span>
        <span className="flex items-center gap-1.5">
          <Minus className="size-3.5" style={{ color: "var(--ink-4)" }} aria-hidden />
          {t("users.matrix.no")}
        </span>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-3.5">
        <span className="text-list font-semibold">{t("users.matrix.membersHeading")}</span>
        <SettingRow
          label={t("users.matrix.memberCanDecide")}
          hint={t("users.matrix.memberCanDecideHint")}
          checked={settings.memberCanDecide}
          disabled={pending}
          onChange={(value) => onChangeSetting({ memberCanDecide: value })}
        />
        <SettingRow
          label={t("users.matrix.memberCanPublish")}
          hint={t("users.matrix.memberCanPublishHint")}
          checked={settings.memberCanPublish}
          disabled={pending}
          onChange={(value) => onChangeSetting({ memberCanPublish: value })}
        />
      </div>

      <span className="text-meta leading-[1.5] text-ink-3">{t("users.matrix.readersNote")}</span>
    </aside>
  );
}

function SettingRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-list text-ink-1">{label}</span>
        <span className="text-meta text-ink-3">{hint}</span>
      </span>
      <Toggle checked={checked} disabled={disabled} label={label} onCheckedChange={onChange} />
    </div>
  );
}
