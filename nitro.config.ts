import { defineConfig } from "nitro";

// The session lives in localStorage, so a script injected into a page would own the
// account. The policy keeps scripts, frames and connections to our own origin and Supabase (the
// browser talks to nothing else; AI calls are made by the server). Inline scripts and styles stay
// allowed because the framework injects them for hydration; Google Fonts is the maintenance
// page's font. Every origin here must be one the app really uses.
// A Supabase that is not on supabase.co (a custom domain, or the local Supabase the self-host
// end-to-end test runs, .github/workflows/selfhost-e2e.yml) is added from the build's own
// PAP_SUPABASE_URL/SUPABASE_URL; on supabase.co nothing changes.
function ownSupabaseOrigins(): string[] {
  const raw = process.env["PAP_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  if (!raw) return [];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`PAP_SUPABASE_URL/SUPABASE_URL is not a URL: ${raw}`);
  }
  if (url.hostname.endsWith(".supabase.co")) return [];
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`PAP_SUPABASE_URL/SUPABASE_URL must be http(s): ${raw}`);
  }
  const socket = url.protocol === "https:" ? "wss:" : "ws:";
  return [url.origin, `${socket}//${url.host}`];
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  ["connect-src 'self' https://*.supabase.co wss://*.supabase.co", ...ownSupabaseOrigins()].join(
    " ",
  ),
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export default defineConfig({
  routeRules: {
    "/**": {
      headers: {
        "Content-Security-Policy": contentSecurityPolicy,
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Content-Type-Options": "nosniff",
      },
    },
  },
  plugins: [
    "./server/plugins/deep-analysis-queue.ts",
    "./server/plugins/screening-queue.ts",
    "./server/plugins/brain-queue.ts",
  ],
  vercel: {
    queues: {
      triggers: [
        { topic: "interlect-deep-analysis", retryAfterSeconds: 30 },
        // The screening's analysis phase, after its research phase.
        { topic: "interlect-screening", retryAfterSeconds: 30 },
        // Brain: a busy or failed job is retried a minute later.
        { topic: "interlect-brain", retryAfterSeconds: 60 },
      ],
    },
    // Brain's nightly cron (RETENTION and L4, later WATCH). Vercel Cron only runs on production and
    // sends Authorization: Bearer $CRON_SECRET; the route does nothing while BRAIN_ENABLED is off.
    config: {
      crons: [{ path: "/api/brain/cron", schedule: "15 2 * * *" }],
    },
    functions: {
      // Each queued analysis phase stays below this boundary. The full analysis
      // is split across several queue deliveries (one phase per invocation). Pro allows more, but
      // 300 s is the chosen ceiling; the gateway timeouts in src/lib/analysis/deep-text-rules.ts (which explains
      // the whole chain) are sized to finish and save inside it.
      maxDuration: 300,
    },
  },
});
