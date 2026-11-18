/**
 * The content of a case's "all actions" menu (Cases v4 320 px, CaseStatus 360 px): groups
 * Fase (Genåbn when decided), Status and Beslutning with the shared action vocabulary. The
 * current state is dimmed with a check, the recommended step says "Anbefalet", and an action
 * the role cannot take is shown disabled with the reason.
 */
import { Fragment } from "react";
import { MenuItem, MenuLabel } from "@/components/ds/Menu";
import { caseActionCopy } from "@/lib/cases/case-action-copy";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { CaseMenuGroup, CaseMenuItem } from "@/lib/cases/case-actions";

export function CaseActionMenuItems({
  groups,
  onSelect,
}: {
  groups: readonly CaseMenuGroup[];
  onSelect: (item: CaseMenuItem) => void;
}) {
  const t = useT();
  const language = useLanguage();
  return (
    <>
      {groups.map((group) => (
        <Fragment key={group.heading}>
          <MenuLabel>{t(`cases.groups.${group.heading}`)}</MenuLabel>
          {group.items.map((item) => {
            const copy = caseActionCopy(item.id, language);
            return (
              <MenuItem
                key={item.id}
                icon={copy.icon}
                tone={copy.tone}
                description={item.blocked ?? copy.description}
                recommended={item.recommended && !item.blocked}
                current={item.current}
                disabled={item.blocked !== null}
                onSelect={() => onSelect(item)}
              >
                {copy.label}
              </MenuItem>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}
