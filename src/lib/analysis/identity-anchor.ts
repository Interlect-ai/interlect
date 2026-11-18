/**
 * whether the research has something to hold the company's identity to. Without a website,
 * a register number that no one has rejected, or domains or register numbers read from the case's
 * own material, a search for the name finds namesakes as readily as the company: the plan's extra
 * questions and the follow-up rounds then multiply claims about another entity (the made-up
 * "Nordlys Analytics" got twice as many claims about an Italian NORDLYS S.R.L.). Such a case is
 * researched with the fixed questions only, and its sources are marked as a suggested match. Pure.
 */
import type { CaseIdentityExtraction } from "./identity-extraction.ts";
import { normalizeSourceUrl } from "./source-grounding.ts";

import { serverText } from "../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.identity.${key}` as MessageKey, vars);
}

export type IdentityAnchor = "website" | "registry" | "material";

/** The company's identity as stored (companies). */
export interface StoredIdentity {
  website: string | null;
  domains: string[] | null;
  cvrNumber: string | null;
  registryNumber: string | null;
  /** companies.identity_status (0018); "rejected" means a human rejected the register match. */
  identityStatus: string | null;
}

const filled = (value: string | null | undefined) => Boolean(value && value.trim());

export function identityAnchor(input: {
  website: string | null;
  stored: StoredIdentity | null;
  extraction: Pick<CaseIdentityExtraction, "domains" | "cvrNumbers"> | null;
}): IdentityAnchor | null {
  const stored = input.stored;
  if (
    filled(input.website) ||
    filled(stored?.website) ||
    (stored?.domains ?? []).some((domain) => filled(domain))
  ) {
    return "website";
  }
  if (
    stored &&
    stored.identityStatus !== "rejected" &&
    (filled(stored.cvrNumber) || filled(stored.registryNumber))
  ) {
    return "registry";
  }
  const extraction = input.extraction;
  if (
    extraction &&
    (extraction.domains.some((domain) => filled(domain)) ||
      extraction.cvrNumbers.some((number) => filled(number)))
  ) {
    return "material";
  }
  return null;
}

/** The research log's note when a case has no anchor, in the fund's language. */
export function noIdentityAnchorGap() {
  return msg("noAnchor");
}

/** What a research track returned, as far as the entity mark is concerned. */
interface TrackSources {
  /** The track's own doubt about the company's legal identity (null or blank: no doubt). */
  identityAmbiguity: string | null;
  findings: ReadonlyArray<{ sources: ReadonlyArray<{ url: string }> }>;
}

/**
 * Whether a public source (by URL) is marked as a suggested match
 * (sources.entity_match_status). Without an anchor every source is. With one, only the
 * sources cited by a track that was itself unsure which legal entity it found; before, one unsure
 * track marked the whole run, and 74-83 % of all sources were suggested even for companies with a
 * website, so the mark told the analyst nothing. A URL cited by both an unsure and a sure track
 * stays suggested. Pure.
 */
export function suggestedMatch(
  tracks: ReadonlyArray<TrackSources>,
  anchor: IdentityAnchor | null,
): (url: string) => boolean {
  if (!anchor) return () => true;
  const unsure = new Set(
    tracks
      .filter((track) => filled(track.identityAmbiguity))
      .flatMap((track) =>
        track.findings.flatMap((finding) =>
          finding.sources.map((source) => normalizeSourceUrl(source.url)),
        ),
      ),
  );
  return (url) => unsure.has(normalizeSourceUrl(url));
}
