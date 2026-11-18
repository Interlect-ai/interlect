/**
 * Sikkerhed og data (redesign-skallen). Name-free: no model, provider or
 * service names; those stand only in the data processing agreement. No prototype exists: the page follows
 * Brugere og adgang ("Brugere og adgang") with its own header in the card, the
 * sections as canvas cards (radius 16, section titles) and the shell's states. Admin only;
 * the posture comes from the server (`getSecurityPosture`), never from the page.
 */
import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/ds/AppShell";
import { Reveal, RevealGroup } from "@/components/ds/Reveal";
import { ErrorState, LoadingState, NoAccess } from "@/components/ds/States";
import { getMyAccess, myAccessQueryKey } from "@/lib/auth/access.functions";
import { getSecurityPosture } from "@/lib/security/security.functions";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { useT } from "@/lib/i18n/useT";
import { pageMeta } from "@/lib/i18n/page-head";

export const Route = createFileRoute("/sikkerhed")({
  head: () => ({
    meta: [...pageMeta("security"), { name: "robots", content: "noindex" }],
  }),
  component: SecurityPage,
});

function SecurityPage() {
  const t = useT();
  return (
    <AppShell title={t("security.page.title")} redesigned>
      <SecurityContent />
    </AppShell>
  );
}

function SecurityContent() {
  const { fundId } = useActiveFund();
  const t = useT();
  const access = useQuery({
    queryKey: myAccessQueryKey(fundId),
    queryFn: () => getMyAccess({ data: { fundId: fundId! } }),
    enabled: Boolean(fundId),
  });
  const isAdmin = access.data?.roles?.includes("admin") ?? false;

  const posture = useQuery({
    queryKey: ["security-posture", fundId],
    queryFn: () => getSecurityPosture({ data: { fundId: fundId! } }),
    enabled: isAdmin && Boolean(fundId),
  });

  if (!fundId || access.isLoading) return <LoadingState title={t("security.page.loadingAccess")} />;
  if (access.isError) return <ErrorState onRetry={() => void access.refetch()} />;
  if (!access.data) return <Locked body={t("security.page.noAccess")} />;
  if (!isAdmin) return <Locked body={t("security.page.adminOnly")} />;

  const zdr = posture.data?.zdrEnforced ?? false;
  const eu = posture.data?.euRegionEnforced ?? false;

  return (
    <div className="flex max-w-[960px] flex-col gap-[18px] px-4 pt-6 pb-[90px] md:px-10 md:pt-[30px]">
      <RevealGroup start={0} step={0.06}>
        <Reveal className="mb-1 flex flex-col gap-1.5">
          <h1 className="m-0 text-[40px] leading-[1.05] font-semibold tracking-display">
            {t("security.page.title")}
          </h1>
          <span className="text-[15px] text-ink-3">{t("security.page.description")}</span>
        </Reveal>
        <Section>
          <h2 className="m-0 flex items-center gap-2 text-section font-semibold">
            <ShieldCheck className="size-4 text-positive" aria-hidden />
            {t("security.built.title")}
          </h2>
          <ul className="space-y-2 text-body leading-relaxed text-ink-2">
            <PostureItem done>{t("security.built.rls")}</PostureItem>
            <PostureItem done>{t("security.built.storage")}</PostureItem>
            <PostureItem done>{t("security.built.encryption")}</PostureItem>
            <PostureItem done>{t("security.built.audit")}</PostureItem>
            <PostureItem done>{t("security.built.region")}</PostureItem>
            <PostureItem done>{t("security.built.noAutoDelete")}</PostureItem>
            <PostureItem done>{t("security.built.forgetPerson")}</PostureItem>
          </ul>
        </Section>

        <Section>
          <h2 className="m-0 text-section font-semibold">{t("security.ai.title")}</h2>
          <p className="text-body leading-relaxed text-ink-2">{t("security.ai.intro")}</p>
          <ul className="space-y-4 text-body text-ink-2">
            <PostureItem done={zdr}>
              <span className="block font-medium text-ink">
                {t("security.ai.confidentialTitle")}
              </span>
              {t("security.ai.confidentialBody")}{" "}
              {zdr ? (
                <strong className="font-medium text-ink">{t("security.ai.zdrOn")}</strong>
              ) : (
                <span>{t("security.ai.zdrOff")}</span>
              )}
            </PostureItem>
            <PostureItem done>
              <span className="block font-medium text-ink">{t("security.ai.publicTitle")}</span>
              {t("security.ai.publicBody")}
            </PostureItem>
            <PostureItem done={eu}>
              <span className="block font-medium text-ink">{t("security.ai.regionTitle")}</span>
              {t("security.ai.regionBody")}{" "}
              {eu ? (
                <strong className="font-medium text-ink">{t("security.ai.euOn")}</strong>
              ) : (
                <span>{t("security.ai.euOff")}</span>
              )}
            </PostureItem>
          </ul>
        </Section>

        <Section>
          <h2 className="m-0 text-section font-semibold">{t("security.processors.title")}</h2>
          <p className="text-body leading-relaxed text-ink-2">{t("security.processors.body")}</p>
        </Section>

        <Section>
          <h2 className="m-0 text-section font-semibold">{t("security.retention.title")}</h2>
          <ul className="space-y-2 text-body leading-relaxed text-ink-2">
            <PostureItem done>{t("security.retention.aiLog")}</PostureItem>
            <PostureItem done>{t("security.retention.searchLog")}</PostureItem>
            <PostureItem done>{t("security.retention.chats")}</PostureItem>
          </ul>
        </Section>

        <Section>
          <h2 className="m-0 text-section font-semibold">{t("security.forget.title")}</h2>
          <p className="text-body leading-relaxed text-ink-2">{t("security.forget.body")}</p>
        </Section>
      </RevealGroup>
    </div>
  );
}

/** One block of the page: a canvas card like "Hvad hver rolle kan" in Brugere og adgang. */
function Section({ children }: { children: ReactNode }) {
  return (
    <Reveal>
      <section className="flex min-w-0 flex-col gap-3 rounded-xl bg-canvas px-6 py-[22px]">
        {children}
      </section>
    </Reveal>
  );
}

/** Not an Admin (or no team yet): a calm locked page, as in Brugere og adgang. */
function Locked({ body }: { body: string }) {
  return (
    <div className="grid min-h-full place-items-center p-10">
      <NoAccess body={body} />
    </div>
  );
}

function PostureItem({ done, children }: { done: boolean; children: ReactNode }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex items-start gap-2.5">
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${done ? "text-positive" : "text-ink-4"}`}
        aria-hidden
      />
      <span>{children}</span>
    </li>
  );
}
