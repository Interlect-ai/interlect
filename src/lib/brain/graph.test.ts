/** The map's data from brain_graph_payload (lengths, indexes, clusters, degrees). Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import { GRAPH_CLUSTERS, localizeGraphLabels, shapeGraph, stageText } from "./graph.ts";

function raw(nodes: number, edges: number) {
  const types = ["case", "company", "person", "sector", "reason", "decision", "note", "theme"];
  return {
    nodes: {
      ids: Array.from({ length: nodes }, (_, i) => `id-${i}`),
      types: Array.from({ length: nodes }, (_, i) => types[i % types.length]!),
      labels: Array.from({ length: nodes }, (_, i) => `Punkt ${i}`),
      first_seen: Array.from({ length: nodes }, (_, i) => 1_700_000_000 + i),
      decision: Array.from({ length: nodes }, (_, i) =>
        i === 0 ? "invest" : i === 1 ? "hmm" : null,
      ),
      ref: Array.from({ length: nodes }, () => null),
    },
    preds: ["decided", "similar_to"],
    edges: {
      src: Array.from({ length: edges }, (_, k) => k % nodes),
      dst: Array.from({ length: edges }, (_, k) => (k * 7 + 1) % nodes),
      pred: Array.from({ length: edges }, (_, k) => k % 2),
      proposed: Array.from({ length: edges }, (_, k) => k % 10 === 0),
      recorded: Array.from({ length: edges }, () => 1_700_000_000),
    },
    truncated: false,
  };
}

test("5.000 points and 20.000 links are shaped quickly, with degrees and clusters", () => {
  const started = performance.now();
  const graph = shapeGraph(raw(5_000, 20_000));
  assert.ok(performance.now() - started < 500);
  assert.equal(graph.nodes.ids.length, 5_000);
  assert.equal(graph.edges.src.length, 20_000);
  assert.equal(
    graph.nodes.degree.reduce((sum, d) => sum + d, 0),
    40_000,
    "every link counts at both ends",
  );
  const key = (i: number) => GRAPH_CLUSTERS[graph.nodes.cluster[i]!]!.key;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(key), [
    "case",
    "company",
    "person",
    "sector",
    "pattern",
    "decision",
    "note",
    "pattern",
  ]);
  assert.equal(graph.nodes.decision[0], "invest");
  assert.equal(graph.nodes.decision[1], null, "an unknown decision word is dropped");
});

test("an empty fund gives an empty graph", () => {
  const graph = shapeGraph(raw(0, 0));
  assert.equal(graph.nodes.ids.length, 0);
  assert.equal(graph.edges.src.length, 0);
});

test("a broken answer is refused, never drawn half", () => {
  const short = raw(3, 2);
  short.nodes.labels.pop();
  assert.throws(() => shapeGraph(short), /labels has the wrong length/);
  const outside = raw(3, 2);
  outside.edges.dst[0] = 3;
  assert.throws(() => shapeGraph(outside), /outside the graph/);
  const badPred = raw(3, 2);
  badPred.edges.pred[1] = 2;
  assert.throws(() => shapeGraph(badPred), /outside the graph/);
  assert.throws(() => shapeGraph(null), /no graph/);
  const twice = raw(3, 2);
  twice.nodes.ids[2] = "id-0";
  assert.throws(() => shapeGraph(twice), /comes twice/);
});

test("the map's labels follow the team's language (T-898)", () => {
  const graph = shapeGraph({
    nodes: {
      ids: ["d", "n", "s", "s2", "c"],
      types: ["decision", "note", "stage", "stage", "company"],
      labels: ["Investeret 15.10.2026", "Note 03.10.2026", "series_c", "series_a", "Veo"],
      first_seen: [1, 2, 3, 4, 5],
      decision: ["invest", null, null, null, null],
      ref: [null, null, null, null, null],
    },
    preds: [],
    edges: { src: [], dst: [], pred: [], proposed: [], recorded: [] },
    truncated: false,
  });
  assert.deepEqual(localizeGraphLabels(graph, "en").nodes.labels, [
    "Invested 15 Oct 2026",
    "Note 3 Oct 2026",
    "Series C",
    "Series A",
    "Veo",
  ]);
  assert.deepEqual(localizeGraphLabels(graph, "da").nodes.labels, [
    "Investeret 15.10.2026",
    "Note 03.10.2026",
    "Series C",
    "Series A",
    "Veo",
  ]);
  assert.equal(stageText("pre_seed", "en"), "Pre-seed");
  assert.equal(stageText("growth", "da"), "Vækst");
  assert.equal(stageText("bridge_round", "en"), "Bridge round");
});
