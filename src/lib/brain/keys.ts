/**
 * Entity keys for Brain. normalizeEntityName mirrors public.brain_normalize_name (migration
 * 0042) exactly, so a key computed in TypeScript matches the unique (fund_id, type,
 * normalized_key) index in the database. keys.test.ts pins the shared cases; npm run test:rls
 * compares both implementations on the same names.
 */

const LEGAL_SUFFIX =
  /[ \t\n\r\f\v,.]+(aps|a\/s|as|ivs|p\/s|i\/s|k\/s|smba|ltd|limited|inc|llc|gmbh|ab|oy|bv|sas)\.?$/;

/**
 * Lower case, trim, collapse whitespace, drop one trailing legal suffix ("ApS", "A/S", "Ltd.").
 * Returns null for an empty name, like the SQL function. Postgres' \s is [ \t\n\r\f\v], so the
 * ASCII class is used here too (JavaScript's \s also matches Unicode spaces).
 */
export function normalizeEntityName(name: string | null | undefined): string | null {
  // Same order as SQL: btrim (spaces only), lower, collapse whitespace, strip suffix, btrim.
  const collapsed = (name ?? "")
    .replace(/^ +| +$/g, "")
    .toLowerCase()
    .replace(/[ \t\n\r\f\v]+/g, " ");
  const stripped = collapsed.replace(LEGAL_SUFFIX, "").replace(/^ +| +$/g, "");
  return stripped === "" ? null : stripped;
}

/**
 * The company entity's key, as brain_project_db_entities builds it (0042): the CVR number when
 * known, else the domain, else the normalised name (else the company id).
 */
export function companyEntityKey(company: {
  id: string;
  name: string | null;
  cvrNumber?: string | null;
  domain?: string | null;
}): string {
  if (company.cvrNumber) return `cvr:${company.cvrNumber}`;
  const domain = (company.domain ?? "").replace(/^ +| +$/g, "");
  if (domain) return `domain:${domain.toLowerCase()}`;
  return `name:${normalizeEntityName(company.name) ?? company.id}`;
}
