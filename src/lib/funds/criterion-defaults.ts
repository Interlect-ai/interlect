/**
 * "Tilpasset" and "Nulstil til standard" for a criterion (v0.7): a criterion is
 * customised when its text is not the text a template ships for the same criterion. The fund does
 * not store which template it started from, so the default is looked up by the criterion's key,
 * preferring the template that matches the fund's investment model. Criteria the fund added itself
 * have no default and are never marked. Pure file: the templates are passed in (the app passes
 * `fundConfigTemplates`), so it can be tested with node --test.
 */
export interface TemplateLike {
  strategyType: string;
  criteria: ReadonlyArray<{ key: string; description: string }>;
}

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The template texts for a criterion key, the fund's own investment model first. */
function candidates(
  templates: Iterable<TemplateLike>,
  key: string,
  strategyType: string,
): string[] {
  const ordered = [...templates].sort(
    (a, b) => Number(b.strategyType === strategyType) - Number(a.strategyType === strategyType),
  );
  const texts: string[] = [];
  for (const template of ordered) {
    for (const criterion of template.criteria) {
      if (criterion.key === key && !texts.includes(criterion.description)) {
        texts.push(criterion.description);
      }
    }
  }
  return texts;
}

/** The standard text for a criterion, or null when no template has the criterion. */
export function defaultCriterionDescription(
  templates: Iterable<TemplateLike>,
  key: string,
  strategyType: string,
): string | null {
  return candidates(templates, key, strategyType)[0] ?? null;
}

/**
 * The templates' texts from (the product no longer says "fond").
 * Teams made from a template before then still have them: they count as the standard, not as
 * "Tilpasset", but "Nulstil til standard" always writes today's text.
 */
// i18n-keep: earlier template texts, only compared with a team's saved text, never shown.
const EARLIER_TEMPLATE_TEXTS: Readonly<Record<string, readonly string[]>> = {
  thesis_fit: [
    "Hvor direkte casen matcher fondens erklærede tese, sektorer og differentierede investeringssyn.",
    "Match med fondens markedssyn, værdiskabelsesmodel, ejerhorisont og afkastkrav.",
  ],
  strategic_fit: ["Match med fondens tese, ejerhorisont, afkastkrav og værdiskabelsesmodel."],
};

/** True when the criterion has a standard text and the fund's text differs from all of them. */
export function isCustomCriterion(
  templates: Iterable<TemplateLike>,
  criterion: { key: string; description: string },
  strategyType: string,
): boolean {
  const defaults = candidates(templates, criterion.key, strategyType);
  if (defaults.length === 0) return false;
  const current = norm(criterion.description);
  const standard = [...defaults, ...(EARLIER_TEMPLATE_TEXTS[criterion.key] ?? [])];
  return !standard.some((text) => norm(text) === current);
}
