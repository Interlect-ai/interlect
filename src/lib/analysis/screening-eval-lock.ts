/**
 * (TS-20), the small fixed eval set (scripts/screening-eval.ts, 10 calls on
 * Interlect Demo) runs at every code change of the screening prompt. The paid run cannot run in CI,
 * so CI holds a lock instead: the fingerprint of the screening prompt for one fixed setup and case.
 * When the prompt's code changes, the fingerprint changes, and `screening-eval-lock.test.ts` fails
 * until the eval has been run on the new prompt and `screening-eval-record.json` is updated with
 * the run (the eval prints the fingerprint it tested). Pay once per code change (00, rule 13).
 *
 * Pure file without a database, so the test and the script share it.
 */
import { createHash } from "node:crypto";
import type { FundProfile } from "../funds/profiles.ts";
import { buildScreeningPrompt, type ScreeningCaseInput } from "./prompt.ts";

const LOCK_PROFILE = {
  id: "eval-lock",
  name: "Eval Lock Fund",
  shortThesis: "B2B",
  thesis: "We invest in Nordic B2B software with paying customers.",
  stages: ["seed"],
  geographies: ["Denmark"],
  sectors: ["B2B SaaS"],
  ticket: { minEur: 500_000, maxEur: 2_000_000, note: "First cheque." },
  fundSizeEur: 40_000_000,
  analysisThreshold: 60,
  approvalMode: "partner_approval",
  riskPosture: "Technical risk is fine, market risk is not.",
  screeningInstruction: "We weigh documented willingness to pay over user growth.",
  distinctiveLens: ["Seed needs paying pilots."],
  gates: [
    { key: "geo", label: "Nordics", description: "Head office in the Nordics.", treatment: "hard" },
  ],
  criteria: [
    {
      key: "team",
      label: "Team",
      description: "Founders with market experience.",
      weight: 50,
      category: "team_market_fit",
    },
    {
      key: "traction",
      label: "Traction",
      description: "Paying customers and growth.",
      weight: 50,
      category: "traction_gtm",
    },
  ],
  sources: [],
  version: "config-lock",
  researchedAt: "2026-11-03",
  language: "en",
} as FundProfile;

const LOCK_CASE: ScreeningCaseInput = {
  caseId: "00000000-0000-4000-8000-00000000eeee",
  companyName: "Lock ApS",
  website: "https://lock.example",
  stage: "seed",
  intakeSources: ["pitch_deck"],
  founders: [{ name: "Ada Founder", role: "CEO", linkedinUrl: null }],
  evidence: [
    {
      id: "00000000-0000-4000-8000-00000000e001",
      claim: "The company has 12 paying customers.",
      status: "company_stated",
      sourceLabel: "Pitch deck",
      sourceUrl: null,
      observationDate: "2026-10-01",
      periodStart: "2026-01-01",
      periodEnd: "2026-09-30",
      excerpt: "12 paying customers, EUR 1.5M ARR.",
    },
  ],
  relatedPastCases: [],
  codeEvaluatedGates: [{ gateKey: "geo", passed: true, rationale: "Registered in Denmark." }],
  financeCodeScore: 55,
};

/**
 * sha256 of the screening prompt (system and user) for the fixed lock setup and case, in English
 * and in Danish, so a change to either language's prompt trips the lock.
 */
export function screeningPromptFingerprint(): string {
  const hash = createHash("sha256");
  for (const language of ["en", "da"] as const) {
    const prompt = buildScreeningPrompt({ ...LOCK_PROFILE, language }, LOCK_CASE);
    hash.update(prompt.system).update("\n\u0000\n").update(prompt.user).update("\n\u0000\n");
  }
  return hash.digest("hex");
}

/** The record of the last eval run, kept next to this file. */
export interface ScreeningEvalRecord {
  promptFingerprint: string;
  promptVersion: string;
  result: "pass" | "fail";
  /** The staging-live run (GitHub Actions run id) with the log on the branch staging-live. */
  runId: string;
  date: string;
  costUsd: number;
  calls: number;
}
