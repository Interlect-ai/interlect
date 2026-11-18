/**
 * Wire ids of TanStack Start server functions in PRODUCTION builds.
 *
 * In dev the URL is `/_serverFn/<base64url JSON {file, export}>`, so a test can read the function
 * name. In a production build the plugin replaces that with an opaque sha256 hash, which made the
 * paid-call guard in tests/e2e/lib.ts blind against Vercel previews. vite.config.ts therefore sets
 * `serverFns.generateFunctionId` to this function: the id keeps the function name in front and a
 * short hash behind, e.g. `runInitialScreening_createServerFn_handler--3fa9c1d2e07b8a44`.
 *
 * The hash still makes the id unique per file (two modules may export the same name). The name is
 * not a secret: it is public in the dev build and the function still requires login and capability.
 * Plain .mjs so vite.config.ts, node --test and the e2e scripts can all import the same code.
 */
import { createHash } from "node:crypto";

const ID_PATTERN = /^([A-Za-z0-9]+)_createServerFn_handler--[0-9a-f]{16}(?:_\d+)?$/;

/** `generateFunctionId` for `tanstackStart({ serverFns })`; only used by production builds. */
export function generateServerFnId({ filename, functionName }) {
  const hash = createHash("sha256")
    .update(`${filename}--${functionName}`)
    .digest("hex")
    .slice(0, 16);
  return `${functionName}--${hash}`;
}

/**
 * The export name (`runInitialScreening`) behind the last path segment of a `/_serverFn/...` URL,
 * or null when it cannot be read (an opaque hash from an older build, or anything unexpected).
 * Understands both the dev encoding (base64url JSON) and ids from generateServerFnId.
 */
export function serverFnNameFromUrl(url) {
  const match = /\/_serverFn\/([^?/#]+)/.exec(url);
  if (!match?.[1]) return null;
  let segment;
  try {
    segment = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const fromId = ID_PATTERN.exec(segment);
  if (fromId?.[1]) return fromId[1];
  try {
    const decoded = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    const exportName = typeof decoded?.export === "string" ? decoded.export : null;
    const named = exportName ? /^([A-Za-z0-9]+)_createServerFn_handler$/.exec(exportName) : null;
    return named?.[1] ?? null;
  } catch {
    return null;
  }
}
