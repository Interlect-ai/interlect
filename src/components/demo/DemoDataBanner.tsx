/**
 * The self-host demo data's banner (0900, `npm run seed:demo`): while the fund has fictional demo
 * cases, a quiet box at the top of every page says so, and an admin can delete them ("Slet
 * demodata", confirmed in a dialog). Neutral, not coral (coral is only AI at work, "Farve er
 * signal"); the delete button is the quiet destructive pill. The page's own layout is
 * untouched when there is no demo data (AppShell only wraps the page while the banner shows).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Trash2 } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import { showToast } from "@/components/ds/Toast";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import { deleteDemoData } from "@/lib/demo/demo-data.functions";
import { useT } from "@/lib/i18n/useT";

export function DemoDataBanner({ fundId, cases }: { fundId: string; cases: number }) {
  // cases 0 while shown: the demo cases are gone, but the demo analyst's user is still there.
  const t = useT();
  const access = useMyAccess(fundId);
  const canDelete = access.data?.capabilities.includes("manage_users") ?? false;
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const remove = useServerFn(deleteDemoData);
  const mutation = useMutation({
    mutationFn: () => remove({ data: { fundId } }),
    onSuccess: async (result) => {
      setOpen(false);
      showToast(
        result.usersRemaining > 0
          ? { message: t("demoData.banner.failed"), tone: "error" }
          : { message: t("demoData.banner.deleted"), tone: "success" },
      );
      // Every page's lists may hold demo rows: read them all again.
      await queryClient.invalidateQueries();
    },
    onError: () => showToast({ message: t("demoData.banner.failed"), tone: "error" }),
  });

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-5 print:hidden">
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[16px] bg-canvas px-4 py-3"
      >
        <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-sunken text-ink-3">
          <FlaskConical className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-[1.35]">
          <span className="text-list font-medium text-ink-1">{t("demoData.banner.title")}</span>
          <span className="text-meta text-ink-3">
            {cases === 0
              ? t("demoData.banner.bodyLeftover")
              : t(cases === 1 ? "demoData.banner.bodyOne" : "demoData.banner.bodyMany", {
                  count: cases,
                })}
          </span>
        </span>
        {canDelete && (
          <Button variant="danger" size="sm" icon={Trash2} onClick={() => setOpen(true)}>
            {t("demoData.banner.delete")}
          </Button>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => !mutation.isPending && setOpen(next)}
        title={t("demoData.banner.confirmTitle")}
        icon={Trash2}
        tone={{ color: "critical", wash: "critical-wash" }}
        footer={
          <>
            <Button
              variant="quiet"
              size="md"
              className="h-[42px]"
              disabled={mutation.isPending}
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              className="h-[42px] px-5 text-[14px]"
              pending={mutation.isPending}
              pendingLabel={t("demoData.banner.deleting")}
              onClick={() => mutation.mutate()}
            >
              {t("demoData.banner.confirm")}
            </Button>
          </>
        }
      >
        <p className="m-0 text-[15px] leading-[1.55] text-ink-2">
          {t("demoData.banner.confirmBody")}
        </p>
      </Dialog>
    </div>
  );
}
