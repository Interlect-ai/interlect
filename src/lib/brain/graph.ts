/**
 * Hjernekortets data: the database's column arrays
 * (brain_graph_payload, 0074) checked and turned into what the map draws. Every type belongs to
 * a cluster (the prototype's groups, plus companies), and
 * every point gets its number of links. Pure, so it is tested without a database.
 */

import type { Language } from "../i18n/language.ts";
import { DICTIONARIES, translate, type MessageKey } from "../i18n/translate.ts";

export const GRAPH_CLUSTERS = [
  { key: "case", labelKey: "brainKnowledge.map.cluster.case" },
  { key: "note", labelKey: "brainKnowledge.map.cluster.note" },
  { key: "decision", labelKey: "brainKnowledge.map.cluster.decision" },
  { key: "pattern", labelKey: "brainKnowledge.map.cluster.pattern" },
  { key: "sector", labelKey: "brainKnowledge.map.cluster.sector" },
  { key: "person", labelKey: "brainKnowledge.map.cluster.person" },
  { key: "company", labelKey: "brainKnowledge.map.cluster.company" },
] as const satisfies ReadonlyArray<{ key: string; labelKey: MessageKey }>;

export type GraphClusterKey = (typeof GRAPH_CLUSTERS)[number]["key"];

/** Brain's entity types (0042) and the graph's own points (decisions, notes) per cluster. */
const CLUSTER_OF_TYPE: Record<string, GraphClusterKey> = {
  case: "case",
  note: "note",
  decision: "decision",
  reason: "pattern",
  theme: "pattern",
  sector: "sector",
  market: "sector",
  geography: "sector",
  stage: "sector",
  person: "person",
  company: "company",
  product: "company",
  investor: "company",
  fund_vehicle: "company",
};

export type GraphDecision = "invest" | "reject" | "decline_ic";

export interface BrainGraph {
  nodes: {
    ids: string[];
    types: string[];
    labels: string[];
    /** Index into GRAPH_CLUSTERS. */
    cluster: number[];
    /** Number of links (both directions). */
    degree: number[];
    /** Epoch seconds: when Brain first saw the point (the order of "Afspil væksten"). */
    firstSeen: number[];
    decision: Array<GraphDecision | null>;
    /** The case a point opens (a case or a note on it), else null. */
    ref: Array<string | null>;
  };
  edges: {
    src: number[];
    dst: number[];
    /** Index into `preds`. */
    pred: number[];
    /** Not confirmed (a proposal): drawn dashed. */
    proposed: boolean[];
    recorded: number[];
  };
  preds: string[];
  clusters: typeof GRAPH_CLUSTERS;
  truncated: boolean;
}

interface RawGraph {
  nodes: {
    ids: string[];
    types: string[];
    labels: string[];
    first_seen: number[];
    decision: Array<string | null>;
    ref: Array<string | null>;
  };
  preds: string[];
  edges: {
    src: number[];
    dst: number[];
    pred: number[];
    proposed: boolean[];
    recorded: number[];
  };
  truncated: boolean;
}

const DECISIONS = new Set<string>(["invest", "reject", "decline_ic"]);
const OTHER_CLUSTER = GRAPH_CLUSTERS.findIndex((cluster) => cluster.key === "company");

function fail(reason: string): never {
  throw new Error(`brain_graph_payload: ${reason}`);
}

function arrayOf(value: unknown, length: number | null, name: string): unknown[] {
  if (!Array.isArray(value)) fail(`${name} is not an array`);
  if (length !== null && value.length !== length) fail(`${name} has the wrong length`);
  return value;
}

/** Checks the database's answer (lengths and indexes) and adds clusters and degrees. */
export function shapeGraph(raw: unknown): BrainGraph {
  const graph = raw as Partial<RawGraph> | null;
  if (!graph || typeof graph !== "object" || !graph.nodes || !graph.edges) fail("no graph");
  const ids = arrayOf(graph.nodes.ids, null, "ids") as string[];
  const n = ids.length;
  if (new Set(ids).size !== n) fail("a point id comes twice");
  const types = arrayOf(graph.nodes.types, n, "types") as string[];
  const labels = arrayOf(graph.nodes.labels, n, "labels") as string[];
  const firstSeen = arrayOf(graph.nodes.first_seen, n, "first_seen") as number[];
  const decision = arrayOf(graph.nodes.decision, n, "decision") as Array<string | null>;
  const ref = arrayOf(graph.nodes.ref, n, "ref") as Array<string | null>;
  const preds = arrayOf(graph.preds, null, "preds") as string[];
  const src = arrayOf(graph.edges.src, null, "src") as number[];
  const m = src.length;
  const dst = arrayOf(graph.edges.dst, m, "dst") as number[];
  const pred = arrayOf(graph.edges.pred, m, "pred") as number[];
  const proposed = arrayOf(graph.edges.proposed, m, "proposed") as boolean[];
  const recorded = arrayOf(graph.edges.recorded, m, "recorded") as number[];

  const degree = new Array<number>(n).fill(0);
  for (let k = 0; k < m; k += 1) {
    const a = src[k]!;
    const b = dst[k]!;
    const p = pred[k]!;
    if (!(a >= 0 && a < n && b >= 0 && b < n && p >= 0 && p < preds.length)) {
      fail("an edge points outside the graph");
    }
    degree[a]! += 1;
    degree[b]! += 1;
  }
  const clusterIndex = new Map<string, number>(
    GRAPH_CLUSTERS.map((cluster, index) => [cluster.key, index]),
  );
  return {
    nodes: {
      ids,
      types,
      labels,
      cluster: types.map((type) => {
        const key = CLUSTER_OF_TYPE[type];
        return key ? clusterIndex.get(key)! : OTHER_CLUSTER;
      }),
      degree,
      firstSeen,
      decision: decision.map((value) =>
        value && DECISIONS.has(value) ? (value as GraphDecision) : null,
      ),
      ref,
    },
    edges: { src, dst, pred, proposed, recorded },
    preds,
    clusters: GRAPH_CLUSTERS,
    truncated: graph.truncated === true,
  };
}

const DECISION_LABEL_KEYS: Record<GraphDecision, MessageKey> = {
  invest: "brainKnowledge.lessons.decision.invest",
  reject: "brainKnowledge.lessons.decision.reject",
  decline_ic: "brainKnowledge.lessons.decision.decline_ic",
};
/** The date the database writes on a decision's and a note's point (DD.MM.YYYY, 0074). */
const POINT_DATE = /(\d{2})\.(\d{2})\.(\d{4})$/;

function pointDate(match: RegExpExecArray, language: Language): string {
  if (language === "da") return match[0];
  const [, day, month, year] = match;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

/** A stage as the rest of the product writes it: "Series C", never "series_c". */
export function stageText(stage: string, language: Language): string {
  const key = stage.trim().toLowerCase();
  const names = DICTIONARIES[language].basis.stage as Readonly<Record<string, string>>;
  if (Object.hasOwn(names, key)) return names[key]!;
  const series = /^series[_\s-]?([a-z])$/.exec(key);
  if (series) return `Series ${series[1]!.toUpperCase()}`;
  const words = stage.replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The map's labels in the team's language. The database writes a decision's point in
 * Danish ("Investeret 15.10.2026", 0074) and a stage as Brain stored it ("series_c"); the English
 * demo team saw both. Decisions are named from their kind, the date is written the language's
 * way, and a stage is written as in the rest of the product.
 */
export function localizeGraphLabels(graph: BrainGraph, language: Language): BrainGraph {
  const labels = graph.nodes.labels.map((label, index) => {
    const type = graph.nodes.types[index];
    if (type === "decision") {
      const kind = graph.nodes.decision[index];
      if (!kind) return label;
      const date = POINT_DATE.exec(label);
      const name = translate(language, DECISION_LABEL_KEYS[kind]);
      return date ? `${name} ${pointDate(date, language)}` : name;
    }
    if (type === "note") {
      const date = POINT_DATE.exec(label);
      return date ? `${label.slice(0, date.index)}${pointDate(date, language)}` : label;
    }
    if (type === "stage") return stageText(label, language);
    return label;
  });
  return { ...graph, nodes: { ...graph.nodes, labels } };
}
