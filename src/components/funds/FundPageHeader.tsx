/**
 * The page header of /fond (prototype Fondsopsaetning v2): the 36 px title. The pill
 * "Opsætning | Analysemetode" is gone with the method page, so the header carries
 * only the title.
 */
import type { ReactNode } from "react";
import { Reveal } from "@/components/ds/Reveal";

export function FundPageHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex max-w-[1160px] flex-col gap-[26px] px-4 pt-6 pb-20 md:px-11 md:pt-8 md:pb-[72px]">
      <Reveal className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 text-[30px] leading-[1.05] font-semibold tracking-display md:text-[36px]">
          {title}
        </h1>
      </Reveal>
      {children}
    </div>
  );
}
