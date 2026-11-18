import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export interface InboundItem {
  id: string;
  subject: string;
  sender: string;
  body: string;
}

/**
 * The newest received mails for the fund (RLS: members only). Any failure is "nothing to show":
 * this is a convenience, never a blocker.
 */
export function useInboundItems(fundId: string | null): InboundItem[] {
  const [items, setItems] = useState<InboundItem[]>([]);
  useEffect(() => {
    if (!fundId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("inbound_messages")
        .select("id, subject, sender_email, text_body")
        .eq("fund_id", fundId)
        .eq("status", "received")
        .order("received_at", { ascending: false })
        .limit(3);
      if (cancelled) return;
      if (error || !data) {
        if (error) console.warn("[inbox-pills] not loaded", error.message);
        setItems([]);
        return;
      }
      setItems(
        data.map((row) => ({
          id: String(row["id"]),
          subject: String(row["subject"] ?? ""),
          sender: String(row["sender_email"] ?? ""),
          body: String(row["text_body"] ?? ""),
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [fundId]);
  return items;
}

/** The notes a mail turns into: the subject, then the start of the text. */
export function notesFromInbound(item: InboundItem): string {
  const body = item.body.replace(/\s+/g, " ").trim().slice(0, 1200);
  return [item.subject.trim(), body].filter(Boolean).join("\n\n");
}
