/**
 * Geografi (Overblik v2): a port of the prototype's GeoMap.jsx. A choropleth in Natural Earth
 * (d3-geo through @visx/geo) on world-atlas, drawn in the "action" colour in steps by the
 * number of cases, with the hovered country in a dark pill. `focus` is "world" on the card and
 * "europe" on the sub-page; `onPick` gets the country's ISO 3166-1 alpha-2 code. The map data
 * is fetched only when the map is shown (world-atlas is a separate chunk). On the Overview card
 * the map stands alone and the count per country shows on hover; the svg's label
 * names every country and count for a screen reader.
 */
import { useEffect, useMemo, useState } from "react";
import { NaturalEarth } from "@visx/geo";
import { ParentSize } from "@visx/responsive";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { countryFill } from "@/lib/overview/map-colors";
import { countryName } from "@/lib/overview/meaning";
import { cn } from "@/lib/utils";

/** ISO 3166-1 alpha-2 → numeric id in world-atlas (the countries dealflow typically comes from). */
export const NUMERIC_ID: Record<string, string> = {
  DK: "208",
  SE: "752",
  NO: "578",
  FI: "246",
  IS: "352",
  DE: "276",
  NL: "528",
  BE: "056",
  GB: "826",
  IE: "372",
  FR: "250",
  ES: "724",
  PT: "620",
  IT: "380",
  CH: "756",
  AT: "040",
  PL: "616",
  CZ: "203",
  EE: "233",
  LV: "428",
  LT: "440",
  UA: "804",
  RO: "642",
  GR: "300",
  US: "840",
  CA: "124",
  MX: "484",
  BR: "076",
  AR: "032",
  IL: "376",
  AE: "784",
  IN: "356",
  CN: "156",
  JP: "392",
  KR: "410",
  SG: "702",
  AU: "036",
  NZ: "554",
  ZA: "710",
  TR: "792",
  HU: "348",
  SK: "703",
  SI: "705",
  HR: "191",
  BG: "100",
  RS: "688",
  LU: "442",
};
const ALPHA_BY_NUMERIC = new Map(Object.entries(NUMERIC_ID).map(([alpha, id]) => [id, alpha]));

/** The countries the prototype fits the Europe view to. */
const EUROPE_IDS = [
  "208",
  "752",
  "578",
  "246",
  "276",
  "826",
  "250",
  "528",
  "616",
  "724",
  "380",
  "352",
];

let worldPromise: Promise<Array<Feature<Geometry>>> | null = null;
export function loadWorld() {
  worldPromise ??= import("world-atlas/countries-110m.json").then((module) => {
    const topology = (module.default ?? module) as unknown as Topology<{
      countries: GeometryCollection;
    }>;
    const collection = feature(
      topology,
      topology.objects.countries,
    ) as unknown as FeatureCollection<Geometry>;
    // Antarctica takes room and says nothing.
    return collection.features.filter((item) => String(item.id) !== "010");
  });
  return worldPromise;
}

function useWorld() {
  const [world, setWorld] = useState<Array<Feature<Geometry>> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadWorld()
      .then((features) => {
        if (alive) setWorld(features);
      })
      .catch(() => {
        worldPromise = null;
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { world, failed };
}

export interface GeoCount {
  code: string;
  value: number;
}

export function GeoMap({
  data,
  focus = "world",
  height = 250,
  onPick,
}: {
  data: readonly GeoCount[];
  focus?: "world" | "europe";
  height?: number;
  onPick?: (code: string) => void;
}) {
  const { world, failed } = useWorld();
  const t = useT();
  const language = useLanguage();
  const [hover, setHover] = useState<string | null>(null);
  const byNumeric = useMemo(() => {
    const map = new Map<string, GeoCount>();
    for (const row of data) {
      const id = NUMERIC_ID[row.code];
      if (id) map.set(id, row);
    }
    return map;
  }, [data]);
  const max = Math.max(1, ...data.map((row) => row.value));
  const fitTo = useMemo<
    Feature<Geometry> | FeatureCollection<Geometry> | { type: "Sphere" } | null
  >(
    () =>
      !world
        ? null
        : focus === "europe"
          ? {
              type: "FeatureCollection",
              features: world.filter((item) => EUROPE_IDS.includes(String(item.id))),
            }
          : { type: "Sphere" },
    [world, focus],
  );
  const hovered = hover ? byNumeric.get(hover) : undefined;
  // Countries the map cannot draw (too small for the 110m atlas, not in it, or off a Europe view)
  // get a quiet line instead of silently disappearing.
  const others = useMemo(() => {
    if (!world) return [];
    const drawn = new Set(
      world
        .map((item) => String(item.id))
        .filter((id) => focus === "world" || EUROPE_IDS.includes(id)),
    );
    return data.filter((row) => {
      const id = NUMERIC_ID[row.code];
      return !id || !drawn.has(id);
    });
  }, [world, data, focus]);

  return (
    <div className="relative w-full overflow-hidden rounded-[16px]" style={{ height }}>
      {!world || !fitTo ? (
        <div
          className="absolute inset-0 grid place-items-center rounded-[16px] bg-sunken/50"
          role="status"
        >
          {failed ? (
            <span className="text-meta text-ink-3">{t("overview.map.loadFailed")}</span>
          ) : (
            <span className="sr-only">{t("overview.map.loading")}</span>
          )}
        </div>
      ) : (
        <ParentSize>
          {({ width }) =>
            width > 0 ? (
              <svg
                width={width}
                height={height}
                role="img"
                aria-label={t("overview.map.aria", {
                  list: data
                    .map((row) => `${countryName(row.code, language)} ${row.value}`)
                    .join(", "),
                })}
                className="block overflow-hidden"
              >
                <NaturalEarth<Feature<Geometry>>
                  data={world}
                  fitExtent={[
                    [
                      [8, 8],
                      [width - 8, height - 8],
                    ],
                    fitTo as never,
                  ]}
                >
                  {(projection) => (
                    <g>
                      {projection.features.map(({ feature: country, path }, index) => {
                        const id = String(country.id);
                        const row = byNumeric.get(id);
                        const pickable = Boolean(row && onPick);
                        return (
                          <path
                            key={`${id}-${index}`}
                            d={path ?? ""}
                            onMouseEnter={() => setHover(id)}
                            onMouseLeave={() => setHover(null)}
                            onClick={(event) => {
                              const code = ALPHA_BY_NUMERIC.get(id);
                              if (row && onPick && code) {
                                event.stopPropagation();
                                onPick(code);
                              }
                            }}
                            className={cn(
                              "transition-[fill,opacity] duration-200",
                              pickable && "cursor-pointer",
                            )}
                            style={{
                              fill: countryFill(row?.value ?? null, max),
                              stroke: "var(--bg-canvas)",
                              strokeWidth: 0.6,
                              opacity: hover && hover !== id && row ? 0.55 : 1,
                            }}
                          />
                        );
                      })}
                    </g>
                  )}
                </NaturalEarth>
              </svg>
            ) : null
          }
        </ParentSize>
      )}
      {others.length > 0 && (
        <div
          className="pointer-events-none absolute right-3 bottom-2 text-meta text-ink-3"
          title={others.map((row) => `${countryName(row.code, language)} ${row.value}`).join(", ")}
        >
          {t(others.length === 1 ? "overview.map.otherOne" : "overview.map.otherMany", {
            count: others.length,
          })}
        </div>
      )}
      {hovered && (
        <div className="pointer-events-none absolute top-3 left-3 rounded-[12px] bg-inverse px-3 py-2 text-[13px] whitespace-nowrap text-ink-inverse">
          <b className="font-semibold">{countryName(hovered.code, language)}</b>
          {"  "}
          {t(hovered.value === 1 ? "overview.meaning.casesOne" : "overview.meaning.casesMany", {
            count: hovered.value,
          })}
        </div>
      )}
    </div>
  );
}
