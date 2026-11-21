/**
 * The page header of /fond (prototype Teamopsaetning v3, `.t-page`): the 32 px title. The pill
 * "Opsætning | Analysemetode" is gone with the method page, so the header carries
 * only the title.: the prototype's `pagehead` has the "Interlect-Assistant" pill on the right;
 * the setup draws it into `#fund-page-actions` (SetupAssistant `PageAskButton`).
 */
import type { ReactNode } from "react";
import { Reveal } from "@/components/ds/Reveal";

export function FundPageHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex max-w-[1180px] flex-col gap-[22px] px-4 pt-6 pb-20 md:px-11 md:pt-8 md:pb-[72px]">
      <Reveal className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 text-[26px] leading-[1.1] font-semibold tracking-display md:text-[32px]">
          {title}
        </h1>
        <span id="fund-page-actions" className="ml-auto flex items-center empty:hidden" />
      </Reveal>
      {children}
    </div>
  );
}
