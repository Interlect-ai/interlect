import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/supabase/types";
import { CLAIM_TIMEOUT_MINUTES } from "./roles";
import { GENERIC_INVITATION_ERROR, writeAudit } from "./access.server";
import { acceptanceBlockedBy } from "./guards";
import { serverText } from "@/lib/i18n/server-text";

/**
 * Accept af en invitation er et claim-then-complete-forløb, ikke én
 * databasetransaktion: oprettelse af en auth-bruger og skrivninger i
 * public-skemaet kan ikke dele transaktion. Færdiggørelsen er derfor
 * idempotent, og et fejlet forsøg frigiver invitationen igen.
 */

export interface ClaimedInvitation {
  id: string;
  /** Ejerskabsmarkør for netop dette forsøg. Kun det må afslutte eller frigive. */
  claimId: string;
  fundId: string;
  email: string;
  roles: AppRole[];
}

/**
 * Betinget claim/lås med nonce. Gør samtidige og gentagne indsendelser sikre:
 * et forældet forsøg kan hverken færdiggøre eller frigive en invitation,
 * som et nyere forsøg har overtaget.
 */
export async function claimInvitation(
  service: SupabaseClient,
  tokenHash: string,
): Promise<ClaimedInvitation> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MINUTES * 60_000).toISOString();
  const claimId = crypto.randomUUID();

  const { data, error } = await service
    .from("invitations")
    .update({ claimed_at: now.toISOString(), claim_id: claimId })
    .eq("token_hash", tokenHash)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
    .select("id, fund_id, email_normalized, roles, claim_id")
    .maybeSingle();

  if (error || !data || data["claim_id"] !== claimId) {
    throw new Error(GENERIC_INVITATION_ERROR);
  }

  return {
    id: data["id"] as string,
    claimId,
    fundId: data["fund_id"] as string,
    email: data["email_normalized"] as string,
    roles: data["roles"] as AppRole[],
  };
}

/** Frigiver kun, hvis kaldet stadig ejer låsen. */
export async function releaseClaim(
  service: SupabaseClient,
  invitationId: string,
  claimId: string,
): Promise<void> {
  await service
    .from("invitations")
    .update({ claimed_at: null, claim_id: null })
    .eq("id", invitationId)
    .eq("claim_id", claimId)
    .is("accepted_at", null);
}

/** Idempotent: profil, medlemskab og roller kan skrives igen uden dubletter. */
export async function completeAcceptance(
  service: SupabaseClient,
  invitation: ClaimedInvitation,
  userId: string,
  fullName: string | null,
  email: string,
): Promise<void> {
  // Uden navn (eksisterende bruger) røres det viste navn ikke, så det ikke slettes.
  const { error: profileError } = await service
    .from("profiles")
    .upsert(
      { id: userId, email_normalized: email, ...(fullName ? { full_name: fullName } : {}) },
      { onConflict: "id" },
    );
  if (profileError) throw new Error(serverText("appServer.invitations.profileNotCreated"));

  // A deactivated person is never brought back by an old invitation (an Admin must do that).
  const { data: existing, error: existingError } = await service
    .from("fund_memberships")
    .select("id, status")
    .eq("fund_id", invitation.fundId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw new Error(serverText("appServer.invitations.membershipNotCreated"));
  if (acceptanceBlockedBy(existing?.["status"] as "active" | "deactivated" | undefined)) {
    throw new Error(GENERIC_INVITATION_ERROR);
  }

  // Revoked or expired while this attempt was running: stop before anything is written.
  const { data: stillValid } = await service
    .from("invitations")
    .select("id")
    .eq("id", invitation.id)
    .eq("claim_id", invitation.claimId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!stillValid) throw new Error(GENERIC_INVITATION_ERROR);

  const { data: membership, error: membershipError } = await service
    .from("fund_memberships")
    .upsert(
      { fund_id: invitation.fundId, user_id: userId, status: "active" },
      { onConflict: "fund_id,user_id" },
    )
    .select("id")
    .single();
  if (membershipError || !membership)
    throw new Error(serverText("appServer.invitations.membershipNotCreated"));

  const membershipId = membership["id"] as string;
  const { error: rolesError } = await service.from("fund_membership_roles").upsert(
    invitation.roles.map((role) => ({ membership_id: membershipId, role })),
    { onConflict: "membership_id,role", ignoreDuplicates: true },
  );
  if (rolesError) throw new Error(serverText("appServer.invitations.rolesNotGranted"));

  // Revisionshændelsen skrives før forbruget: kan den ikke skrives, forbliver
  // invitationen ubrugt, og forsøget kan gentages.
  await writeAudit(service, {
    fundId: invitation.fundId,
    actorType: "system",
    actorId: userId,
    action: "invitation_accepted",
    entity: "invitations",
    entityId: invitation.id,
    payload: { roles: invitation.roles, email },
  });

  // Endeligt forbrug er betinget af, at dette forsøg stadig ejer låsen, og at
  // invitationen fortsat er gyldig. Ellers forbruges intet, og kaldet fejler.
  const { data: consumed, error: consumeError } = await service
    .from("invitations")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by: userId,
      claim_id: null,
    })
    .eq("id", invitation.id)
    .eq("claim_id", invitation.claimId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (consumeError || !consumed) {
    // Revoked in the last moment: undo the membership this attempt created (never an old one).
    if (!existing) {
      await service.from("fund_membership_roles").delete().eq("membership_id", membershipId);
      await service.from("fund_memberships").delete().eq("id", membershipId);
    }
    throw new Error(GENERIC_INVITATION_ERROR);
  }
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${(local ?? "").slice(0, 1)}•••@${domain ?? ""}`;
}
