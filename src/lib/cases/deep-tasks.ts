/**
 * The "Skal afklares" source of a finished deep analysis: what the synthesis and the four
 * specialists found, in the shape `buildAiTasks` reads. Pure and tested (only type imports and
 * pure files), so both places that finish a deep run build the same tasks.
 */
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { specialistLabel } from "./deep-view.ts";
import {
  MAX_AI_TASKS_PER_CURATED_RUN,
  MAX_AI_TASKS_PER_DEEP_RUN,
  MAX_UNKNOWNS_PER_CRITERION_DEEP,
  sanitizeNextSteps,
  type AiTaskSource,
} from "./tasks.ts";

interface ProfileLike {
  /** The fund's language: the task builder's wording follows it. */
  language?: Language;
  gates: Array<{ key: string; label: string; treatment?: string }>;
  criteria: Array<{ key: string; label: string; description?: string; category: string }>;
}

interface SynthesisLike {
  assessments: Array<{ criterionKey: string; unknowns: string[] }>;
  openQuestions: string[];
  findings?: Array<{ findingType: string; statement: string }>;
  risks?: Array<{
    riskKey?: string;
    label: string;
    level: string;
    rationale: string;
    mitigation: string | null;
  }>;
  contraryCase?: string | null | undefined;
  /** From prompt v10c; undefined on older stored output (the older builder then runs). */
  nextSteps?:
    | ReadonlyArray<{
        title?: unknown;
        why?: unknown;
        kind?: unknown;
        linkedKind?: unknown;
        linkedKey?: unknown;
        priority?: unknown;
      }>
    | undefined;
  investmentCondition?: string | null | undefined;
}

interface SpecialistLike {
  moduleId: string;
  questions: string[];
  unknowns: string[];
}

export function deepTaskSource(input: {
  configVersionId: string | null;
  profile: ProfileLike;
  modules: ReadonlyArray<{ id: string; title: string; categories: readonly string[] }>;
  unresolvedGateKeys: string[];
  missingCriterionKeys: string[];
  output: SynthesisLike;
  specialists: readonly SpecialistLike[];
  /** The research's open questions to the founders (`founderQuestions`). */
  researchQuestions?: AiTaskSource["researchQuestions"];
}): AiTaskSource {
  const moduleById = new Map(input.modules.map((module) => [module.id, module]));
  const language = input.profile.language ?? DEFAULT_LANGUAGE;
  return {
    language,
    configVersionId: input.configVersionId,
    gates: input.profile.gates,
    criteria: input.profile.criteria,
    unresolvedGateKeys: input.unresolvedGateKeys,
    missingCriterionKeys: input.missingCriterionKeys,
    assessments: input.output.assessments,
    openQuestions: input.output.openQuestions,
    findings: input.output.findings ?? [],
    risks: input.output.risks ?? [],
    specialists: input.specialists.flatMap((packet) => {
      const module = moduleById.get(packet.moduleId);
      if (!module) return [];
      return [
        {
          moduleId: module.id,
          label: specialistLabel(module, language),
          criterionKeys: input.profile.criteria
            .filter((criterion) => module.categories.includes(criterion.category))
            .map((criterion) => criterion.key),
          questions: packet.questions,
          unknowns: packet.unknowns,
        },
      ];
    }),
    researchQuestions: input.researchQuestions ?? [],
    investmentCondition: input.output.investmentCondition ?? null,
    contraryCase: input.output.contraryCase ?? null,
    nextSteps:
      input.output.nextSteps === undefined
        ? undefined
        : sanitizeNextSteps(input.output.nextSteps, {
            gates: input.profile.gates.map((gate) => gate.key),
            criteria: input.profile.criteria.map((criterion) => criterion.key),
          }),
    maxTasks:
      input.output.nextSteps === undefined
        ? MAX_AI_TASKS_PER_DEEP_RUN
        : MAX_AI_TASKS_PER_CURATED_RUN,
    maxUnknownsPerCriterion: MAX_UNKNOWNS_PER_CRITERION_DEEP,
  };
}
