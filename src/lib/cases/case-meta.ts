import type { CaseViewModel } from "./view-model.ts";

/** "Seed, Aquatech, Danmark" (the facts we have, in that order). */
export function caseMeta(model: CaseViewModel): string {
  return [model.stageText === "Ukendt" ? null : model.stageText, model.sector, model.geography]
    .filter(Boolean)
    .join(", ");
}
