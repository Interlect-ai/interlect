import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import {
  PASSWORD_RESET_HOURS,
  PASSWORD_RESET_RATE,
  isSelfChange,
  mfaResetBlockedByOtherTeams,
  passwordResetUsable,
  passwordSchema,
  refuseForeignMembership,
} from "./guards";
import { serverText } from "@/lib/i18n/server-text";

/**
 * "Nulstil adgangskode" (= A). Installationerne sender ingen mails, så en Admin laver
 * et engangslink til personen (som ved invitationen), og personen vælger selv sin nye adgangskode;
 * Admin ser den aldrig. Det rå token vises én gang for Admin og gemmes aldrig (kun sha256), hverken
 * i databasen, i revisionsloggen eller i logfiler. To-trins-login røres ikke: personen skal stadig
 * bruge sin godkendelsesapp ved næste login ("Nulstil to-trins-login" er en anden handling).
 */

const resetToken = z
  .string()
  .min(20)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export interface PasswordResetPreview {
  fundName: string;
  maskedEmail: string;
}

export const createPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ fundId: z.guid(), membershipId: z.guid() }).parse(input),
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
    await server.rateLimit(
      `pwreset:${access.fundId}`,
      PASSWORD_RESET_RATE.limit,
      PASSWORD_RESET_RATE.windowMs,
    );

    const { data: membership, error: membershipError } = await service
      .from("fund_memberships")
      .select("id, fund_id, user_id, status")
      .eq("id", data.membershipId)
      .maybeSingle();
    if (membershipError) {
      console.error("[createPasswordReset] membership", membershipError.message);
      throw new Error(serverText("appServer.access.passwordResetNotCreated"));
    }
    if (!membership) throw new Error(serverText("appServer.access.unknownMembership"));
    if (refuseForeignMembership(membership["fund_id"] as string, access.fundId)) {
      server.forbidden(serverText("appServer.access.unknownMembership"));
    }
    const targetUserId = membership["user_id"] as string;
    if (isSelfChange(targetUserId, context.userId)) {
      server.forbidden(serverText("appServer.access.ownPasswordReset"));
    }
    // A deactivated person is brought back by an Admin first, never by a password link.
    if (membership["status"] !== "active") {
      throw new Error(serverText("appServer.access.passwordResetDeactivated"));
    }

    // The password belongs to the account: never when the person also has a team this Admin does
    // not run (the same rule as "Nulstil to-trins-login").
    const { otherFundIds, callerAdminFundIds } = await server
      .otherTeamsOfPerson(service, {
        targetUserId,
        callerUserId: context.userId,
        fundId: access.fundId,
        logTag: "createPasswordReset",
      })
      .catch(() => {
        throw new Error(serverText("appServer.access.passwordResetNotCreated"));
      });
    if (mfaResetBlockedByOtherTeams(otherFundIds, callerAdminFundIds)) {
      server.forbidden(serverText("appServer.access.passwordResetOtherTeam"));
    }

    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("email_normalized, full_name")
      .eq("id", targetUserId)
      .maybeSingle();
    if (profileError || !profile) {
      console.error("[createPasswordReset] profile", profileError?.message ?? "missing");
      throw new Error(serverText("appServer.access.passwordResetNotCreated"));
    }
    const email = profile["email_normalized"] as string;

    const token = server.generateInvitationToken();
    const tokenHash = await server.sha256Hex(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_HOURS * 60 * 60 * 1000).toISOString();

    // One open link per person: an older one is no longer valid once a new one is made.
    const { error: revokeError } = await service
      .from("password_resets")
      .update({ revoked_at: now.toISOString() })
      .eq("user_id", targetUserId)
      .is("used_at", null)
      .is("revoked_at", null);
    if (revokeError) {
      console.error("[createPasswordReset] revoke", revokeError.message);
      throw new Error(serverText("appServer.access.passwordResetNotCreated"));
    }
    const { data: inserted, error: insertError } = await service
      .from("password_resets")
      .insert({
        fund_id: access.fundId,
        user_id: targetUserId,
        email_normalized: email,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      console.error("[createPasswordReset] insert", insertError?.message ?? "no row");
      throw new Error(serverText("appServer.access.passwordResetNotCreated"));
    }

    // Written before the link is shown: when the row cannot be written the link is revoked again.
    try {
      await server.writeAudit(service, {
        fundId: access.fundId,
        actorType: "user",
        actorId: context.userId,
        action: "membership_password_reset_created",
        entity: "fund_memberships",
        entityId: data.membershipId,
        payload: { expires_at: expiresAt },
      });
    } catch (cause) {
      await service
        .from("password_resets")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", inserted["id"] as string);
      throw cause;
    }

    const name = (profile["full_name"] as string | null)?.trim() || null;
    return { token, expiresAt, email, name };
  });

/** Only the fund name and the masked e-mail; every unusable link gets the same answer. */
export const resolvePasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: resetToken }).parse(input))
  .handler(async ({ data }): Promise<PasswordResetPreview> => {
    const server = await import("./access.server");
    const { maskEmail } = await import("./invitations.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const tokenHash = await server.sha256Hex(data.token);
    await server.rateLimit(`resolve-reset:${tokenHash}`, 20, 60_000);

    const { data: row } = await getServiceClient()
      .from("password_resets")
      .select("email_normalized, expires_at, used_at, revoked_at, funds(name)")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (
      !row ||
      !passwordResetUsable(
        row as { used_at: string | null; revoked_at: string | null; expires_at: string },
        new Date(),
      )
    ) {
      throw new Error(server.GENERIC_INVITATION_ERROR);
    }
    const fundValue = row["funds"] as { name: string } | { name: string }[] | null;
    const fund = Array.isArray(fundValue) ? fundValue[0] : fundValue;
    return {
      fundName: fund?.name ?? "",
      maskedEmail: maskEmail(row["email_normalized"] as string),
    };
  });

/**
 * The person sets the new password with the link and types their e-mail address (as when an
 * invitation is accepted), so a link that ended up in the wrong hands alone is not enough. The
 * link is used up before the password is changed and released again if the change fails.
 */
export const completePasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: resetToken,
        email: z.string().email().max(320),
        password: passwordSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const server = await import("./access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const service = getServiceClient();
    const tokenHash = await server.sha256Hex(data.token);
    await server.rateLimit(`complete-reset:${tokenHash}`, 10, 60_000);

    const { data: row } = await service
      .from("password_resets")
      .select("id, fund_id, user_id, email_normalized, expires_at, used_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (
      !row ||
      !passwordResetUsable(
        row as { used_at: string | null; revoked_at: string | null; expires_at: string },
        new Date(),
      ) ||
      server.normalizeEmail(data.email) !== row["email_normalized"]
    ) {
      throw new Error(server.GENERIC_INVITATION_ERROR);
    }
    const fundId = row["fund_id"] as string;
    const userId = row["user_id"] as string;

    // The person must still be an active member of the team that made the link.
    const { data: membership } = await service
      .from("fund_memberships")
      .select("status")
      .eq("fund_id", fundId)
      .eq("user_id", userId)
      .maybeSingle();
    if (membership?.["status"] !== "active") throw new Error(server.GENERIC_INVITATION_ERROR);

    // One attempt wins: the link is used up first (conditionally), so a second submit finds it gone.
    const usedAt = new Date().toISOString();
    const { data: consumed, error: consumeError } = await service
      .from("password_resets")
      .update({ used_at: usedAt })
      .eq("id", row["id"] as string)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", usedAt)
      .select("id")
      .maybeSingle();
    if (consumeError || !consumed) throw new Error(server.GENERIC_INVITATION_ERROR);

    const release = () =>
      service
        .from("password_resets")
        .update({ used_at: null })
        .eq("id", row["id"] as string)
        .then(({ error }) => {
          if (error) console.error("[completePasswordReset] release", error.message);
        });

    const { error: updateError } = await service.auth.admin.updateUserById(userId, {
      password: data.password,
    });
    if (updateError) {
      console.error("[completePasswordReset] update", {
        status: updateError.status,
        code: updateError.code,
      });
      await release();
      throw new Error(serverText("appServer.access.passwordResetNotSet"));
    }

    try {
      await server.writeAudit(service, {
        fundId,
        actorType: "system",
        actorId: userId,
        action: "membership_password_reset_completed",
        entity: "fund_memberships",
        entityId: null,
      });
    } catch (cause) {
      // The password is changed and the link used; only the log row is missing.
      console.error("[completePasswordReset] audit", cause);
    }
    return { ok: true as const };
  });
