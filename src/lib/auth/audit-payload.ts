/**
 * The audit log's payload as Admin gets it: amounts in kroner are only found under
 * Analysegrænser, so every field that holds kroner (`…Dkk`, `…_dkk`) is left out at any depth.
 * The stored row is not changed (the audit log is append-only).
 */
export function auditPayloadWithoutAmounts(payload: unknown): Record<string, unknown> {
  const cleaned = withoutAmounts(payload);
  return cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)
    ? (cleaned as Record<string, unknown>)
    : {};
}

function withoutAmounts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAmounts);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/dkk$/i.test(key))
      .map(([key, inner]) => [key, withoutAmounts(inner)]),
  );
}
