/**
 * What a failed run's stored error says to the person. The stored `error_message` can
 * hold text from the AI provider or the database (model ids, "gateway", PostgREST messages), and
 * every role in the team gets the case payload, so the server maps it here before it leaves, and
 * the case page uses the same mapping for an error it gets live. Only Interlect's own sentences
 * reach people (beslutningslog 15. okt): no model or provider names, ever.
 */
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import { userMessage } from "./user-message.ts";

/** Names and ids that show how an analysis was made; never shown, even inside our own sentence. */
const AI_INTERNALS =
  /\b(openai|anthropic|perplexity|sonar|gpt[-\w.]*|claude[-\w.]*|gemini|mistral|llama|grok|deepseek|ai sdk|gateway|vercel|postgrest|supabase)\b|\b(google|xai|meta|cohere|amazon|bedrock)\//i;

const MAPPED = [
  "caseView.route.errCredits",
  "caseView.route.errApiKey",
  "caseView.route.errResearch",
  "caseView.route.errGeneric",
] as const;

/** The person's sentence for a stored run error; null when the run stored none. */
export function publicRunError(
  stored: string | null | undefined,
  language: Language,
): string | null {
  if (!stored) return null;
  // Already mapped (the case page maps a stored error again on its way to the notice).
  if (MAPPED.some((key) => translate(language, key) === stored)) return stored;
  // Interlect's own AI account, not the customer's: a neutral line. The customer's credits
  // running out is the credit meter's message (appServer.credits.exhausted) and passes as it is.
  if (
    stored.includes("GatewayRateLimitError") ||
    stored.includes("Free tier") ||
    stored === translate("da", "analysisServer.research.serviceLimited") ||
    stored === translate("en", "analysisServer.research.serviceLimited")
  ) {
    return translate(language, "caseView.route.errCredits");
  }
  // Also a run from, whose stored error still names the subcontractor.
  if (stored.includes("Invalid API key") || /gateway|vercel/i.test(stored)) {
    return translate(language, "caseView.route.errApiKey");
  }
  // i18n-keep: matched against the server's error text in both languages, never shown.
  if (
    stored.includes("researchspor") ||
    stored.includes("søgeresultater") ||
    stored.includes("research tracks") ||
    stored.includes("search results")
  ) {
    return translate(language, "caseView.route.errResearch");
  }
  const generic = translate(language, "caseView.route.errGeneric");
  // A run from may have our own sentence with the provider's text after it.
  if (AI_INTERNALS.test(stored)) return generic;
  // Last resort: only the server's own sentences in the team's language reach the page.
  return userMessage(new Error(stored), generic, language);
}
