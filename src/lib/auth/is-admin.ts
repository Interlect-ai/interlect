/**
 * Whether the roles include the admin role. UI only: every server function checks the role
 * itself. One place for the role name ("admin" since migration 0032).
 */
export function isAdminRole(roles: readonly string[] | null | undefined): boolean {
  return Boolean(roles?.includes("admin"));
}
