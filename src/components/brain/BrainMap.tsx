/**
 * Hjernekortet ("Hjernen" i Interlect Brain): hele fondens hjerne som et levende netværk,
 * porteret fra prototypen `BrainGraph.jsx` (mørkt lærred, klynger med faste farver, svag drift,
 * hover med navn og antal koblinger, tidslinje med "Afspil væksten") og bygget på de rigtige data
 * (`getBrainGraph`). Ud over prototypen: 2D-lærred med tre dybdelag (mindre og svagere
 * punkter bagerst, let parallakse), søgning, klik der fremhæver et punkt og dets naboer, zoom og
 * træk, klyngetitler, tom tilstand for en ny fond og "Vis som liste" til tastatur og skærmlæser.
 * Tegner kun det synlige, grupperer kanter og punkter pr. farve (få tegnekald) og holder
 * 30 FPS ved 5.000 punkter. Geometrien ligger i `src/lib/brain/graph-map.ts` (testet).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, List, Maximize2, Minus, Pause, Play, Plus, Search, X } from "lucide-react";
import { PendingLabel } from "@/components/ai/AiOrb";
import { Button } from "@/components/ds/Button";
import { ErrorState } from "@/components/ds/States";
import { BrainCardDialog, type CardSource } from "@/components/brain/BrainCard";
import { getBrainGraph } from "@/lib/brain/graph.functions";
import type { BrainGraph, GraphDecision } from "@/lib/brain/graph";
import {
  buildAdjacency,
  countAt,
  growthDate,
  layoutGraph,
  searchNodes,
  type Adjacency,
  type MapLayout,
} from "@/lib/brain/graph-map";
import { useLocaleTag, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

/** Prototypens farver pr. klynge (faste, også i lyst tema: kortet har sit eget mørke lærred). */
const CLUSTER_COLORS = [
  "#7C8CFF", // Cases
  "#F5B84B", // Noter
  "#FF6B4A", // Beslutninger
  "#FF5C9A", // Mønstre
  "#4FD1A5", // Sektorer og marked
  "#6FC3FF", // Founders og teams
  "#B9A8FF", // Selskaber
] as const;
const DECISION_COLORS: Record<GraphDecision, string> = {
  invest: "#4FD1A5",
  reject: "#9A98A8",
  decline_ic: "#9A98A8",
};
const LAYER = [
  { size: 1, alpha: 1, parallax: 1 },
  { size: 0.8, alpha: 0.8, parallax: 0.6 },
  { size: 0.6, alpha: 0.55, parallax: 0.3 },
] as const;
const PLAY_SECONDS = 6;
const FADE_PER_SECOND = 1 / 0.6;

function nodeColor(graph: BrainGraph, i: number): string {
  const decision = graph.nodes.decision[i];
  return decision ? DECISION_COLORS[decision] : CLUSTER_COLORS[graph.nodes.cluster[i]!]!;
}

interface View {
  /** Kortet strækkes i bredden på et bredt lærred (sættes af lærredet). */
  ax?: number;
  zoom: number;
  panX: number;
  panY: number;
}

export function BrainMap({ fundId, onBack }: { fundId: string; onBack: () => void }) {
  const t = useT();
  const fetchGraph = useServerFn(getBrainGraph);
  const query = useQuery({
    queryKey: ["brain-graph", fundId],
    queryFn: () => fetchGraph({ data: { fundId } }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (query.isLoading) {
    return (
      <Frame onBack={onBack}>
        <div className="grid flex-1 place-items-center text-list text-ink-3">
          <PendingLabel tone="ai">{t("brainKnowledge.map.loading")}</PendingLabel>
        </div>
      </Frame>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Frame onBack={onBack}>
        <ErrorState
          title={t("brainKnowledge.map.errorTitle")}
          body={t("brainKnowledge.map.errorBody")}
          onRetry={() => void query.refetch()}
        />
      </Frame>
    );
  }
  return (
    <Frame onBack={onBack}>
      <MapView graph={query.data} fundId={fundId} />
    </Frame>
  );
}

function Frame({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex h-[calc(100svh-96px)] min-h-[520px] min-w-0 flex-col gap-3 px-5 pb-4 md:h-full">
      <header className="flex shrink-0 items-center gap-3 py-3.5">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("brainKnowledge.map.backLabel")}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-pill border-0 bg-sunken px-3 text-meta font-medium text-ink-2 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-action"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("brainKnowledge.map.back")}
        </button>
        <h1 className="m-0 text-[15px] font-semibold">{t("brainKnowledge.map.title")}</h1>
      </header>
      {children}
    </div>
  );
}

function MapView({ graph, fundId }: { graph: BrainGraph; fundId: string }) {
  const t = useT();
  const localeTag = useLocaleTag();
  const [who, setWho] = useState<CardSource | null>(null);
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);
  const n = graph.nodes.ids.length;
  const [growth, setGrowth] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [list, setList] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [search, setSearch] = useState("");
  const counts = useMemo(() => countAt(graph, layout, growth), [graph, layout, growth]);
  const results = useMemo(() => searchNodes(graph, search), [graph, search]);

  const state = useRef({
    growth: 1,
    selected: null as number | null,
    hover: null as number | null,
  });
  state.current.growth = growth;
  state.current.selected = selected;
  state.current.hover = hover?.i ?? null;
  const view = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const target = useRef<View | null>(null);
  const dirty = useRef(true);
  const playRef = useRef({ playing: false, last: 0 });
  // Stabil, så lærredet ikke bygges forfra, hver gang tidslinjen opdaterer siden.
  const selectPoint = useCallback((i: number | null) => {
    setSelected(i);
    dirty.current = true;
  }, []);

  const focusOn = useCallback(
    (i: number) => {
      setSelected(i);
      target.current = {
        zoom: 2.2,
        panX: -layout.x[i]! * (view.current.ax ?? 1),
        panY: -layout.y[i]!,
      };
      dirty.current = true;
    },
    [layout, view],
  );

  // Afspil væksten: ca. 6 sekunder fra start (eller fra nu).
  useEffect(() => {
    playRef.current.playing = playing;
    if (!playing) return;
    let raf = 0;
    playRef.current.last = performance.now();
    const step = (now: number) => {
      const dt = (now - playRef.current.last) / 1000;
      playRef.current.last = now;
      let next = state.current.growth + dt / PLAY_SECONDS;
      if (next >= 1) {
        next = 1;
        setPlaying(false);
      }
      state.current.growth = next;
      setGrowth(next);
      if (next < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (growth >= 1) {
      state.current.growth = 0;
      setGrowth(0);
    }
    setPlaying(true);
  };

  const empty = n < 3;
  // En ny fond: få punkter, der vokser. Kortet vises alligevel, med en venlig forklaring.
  const young = n < 25;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative min-h-[260px] flex-1">
        <MapCanvas
          graph={graph}
          layout={layout}
          adjacency={adjacency}
          state={state}
          view={view}
          target={target}
          dirty={dirty}
          onHover={setHover}
          onSelect={selectPoint}
        />
        <div className="pointer-events-none absolute top-3 left-3.5 flex flex-col gap-0.5">
          <span className="text-[22px] font-semibold tracking-[var(--track-title)] text-white">
            {t("brainKnowledge.map.pointsAndLinks", {
              points: counts.nodes.toLocaleString(localeTag),
              links: counts.edges.toLocaleString(localeTag),
            })}
          </span>
          <span className="text-meta text-white/60">
            {graph.truncated ? t("brainKnowledge.map.truncated") : t("brainKnowledge.map.current")}
          </span>
        </div>

        <div className="absolute top-3 right-3 flex w-[min(280px,60%)] flex-col gap-1.5">
          <label className="flex h-9 items-center gap-2 rounded-pill bg-white/10 px-3 text-white backdrop-blur-md">
            <Search className="size-3.5 shrink-0 text-white/60" aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t("brainKnowledge.map.searchLabel")}
              placeholder={t("brainKnowledge.map.searchPlaceholder")}
              className="min-w-0 flex-1 border-0 bg-transparent text-meta text-white outline-none placeholder:text-white/50"
            />
            {search && (
              <button
                type="button"
                aria-label={t("brainKnowledge.map.clearSearch")}
                onClick={() => setSearch("")}
                className="grid size-5 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-white/60 hover:text-white"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </label>
          {results.length > 0 && (
            <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[14px] bg-white/95 p-1 text-[#17151c] shadow-overlay">
              {results.map((i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      focusOn(i);
                      setSearch("");
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] border-0 bg-transparent px-2.5 py-1.5 text-left text-meta hover:bg-black/5"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: nodeColor(graph, i) }}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {graph.nodes.labels[i]}
                    </span>
                    <span className="shrink-0 text-micro text-[#6b6875]">
                      {t(graph.clusters[graph.nodes.cluster[i]!]!.labelKey)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="absolute bottom-3 left-3 flex flex-col gap-1">
          {[
            {
              label: t("brainKnowledge.map.zoomIn"),
              icon: Plus,
              on: () => zoomBy(view, dirty, 1.35),
            },
            {
              label: t("brainKnowledge.map.zoomOut"),
              icon: Minus,
              on: () => zoomBy(view, dirty, 1 / 1.35),
            },
            {
              label: t("brainKnowledge.map.fitAll"),
              icon: Maximize2,
              on: () => {
                target.current = { zoom: 1, panX: 0, panY: 0 };
                dirty.current = true;
              },
            },
          ].map((control) => (
            <button
              key={control.label}
              type="button"
              aria-label={control.label}
              onClick={control.on}
              className="grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-white/10 text-white outline-none backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <control.icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>

        {hover && hover.i !== selected && (
          <div
            className="pointer-events-none absolute rounded-[12px] bg-white/95 px-3 py-2 text-[13px] whitespace-nowrap text-[#17151c] shadow-overlay"
            style={{ left: hover.x + 14, top: hover.y + 14 }}
          >
            <div className="font-semibold">{graph.nodes.labels[hover.i]}</div>
            <div className="flex items-center gap-1.5 text-[12px] text-[#6b6875]">
              <span
                className="size-[7px] rounded-full"
                style={{ background: nodeColor(graph, hover.i) }}
              />
              {t("brainKnowledge.map.clusterLinks", {
                cluster: t(graph.clusters[graph.nodes.cluster[hover.i]!]!.labelKey),
                count: graph.nodes.degree[hover.i]!,
              })}
            </div>
          </div>
        )}

        {selected !== null && (
          <SelectedCard
            graph={graph}
            adjacency={adjacency}
            index={selected}
            onClose={() => {
              setSelected(null);
              dirty.current = true;
            }}
            onPick={focusOn}
            onWho={(entityId) => setWho({ entityId })}
          />
        )}
        <BrainCardDialog fundId={fundId} source={who} onClose={() => setWho(null)} />

        {young && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6">
            <p className="m-0 max-w-[420px] rounded-[14px] bg-white/10 px-4 py-3 text-center text-list text-white/80 backdrop-blur-md">
              {t("brainKnowledge.map.young")}
            </p>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5">
        {graph.clusters.map((cluster, index) => (
          <span key={cluster.key} className="flex items-center gap-1.5 text-meta text-ink-2">
            <span
              className="size-2 rounded-full"
              style={{ background: CLUSTER_COLORS[index] }}
              aria-hidden
            />
            {t(cluster.labelKey)}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setList((v) => !v)}
          aria-pressed={list}
          className="ml-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill border-0 bg-sunken px-2.5 text-meta font-medium text-ink-2 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-action"
        >
          <List className="size-3.5" aria-hidden />
          {t("brainKnowledge.map.showAsList")}
        </button>
      </div>

      {list && (
        <NodeList
          graph={graph}
          onPick={(i) => {
            setList(false);
            focusOn(i);
          }}
        />
      )}

      <div className="flex shrink-0 flex-col gap-2 rounded-[16px] bg-canvas px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <Button
            variant="primary"
            size="sm"
            onClick={togglePlay}
            disabled={empty}
            aria-label={playing ? t("brainKnowledge.map.stopPlay") : t("brainKnowledge.map.play")}
            className="!size-8 !p-0"
          >
            {playing ? (
              <Pause className="size-3.5" aria-hidden />
            ) : (
              <Play className="size-3.5" aria-hidden />
            )}
          </Button>
          <span className="text-list font-medium">{t("brainKnowledge.map.growthTitle")}</span>
          <div className="flex-1" />
          <span className="text-meta text-ink-3 tabular-nums">
            {growthDate(layout, growth, localeTag)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(growth * 100)}
          disabled={empty}
          aria-label={t("brainKnowledge.map.timeline")}
          onChange={(event) => {
            setPlaying(false);
            setGrowth(Number(event.target.value) / 100);
          }}
          className="w-full accent-[var(--ai)]"
        />
        <div className="flex justify-between text-micro text-ink-4">
          <span>{layout.range ? growthDate(layout, 0, localeTag) : ""}</span>
          <span>{t("brainKnowledge.map.today")}</span>
        </div>
      </div>
    </div>
  );
}

function zoomBy(
  view: React.MutableRefObject<View>,
  dirty: React.MutableRefObject<boolean>,
  f: number,
) {
  view.current.zoom = Math.max(0.5, Math.min(6, view.current.zoom * f));
  dirty.current = true;
}

function SelectedCard({
  graph,
  adjacency,
  index,
  onClose,
  onPick,
  onWho,
}: {
  graph: BrainGraph;
  adjacency: Adjacency;
  index: number;
  onClose: () => void;
  onPick: (i: number) => void;
  /** Opens "Hvem var det nu lige?" for a company or a person point. */
  onWho: (entityId: string) => void;
}) {
  const t = useT();
  const type = graph.nodes.types[index];
  const who = type === "company" || type === "person" ? graph.nodes.ids[index]! : null;
  const unique = new Set<number>();
  for (let k = adjacency.offsets[index]!; k < adjacency.offsets[index + 1]!; k += 1) {
    unique.add(adjacency.targets[k]!);
  }
  const neighbours = [...unique];
  neighbours.sort((a, b) => graph.nodes.degree[b]! - graph.nodes.degree[a]!);
  const ref = graph.nodes.ref[index];
  return (
    <aside
      aria-label={t("brainKnowledge.map.selected")}
      className="absolute right-3 bottom-3 flex max-h-[60%] w-[min(300px,70%)] flex-col gap-2 overflow-auto rounded-[16px] bg-white/95 p-3.5 text-[#17151c] shadow-overlay"
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1.5 size-2 shrink-0 rounded-full"
          style={{ background: nodeColor(graph, index) }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold break-words">{graph.nodes.labels[index]}</div>
          <div className="text-meta text-[#6b6875]">
            {t("brainKnowledge.map.clusterLinks", {
              cluster: t(graph.clusters[graph.nodes.cluster[index]!]!.labelKey),
              count: graph.nodes.degree[index]!,
            })}
          </div>
        </div>
        <button
          type="button"
          aria-label={t("brainKnowledge.map.close")}
          onClick={onClose}
          className="grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-[#6b6875] hover:bg-black/5"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {who && (
        <button
          type="button"
          onClick={() => onWho(who)}
          className="inline-flex h-8 cursor-pointer items-center justify-center rounded-pill border-0 bg-[#17151c] px-3 text-meta font-medium text-white"
        >
          {t("brainKnowledge.card.title")}
        </button>
      )}
      {ref && (
        <Link
          to="/cases/$caseId"
          params={{ caseId: ref }}
          search={{ view: "screening" }}
          className="inline-flex h-8 items-center justify-center rounded-pill bg-[#17151c] px-3 text-meta font-medium text-white no-underline"
        >
          {t("brainKnowledge.map.openCase")}
        </Link>
      )}
      {neighbours.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-micro font-semibold text-[#6b6875]">
            {t("brainKnowledge.map.neighbours", { count: neighbours.length })}
          </span>
          {neighbours.slice(0, 8).map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPick(i)}
              className="flex cursor-pointer items-center gap-2 rounded-[8px] border-0 bg-transparent px-1.5 py-1 text-left text-meta hover:bg-black/5"
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: nodeColor(graph, i) }}
              />
              <span className="min-w-0 flex-1 truncate">{graph.nodes.labels[i]}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function NodeList({ graph, onPick }: { graph: BrainGraph; onPick: (i: number) => void }) {
  const t = useT();
  const order = useMemo(
    () =>
      graph.nodes.ids
        .map((_, i) => i)
        .sort((a, b) => graph.nodes.degree[b]! - graph.nodes.degree[a]! || a - b)
        .slice(0, 200),
    [graph],
  );
  return (
    <div className="max-h-56 shrink-0 overflow-auto rounded-[16px] bg-canvas">
      <table className="w-full text-left text-list">
        <caption className="sr-only">{t("brainKnowledge.map.listCaption")}</caption>
        <thead className="sticky top-0 bg-canvas text-meta text-ink-3">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              {t("brainKnowledge.map.colPoint")}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {t("brainKnowledge.map.colType")}
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              {t("brainKnowledge.map.colLinks")}
            </th>
          </tr>
        </thead>
        <tbody>
          {order.map((i) => (
            <tr key={i} className="border-t border-line">
              <td className="px-4 py-1.5">
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  className="cursor-pointer border-0 bg-transparent p-0 text-left text-ink-1 underline-offset-2 hover:underline"
                >
                  {graph.nodes.labels[i]}
                </button>
              </td>
              <td className="px-4 py-1.5 text-ink-3">
                {t(graph.clusters[graph.nodes.cluster[i]!]!.labelKey)}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums">{graph.nodes.degree[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Lærredet ────────────────────────────────────────────────────────────────────────────────

function MapCanvas({
  graph,
  layout,
  adjacency,
  state,
  view,
  target,
  dirty,
  onHover,
  onSelect,
}: {
  graph: BrainGraph;
  layout: MapLayout;
  adjacency: Adjacency;
  state: React.MutableRefObject<{ growth: number; selected: number | null; hover: number | null }>;
  view: React.MutableRefObject<View>;
  target: React.MutableRefObject<View | null>;
  dirty: React.MutableRefObject<boolean>;
  onHover: (hover: { i: number; x: number; y: number } | null) => void;
  onSelect: (i: number | null) => void;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({
    x: 0,
    y: 0,
    inside: false,
    dragging: false,
    moved: 0,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    const el = canvas.current;
    const host = box.current;
    if (!el || !host) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const n = graph.nodes.ids.length;
    const m = graph.edges.src.length;
    const clusterTitles = graph.clusters.map((cluster) => t(cluster.labelKey).toUpperCase());
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const shown = new Float32Array(n);
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i += 1) phase[i] = (((i * 2654435761) >>> 0) / 4294967296) * Math.PI * 2;
    // De mest forbundne punkter får titel og glød.
    const hubs = graph.nodes.ids
      .map((_, i) => i)
      .sort((a, b) => graph.nodes.degree[b]! - graph.nodes.degree[a]!)
      .slice(0, 50);
    const hubSet = new Set(hubs);
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      w = host.clientWidth;
      h = host.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      cache.width = el.width;
      cache.height = el.height;
      dirty.current = true;
    };
    // Kanterne tegnes på et lag, der kun tegnes om, når kortet, valget eller tidslinjen ændrer sig:
    // 20.000 streger hvert billede er for tungt, og driften (±2 px) ses ikke på tynde kanter.
    const cache = document.createElement("canvas");
    const cacheCtx = cache.getContext("2d");
    let cacheKey = "";
    let lastDraw = 0;
    const bx = new Float32Array(n);
    const by = new Float32Array(n);
    const observer = new ResizeObserver(() => {
      resize();
      cacheKey = "";
    });
    observer.observe(host);
    resize();

    let raf = 0;
    let last = performance.now();
    const edgeColors = graph.edges.src.map((s) => CLUSTER_COLORS[graph.nodes.cluster[s]!]!);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = state.current;
      const v = view.current;
      // Glid mod et mål (søgning, "vis hele hjernen") med blød fjeder.
      const tg = target.current;
      if (tg) {
        const k = 1 - Math.exp(-dt * 7);
        v.zoom += (tg.zoom - v.zoom) * k;
        v.panX += (tg.panX - v.panX) * k;
        v.panY += (tg.panY - v.panY) * k;
        dirty.current = true;
        if (
          Math.abs(tg.zoom - v.zoom) < 0.002 &&
          Math.abs(tg.panX - v.panX) < 0.001 &&
          Math.abs(tg.panY - v.panY) < 0.001
        ) {
          v.zoom = tg.zoom;
          v.panX = tg.panX;
          v.panY = tg.panY;
          target.current = null;
        }
      }
      // Punkter tones ind og ud efter tidslinjen.
      let fading = false;
      for (let i = 0; i < n; i += 1) {
        const want = layout.growth[i]! <= st.growth ? 1 : 0;
        const cur = shown[i]!;
        if (cur !== want) {
          const next = want
            ? Math.min(1, cur + dt * FADE_PER_SECOND)
            : Math.max(0, cur - dt * FADE_PER_SECOND * 2);
          shown[i] = next;
          fading = true;
        }
      }
      // Højst ca. 30 tegninger i sekundet, medmindre brugeren rører kortet: det holder siden let.
      if (!dirty.current && !fading && (reduced || now - lastDraw < 33)) return;
      lastDraw = now;
      dirty.current = false;

      const scale = (Math.min(w, h) / 2) * 0.9 * v.zoom;
      const ax = Math.min(2.1, Math.max(1, w / h));
      v.ax = ax;
      const cx = w / 2 + v.panX * scale;
      const cy = h / 2 + v.panY * scale;
      const t = now / 1000;
      const px = pointer.current.inside ? (pointer.current.x - w / 2) / w : 0;
      const py = pointer.current.inside ? (pointer.current.y - h / 2) / h : 0;
      for (let i = 0; i < n; i += 1) {
        if (shown[i]! <= 0) continue;
        const L = LAYER[layout.layer[i]!]!;
        const drift = reduced ? 0 : 2 * L.parallax;
        bx[i] = cx + layout.x[i]! * scale * ax;
        by[i] = cy + layout.y[i]! * scale;
        sx[i] = bx[i]! - px * 4 * L.parallax + Math.cos(t * 0.5 + phase[i]!) * drift;
        sy[i] = by[i]! - py * 4 * L.parallax + Math.sin(t * 0.6 + phase[i]!) * drift;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const focus = st.selected ?? st.hover;
      const near = new Set<number>();
      if (focus !== null) {
        near.add(focus);
        for (let k = adjacency.offsets[focus]!; k < adjacency.offsets[focus + 1]!; k += 1)
          near.add(adjacency.targets[k]!);
      }
      // Kun et klik dæmper resten (og tegner kantlaget om); hover fremhæver uden at koste et nyt lag.
      const pinned = st.selected;
      const dim = pinned !== null ? 0.3 : 1;

      // Kanter: ét lag, tegnet om kun når noget ændrer sig (se `cache`), og de fremhævede for sig.
      const key = `${w}x${h}|${v.zoom.toFixed(3)}|${v.panX.toFixed(3)}|${v.panY.toFixed(3)}|${pinned ?? -1}|${Math.round(st.growth * 200)}|${fading ? Math.floor(now / 100) : 0}`;
      if (key !== cacheKey && cacheCtx) {
        cacheKey = key;
        cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cacheCtx.clearRect(0, 0, w, h);
        const buckets = new Map<string, Path2D>();
        const dashed = new Path2D();
        for (let k = 0; k < m; k += 1) {
          const a = graph.edges.src[k]!;
          const b = graph.edges.dst[k]!;
          const o = Math.min(shown[a]!, shown[b]!);
          if (o <= 0 || (pinned !== null && (a === pinned || b === pinned))) continue;
          if (graph.edges.proposed[k]) {
            dashed.moveTo(bx[a]!, by[a]!);
            dashed.lineTo(bx[b]!, by[b]!);
            continue;
          }
          const level = o > 0.66 ? 3 : o > 0.33 ? 2 : 1;
          const bucketKey = `${edgeColors[k]}|${level}`;
          let path = buckets.get(bucketKey);
          if (!path) {
            path = new Path2D();
            buckets.set(bucketKey, path);
          }
          path.moveTo(bx[a]!, by[a]!);
          path.lineTo(bx[b]!, by[b]!);
        }
        cacheCtx.lineWidth = 0.5;
        for (const [bucketKey, path] of buckets) {
          const [color, level] = bucketKey.split("|") as [string, string];
          cacheCtx.globalAlpha =
            Math.min(0.2, 0.16 * Math.sqrt(4000 / Math.max(m, 1000))) * (Number(level) / 3) * dim;
          cacheCtx.strokeStyle = color;
          cacheCtx.stroke(path);
        }
        cacheCtx.setLineDash([3, 4]);
        cacheCtx.globalAlpha = 0.35 * dim;
        cacheCtx.strokeStyle = "#FF8A6A";
        cacheCtx.stroke(dashed);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cache, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (focus !== null) {
        const hot = new Path2D();
        for (let k = adjacency.offsets[focus]!; k < adjacency.offsets[focus + 1]!; k += 1) {
          const other = adjacency.targets[k]!;
          if (shown[other]! <= 0 || shown[focus]! <= 0) continue;
          hot.moveTo(sx[focus]!, sy[focus]!);
          hot.lineTo(sx[other]!, sy[other]!);
        }
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 0.8;
        ctx.stroke(hot);
      }

      // Punkter: én sti pr. farve og lag, de fremhævede for sig.
      const groups = new Map<string, Path2D>();
      const lit = new Path2D();
      for (let i = 0; i < n; i += 1) {
        const o = shown[i]!;
        if (o <= 0) continue;
        const L = LAYER[layout.layer[i]!]!;
        const r =
          (1.6 + Math.min(3, graph.nodes.degree[i]! * 0.06)) * Math.max(0.8, scale / 380) * L.size;
        const x = sx[i]!;
        const y = sy[i]!;
        if (x < -8 || y < -8 || x > w + 8 || y > h + 8) continue;
        if (focus !== null && near.has(i)) {
          lit.moveTo(x + r * 1.6, y);
          lit.arc(x, y, r * (i === focus ? 2.2 : 1.6), 0, 7);
          continue;
        }
        const key = `${nodeColor(graph, i)}|${layout.layer[i]}|${o > 0.66 ? 3 : o > 0.33 ? 2 : 1}`;
        let path = groups.get(key);
        if (!path) {
          path = new Path2D();
          groups.set(key, path);
        }
        path.moveTo(x + r, y);
        path.arc(x, y, r, 0, 7);
      }
      for (const [key, path] of groups) {
        const [color, layerIndex, level] = key.split("|") as [string, string, string];
        ctx.globalAlpha = LAYER[Number(layerIndex)]!.alpha * (Number(level) / 3) * dim;
        ctx.fillStyle = color;
        ctx.fill(path);
      }
      if (focus !== null) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = nodeColor(graph, focus);
        ctx.fill(lit);
      }
      // Glød om de mest forbundne.
      for (const i of hubs) {
        const o = shown[i]!;
        if (o <= 0) continue;
        ctx.globalAlpha = o * 0.2 * dim;
        ctx.fillStyle = nodeColor(graph, i);
        ctx.beginPath();
        ctx.arc(
          sx[i]!,
          sy[i]!,
          (3 + Math.min(3, graph.nodes.degree[i]! * 0.06)) * 2.6 * Math.max(0.8, scale / 380),
          0,
          7,
        );
        ctx.fill();
      }

      // Klyngetitler og navne.
      ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      // Områderne læses som områder. Titel og antal står på én linje over hver klynge i klyngens
      // farve, og de toner ud, når man zoomer ind og punkternes egne navne tager over.
      const titleAlpha = Math.min(1, Math.max(0, 1.6 - v.zoom * 0.6));
      for (let c = 0; c < layout.clusterCenters.length; c += 1) {
        const cc = layout.clusterCenters[c]!;
        if (cc.count === 0) continue;
        const tx = cx + cc.x * scale * ax;
        const ty = cy + (cc.y - cc.r) * scale - 10;
        ctx.globalAlpha = 0.9 * titleAlpha;
        ctx.fillStyle = CLUSTER_COLORS[c]!;
        ctx.font = "600 12px Geist, system-ui, sans-serif";
        ctx.fillText(`${clusterTitles[c]!} · ${cc.count.toLocaleString(localeTag)}`, tx, ty);
      }
      ctx.font = "500 11px Geist, system-ui, sans-serif";
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "left";
      const labelled = v.zoom >= 2.2;
      // Navne placeres uden at ligge oven i hinanden: det valgte og dets naboer først, så de mest forbundne.
      const candidates: number[] = [];
      if (focus !== null) candidates.push(focus, ...near);
      // Navnene vises først ved hover (tooltip), ved valg eller ved zoom, aldrig på oversigten.
      if (labelled) {
        for (const i of hubs) candidates.push(i);
        for (let i = 0; i < n && candidates.length < 400; i += 1) {
          if (graph.nodes.degree[i]! >= 2) candidates.push(i);
        }
      }
      const placed: Array<[number, number, number, number]> = [];
      let drawn = 0;
      for (const i of candidates) {
        if (drawn >= 60) break;
        if (shown[i]! < 0.9) continue;
        const x = sx[i]! + 6;
        const y = sy[i]! - 6;
        if (x < 0 || y < 10 || x > w - 40 || y > h) continue;
        const text = graph.nodes.labels[i]!;
        const width = ctx.measureText(text).width;
        if (
          placed.some(
            ([px0, py0, pw, ph]) =>
              x < px0 + pw && x + width > px0 && y - 11 < py0 + ph && y > py0 - 11,
          )
        )
          continue;
        placed.push([x, y, width, 11]);
        ctx.globalAlpha = focus !== null && near.has(i) ? 0.95 : 0.6;
        ctx.fillText(text, x, y);
        drawn += 1;
      }
      ctx.globalAlpha = 1;
      pointerPositions.sx = sx;
      pointerPositions.sy = sy;
      pointerPositions.shown = shown;
    };
    const pointerPositions: { sx: Float32Array; sy: Float32Array; shown: Float32Array } = {
      sx,
      sy,
      shown,
    };
    raf = requestAnimationFrame(draw);

    const nearest = (mx: number, my: number): number | null => {
      let best: number | null = null;
      let bestD = 144;
      for (let i = 0; i < n; i += 1) {
        if (pointerPositions.shown[i]! < 0.5) continue;
        const dx = pointerPositions.sx[i]! - mx;
        const dy = pointerPositions.sy[i]! - my;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const p = pointer.current;
      p.x = mx;
      p.y = my;
      p.inside = true;
      if (p.dragging) {
        const scale = (Math.min(w, h) / 2) * 0.9 * view.current.zoom;
        view.current.panX += (event.clientX - p.lastX) / scale;
        view.current.panY += (event.clientY - p.lastY) / scale;
        p.moved += Math.abs(event.clientX - p.lastX) + Math.abs(event.clientY - p.lastY);
        p.lastX = event.clientX;
        p.lastY = event.clientY;
        target.current = null;
        onHover(null);
        dirty.current = true;
        return;
      }
      const i = nearest(mx, my);
      onHover(i === null ? null : { i, x: mx, y: my });
      el.style.cursor = i === null ? "grab" : "pointer";
      dirty.current = true;
    };
    const onDown = (event: PointerEvent) => {
      const p = pointer.current;
      p.dragging = true;
      p.moved = 0;
      p.lastX = event.clientX;
      p.lastY = event.clientY;
      el.setPointerCapture(event.pointerId);
    };
    const onUp = (event: PointerEvent) => {
      const p = pointer.current;
      p.dragging = false;
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      if (p.moved < 5) {
        const rect = el.getBoundingClientRect();
        onSelect(nearest(event.clientX - rect.left, event.clientY - rect.top));
      }
    };
    const onLeave = () => {
      pointer.current.inside = false;
      onHover(null);
      dirty.current = true;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(view, dirty, event.deltaY < 0 ? 1.12 : 1 / 1.12);
      target.current = null;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
    };
  }, [graph, layout, adjacency, state, view, target, dirty, onHover, onSelect, t, localeTag]);

  return (
    <div
      ref={box}
      className={cn("absolute inset-0 overflow-hidden rounded-[18px]")}
      style={{ background: "radial-gradient(120% 90% at 50% 45%, #1a1830 0%, #0e0d1a 70%)" }}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={t("brainKnowledge.map.canvasLabel", { count: graph.nodes.ids.length })}
        className="block touch-none cursor-grab"
      />
    </div>
  );
}
