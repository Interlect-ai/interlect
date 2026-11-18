/**
 * Module resolve hook for scripts that import app code: maps "@/…" to src/ (as in tsconfig) and
 * adds the .ts extension to extensionless relative imports, which Node's type stripping needs.
 * Registered by scripts/lib/register-alias.mjs (node --import).
 */
import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function withExtension(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const found = withExtension(resolvePath(SRC, specifier.slice(2)));
    if (found) return next(pathToFileURL(found).href, context);
  } else if (
    specifier.startsWith(".") &&
    context.parentURL?.startsWith("file:") &&
    !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)
  ) {
    const parent = dirname(fileURLToPath(context.parentURL));
    const found = withExtension(resolvePath(parent, specifier));
    if (found) return next(pathToFileURL(found).href, context);
  }
  return next(specifier, context);
}
