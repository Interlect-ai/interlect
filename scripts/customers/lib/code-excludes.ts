/** Paths that never go to a customer: other customers, the product owner's notes, chat archives, secrets. */
export const CODE_EXPORT_EXCLUDES = [
  "customers",
  "docs/noter",
  "docs/spec",
  "docs/plans",
  "docs/knowledge",
  "docs/design-status",
  "_chat-arkiv",
  "harden",
  "docs/arkiv",
  "PLAN-REVIEW-LOG.md",
  "CONTEXT.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".claude",
  ".lovable",
  ".mcp.json",
  "graphify-out",
] as const;

/** Files that never go to a customer, wherever they are. */
export function isSecretFile(path: string) {
  const name = path.split("/").pop() ?? "";
  return /^\.env(\..*)?$/.test(name) && name !== ".env.example";
}

export function isExcludedFromCodeExport(path: string) {
  const normal = path.replace(/^\.\//, "");
  return (
    CODE_EXPORT_EXCLUDES.some((dir) => normal === dir || normal.startsWith(`${dir}/`)) ||
    isSecretFile(normal)
  );
}
