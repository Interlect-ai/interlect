/**
 * Selskabet, Interlect fandt (masterplan B4, ændret 25/9-2026): navn, registernummer og
 * hjemmeside. Sikkerhedsmåleren og signalerne bag matchet er fjernet (beslutningslog 15. okt):
 * produktet viser ikke, hvordan analysen blev lavet.
 */
import { ExternalLink } from "lucide-react";
import type { CaseIdentity } from "@/lib/cases/cases.functions";
import { useT } from "@/lib/i18n/useT";
import { registryCompanyUrl, registryNumberLabel } from "@/lib/analysis/registries/types";

export function IdentityCard({
  identity,
  website,
}: {
  identity: CaseIdentity;
  website: string | null;
}) {
  const t = useT();
  const host = website?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") ?? null;
  // Dansk CVR, ellers et udenlandsk registernummer (fx norsk org.nr.).
  const registryNumber = identity.cvrNumber ?? identity.registryNumber;
  const registryCountry = identity.cvrNumber ? "DK" : (identity.registryCountry ?? "DK");
  const registryUrl = registryNumber ? registryCompanyUrl(registryCountry, registryNumber) : null;
  const note =
    identity.status === "unverified" && identity.assessed && !registryNumber
      ? t("caseView.identity.noteNoCvr")
      : null;

  return (
    <section className="mt-3" aria-label={t("caseView.identity.title")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-list text-ink-2">
          {identity.legalName && <span className="text-ink">{identity.legalName}</span>}
          {registryNumber && registryUrl ? (
            <a
              href={registryUrl}
              target="_blank"
              rel="noreferrer"
              className="mono-num inline-flex items-center gap-1 text-action hover:underline"
            >
              {registryNumberLabel(registryCountry)} {registryNumber}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : registryNumber ? (
            <span className="mono-num text-ink-2">
              {registryNumberLabel(registryCountry)} {registryNumber}
            </span>
          ) : (
            <span className="text-ink-4">{t("caseView.identity.noCvr")}</span>
          )}
          {host && <span className="mono-num text-ink-3">{host}</span>}
        </span>
      </div>
      {note && <p className="mt-1.5 max-w-[70ch] text-list leading-5 text-ink-3">{note}</p>}
    </section>
  );
}
