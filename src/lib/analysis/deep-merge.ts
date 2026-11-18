/**
 * The long per-criterion text of the deep analysis is written by the specialists; the synthesis
 * writes only a short verdict-style paragraph (it used to repeat the long texts and ran out of
 * output tokens). After the synthesis, CODE puts each specialist's text into the stored
 * assessment of the same criterion, so the page (which reads the final assessments) still shows
 * the long text. Never done by the model; nothing is invented. Pure and tested.
 */

interface WithRationale {
  criterionKey: string;
  rationale: string;
}

/**
 * Puts the specialist's own text into the assessment of the same criterion whenever it is at
 * least `minLength` characters (the specialist's is the full version). The synthesis's own short
 * text is never silently overwritten: it stays, as a final paragraph "Syntesen: …", so a
 * disagreement the synthesis wrote remains visible. Without a usable specialist text the
 * synthesis text stays alone. Other fields are untouched.
 */
export function mergeSpecialistRationales<A extends WithRationale>(
  assessments: readonly A[],
  specialists: ReadonlyArray<{ assessments: readonly WithRationale[] }>,
  minLength = 150,
): A[] {
  const longest = new Map<string, string>();
  for (const specialist of specialists) {
    for (const item of specialist.assessments) {
      const text = item.rationale.trim();
      if (text.length > (longest.get(item.criterionKey)?.length ?? 0)) {
        longest.set(item.criterionKey, text);
      }
    }
  }
  const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLocaleLowerCase("da-DK");
  return assessments.map((assessment) => {
    const full = longest.get(assessment.criterionKey);
    if (!full || full.length < minLength) return assessment;
    const own = assessment.rationale.trim();
    const repeated = own === "" || norm(full).includes(norm(own));
    return { ...assessment, rationale: repeated ? full : `${full}\n\nSyntesen: ${own}` };
  });
}
