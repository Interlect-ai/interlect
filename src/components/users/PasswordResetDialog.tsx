/**
 * "Lav link til ny adgangskode" (= A): first the confirmation, then the one-time link
 * with "Kopiér link". The installations send no e-mail, so the Admin sends the link on; the link
 * is kept ONLY in this component's state (never in the URL, a cache or localStorage) and is gone
 * when the dialog closes. The person chooses the password; the Admin never sees it.
 */
import { useEffect, useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import type { MenuTone } from "@/components/ds/Menu";
import { showToast } from "@/components/ds/Toast";
import type { MemberRow } from "@/lib/auth/access.functions";
import { useT } from "@/lib/i18n/useT";

const PASSWORD_TONE: MenuTone = { color: "warning", wash: "warning-wash" };

export function PasswordResetDialog({
  member,
  open,
  onOpenChange,
  onMake,
}: {
  member: MemberRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The link to show, or null when it could not be made (the caller has said why). */
  onMake: (member: MemberRow) => Promise<{ url: string; email: string } | null>;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const name = member ? (member.fullName ?? member.email) : "";

  // A new person (or a reopened dialog) starts at the confirmation, never at an old link.
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => {
      setLink(null);
      setCopied(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [open]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      showToast({ tone: "error", message: t("users.passwordLink.copyFailed") });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={
        link
          ? t("users.passwordLink.title", { name })
          : t("users.members.resetPasswordTitle", { name })
      }
      description={
        link
          ? t("users.passwordLink.once", { email: link.email })
          : t("users.members.resetPasswordBody", { name })
      }
      icon={KeyRound}
      tone={PASSWORD_TONE}
      footer={
        link ? (
          <>
            <Button
              variant="quiet"
              size="md"
              className="h-[42px]"
              onClick={() => onOpenChange(false)}
            >
              {t("users.passwordLink.close")}
            </Button>
            <Button variant="primary" size="md" className="h-[42px] px-4" onClick={copy}>
              {copied ? (
                <Check className="size-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <Copy className="size-4" strokeWidth={1.75} aria-hidden />
              )}
              {copied ? t("users.passwordLink.copied") : t("users.passwordLink.copyLink")}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="quiet"
              size="md"
              className="h-[42px]"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("users.members.cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              className="h-[42px] px-5 text-[14px]"
              pending={pending}
              onClick={async () => {
                if (!member || pending) return;
                setPending(true);
                try {
                  const made = await onMake(member);
                  if (made) setLink(made);
                  else onOpenChange(false);
                } finally {
                  setPending(false);
                }
              }}
            >
              {t("users.members.resetPasswordConfirm")}
            </Button>
          </>
        )
      }
    >
      {link && (
        <div className="flex flex-col gap-2.5">
          <code className="rounded-[12px] bg-canvas px-3.5 py-3 font-mono text-[13px] [overflow-wrap:anywhere] text-ink-1 select-all">
            {link.url}
          </code>
          <span className="text-list text-ink-3">{t("users.passwordLink.expires")}</span>
        </div>
      )}
    </Dialog>
  );
}
