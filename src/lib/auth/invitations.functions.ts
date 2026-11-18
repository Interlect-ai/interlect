import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import {
  INVITE_RATE,
  emailSchema,
  overSeatLimitAfterInsert,
  pendingInvitationCapReached,
  singleRoleSchema,
} from "./guards";
import type { AppRole } from "@/lib/supabase/types";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

/**
 * Invitationer. Rå tokens vises præcis én gang for administratoren og
 * gemmes aldrig — hverken i databasen, i revisionsloggen eller i logfiler.
 */

/** Invitationstokens er 32 tilfældige bytes i base64url (43 tegn). */
const invitationToken = z
  .string()
  .min(20)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export interface InvitationPreview {
  fundName: string;
  maskedEmail: string;
  roles: AppRole[];
  /** Full name of the person who sent the invitation (never their e-mail); null if unknown. */
  invitedBy: string | null;
}

export const createInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        fundId: z.guid(),
        email: emailSchema,
        roles: singleRoleSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const server = await import("./access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");

    const access = await server.requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_users",
    );

    const email = server.normalizeEmail(data.email);
    const token = server.generateInvitationToken();
    const tokenHash = await server.sha256Hex(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const service = getServiceClient();

    // Per fund: a burst of invitations (a slip or a stolen session) is stopped, and a fund can
    // only hold so many open invitations.
    await server.rateLimit(`invite:${access.fundId}`, INVITE_RATE.limit, INVITE_RATE.windowMs);
    const { count: pendingCount, error: pendingError } = await service
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .eq("fund_id", access.fundId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString());
    if (pendingError) throw new Error(serverText("appServer.invitations.notCreated"));
    if (pendingInvitationCapReached(pendingCount ?? 0)) {
      throw new Error(serverText("appServer.invitations.tooManyPending"));
    }

    // En invitation må aldrig stille genaktivere et medlemskab, en admin
    // bevidst har deaktiveret -- det skal ske eksplicit via /brugere.
    const { data: existingProfile } = await service
      .from("profiles")
      .select("id")
      .eq("email_normalized", email)
      .maybeSingle();
    if (existingProfile) {
      const { data: existingMembership } = await service
        .from("fund_memberships")
        .select("status")
        .eq("fund_id", access.fundId)
        .eq("user_id", existingProfile["id"] as string)
        .maybeSingle();
      if (existingMembership?.["status"] === "deactivated") {
        throw new Error(serverText("appServer.invitations.deactivated"));
      }
      if (existingMembership?.["status"] === "active") {
        throw new Error(serverText("appServer.invitations.alreadyActive"));
      }
    }

    // Pladser: afvis kun, når en grænse er sat og nået (i piloten er der ingen grænse).
    const { seatLimitMessage } = await import("./seats");
    const seats = await server.loadSeatUsage(service, email);
    const seatProblem = seatLimitMessage(
      seats,
      data.roles,
      {
        seat: seats.emailUsesSeat,
        reader: seats.emailIsReader,
      },
      requestLanguage(),
    );
    if (seatProblem) throw new Error(seatProblem);

    const { data: inserted, error } = await service
      .from("invitations")
      .insert({
        fund_id: access.fundId,
        email_normalized: email,
        roles: [...new Set(data.roles)],
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (error) throw new Error(serverText("appServer.invitations.notCreated"));

    // Check-then-insert race: with the new row counted, is the installation over its limit?
    // Then this invitation is revoked again and the person is told the seats are full.
    const afterSeats = await server.loadSeatUsage(service, email);
    const alreadyCounted = data.roles.some((role) => role !== "reader")
      ? seats.emailUsesSeat
      : seats.emailUsesSeat || seats.emailIsReader;
    if (overSeatLimitAfterInsert(afterSeats, data.roles, alreadyCounted)) {
      await service
        .from("invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", inserted["id"] as string);
      throw new Error(serverText("appServer.invitations.seatsFull"));
    }

    await server.writeAudit(service, {
      fundId: access.fundId,
      actorType: "user",
      actorId: context.userId,
      action: "invitation_created",
      entity: "invitations",
      entityId: inserted["id"] as string,
      payload: { email, roles: data.roles, expires_at: expiresAt },
    });

    // Vises én gang i brugerfladen. Administratoren sender selv linket videre.
    return { token, expiresAt, email, roles: data.roles as AppRole[] };
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ fundId: z.guid(), invitationId: z.guid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const server = await import("./access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const access = await server.requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_users",
    );

    const service = getServiceClient();
    const { data: row } = await service
      .from("invitations")
      .select("id, fund_id, accepted_at")
      .eq("id", data.invitationId)
      .maybeSingle();

    if (!row) throw new Error(serverText("appServer.invitations.unknown"));
    if (row["fund_id"] !== access.fundId)
      server.forbidden(serverText("appServer.invitations.unknown"));
    if (row["accepted_at"]) server.forbidden(serverText("appServer.invitations.alreadyUsed"));

    const { data: revoked, error: revokeError } = await service
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.invitationId)
      .is("accepted_at", null)
      .select("id")
      .maybeSingle();
    if (revokeError || !revoked) throw new Error(serverText("appServer.invitations.notRevoked"));

    await server.writeAudit(service, {
      fundId: access.fundId,
      actorType: "user",
      actorId: context.userId,
      action: "invitation_revoked",
      entity: "invitations",
      entityId: data.invitationId,
    });

    return { ok: true as const };
  });

/**
 * Afslører kun fondsnavn, maskeret e-mail, roller og navnet på den, der inviterede.
 * Aldrig eksistens pr. e-mail.
 */
export const resolveInvitation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: invitationToken }).parse(input))
  .handler(async ({ data }): Promise<InvitationPreview> => {
    const server = await import("./access.server");
    const { maskEmail } = await import("./invitations.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");

    const tokenHash = await server.sha256Hex(data.token);
    await server.rateLimit(`resolve:${tokenHash}`, 20, 60_000);

    const service = getServiceClient();
    const { data: row } = await service
      .from("invitations")
      .select(
        "email_normalized, roles, expires_at, accepted_at, revoked_at, created_by, funds(name)",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (
      !row ||
      row["accepted_at"] ||
      row["revoked_at"] ||
      new Date(row["expires_at"] as string).getTime() <= Date.now()
    ) {
      throw new Error(server.GENERIC_INVITATION_ERROR);
    }

    const fundValue = row["funds"] as { name: string } | { name: string }[] | null;
    const fund = Array.isArray(fundValue) ? fundValue[0] : fundValue;

    // "Inviteret af": kun navnet; mangler profilen, eller fejler opslaget, vises linjen ikke.
    let invitedBy: string | null = null;
    const createdBy = row["created_by"] as string | null;
    if (createdBy) {
      const { data: inviter, error: inviterError } = await service
        .from("profiles")
        .select("full_name")
        .eq("id", createdBy)
        .maybeSingle();
      if (inviterError) console.error("[invitation] inviter lookup failed", inviterError.message);
      const name = (inviter?.["full_name"] as string | null | undefined)?.trim();
      invitedBy = name ? name : null;
    }

    return {
      fundName: fund?.name ?? "",
      maskedEmail: maskEmail(row["email_normalized"] as string),
      roles: row["roles"] as AppRole[],
      invitedBy,
    };
  });

/** Ny bruger: token + matchende e-mail + adgangskode. Serveren opretter auth-brugeren. */
export const acceptInvitationAsNewUser = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: invitationToken,
        email: z.string().email().max(320),
        password: z.string().min(12).max(200),
        fullName: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const server = await import("./access.server");
    const flow = await import("./invitations.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const service = getServiceClient();

    const tokenHash = await server.sha256Hex(data.token);
    await server.rateLimit(`accept:${tokenHash}`, 10, 60_000);

    const invitation = await flow.claimInvitation(service, tokenHash);
    const email = server.normalizeEmail(data.email);
    if (email !== invitation.email) {
      await flow.releaseClaim(service, invitation.id, invitation.claimId);
      throw new Error(server.GENERIC_INVITATION_ERROR);
    }

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
    });
    const userId = created?.user?.id ?? null;

    if (createError || !userId) {
      // Kontoen findes måske allerede. Det afsløres ikke: brugeren skal logge
      // ind og bruge forløbet for eksisterende brugere.
      await flow.releaseClaim(service, invitation.id, invitation.claimId);
      throw new Error(server.GENERIC_INVITATION_ERROR);
    }

    try {
      await flow.completeAcceptance(service, invitation, userId, data.fullName ?? null, email);
    } catch (error) {
      // Kompenserende oprydning, så et nyt forsøg kan gennemføres.
      await service.auth.admin.deleteUser(userId).catch(() => undefined);
      await flow.releaseClaim(service, invitation.id, invitation.claimId);
      throw error;
    }

    return { ok: true as const, email };
  });

/** Eksisterende bruger: logger ind som normalt først. Adgangskoden røres aldrig. */
export const acceptInvitationAsExistingUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: invitationToken }).parse(input))
  .handler(async ({ data, context }) => {
    const server = await import("./access.server");
    const flow = await import("./invitations.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const service = getServiceClient();

    const tokenHash = await server.sha256Hex(data.token);
    await server.rateLimit(`accept:${tokenHash}`, 10, 60_000);

    const invitation = await flow.claimInvitation(service, tokenHash);

    if (!context.emailVerified || server.normalizeEmail(context.email) !== invitation.email) {
      await flow.releaseClaim(service, invitation.id, invitation.claimId);
      throw new Error(server.GENERIC_INVITATION_ERROR);
    }

    try {
      await flow.completeAcceptance(service, invitation, context.userId, null, invitation.email);
    } catch (error) {
      await flow.releaseClaim(service, invitation.id, invitation.claimId);
      throw error;
    }

    return { ok: true as const };
  });
