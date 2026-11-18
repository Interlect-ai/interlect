/**
 * Settings for running Interlect as a service for other organisations. A self-hosted installation
 * (npm run setup, scripts/selfhost) never reads them, so they are empty here. Set them in the
 * environment only if you operate such a service yourself.
 */
const env = typeof process === "undefined" ? {} : process.env;
const pick = (key: string) => env[key]?.trim() || "";

export const OPERATOR = {
  /** The GitHub repository every customer's Vercel project builds from. */
  repository: pick("INTERLECT_OPERATOR_REPOSITORY"),
  /** The Vercel team where every customer's project lives. */
  vercelTeamId: pick("INTERLECT_OPERATOR_VERCEL_TEAM_ID"),
  /** The Vercel project whose build settings a customer's project copies. */
  templateProject: pick("INTERLECT_OPERATOR_TEMPLATE_PROJECT"),
  /** Customers get <slug>.<customerDomain>. */
  customerDomain: pick("INTERLECT_OPERATOR_CUSTOMER_DOMAIN"),
  /** The sender of the admin's invitation mail. */
  inviteFrom: pick("INTERLECT_OPERATOR_INVITE_FROM"),
} as const;
