import type { AppRole } from "@/lib/supabase/types";
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

/** Klient-sikkert modul: rollelisten bruges både i UI og i validatorer. */
export const roleValues = ["admin", "lead", "member", "reader"] as const;

/** The role's name in the fund's language (Danish by default). */
export function roleLabel(role: AppRole, language: Language = "da"): string {
  return translate(language, `users.role.${role}`);
}

/** The prototype's one-line description of the role ("Brugere og adgang"). */
export function roleDescription(role: AppRole, language: Language = "da"): string {
  return translate(language, `users.roleDescription.${role}`);
}

/** Danish names, for server texts that are Danish on purpose. */
export const roleLabels: Record<AppRole, string> = {
  admin: roleLabel("admin"),
  lead: roleLabel("lead"),
  member: roleLabel("member"),
  reader: roleLabel("reader"),
};

/** Minutter en påbegyndt accept holder invitationen låst. */
export const CLAIM_TIMEOUT_MINUTES = 5;
