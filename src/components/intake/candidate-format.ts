/** Text helpers for candidate cards (Find step and Bekræft). */
import type { CompanyCandidate } from "@/lib/analysis/identity-resolve";
import type { Language } from "@/lib/i18n/language";
import { registryNumberLabel } from "@/lib/analysis/registries/types";
import { translate } from "@/lib/i18n/translate";

/** "havbrugnord.dk, CVR 41234567, Hirtshals, stiftet 2021" from what is known. */
export function candidateMeta(candidate: CompanyCandidate, language: Language = "da"): string {
  const parts: string[] = [];
  if (candidate.website) parts.push(candidate.website);
  if (candidate.cvrNumber) {
    parts.push(`${registryNumberLabel(candidate.registryCountry)} ${candidate.cvrNumber}`);
  } else if (candidate.country) parts.push(candidate.country);
  if (candidate.city) parts.push(candidate.city);
  if (candidate.inactive)
    parts.push(
      translate(language, "intake.match.ended", {
        status: (candidate.status ?? "").toLowerCase(),
      }),
    );
  else if (candidate.foundedYear) {
    parts.push(translate(language, "intake.match.founded", { year: candidate.foundedYear }));
  }
  if (candidate.legalForm && !candidate.inactive) parts.push(candidate.legalForm);
  return parts.join(", ");
}
