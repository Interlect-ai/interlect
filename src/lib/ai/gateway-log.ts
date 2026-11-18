/**
 * What the server log may say about a failed model call. The model's answer and the
 * gateway's error message can repeat the request, and a call's answer has its masking undone,
 * so real names and confidential text would land in Vercel's log. Only the kind of failure and
 * sizes are logged; the masked text itself is kept in `ai_call_log`. Pure and tested.
 */
export function gatewayErrorSummary(error: unknown): {
  code: string | null;
  type: string | null;
  messageLength: number;
} {
  const record =
    error !== null && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const short = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value).slice(0, 60) : null;
  const message = record ? record["message"] : error;
  return {
    code: short(record?.["code"]),
    type: short(record?.["type"]),
    messageLength: typeof message === "string" ? message.length : 0,
  };
}
