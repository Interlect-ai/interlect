/**
 * "Sådan ser jeres dybe analyse ud": the tabs a deep analysis of a case has, built
 * from this version's real set of specialists, and what controls each tab. Facts from the code
 * (DeepCaseView, deep-view.ts, specialist-prompts.ts; report): Konklusion is Interlect's
 * synthesis (score calculated in code, the rules are checked there); one tab per active specialist,
 * which only assesses its own areas and follows its focus (Customise below); Økonomi is calculated
 * in code from the annual reports; Risici are assessed by Interlect.
 */
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Calculator, Coins, ShieldAlert, Sparkles } from "lucide-react";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { SpecialistBot } from "@/components/ai/SpecialistBot";
import { ownSpecialistKind, specialistKind } from "@/components/ai/specialist-kind";
import { Reveal } from "@/components/ds/Reveal";
import { useFundSpecialists } from "@/components/funds/editor/use-fund-specialists";
import { standardSpecialistCardIn, STANDARD_SPECIALIST_CARDS } from "@/lib/funds/specialist-cards";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

type TabKey = "conclusion" | "specialist" | "economy" | "risks";

export function AnalysisMap({ fundId, configId }: { fundId: string; configId: string }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const view = useFundSpecialists(fundId, configId).data;
  const [tab, setTab] = useState<{ key: TabKey; id?: string; name?: string }>({
    key: "conclusion",
  });

  const specialists = view
    ? [
        ...view.standard
          .filter((module) => module.enabled)
          .map((module) => ({
            id: module.id,
            name:
              module.id in STANDARD_SPECIALIST_CARDS
                ? standardSpecialistCardIn(
                    module.id as keyof typeof STANDARD_SPECIALIST_CARDS,
                    language,
                  ).label
                : module.title,
            kind: specialistKind(module.id),
          })),
        ...view.custom.flatMap((item, index) =>
          item.enabled ? [{ id: item.key, name: item.name, kind: ownSpecialistKind(index) }] : [],
        ),
      ]
    : [];

  const explain: Record<TabKey, { title: MessageKey; body: MessageKey; ai: boolean }> = {
    conclusion: {
      title: "fundSetup.analysisMap.conclusionTitle",
      body: "fundSetup.analysisMap.conclusionBody",
      ai: true,
    },
    specialist: {
      title: "fundSetup.analysisMap.specialistTitle",
      body: "fundSetup.analysisMap.specialistBody",
      ai: true,
    },
    economy: {
      title: "fundSetup.analysisMap.economyTitle",
      body: "fundSetup.analysisMap.economyBody",
      ai: false,
    },
    risks: {
      title: "fundSetup.analysisMap.risksTitle",
      body: "fundSetup.analysisMap.risksBody",
      ai: true,
    },
  };
  const current = explain[tab.key];

  const tabButton = (key: TabKey, label: string, icon: React.ReactNode, id?: string) => {
    const on = tab.key === key && (key !== "specialist" || tab.id === id);
    return (
      <button
        key={`${key}-${id ?? ""}`}
        type="button"
        data-browse
        aria-pressed={on}
        onClick={() => setTab(id ? { key, id, name: label } : { key })}
        className={cn(
          "relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-pill border-0 px-3.5 font-[inherit] text-list font-medium whitespace-nowrap transition-colors",
          on ? "text-ink-1" : "bg-transparent text-ink-3 hover:text-ink-1",
        )}
      >
        {on && (
          <motion.span
            layoutId="analysis-map-tab"
            className="absolute inset-0 -z-0 rounded-pill bg-surface shadow-pill"
            transition={reduced ? { duration: 0 } : SPRING.snappy}
          />
        )}
        <span className="relative z-10 inline-flex items-center gap-2">
          {icon}
          {label}
        </span>
      </button>
    );
  };

  return (
    <Reveal>
      <section
        aria-label={t("fundSetup.analysisMap.title")}
        className="flex flex-col gap-4 rounded-lg bg-surface p-5 shadow-card"
      >
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-section font-semibold">{t("fundSetup.analysisMap.title")}</h3>
          <p className="m-0 text-list text-ink-3">{t("fundSetup.analysisMap.lead")}</p>
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-pill bg-sunken p-1 [scrollbar-width:none]">
          {tabButton(
            "conclusion",
            t("fundSetup.analysisMap.conclusion"),
            <Sparkles className="size-3.5" aria-hidden />,
          )}
          {specialists.map((item) =>
            tabButton(
              "specialist",
              item.name,
              <SpecialistBot kind={item.kind} size={20} />,
              item.id,
            ),
          )}
          {tabButton(
            "economy",
            t("fundSetup.analysisMap.economy"),
            <Coins className="size-3.5" aria-hidden />,
          )}
          {tabButton(
            "risks",
            t("fundSetup.analysisMap.risks"),
            <ShieldAlert className="size-3.5" aria-hidden />,
          )}
        </div>
        <motion.div
          key={`${tab.key}-${tab.id ?? ""}`}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="flex items-start gap-3 rounded-md bg-canvas p-4"
        >
          <span
            aria-hidden
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-[10px]",
              current.ai ? "bg-ai-wash" : "bg-surface text-ink-2",
            )}
          >
            {current.ai ? <InterlectMark size={12} /> : <Calculator className="size-4" />}
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-list font-semibold text-ink-1">
              {t(current.title, { name: tab.name ?? "" })}
            </span>
            <span className="text-meta leading-[1.55] text-ink-2">
              {t(current.body, { name: tab.name ?? "" })}
            </span>
          </span>
        </motion.div>
      </section>
    </Reveal>
  );
}
