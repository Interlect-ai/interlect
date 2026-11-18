/**
 * "Sprog" in Fondsopsætning: one choice per team, Dansk or English, and then the
 * interface and everything Interlect writes follow it. Everyone sees the choice; only Admin and
 * Lead (`configure_fund`) change it. Saved at once; the member funds are fetched again so the
 * whole app changes language without a reload, and the toast is already in the new language.
 */
import { useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { showToast } from "@/components/ds/Toast";
import type { FundRole } from "@/lib/domain/types";
import { hasCapability } from "@/lib/domain/workflow";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { LANGUAGE_NAMES, LANGUAGES, type Language } from "@/lib/i18n/language";
import { setFundLanguage } from "@/lib/i18n/language.functions";
import { translate } from "@/lib/i18n/translate";
import { useT } from "@/lib/i18n/useT";

const OPTIONS = LANGUAGES.map((language) => ({ value: language, label: LANGUAGE_NAMES[language] }));

export function LanguageBox({ fundId }: { fundId: string }) {
  const t = useT();
  const headingId = useId();
  const { funds, refreshFunds } = useActiveFund();
  const save = useServerFn(setFundLanguage);
  const fund = funds.find((candidate) => candidate.id === fundId);
  const mutation = useMutation({
    mutationFn: (language: Language) => save({ data: { fundId, language } }),
    onSuccess: async ({ language }) => {
      // Wait for the funds, so the page and the toast change language together.
      await refreshFunds();
      showToast({
        message: translate(language, "language.changed", { language: LANGUAGE_NAMES[language] }),
      });
    },
    onError: () => showToast({ message: t("language.notSaved"), tone: "error" }),
  });
  if (!fund) return null;
  const canEdit = hasCapability(fund.roles as FundRole[], "configure_fund");
  const value = mutation.isPending && mutation.variables ? mutation.variables : fund.language;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg bg-canvas p-[22px]"
    >
      <header className="flex min-w-[260px] flex-1 flex-col gap-1">
        <h2 id={headingId} className="m-0 text-list font-semibold">
          {t("language.label")}
        </h2>
        <p className="m-0 max-w-[620px] text-meta text-ink-3">
          {canEdit ? t("language.help") : t("language.readOnly")}
        </p>
      </header>
      {canEdit ? (
        <SegmentedControl
          options={OPTIONS}
          value={value}
          onChange={(language) => {
            if (language !== fund.language && !mutation.isPending) mutation.mutate(language);
          }}
          aria-label={t("language.label")}
        />
      ) : (
        <span className="text-list font-medium">{LANGUAGE_NAMES[fund.language]}</span>
      )}
    </section>
  );
}
