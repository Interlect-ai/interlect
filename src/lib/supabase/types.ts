/**
 * Håndskrevne typer for det eksterne Supabase-projekt (Interlect.ai).
 * Milepæl 2 dækker kun identitet og adgang.
 */

export type AppRole = "admin" | "lead" | "member" | "reader";
export type MembershipStatus = "active" | "deactivated";
export type AuditActorType = "pap" | "user" | "system";

export interface ProfileRow {
  id: string;
  full_name: string | null;
  email_normalized: string;
  created_at: string;
  updated_at: string;
}

export interface FundRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface FundMembershipRow {
  id: string;
  fund_id: string;
  user_id: string;
  status: MembershipStatus;
  created_at: string;
  updated_at: string;
}

export interface FundMembershipRoleRow {
  membership_id: string;
  role: AppRole;
  granted_by: string | null;
  granted_at: string;
}

export interface InvitationRow {
  id: string;
  fund_id: string;
  email_normalized: string;
  roles: AppRole[];
  token_hash: string;
  expires_at: string;
  claimed_at: string | null;
  claim_id: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AuditEventRow {
  id: string;
  fund_id: string | null;
  actor_type: AuditActorType;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
}
