/**
 * Hjernekortets geometri: fra `BrainGraph` til det, kortet tegner. Rent og testet:
 * layout (klynger i en ring, hver klynge en solsikke-spiral med de mest forbundne i midten),
 * dybde-lag, naboer, vækst-tidslinje og søgning. Layoutet er deterministisk og O(n), så et stort
 * kort står stille og ens fra gang til gang, og 5.000 punkter tager få millisekunder. Koordinaterne
 * er enhedsrum (−1 … 1); kortet skalerer dem til lærredet.
 */
import type { BrainGraph } from "./graph.ts";

export interface MapLayout {
  /** Enhedsrum, −1 … 1 (cirka). */
  x: Float32Array;
  y: Float32Array;
  /** 0 forrest, 1 midt, 2 bagerst (størrelse, styrke og parallakse). */
  layer: Uint8Array;
  /** 0 … 1: hvornår punktet kommer med i "Afspil væksten". */
  growth: Float32Array;
  /** Klyngernes midte og radius i enhedsrum, til titler. */
  clusterCenters: Array<{ x: number; y: number; r: number; count: number }>;
  /** Første og sidste tidspunkt (epoch-sekunder) i grafen, eller null uden punkter. */
  range: { from: number; to: number } | null;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Et stabilt tal 0 … 1 pr. indeks, så layoutet ikke ændrer sig fra gang til gang. */
export function hash01(index: number, salt = 0): number {
  let h = (index * 374761393 + salt * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function layoutGraph(graph: BrainGraph): MapLayout {
  const n = graph.nodes.ids.length;
  const clusters = graph.clusters.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const layer = new Uint8Array(n);
  const growth = new Float32Array(n);

  const members: number[][] = Array.from({ length: clusters }, () => []);
  for (let i = 0; i < n; i += 1) members[graph.nodes.cluster[i]!]!.push(i);

  const clusterCenters: MapLayout["clusterCenters"] = [];
  for (let c = 0; c < clusters; c += 1) {
    const list = members[c]!;
    // De mest forbundne ligger i midten af klyngen.
    list.sort((a, b) => graph.nodes.degree[b]! - graph.nodes.degree[a]! || a - b);
    const angle = (c / clusters) * Math.PI * 2 - Math.PI / 2;
    const ringRadius = 0.62;
    const cx = Math.cos(angle) * ringRadius;
    const cy = Math.sin(angle) * ringRadius;
    const radius =
      n === 0 ? 0.1 : Math.min(0.34, Math.max(0.08, 0.42 * Math.sqrt(list.length / n)));
    clusterCenters.push({ x: cx, y: cy, r: radius, count: list.length });
    for (let rank = 0; rank < list.length; rank += 1) {
      const i = list[rank]!;
      const rho = radius * Math.sqrt((rank + 0.5) / list.length);
      const theta = rank * GOLDEN + hash01(i, 1) * 0.6;
      x[i] = cx + Math.cos(theta) * rho;
      y[i] = cy + Math.sin(theta) * rho;
    }
  }

  for (let i = 0; i < n; i += 1) {
    const r = hash01(i, 2);
    layer[i] = r < 0.4 ? 0 : r < 0.75 ? 1 : 2;
  }

  let from = Infinity;
  let to = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const t = graph.nodes.firstSeen[i]!;
    if (t < from) from = t;
    if (t > to) to = t;
  }
  const span = to - from;
  for (let i = 0; i < n; i += 1) {
    growth[i] = span > 0 ? (graph.nodes.firstSeen[i]! - from) / span : 0;
  }
  return { x, y, layer, growth, clusterCenters, range: n > 0 ? { from, to } : null };
}

export interface Adjacency {
  /** Naboer af punkt i: targets[offsets[i] … offsets[i + 1]). */
  offsets: Uint32Array;
  targets: Uint32Array;
}

export function buildAdjacency(graph: BrainGraph): Adjacency {
  const n = graph.nodes.ids.length;
  const m = graph.edges.src.length;
  const offsets = new Uint32Array(n + 1);
  for (let k = 0; k < m; k += 1) {
    offsets[graph.edges.src[k]! + 1]! += 1;
    offsets[graph.edges.dst[k]! + 1]! += 1;
  }
  for (let i = 0; i < n; i += 1) offsets[i + 1]! += offsets[i]!;
  const fill = offsets.slice(0, n);
  const targets = new Uint32Array(m * 2);
  for (let k = 0; k < m; k += 1) {
    const a = graph.edges.src[k]!;
    const b = graph.edges.dst[k]!;
    targets[fill[a]!++] = b;
    targets[fill[b]!++] = a;
  }
  return { offsets, targets };
}

/** Punkter, der matcher en søgning: begynder-med først, så mest forbundne. */
export function searchNodes(graph: BrainGraph, query: string, limit = 8): number[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const starts: number[] = [];
  const contains: number[] = [];
  for (let i = 0; i < graph.nodes.labels.length; i += 1) {
    const label = graph.nodes.labels[i]!.toLowerCase();
    const at = label.indexOf(q);
    if (at === 0) starts.push(i);
    else if (at > 0) contains.push(i);
  }
  const byDegree = (a: number, b: number) =>
    graph.nodes.degree[b]! - graph.nodes.degree[a]! || a - b;
  return [...starts.sort(byDegree), ...contains.sort(byDegree)].slice(0, limit);
}

/** Hvor mange punkter og forbindelser der er med ved et vækst-punkt 0 … 1. */
export function countAt(
  graph: BrainGraph,
  layout: MapLayout,
  at: number,
): { nodes: number; edges: number } {
  let nodes = 0;
  for (let i = 0; i < layout.growth.length; i += 1) if (layout.growth[i]! <= at) nodes += 1;
  let edges = 0;
  for (let k = 0; k < graph.edges.src.length; k += 1) {
    if (layout.growth[graph.edges.src[k]!]! <= at && layout.growth[graph.edges.dst[k]!]! <= at) {
      edges += 1;
    }
  }
  return { nodes, edges };
}

/** Datoen ved et vækst-punkt, "marts 2026". */
export function growthDate(layout: MapLayout, at: number, localeTag = "da-DK"): string {
  if (!layout.range) return "";
  const seconds = layout.range.from + (layout.range.to - layout.range.from) * at;
  return new Intl.DateTimeFormat(localeTag, { month: "long", year: "numeric" }).format(
    new Date(seconds * 1000),
  );
}
