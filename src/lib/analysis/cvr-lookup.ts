/**
 * Slår et dansk CVR-nummer op ud fra selskabsnavn via Datafordelerens CVR
 * GraphQL-API (graphql.datafordeler.dk/CVR/v2) -- gratis konto, ingen MitID
 * krævet for denne del af CVR-registret. Kræver DATAFORDELER_API_KEY.
 *
 * Vigtig begrænsning, bekræftet mod det rigtige API: navnefeltet
 * (`CVR_Navn.vaerdi`) understøtter kun eksakt match (`eq`/`in`) og er
 * versalfølsomt -- der findes ingen fritekst-/delstrengssøgning i dette
 * register. Vi prøver derfor navnet i et par almindelige stavevarianter
 * (som indtastet, med stort forbogstav i hvert ord, og versaler), men et
 * navn der ikke matcher Erhvervsstyrelsens indberettede stavning præcist vil
 * ikke give et hit.
 *
 * Skema-sammenhæng fundet ved eksperiment: en virksomheds "enhed" har sit
 * eget id (`CVR_Virksomhed.id`, IKKE det samme som CVR-nummeret), og det er
 * DEN værdi -- ikke CVR-nummeret -- som `CVR_Navn.CVREnhedsId` peger på.
 */

import { serverText } from "../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.cvr.${key}` as MessageKey, vars);
}

const GRAPHQL_ENDPOINT = "https://graphql.datafordeler.dk/CVR/v2";
// Datafordelerens offentlige CVR-GraphQL kan i praksis tage 15-20 sekunder om
// at svare på et enkelt opslag -- ikke en fejl i vores kode, bare et langsomt
// offentligt API. Sat højt for ikke at afbryde et svar der er undervejs.
const FETCH_TIMEOUT_MS = 25_000;

export interface CvrCompanyMatch {
  cvrNumber: string;
  name: string;
  status: string;
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map((word) =>
      word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

async function graphqlFetch(query: string, apiKey: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${GRAPHQL_ENDPOINT}?apiKey=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(msg("status", { status: response.status }));
  }
  const body = (await response.json()) as { data?: Record<string, unknown>; errors?: unknown[] };
  if (body.errors?.length) {
    // Den rå fejltekst logges til fejlsøgning, men vises aldrig for brugeren.
    const first = body.errors[0] as { message?: unknown } | undefined;
    console.error("[cvr-lookup] Datafordeleren rejected query", String(first?.message ?? ""));
    throw new Error(msg("rejected"));
  }
  return body.data ?? {};
}

/** Slår et selskabsnavn op og returnerer de(t) aktuelle CVR-selskab(er) det matcher. */
export async function searchCvrByName(rawName: string): Promise<CvrCompanyMatch[]> {
  return searchCvrByNames([rawName]);
}

/**
 * Som `searchCvrByName`, men for flere stavemåder i ÉT opslag (registret er langsomt, så
 * Opret case prøver navnet med og uden selskabsform i samme kald).
 */
export async function searchCvrByNames(rawNames: string[]): Promise<CvrCompanyMatch[]> {
  const apiKey = process.env["DATAFORDELER_API_KEY"];
  if (!apiKey) throw new Error(msg("nameLookupNotConfigured"));

  const names = rawNames.map((name) => name.trim()).filter((name) => name.length > 0);
  if (names.length === 0) return [];
  const trimmed = names[0]!;

  const variants = Array.from(
    new Set(names.flatMap((name) => [name, titleCase(name), name.toUpperCase()])),
  );
  const valuesLiteral = variants.map((value) => JSON.stringify(value)).join(", ");

  const navnData = await graphqlFetch(
    `query {
      CVR_Navn(where: { vaerdi: { in: [${valuesLiteral}] } }) {
        edges { node { vaerdi CVREnhedsId virkningTil } }
      }
    }`,
    apiKey,
  );
  const navnEdges =
    (navnData["CVR_Navn"] as { edges?: Array<{ node: Record<string, unknown> }> } | undefined)
      ?.edges ?? [];

  // Kun det navn, selskabet bærer LIGE NU (virkningTil er null) -- ellers
  // ville et nedlagt historisk navn kunne pege på det forkerte selskab.
  const currentByEnhedsId = new Map<string, string>();
  for (const edge of navnEdges) {
    if (edge.node["virkningTil"] === null) {
      currentByEnhedsId.set(edge.node["CVREnhedsId"] as string, edge.node["vaerdi"] as string);
    }
  }
  const enhedsIds = Array.from(currentByEnhedsId.keys());
  if (enhedsIds.length === 0) return [];

  const idsLiteral = enhedsIds.map((id) => JSON.stringify(id)).join(", ");
  const virksomhedData = await graphqlFetch(
    `query {
      CVR_Virksomhed(where: { id: { in: [${idsLiteral}] } }) {
        edges { node { id CVRNummer status } }
      }
    }`,
    apiKey,
  );
  const virksomhedEdges =
    (
      virksomhedData["CVR_Virksomhed"] as
        { edges?: Array<{ node: Record<string, unknown> }> } | undefined
    )?.edges ?? [];

  return virksomhedEdges.map((edge) => ({
    cvrNumber: String(edge.node["CVRNummer"]),
    name: currentByEnhedsId.get(edge.node["id"] as string) ?? trimmed,
    status: edge.node["status"] as string,
  }));
}

/**
 * Slår ét CVR-nummer op (fx fundet i decket eller på websitet) og returnerer det
 * aktuelle navn og status. `null` betyder, at nummeret ikke findes i registret.
 */
export async function lookupCvrByNumber(cvrNumber: string): Promise<CvrCompanyMatch | null> {
  const apiKey = process.env["DATAFORDELER_API_KEY"];
  if (!apiKey) throw new Error(msg("lookupNotConfigured"));
  if (!/^[0-9]{8}$/.test(cvrNumber)) return null;

  // CVRNummer er et tal i registret. Afviser API'et et tal-filter, prøves det som tekst,
  // så et skemaskifte giver et svar i stedet for et tavst "ikke fundet".
  let virksomhedData: Record<string, unknown>;
  try {
    virksomhedData = await graphqlFetch(
      `query { CVR_Virksomhed(where: { CVRNummer: { eq: ${Number(cvrNumber)} } }) {
        edges { node { id CVRNummer status } } } }`,
      apiKey,
    );
  } catch (numericError) {
    console.warn(
      "[cvr-lookup] numeric CVRNummer filter rejected, retrying as text",
      numericError instanceof Error ? numericError.message : numericError,
    );
    virksomhedData = await graphqlFetch(
      `query { CVR_Virksomhed(where: { CVRNummer: { eq: ${JSON.stringify(cvrNumber)} } }) {
        edges { node { id CVRNummer status } } } }`,
      apiKey,
    );
  }
  const node = (
    virksomhedData["CVR_Virksomhed"] as
      { edges?: Array<{ node: Record<string, unknown> }> } | undefined
  )?.edges?.[0]?.node;
  if (!node) return null;

  const navnData = await graphqlFetch(
    `query { CVR_Navn(where: { CVREnhedsId: { eq: ${JSON.stringify(node["id"])} } }) {
      edges { node { vaerdi virkningTil } } } }`,
    apiKey,
  );
  const names =
    (navnData["CVR_Navn"] as { edges?: Array<{ node: Record<string, unknown> }> } | undefined)
      ?.edges ?? [];
  const current =
    names.find((edge) => edge.node["virkningTil"] === null) ?? names[names.length - 1];
  return {
    cvrNumber: String(node["CVRNummer"]),
    name: (current?.node["vaerdi"] as string | undefined) ?? `CVR ${cvrNumber}`,
    status: (node["status"] as string | null) ?? "ukendt",
  };
}

/** Er selskabet aktivt i CVR? Ukendt status tolkes aldrig som ophørt. */
export function isCvrStatusInactive(status: string): boolean {
  return /ophørt|opløst|konkurs|tvangsopløs|slettet|inaktiv|ceased|dissolved/i.test(status);
}

export interface CvrRegistryProfile {
  cvrNumber: string;
  status: string;
  /** Selskabets startdato i CVR (ISO). */
  startDate: string | null;
  endDate: string | null;
  industryCode: string | null;
  industryText: string | null;
  legalFormText: string | null;
  /** Kun postnummer, by og kommune: vej og husnummer kan være en privat bolig. */
  location: {
    postcode: string | null;
    city: string | null;
    municipality: string | null;
    countryCode: string | null;
  } | null;
  /** Delopslag, der fejlede (vises som note, resten bevares). */
  missingParts: string[];
}

type Edge = { node: Record<string, unknown> };

/** De gældende rækker (virkningTil er tom), ellers alle. */
function openEdges(edges: Edge[]): Edge[] {
  const open = edges.filter((edge) => edge.node["virkningTil"] == null);
  return open.length ? open : edges;
}

/** Den gældende række; ved flere den senest virkende. */
function currentEdge(edges: Edge[]): Record<string, unknown> | null {
  const sorted = [...openEdges(edges)].sort((a, b) =>
    String(a.node["virkningFra"] ?? "") < String(b.node["virkningFra"] ?? "") ? 1 : -1,
  );
  return sorted[0]?.node ?? null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function edgesOf(
  result: PromiseSettledResult<Record<string, unknown>>,
  key: string,
): Edge[] | null {
  if (result.status === "rejected") return null;
  return ((result.value[key] as { edges?: Edge[] } | undefined)?.edges ?? []) as Edge[];
}

/**
 * B2b: CVR-stamdata (branche, virksomhedsform, beliggenhed, start- og ophørsdato) fra
 * Datafordelerens CVR GraphQL. `null`, når nummeret ikke findes. Delopslagene køres
 * samtidig (API'et er langsomt), og et fejlet delopslag taber ikke de andre.
 */
export async function fetchCvrRegistryProfile(
  cvrNumber: string,
): Promise<CvrRegistryProfile | null> {
  const apiKey = process.env["DATAFORDELER_API_KEY"];
  if (!apiKey) throw new Error(msg("lookupNotConfigured"));
  if (!/^[0-9]{8}$/.test(cvrNumber)) return null;
  const virksomhed = await graphqlFetch(
    `query { CVR_Virksomhed(where: { CVRNummer: { eq: ${Number(cvrNumber)} } }) {
      edges { node { id CVRNummer status virksomhedStartdato virksomhedOphoersdato
        virkningFra virkningTil } } } }`,
    apiKey,
  );
  // Registret er bitemporalt: brug den gældende version, ikke en historisk.
  const node = currentEdge(
    (virksomhed["CVR_Virksomhed"] as { edges?: Edge[] } | undefined)?.edges ?? [],
  );
  if (!node) return null;
  const enhedsId = JSON.stringify(node["id"]);
  const [branche, form, adresse] = await Promise.allSettled([
    graphqlFetch(
      `query { CVR_Branche(where: { CVREnhedsId: { eq: ${enhedsId} } }) {
        edges { node { vaerdi vaerdiTekst sekvens virkningFra virkningTil } } } }`,
      apiKey,
    ),
    graphqlFetch(
      `query { CVR_Virksomhedsform(where: { CVREnhedsId: { eq: ${enhedsId} } }) {
        edges { node { vaerdi vaerdiTekst virkningFra virkningTil } } } }`,
      apiKey,
    ),
    graphqlFetch(
      `query { CVR_Adressering(where: { CVREnhedsId: { eq: ${enhedsId} } }) {
        edges { node { AdresseringAnvendelse CVRAdresse_postnummer CVRAdresse_postdistrikt
          CVRAdresse_kommunenavn CVRAdresse_landekode virkningFra virkningTil } } } }`,
      apiKey,
    ),
  ]);
  const missingParts: string[] = [];
  for (const [label, result] of [
    ["branche", branche],
    ["virksomhedsform", form],
    ["adresse", adresse],
  ] as const) {
    if (result.status === "rejected") {
      missingParts.push(label);
      console.warn(
        `[cvr-lookup] ${label} for CVR ${cvrNumber} failed`,
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
    }
  }
  // Hovedbranchen har laveste sekvens blandt de gældende rækker (bibrancher kommer efter).
  const industryEdges = openEdges(edgesOf(branche, "CVR_Branche") ?? []);
  const industry =
    [...industryEdges].sort(
      (a, b) => Number(a.node["sekvens"] ?? 0) - Number(b.node["sekvens"] ?? 0),
    )[0]?.node ?? null;
  const legalForm = currentEdge(edgesOf(form, "CVR_Virksomhedsform") ?? []);
  const addressEdges = edgesOf(adresse, "CVR_Adressering") ?? [];
  // Beliggenhedsadressen foretrækkes frem for postadressen.
  const located = addressEdges.filter((edge) =>
    /beliggenhed/i.test(String(edge.node["AdresseringAnvendelse"] ?? "")),
  );
  const address = currentEdge(located.length ? located : addressEdges);
  return {
    cvrNumber: String(node["CVRNummer"]),
    status: text(node["status"]) ?? "ukendt",
    startDate: text(node["virksomhedStartdato"]),
    endDate: text(node["virksomhedOphoersdato"]),
    industryCode: industry ? text(industry["vaerdi"]) : null,
    industryText: industry ? text(industry["vaerdiTekst"]) : null,
    legalFormText: legalForm ? text(legalForm["vaerdiTekst"]) : null,
    location: address
      ? {
          postcode: text(address["CVRAdresse_postnummer"]),
          city: text(address["CVRAdresse_postdistrikt"]),
          municipality: text(address["CVRAdresse_kommunenavn"]),
          countryCode: text(address["CVRAdresse_landekode"]),
        }
      : null,
    missingParts,
  };
}
