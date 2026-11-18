import assert from "node:assert/strict";
import { test } from "node:test";
import { GRAPH_CLUSTERS, shapeGraph } from "./graph.ts";
import {
  buildAdjacency,
  countAt,
  growthDate,
  hash01,
  layoutGraph,
  searchNodes,
} from "./graph-map.ts";

function sample(n: number, edges = n * 3) {
  const types = ["case", "note", "decision", "reason", "sector", "person", "company"];
  const raw = {
    nodes: {
      ids: Array.from({ length: n }, (_, i) => `id-${i}`),
      types: Array.from({ length: n }, (_, i) => types[i % types.length]!),
      labels: Array.from({ length: n }, (_, i) => `Punkt ${i}`),
      first_seen: Array.from({ length: n }, (_, i) => 1_700_000_000 + i * 86_400),
      decision: Array.from({ length: n }, () => null),
      ref: Array.from({ length: n }, () => null),
    },
    preds: ["rel"],
    edges: {
      src: Array.from({ length: edges }, (_, k) => k % n),
      dst: Array.from({ length: edges }, (_, k) => (k * 7 + 1) % n),
      pred: Array.from({ length: edges }, () => 0),
      proposed: Array.from({ length: edges }, () => false),
      recorded: Array.from({ length: edges }, () => 0),
    },
    truncated: false,
  };
  return shapeGraph(raw);
}

test("the layout is deterministic, inside the map and keeps clusters apart", () => {
  const graph = sample(700);
  const a = layoutGraph(graph);
  const b = layoutGraph(graph);
  assert.deepEqual(Array.from(a.x), Array.from(b.x));
  for (let i = 0; i < graph.nodes.ids.length; i += 1) {
    assert.ok(Math.abs(a.x[i]!) <= 1 && Math.abs(a.y[i]!) <= 1, `point ${i} is inside`);
  }
  assert.equal(a.clusterCenters.length, GRAPH_CLUSTERS.length);
  for (let i = 0; i < a.clusterCenters.length; i += 1) {
    for (let j = i + 1; j < a.clusterCenters.length; j += 1) {
      const d = Math.hypot(
        a.clusterCenters[i]!.x - a.clusterCenters[j]!.x,
        a.clusterCenters[i]!.y - a.clusterCenters[j]!.y,
      );
      assert.ok(d > 0.4, `clusters ${i} and ${j} are apart`);
    }
  }
});

test("5,000 points are laid out in a few milliseconds and spread over three layers", () => {
  const graph = sample(5000, 20000);
  const t0 = performance.now();
  const layout = layoutGraph(graph);
  const adjacency = buildAdjacency(graph);
  assert.ok(performance.now() - t0 < 400, "layout and neighbours are fast");
  const layers = [0, 0, 0];
  for (const l of layout.layer) layers[l]! += 1;
  assert.ok(
    layers.every((count) => count > 500),
    `all layers are used (${layers.join(",")})`,
  );
  assert.equal(adjacency.targets.length, 40000);
});

test("neighbours match the degrees", () => {
  const graph = sample(60, 150);
  const adjacency = buildAdjacency(graph);
  for (let i = 0; i < 60; i += 1) {
    assert.equal(adjacency.offsets[i + 1]! - adjacency.offsets[i]!, graph.nodes.degree[i]);
  }
});

test("growth runs from the first to the last point and counts what is shown", () => {
  const graph = sample(50, 100);
  const layout = layoutGraph(graph);
  assert.equal(layout.growth[0], 0);
  assert.equal(layout.growth[49], 1);
  assert.equal(countAt(graph, layout, 1).nodes, 50);
  assert.equal(countAt(graph, layout, 1).edges, 100);
  assert.ok(countAt(graph, layout, 0.5).nodes < 30);
  assert.match(growthDate(layout, 1), /\d{4}/);
});

test("an empty or one-day brain does not break the map", () => {
  const empty = layoutGraph(sample(0, 0));
  assert.equal(empty.range, null);
  assert.equal(growthDate(empty, 0.5), "");
  const same = shapeGraph({
    nodes: {
      ids: ["a", "b"],
      types: ["case", "case"],
      labels: ["A", "B"],
      first_seen: [5, 5],
      decision: [null, null],
      ref: [null, null],
    },
    preds: [],
    edges: { src: [], dst: [], pred: [], proposed: [], recorded: [] },
    truncated: false,
  });
  const layout = layoutGraph(same);
  assert.deepEqual(Array.from(layout.growth), [0, 0]);
});

test("search ranks names that start with the text before names that contain it", () => {
  const graph = sample(30, 60);
  graph.nodes.labels[3] = "Nordhav ApS";
  graph.nodes.labels[9] = "Havbrug Nord";
  graph.nodes.labels[12] = "Nordlys";
  const found = searchNodes(graph, "nord");
  assert.deepEqual(found.slice(0, 2).sort(), [12, 3].sort());
  assert.equal(found[2], 9);
  assert.deepEqual(searchNodes(graph, "n"), []);
  assert.equal(hash01(5), hash01(5));
});
