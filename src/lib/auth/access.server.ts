import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLanguage, type Language } from "@/lib/i18n/language";
import { translate } from "@/lib/i18n/translate";
import type { AppRole } from "@/lib/supabase/types";
import { hasCapability, type Capability, type FundSettings } from "@/lib/domain/workflow";
import { parseSeatLimit, type SeatUsage } from "./seats";
import { serverText } from "@/lib/i18n/server-text";

/** Serverside hjælpere til adgangskontrol. Ingen af dem stoler på klientinput. */

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 256 bit entropi, url-sikker. */
export function generateInvitationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface Access {
  fundId: string;
  fundName: string;
  membershipId: string;
  roles: AppRole[];
  /** The fund's Medlem settings (0032), read together with the membership. */
  settings: FundSettings;
  /** The fund's language: the interface and everything AI writes. */
  language: Language;
}

export async function loadAccessForFund(
  supabase: SupabaseClient,
  userId: string,
  fundId: string,
): Promise<Access | null> {
  const { data, error } = await supabase
    .from("fund_memberships")
    .select(
      "id, fund_id, status, funds(name, member_can_decide, member_can_publish, language), fund_membership_roles(role)",
    )
    .eq("user_id", userId)
    .eq("fund_id", fundId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    // Fails closed, but a database error must not look like "not a member" (harden).
    console.error("[loadAccessForFund]", error.message);
    throw new Error(serverText("appServer.access.accessNotChecked"));
  }
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    fund_id: string;
    funds: FundRow | FundRow[] | null;
    fund_membership_roles: { role: AppRole }[] | null;
  };
  const fund = Array.isArray(row.funds) ? row.funds[0] : row.funds;
  return {
    fundId: row.fund_id,
    fundName: fund?.name ?? "",
    membershipId: row.id,
    roles: (row.fund_membership_roles ?? []).map((role) => role.role),
    settings: {
      memberCanDecide: fund?.member_can_decide === true,
      memberCanPublish: fund?.member_can_publish === true,
    },
    language: parseLanguage(fund?.language),
  };
}

interface FundRow {
  name: string;
  member_can_decide: boolean | null;
  member_can_publish: boolean | null;
  language?: string | null;
}

export async function requireFundCapability(
  supabase: SupabaseClient,
  userId: string,
  fundId: string,
  capability: Capability,
): Promise<Access> {
  const access = await loadAccessForFund(supabase, userId, fundId);
  if (!access) forbidden(serverText("appServer.access.noMembership"));
  if (!hasCapability(access.roles, capability, access.settings)) forbidden();
  return access;
}

export function forbidden(message = serverText("appServer.access.forbidden")): never {
  throw new Error(message);
}

/**
 * The person's other active teams, and which of them the caller runs as Admin: an
 * action on the person's account itself (their authenticator, their password) must not reach into
 * a team the caller does not run. A lookup that fails throws, so the caller refuses the action.
 */
export async function otherTeamsOfPerson(
  service: SupabaseClient,
  input: { targetUserId: string; callerUserId: string; fundId: string; logTag: string },
): Promise<{ otherFundIds: string[]; callerAdminFundIds: string[] }> {
  const { data: otherRows, error: otherError } = await service
    .from("fund_memberships")
    .select("fund_id")
    .eq("user_id", input.targetUserId)
    .eq("status", "active")
    .neq("fund_id", input.fundId);
  if (otherError) {
    console.error(`[${input.logTag}] other teams`, otherError.message);
    throw new Error("other teams not read");
  }
  const otherFundIds = [
    ...new Set(((otherRows ?? []) as { fund_id: string }[]).map((row) => row.fund_id)),
  ];
  if (otherFundIds.length === 0) return { otherFundIds, callerAdminFundIds: [] };
  const { data: mine, error: mineError } = await service
    .from("fund_memberships")
    .select("fund_id, fund_membership_roles(role)")
    .eq("user_id", input.callerUserId)
    .eq("status", "active")
    .in("fund_id", otherFundIds);
  if (mineError) {
    console.error(`[${input.logTag}] caller teams`, mineError.message);
    throw new Error("caller teams not read");
  }
  const callerAdminFundIds = (
    (mine ?? []) as unknown as Array<{
      fund_id: string;
      fund_membership_roles: { role: AppRole }[] | null;
    }>
  )
    .filter((row) =>
      hasCapability(
        (row.fund_membership_roles ?? []).map((r) => r.role),
        "manage_users",
      ),
    )
    .map((row) => row.fund_id);
  return { otherFundIds, callerAdminFundIds };
}

export interface AuditInput {
  fundId: string | null;
  actorType: "pap" | "user" | "system";
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Rå invitationstokens må aldrig ende her.
 * Fejler lukket: kan hændelsen ikke skrives, må handlingen ikke rapportere
 * succes. Kaldere skal derfor lade fejlen boble op.
 */
export async function writeAudit(service: SupabaseClient, input: AuditInput): Promise<void> {
  await writeAuditWithId(service, input);
}

/**
 * Writes one audit row and returns its id, so a later "not saved" row can name the exact row it
 * cancels. Throws when the row cannot be written, so a caller that logs first changes nothing.
 */
export async function writeAuditWithId(
  service: SupabaseClient,
  input: AuditInput,
): Promise<string | null> {
  const { data, error } = await service
    .from("audit_events")
    .insert({
      fund_id: input.fundId,
      actor_type: input.actorType,
      actor_id: input.actorId,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId,
      payload: input.payload ?? {},
    })
    .select("id")
    .maybeSingle();
  if (error) {
    // The cause is logged here, so every caller's fallback has it (harden G16).
    console.error(`[audit] ${input.action}: ${error.code ?? ""} ${error.message}`);
    throw new Error(serverText("appServer.access.auditNotWritten"));
  }
  return (data?.["id"] as string | undefined) ?? null;
}

/**
 * Delt hastighedsgrænse: databasen tæller forsøg pr. nøgle på tværs af alle
 * Vercel-instanser (0101 `rate_limit_hit`; højst `limit` forsøg pr. `windowMs`, et afvist forsøg
 * tæller ikke). Kaster `refusal` ved grænsen, og afviser også, når databasen ikke kan svare
 * (ingen dyr eller følsom handling slipper igennem uden tælling). Nøglen er id'er eller hashes.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  // Danish on purpose: the invitation page recognises this exact text.
  refusal: string = translate("da", "auth.invitation.rateLimited"),
): Promise<void> {
  const { getServiceClient } = await import("@/lib/supabase/admin.server");
  const { data, error } = await getServiceClient().rpc("rate_limit_hit", {
    _key: key,
    _limit: limit,
    _window_seconds: Math.max(1, Math.round(windowMs / 1000)),
  });
  if (error || typeof data !== "boolean") {
    console.error(`[rate-limit] ${key.split(":")[0]}`, error?.message ?? "intet svar");
    throw new Error(refusal);
  }
  if (!data) throw new Error(refusal);
}

/** Ens svar uanset årsag, så invitationer og konti ikke kan udledes. */
export const GENERIC_INVITATION_ERROR = translate("da", "auth.invitation.unusable");

export interface SeatCount extends SeatUsage {
  /** Whether the given e-mail already holds a seat or a reader place (active or invited). */
  emailUsesSeat: boolean;
  emailIsReader: boolean;
}

/** Pladser for hele installationen (0032 `seat_usage`, kun service-rollen må kalde den). */
export async function loadSeatUsage(service: SupabaseClient, email?: string): Promise<SeatCount> {
  const { data, error } = await service.rpc("seat_usage", { _email: email ?? null });
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        seats_used: number;
        readers_used: number;
        email_uses_seat: boolean;
        email_is_reader: boolean;
      }
    | null
    | undefined;
  if (error || !row) {
    console.error("[seat_usage]", error?.message ?? "intet svar");
    throw new Error(serverText("appServer.access.seatsNotCounted"));
  }
  return {
    seatsUsed: row.seats_used,
    seatLimit: parseSeatLimit(process.env["SEAT_LIMIT"]),
    readersUsed: row.readers_used,
    readerLimit: parseSeatLimit(process.env["READER_LIMIT"]),
    emailUsesSeat: row.email_uses_seat,
    emailIsReader: row.email_is_reader,
  };
}
