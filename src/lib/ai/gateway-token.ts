import { getVercelOidcTokenSync } from "@vercel/functions/oidc";

/**
 * The credential for a direct AI Gateway call: AI_GATEWAY_API_KEY when the installation has one
 * (staging), otherwise the Vercel project's own OIDC token (every customer, the project budget only
 * counts OIDC calls). On Vercel the OIDC token comes with each request
 * (x-vercel-oidc-token), not in process.env at runtime; locally `vercel env pull` puts it in
 * VERCEL_OIDC_TOKEN. Found: a customer installation saw no token at all. Undefined when
 * there is neither, so the caller's own "no gateway access" error stays the one shown.
 */
export function gatewayToken(): string | undefined {
  const key = process.env["AI_GATEWAY_API_KEY"];
  if (key) return key;
  try {
    return getVercelOidcTokenSync();
  } catch {
    return undefined;
  }
}

/**
 * The error a caller throws when there is no token: the customer sees the caller's neutral text
 * (no subcontractor's name), the server log says what is missing and where.
 */
export function missingGatewayToken(where: string, message: string): Error {
  console.error(
    `[ai-gateway] ${where}: no AI_GATEWAY_API_KEY and no Vercel OIDC token in the server environment`,
  );
  return new Error(message);
}
