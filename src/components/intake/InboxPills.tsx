/**
 * "Nye i jeres indbakke" ("Opret case, startskærm"): glass pills under the composer
 * that fill the notes field from an inbound mail.: built, but hidden until real inbound
 * rows exist. The mail intake webhook is parked, so
 * `inbound_messages` is empty today and this renders nothing: no empty box, no mock data.
 *
 * A pill only fills in the NOTES (subject and the start of the mail). The company name is never
 * guessed from a mail: the user types it, and Find checks it.
 */
import { motion, useReducedMotion } from "motion/react";
import { Mail } from "lucide-react";
import { EASE } from "@/lib/motion";
import { useT } from "@/lib/i18n/useT";

import { type InboundItem } from "./inbound";

export function InboxPills({
  items,
  onUse,
}: {
  items: InboundItem[];
  onUse: (item: InboundItem) => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  if (items.length === 0) return null;
  return (
    <motion.div
      className="flex w-full flex-wrap items-center justify-center gap-2"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE.out, delay: 0.2 }}
    >
      <span className="text-meta text-ink-3">{t("intake.inbox.title")}</span>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onUse(item)}
          className="inline-flex h-9 max-w-[280px] items-center gap-2 rounded-pill bg-surface/70 px-3.5 text-list text-ink-1 shadow-pill outline-none backdrop-blur-sm transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-action"
        >
          <Mail className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
          <span className="truncate">{item.subject.trim() || item.sender}</span>
        </button>
      ))}
    </motion.div>
  );
}
