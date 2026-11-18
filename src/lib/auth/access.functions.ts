import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { roleValues } from "./roles";
import type { AppRole } from "@/lib/supabase/types";
import {
  capabilitiesFor,
  hasCapability,
  type Capability,
  type FundSettings,
} from "@/lib/domain/workflow";
import type { FundSeatUsage } from "./fund-seats";
import { applyRoleChange, planRoleChange } from "./role-change";
import {
  adminNamesOnly,
  isSelfChange,
  mfaResetBlockedByOtherTeams,
  needsAdminRollback,
  refuseForeignMembership,
  singleRoleSchema,
} from "./guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

/** Læsninger af egen adgang, medlemsliste, invitationer og revisionslog. */

export interface MyAccess {
  userId: string;
  email: string;
  fullName: string | null;
  fundId: string;
  fundName: string;
  roles: AppRole[];
  /** The fund's Medlem settings (0032). */
  settings: FundSettings;
  /** What the user may do in this fund, for hiding controls; the server re-checks every action. */
  capabilities: Capability[];
}

// Version the client cache when the access payload changes shape. Scoped by
// fund id so a user with several fonde (investeringsteser) never sees a
// stale cache entry from a different one after switching.
export const myAccessQueryKey = (fundId: string | null) => ["my-access", "v4", fundId] as const;
/**
 * The access is reused for 30 s when another part of the page asks for it (the rail and the case
 * top asked twice per page). A role change sets or invalidates the cache itself, and the
 * server re-checks every action.
 */
export const MY_ACCESS_STALE_MS = 30_000;

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<MyAccess | null> => {
    const { loadAccessForFund } = await import("./access.server");
    const access = await loadAccessForFund(context.supabase, context.userId, data.fundId);
    if (!access) return null;

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name, email_normalized")
      .eq("id", context.userId)
      .maybeSingle();

    return {
      userId: context.userId,
      email: (profile?.email_normalized as string | undefined) ?? context.email,
      fullName: (profile?.full_name as string | null | undefined) ?? null,
      fundId: access.fundId,
      fundName: access.fundName,
      roles: Array.isArray(access.roles) ? access.roles : [],
      settings: access.settings,
      capabilities: capabilitiesFor(access.roles, access.settings),
    };
  });

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string | null;
  status: "active" | "deactivated";
  roles: AppRole[];
}

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<MemberRow[]> => {
    const { requireFundCapability } = await import("./access.server");
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_users",
    );

    const { data: members, error } = await context.supabase
      .from("fund_memberships")
      .select("id, user_id, status, fund_membership_roles(role)")
      .eq("fund_id", access.fundId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[listMembers]", error.message);
      throw new Error(serverText("appServer.access.membersNotLoaded"));
    }

    const rows = (members ?? []) as unknown as Array<{
      id: string;
      user_id: string;
      status: "active" | "deactivated";
      fund_membership_roles: { role: AppRole }[] | null;
    }>;

    const userIds = [...new Set(rows.map((row) => row.user_id))];
    const profileById = new Map<string, { full_name: string | null; email_normalized: string }>();
    if (userIds.length > 0) {
      const { data: profiles } = await context.supabase
        .from("profiles")
        .select("id, full_name, email_normalized")
        .in("id", userIds);
      for (const profile of (profiles ?? []) as unknown as Array<{
        id: string;
        full_name: string | null;
        email_normalized: string;
      }>) {
        profileById.set(profile.id, {
          full_name: profile.full_name,
          email_normalized: profile.email_normalized,
        });
      }
    }

    return rows.map((row) => {
      const profile = profileById.get(row.user_id);
      return {
        membershipId: row.id,
        userId: row.user_id,
        email: profile?.email_normalized ?? "",
        fullName: profile?.full_name ?? null,
        status: row.status,
        roles: (row.fund_membership_roles ?? []).map((r) => r.role),
      };
    });
  });

export interface InvitationListRow {
  id: string;
  email: string;
  roles: AppRole[];
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const listInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<InvitationListRow[]> => {
    const { requireFundCapability } = await import("./access.server");
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_users",
    );

    const { data: invitations, error } = await context.supabase
      .from("invitations")
      .select("id, email_normalized, roles, expires_at, accepted_at, revoked_at, created_at")
      .eq("fund_id", access.fundId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(serverText("appServer.access.invitationsNotLoaded"));

    return (invitations ?? []).map((raw) => {
      const row = raw as unknown as {
        id: string;
        email_normalized: string;
        roles: AppRole[];
        expires_at: string;
        accepted_at: string | null;
        revoked_at: string | null;
        created_at: string;
      };
      return {
        id: row.id,
        email: row.email_normalized,
        roles: row.roles,
        expiresAt: row.expires_at,
        acceptedAt: row.accepted_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
      };
    });
  });

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export interface AuditRow {
  id: string;
  action: string;
  entity: string;
  actorType: string;
  occurredAt: string;
  payload: JsonObject;
}

export const listAuditEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<AuditRow[]> => {
    const { requireFundCapability } = await import("./access.server");
    // Revisionsloggen (invitationer, tilsidesættelser, indstillinger) hører under Sikkerhed og
    // data, som kun Admin ser (harden S5-4).
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_users",
    );

    const { data: events, error: eventsError } = await context.supabase
      .from("audit_events")
      .select("id, action, entity, actor_type, occurred_at, payload")
      .eq("fund_id", access.fundId)
      .order("occurred_at", { ascending: false })
      .limit(50);
    if (eventsError) {
      console.error("[listAuditEvents]", eventsError.message);
      throw new Error(serverText("appServer.access.auditNotLoaded"));
    }

    return (events ?? []).map((raw) => {
      const row = raw as unknown as {
        id: string;
        action: string;
        entity: string;
        actor_type: string;
        occurred_at: string;
        payload: JsonObject;
      };
      return {
        id: row.id,
        action: row.action,
        entity: row.entity,
        actorType: row.actor_type,
        occurredAt: row.occurred_at,
        payload: row.payload ?? {},
      };
    });
  });

export const setMemberRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        fundId: z.guid(),
        membershipId: z.guid(),
        roles: singleRoleSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireFundCapability, writeAudit, forbidden } = await import("./access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_users",
    );

    const service = getServiceClient();
    const { data: membership } = await service
      .from("fund_memberships")
      .select("id, fund_id, user_id")
      .eq("id", data.membershipId)
      .maybeSingle();

    if (!membership) throw new Error(serverText("appServer.access.unknownMembership"));
    if (refuseForeignMembership(membership["fund_id"] as string, access.fundId)) {
      forbidden(serverText("appServer.access.unknownMembership"));
    }
    if (isSelfChange(membership["user_id"] as string, context.userId)) {
      forbidden(serverText("appServer.access.ownRoles"));
    }

    const { data: current, error: currentError } = await service
      .from("fund_membership_roles")
      .select("role, granted_by")
      .eq("membership_id", data.membershipId);
    if (currentError) {
      console.error("[setMemberRoles] current roles", currentError.message);
      throw new Error(serverText("appServer.access.roleNotChanged"));
    }
    const currentRows = ((current ?? []) as { role: AppRole; granted_by: string | null }[]).map(
      (row) => ({ role: row.role, grantedBy: row.granted_by }),
    );
    const desired = [...new Set(data.roles)];

    // Pladser (harden): en Læser, der bliver Medlem, Lead eller Admin, tager en plads.
    await assertSeatRoom(service, membership["user_id"] as string, desired);

    const membershipId = data.membershipId;
    // Add first, then remove, then audit; any failure rolls back (role-change.ts, B10-1).
    // The last-admin database trigger refuses the remove, which rolls the add back.
    await applyRoleChange({
      current: currentRows,
      desired,
      grantedBy: context.userId,
      language: requestLanguage(),
      store: {
        async add(rows) {
          const { error } = await service.from("fund_membership_roles").upsert(
            rows.map((row) => ({
              membership_id: membershipId,
              role: row.role,
              granted_by: row.grantedBy,
            })),
            { onConflict: "membership_id,role", ignoreDuplicates: true },
          );
          if (error) throw roleWriteError("add", error.message);
        },
        async remove(roles) {
          const { error } = await service
            .from("fund_membership_roles")
            .delete()
            .eq("membership_id", membershipId)
            .in("role", roles);
          if (error) throw roleWriteError("remove", error.message);
        },
      },
      afterChange: async (plan) => {
        // Two admins demoting each other at once can both pass the database triggers: recount
        // the ACTIVE admins now that the change is in; none left means this change is undone
        // (applyRoleChange rolls back when this throws). A small window between the two
        // commits remains until the triggers take a lock (migration, the product owner decides).
        if (
          plan.remove.includes("admin") &&
          needsAdminRollback(await countActiveAdmins(service, access.fundId))
        ) {
          await writeAudit(service, {
            fundId: access.fundId,
            actorType: "user",
            actorId: context.userId,
            action: "membership_roles_rolled_back",
            entity: "fund_membership_roles",
            entityId: membershipId,
            payload: { reason: "no_active_admin_left", attempted: plan.result },
          }).catch((cause) => console.error("[setMemberRoles] rollback audit", cause));
          throw new Error(serverText("appServer.access.lastAdminRollback"));
        }
        await writeAudit(service, {
          fundId: access.fundId,
          actorType: "user",
          actorId: context.userId,
          action: "membership_roles_changed",
          entity: "fund_membership_roles",
          entityId: membershipId,
          payload: { added: plan.add, removed: plan.remove, result: plan.result },
        });
      },
    });

    // Concurrent changes can leave two roles; make sure exactly the requested one remains.
    const { data: after, error: afterError } = await service
      .from("fund_membership_roles")
      .select("role")
      .eq("membership_id", membershipId);
    if (afterError) {
      console.error("[setMemberRoles] post-check", afterError.message);
    } else {
      const fix = planRoleChange(
        ((after ?? []) as { role: AppRole }[]).map((row) => row.role),
        desired,
      );
      if (fix.add.length > 0 || fix.remove.length > 0) {
        console.warn("[setMemberRoles] concurrent change, correcting to the requested role");
        if (fix.add.length > 0) {
          await service.from("fund_membership_roles").upsert(
            fix.add.map((role) => ({
              membership_id: membershipId,
              role,
              granted_by: context.userId,
            })),
            { onConflict: "membership_id,role", ignoreDuplicates: true },
          );
        }
        if (fix.remove.length > 0) {
          await service
            .from("fund_membership_roles")
            .delete()
            .eq("membership_id", membershipId)
            .in("role", fix.remove);
        }
      }
    }

    return { ok: true as const };
  });

export const setMemberStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        fundId: z.guid(),
        membershipId: z.guid(),
        status: z.enum(["active", "deactivated"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireFundCapability, writeAudit, forbidden } = await import("./access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_users",
    );

    const service = getServiceClient();
    const { data: membership } = await service
      .from("fund_memberships")
      .select("id, fund_id, user_id, status")
      .eq("id", data.membershipId)
      .maybeSingle();

    if (!membership) throw new Error(serverText("appServer.access.unknownMembership"));
    if (refuseForeignMembership(membership["fund_id"] as string, access.fundId)) {
      forbidden(serverText("appServer.access.unknownMembership"));
    }
    if (isSelfChange(membership["user_id"] as string, context.userId)) {
      forbidden(serverText("appServer.access.ownAccess"));
    }

    if (data.status === "active") {
      // Pladser (harden): en genaktiveret person tæller igen.
      const { data: roleRows, error: rolesError } = await service
        .from("fund_membership_roles")
        .select("role")
        .eq("membership_id", data.membershipId);
      if (rolesError) {
        console.error("[setMemberStatus] roles", rolesError.message);
        throw new Error(serverText("appServer.access.accessNotChanged"));
      }
      await assertSeatRoom(
        service,
        membership["user_id"] as string,
        ((roleRows ?? []) as { role: AppRole }[]).map((row) => row.role),
      );
    }

    const { error } = await service
      .from("fund_memberships")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.membershipId);
    if (error) {
      console.error("[setMemberStatus]", error.message);
      throw /admin/i.test(error.message)
        ? new Error(serverText("appServer.access.lastAdmin"))
        : new Error(serverText("appServer.access.accessNotChanged"));
    }

    // Two admins deactivating each other at once can both pass the database triggers: recount
    // the ACTIVE admins and put the target back when none is left (window: see guards.ts).
    if (
      data.status === "deactivated" &&
      needsAdminRollback(await countActiveAdmins(service, access.fundId))
    ) {
      const { error: restoreError } = await service
        .from("fund_memberships")
        .update({ status: membership["status"] as string, updated_at: new Date().toISOString() })
        .eq("id", data.membershipId);
      if (restoreError) console.error("[setMemberStatus] restore", restoreError.message);
      await writeAudit(service, {
        fundId: access.fundId,
        actorType: "user",
        actorId: context.userId,
        action: "membership_status_rolled_back",
        entity: "fund_memberships",
        entityId: data.membershipId,
        payload: { reason: "no_active_admin_left", attempted: data.status },
      }).catch((cause) => console.error("[setMemberStatus] rollback audit", cause));
      throw new Error(serverText("appServer.access.lastAdminRollback"));
    }

    // A deactivated person's leftover invitations must not be able to bring them back.
    let revokedInvitations = 0;
    if (data.status === "deactivated") {
      const { data: profile } = await service
        .from("profiles")
        .select("email_normalized")
        .eq("id", membership["user_id"] as string)
        .maybeSingle();
      const email = profile?.["email_normalized"] as string | undefined;
      if (email) {
        const { data: revoked, error: revokeError } = await service
          .from("invitations")
          .update({ revoked_at: new Date().toISOString() })
          .eq("fund_id", access.fundId)
          .eq("email_normalized", email)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .select("id");
        if (revokeError) console.error("[setMemberStatus] revoke invitations", revokeError.message);
        revokedInvitations = revoked?.length ?? 0;
      }
    }

    await writeAudit(service, {
      fundId: access.fundId,
      actorType: "user",
      actorId: context.userId,
      action: data.status === "active" ? "membership_reactivated" : "membership_deactivated",
      entity: "fund_memberships",
      entityId: data.membershipId,
      payload: { status: data.status, revokedInvitations },
    });

    return { ok: true as const };
  });

/**
 * "Nulstil to-trins-login": a person who has lost their authenticator app cannot get back
 * in on their own (no SMTP, no recovery codes). An Admin deletes the person's factors, and the
 * next sign-in asks them to set up a new app (mfaStep "enroll"). Supabase keeps the person's
 * existing sessions (seen on staging). Only for someone in the Admin's own team, never yourself, and never when the
 * person also has access to a team the Admin does not run (the factor belongs to the account).
 * A "started" audit row is written in each of the person's teams before anything is deleted, so a
 * reset is never unlogged; the outcome is read back from Supabase afterwards (not from each delete
 * call) and logged as a second row.
 */
export const resetMemberMfa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ fundId: z.guid(), membershipId: z.guid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ removed: number; verified: number }> => {
    const { requireFundCapability, writeAudit, forbidden } = await import("./access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_users",
    );

    const service = getServiceClient();
    const { data: membership, error: membershipError } = await service
      .from("fund_memberships")
      .select("id, fund_id, user_id")
      .eq("id", data.membershipId)
      .maybeSingle();
    if (membershipError) {
      console.error("[resetMemberMfa] membership", membershipError.message);
      throw new Error(serverText("appServer.access.mfaNotReset"));
    }
    if (!membership) throw new Error(serverText("appServer.access.unknownMembership"));
    if (refuseForeignMembership(membership["fund_id"] as string, access.fundId)) {
      forbidden(serverText("appServer.access.unknownMembership"));
    }
    const targetUserId = membership["user_id"] as string;
    if (isSelfChange(targetUserId, context.userId)) {
      forbidden(serverText("appServer.access.ownMfa"));
    }

    // The person's other active teams, and which of them the caller runs as Admin.
    const { otherTeamsOfPerson } = await import("./access.server");
    const { otherFundIds, callerAdminFundIds } = await otherTeamsOfPerson(service, {
      targetUserId,
      callerUserId: context.userId,
      fundId: access.fundId,
      logTag: "resetMemberMfa",
    }).catch(() => {
      throw new Error(serverText("appServer.access.mfaNotReset"));
    });
    if (mfaResetBlockedByOtherTeams(otherFundIds, callerAdminFundIds)) {
      forbidden(serverText("appServer.access.mfaOtherTeam"));
    }

    const listFactors = async () => {
      const { data: listed, error } = await service.auth.admin.mfa.listFactors({
        userId: targetUserId,
      });
      if (error || !listed) {
        console.error("[resetMemberMfa] list factors", {
          membershipId: data.membershipId,
          status: error?.status,
          message: error?.message ?? "no data",
        });
        throw new Error(serverText("appServer.access.mfaNotReset"));
      }
      return listed.factors;
    };

    const factors = await listFactors();
    const verified = factors.filter((factor) => factor.status === "verified").length;
    if (factors.length === 0) return { removed: 0, verified: 0 };

    // Every team the person is active in sees the reset in its own log (the guard above means
    // the caller is Admin in all of them).
    const audit = (action: string, payload: JsonObject) =>
      Promise.all(
        [access.fundId, ...otherFundIds].map((fundId) =>
          writeAudit(service, {
            fundId,
            actorType: "user",
            actorId: context.userId,
            action,
            entity: "fund_memberships",
            entityId: fundId === access.fundId ? data.membershipId : null,
            payload: { ...payload, membershipId: data.membershipId },
          }),
        ),
      );
    await audit("membership_mfa_reset_started", { factors: factors.length, verified });

    for (const factor of factors) {
      try {
        const { error } = await service.auth.admin.mfa.deleteFactor({
          id: factor.id,
          userId: targetUserId,
        });
        if (error) {
          console.error("[resetMemberMfa] delete factor", {
            membershipId: data.membershipId,
            factorId: factor.id,
            factorStatus: factor.status,
            status: error.status,
            code: error.code,
            message: error.message,
          });
        }
      } catch (cause) {
        console.error("[resetMemberMfa] delete factor threw", {
          membershipId: data.membershipId,
          factorId: factor.id,
          cause,
        });
      }
    }

    // The outcome is what Supabase holds now: a "not found" on a factor that is still there, or a
    // success on one that is gone, must not decide what the Admin is told.
    const remaining = await listFactors();
    const removed = factors.filter((factor) => !remaining.some((r) => r.id === factor.id)).length;
    if (remaining.length > 0) {
      await audit("membership_mfa_reset_incomplete", {
        removed,
        remaining: remaining.length,
      }).catch((cause) => console.error("[resetMemberMfa] incomplete audit", cause));
      throw new Error(serverText("appServer.access.mfaNotReset"));
    }
    await audit("membership_mfa_reset", { removed, verified }).catch((cause) =>
      // The factors are gone; the "started" row already records the reset.
      console.error("[resetMemberMfa] outcome audit", { membershipId: data.membershipId, cause }),
    );

    return { removed, verified };
  });

/**
 * Pladser i DENNE fond (Admin, B10-5): kun fondens egne tal, talt i kode fra
 * `fund_memberships` og ventende invitationer (ingen migration). Grænserne (SEAT_LIMIT,
 * READER_LIMIT) er installationens, håndhæves kun på serveren (createInvitation, setMemberRoles,
 * setMemberStatus afviser med en klar tekst) og sendes aldrig til klienten.
 */
export const getSeatUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<FundSeatUsage> => {
    const { requireFundCapability } = await import("./access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const { countFundSeats } = await import("./fund-seats");
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_users",
    );
    const service = getServiceClient();

    const { data: members, error: membersError } = await service
      .from("fund_memberships")
      .select("user_id, fund_membership_roles(role)")
      .eq("fund_id", access.fundId)
      .eq("status", "active");
    const { data: invitations, error: invitationsError } = await service
      .from("invitations")
      .select("email_normalized, roles")
      .eq("fund_id", access.fundId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString());
    if (membersError || invitationsError) {
      console.error("[getSeatUsage]", membersError?.message ?? invitationsError?.message);
      throw new Error(serverText("appServer.access.seatsNotCounted"));
    }

    const memberRows = (members ?? []) as unknown as Array<{
      user_id: string;
      fund_membership_roles: { role: AppRole }[] | null;
    }>;
    const userIds = [...new Set(memberRows.map((row) => row.user_id))];
    const emailById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await service
        .from("profiles")
        .select("id, email_normalized")
        .in("id", userIds);
      if (profilesError) {
        console.error("[getSeatUsage] profiles", profilesError.message);
        throw new Error(serverText("appServer.access.seatsNotCounted"));
      }
      for (const profile of (profiles ?? []) as unknown as Array<{
        id: string;
        email_normalized: string;
      }>) {
        emailById.set(profile.id, profile.email_normalized);
      }
    }

    const counted = countFundSeats(
      memberRows.map((row) => ({
        email: emailById.get(row.user_id) ?? row.user_id,
        roles: (row.fund_membership_roles ?? []).map((r) => r.role),
      })),
      ((invitations ?? []) as unknown as Array<{ email_normalized: string; roles: AppRole[] }>).map(
        (row) => ({ email: row.email_normalized, roles: row.roles }),
      ),
    );

    // Only this fund's own counts: the installation's limit and its count are never sent.
    return counted;
  });

/**
 * Navnene på fondens aktive admins, til den låste side ("kontakt Maja eller Jonas"). Alle
 * aktive medlemmer af fonden må kalde den; kun fulde navne, aldrig e-mail, roller eller
 * andre fonde.
 */
export const getFundAdminNames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<string[]> => {
    const { requireFundCapability } = await import("./access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "view_case",
    );
    const service = getServiceClient();
    const { data: rows, error } = await service
      .from("fund_memberships")
      .select("user_id, fund_membership_roles!inner(role)")
      .eq("fund_id", access.fundId)
      .eq("status", "active")
      .eq("fund_membership_roles.role", "admin");
    if (error) {
      console.error("[getFundAdminNames]", error.message);
      throw new Error(serverText("appServer.access.adminsNotLoaded"));
    }
    const ids = [
      ...new Set(((rows ?? []) as unknown as { user_id: string }[]).map((r) => r.user_id)),
    ];
    if (ids.length === 0) return [];
    const { data: profiles, error: profilesError } = await service
      .from("profiles")
      .select("full_name")
      .in("id", ids);
    if (profilesError) {
      console.error("[getFundAdminNames] profiles", profilesError.message);
      throw new Error(serverText("appServer.access.adminsNotLoaded"));
    }
    return adminNamesOnly((profiles ?? []) as unknown as { full_name: string | null }[]);
  });

/** "Medlem må beslutte investeret/luk" og "Medlem må udgive fondsopsætning" (Admin). */
export const setFundMemberSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        fundId: z.guid(),
        /** Only the settings that are sent are changed, so a stale form cannot undo another. */
        memberCanDecide: z.boolean().optional(),
        memberCanPublish: z.boolean().optional(),
      })
      .refine(
        (value) => value.memberCanDecide !== undefined || value.memberCanPublish !== undefined,
        // i18n-keep: a validation message; userMessage never shows it (the fallback stands in).
        { error: "Vælg en indstilling." },
      )
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FundSettings> => {
    const { requireFundCapability, writeAudit } = await import("./access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_users",
    );
    const service = getServiceClient();
    const after: FundSettings = {
      memberCanDecide: data.memberCanDecide ?? access.settings.memberCanDecide,
      memberCanPublish: data.memberCanPublish ?? access.settings.memberCanPublish,
    };
    // Revisionen skrives først: fejler den, ændres intet (writeAudit afviser handlingen).
    await writeAudit(service, {
      fundId: access.fundId,
      actorType: "user",
      actorId: context.userId,
      action: "fund_member_settings_changed",
      entity: "funds",
      entityId: access.fundId,
      payload: { before: access.settings, after },
    });
    const { error } = await service
      .from("funds")
      .update({
        ...(data.memberCanDecide !== undefined ? { member_can_decide: data.memberCanDecide } : {}),
        ...(data.memberCanPublish !== undefined
          ? { member_can_publish: data.memberCanPublish }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", access.fundId);
    if (error) {
      console.error("[setFundMemberSettings]", error.message);
      // The audit log already holds the change; record that it was never saved (harden).
      try {
        await writeAudit(service, {
          fundId: access.fundId,
          actorType: "user",
          actorId: context.userId,
          action: "fund_member_settings_not_saved",
          entity: "funds",
          entityId: access.fundId,
          payload: { after },
        });
      } catch (cause) {
        console.error("[setFundMemberSettings] not saved audit", cause);
      }
      throw new Error(serverText("appServer.access.settingNotSaved"));
    }
    return after;
  });

/** Active members of the fund who hold the admin role (the last-admin recount). */
async function countActiveAdmins(service: SupabaseClient, fundId: string): Promise<number> {
  const { data, error } = await service
    .from("fund_memberships")
    .select("id, fund_membership_roles!inner(role)")
    .eq("fund_id", fundId)
    .eq("status", "active")
    .eq("fund_membership_roles.role", "admin");
  if (error) {
    // Cannot count: keep a valid change rather than undo it; the database trigger still held.
    console.error("[countActiveAdmins]", error.message);
    return Number.POSITIVE_INFINITY;
  }
  return data?.length ?? 0;
}

/** Logs the database message; the person gets one calm sentence (the trigger text is raw). */
function roleWriteError(step: "add" | "remove", message: string): Error {
  console.error(`[setMemberRoles] ${step}: ${message}`);
  if (step === "remove" && /admin/i.test(message)) {
    return new Error(serverText("appServer.access.lastAdmin"));
  }
  return new Error(serverText("appServer.access.roleNotChanged"));
}

/**
 * Refuses a role change or reactivation that would pass the installation's seat limit
 * (SEAT_LIMIT/READER_LIMIT; no limit in the pilot). A person who already holds a seat is not
 * counted twice.
 */
async function assertSeatRoom(
  service: SupabaseClient,
  userId: string,
  roles: readonly string[],
): Promise<void> {
  const { loadSeatUsage } = await import("./access.server");
  const { seatLimitMessage } = await import("./seats");
  const { data: profile, error } = await service
    .from("profiles")
    .select("email_normalized")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[seats] profile", error.message);
    throw new Error(serverText("appServer.access.seatsNotCounted"));
  }
  const seats = await loadSeatUsage(
    service,
    (profile?.["email_normalized"] as string | null) ?? undefined,
  );
  const problem = seatLimitMessage(
    seats,
    roles,
    {
      seat: seats.emailUsesSeat,
      reader: seats.emailIsReader,
    },
    requestLanguage(),
  );
  if (problem) throw new Error(problem);
}
