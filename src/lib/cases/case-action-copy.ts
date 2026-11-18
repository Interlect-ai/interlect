/** Label, description, icon and colours for each case action (the shared vocabulary). */
import { Gavel, ScanSearch, Sparkles, type LucideIcon } from "lucide-react";
import type { MenuTone } from "@/components/ds/Menu";
import { CASE_ACTIONS } from "@/lib/copy/actions";
import { translate } from "@/lib/i18n/translate";
import type { Language } from "@/lib/i18n/language";
import type { CaseActionId } from "./case-actions";

export interface ActionCopy {
  label: string;
  description: string;
  icon: LucideIcon;
  tone: MenuTone;
}

/** Icon and colours per action; the words come from the dictionary (`cases.actions.*`). */
function actionLook(id: CaseActionId): Pick<ActionCopy, "icon" | "tone"> {
  switch (id) {
    case "backToScreening":
      return CASE_ACTIONS.backToScreening;
    case "reopenInScreening":
      return { icon: ScanSearch, tone: CASE_ACTIONS.backToScreening.tone };
    case "reopenInDeepAnalysis":
      return { icon: Sparkles, tone: CASE_ACTIONS.runDeepAnalysis.tone };
    case "inCommittee":
      return { icon: Gavel, tone: CASE_ACTIONS.sendToCommittee.tone };
    default:
      return CASE_ACTIONS[id];
  }
}

export function caseActionCopy(id: CaseActionId, language: Language = "da"): ActionCopy {
  const { icon, tone } = actionLook(id);
  return {
    label: translate(language, `cases.actions.${id}.label`),
    description: translate(language, `cases.actions.${id}.description`),
    icon,
    tone,
  };
}
