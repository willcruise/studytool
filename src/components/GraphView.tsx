import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph from "force-graph";
import type { Debt, GraphEdge, GraphMeta, GraphNodeRow, Tier } from "../types";
import { TIER_META, TIER_ORDER } from "../types";
import * as db from "../db";
import { ConfirmButton } from "./ConfirmButton";
import { MoreMenu } from "./MoreMenu";
import { useI18n } from "../i18n";
import { lastGraphId, setLastGraphId } from "../graphPref";
import {
  componentOf,
  enlargedCompleteIsland,
  islandOf,
  islandsOnGraph,
  isDirectedEdge,
  territoryFromIslands,
  visibleGraphNodeIds,
  type ComponentClip,
} from "../domain/islands";

interface GNode {
  id: string;
  kind: "session" | "debt";
  debtId?: number;
  label: string;
  color: string;
  val: number;
  resolved?: boolean;
  x?: number;
  y?: number;
}

interface GLink {
  source: string;
  target: string;
  edgeId?: number;
  manual?: boolean;
  directed?: boolean;
  label?: string;
}

const isDirected = isDirectedEdge;

/** Survives graph switches so you can copy a component on one map and paste it onto another. */
let graphClip: ComponentClip | null = null;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

function shortTitle(title: string, n = 18): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

interface Props {
  debts: Debt[];
  graphs: GraphMeta[];
  graphNodes: GraphNodeRow[];
  graphEdges: GraphEdge[];
  selectedId: number | null;
  onSelectDebt: (id: number) => void;
  showToast: (msg: string) => void;
  onMapChange: () => Promise<void>;
}

export function GraphView({
  debts,
  graphs,
  graphNodes,
  graphEdges,
  selectedId,
  onSelectDebt,
  showToast,
  onMapChange,
}: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph<GNode, GLink> | null>(null);

  const [currentGraphId, setCurrentGraphId] = useState<number | null>(() => lastGraphId());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hasClip, setHasClip] = useState(() => graphClip !== null);
  const [pickerTier, setPickerTier] = useState<Tier | "all">("all");
  const [linkMode, setLinkMode] = useState(false);
  const [pendingLink, setPendingLink] = useState<number | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [edgeLabel, setEdgeLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const creatingLock = useRef(false);

  // refs so force-graph callbacks (bound once) see current state
  const selectedRef = useRef(selectedId);
  const graphIdRef = useRef(currentGraphId);
  const linkModeRef = useRef(linkMode);
  const pendingRef = useRef(pendingLink);
  const selectedEdgeRef = useRef(selectedEdge);
  const edgesRef = useRef<GraphEdge[]>([]);
  const nodeIdsRef = useRef<number[]>([]);
  const debtsRef = useRef(debts);
  const componentRef = useRef<Set<number>>(new Set());
  const completeIslandRef = useRef<Set<number>>(new Set());
  const fogIslandRef = useRef<Set<number>>(new Set());
  const toastRef = useRef(showToast);
  const tRef = useRef(t);
  const onMapChangeRef = useRef(onMapChange);
  selectedRef.current = selectedId;
  graphIdRef.current = currentGraphId;
  linkModeRef.current = linkMode;
  pendingRef.current = pendingLink;
  selectedEdgeRef.current = selectedEdge;
  debtsRef.current = debts;
  toastRef.current = showToast;
  tRef.current = t;
  onMapChangeRef.current = onMapChange;

  const nodeIds = useMemo(
    () =>
      currentGraphId == null
        ? []
        : graphNodes.filter((n) => n.graph_id === currentGraphId).map((n) => n.debt_id),
    [graphNodes, currentGraphId]
  );
  const edges = useMemo(
    () => (currentGraphId == null ? [] : graphEdges.filter((e) => e.graph_id === currentGraphId)),
    [graphEdges, currentGraphId]
  );
  const islands = useMemo(() => islandsOnGraph(nodeIds, edges, debts), [nodeIds, edges, debts]);
  const mapTerritory = useMemo(() => territoryFromIslands(islands), [islands]);
  edgesRef.current = edges;
  nodeIdsRef.current = nodeIds;

  const selectGraph = (id: number | null) => {
    setRenaming(false);
    setCurrentGraphId(id);
    setLastGraphId(id);
    setLinkMode(false);
    setPendingLink(null);
    setSelectedEdge(null);
    setPickerOpen(false);
  };

  useEffect(() => {
    if (graphs.length === 0) return;
    const pref = lastGraphId();
    const validPref = pref != null && graphs.some((g) => g.id === pref) ? pref : null;
    const next =
      validPref ??
      (currentGraphId != null && graphs.some((g) => g.id === currentGraphId) ? currentGraphId : null);
    if (next === currentGraphId) return;
    setCurrentGraphId(next);
    setLinkMode(false);
    setPendingLink(null);
    setSelectedEdge(null);
    setPickerOpen(false);
  }, [graphs, currentGraphId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingLink !== null) {
        setPendingLink(null);
        return;
      }
      if (selectedEdge !== null) {
        setSelectedEdge(null);
        return;
      }
      if (linkMode) setLinkMode(false);
      if (pickerOpen) setPickerOpen(false);
      if (creating) {
        setCreating(false);
        setNewName("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingLink, selectedEdge, linkMode, pickerOpen, creating]);

  // ---------- force-graph instance ----------

  useEffect(() => {
    const el = containerRef.current!;
    const graph = new ForceGraph<GNode, GLink>(el)
      .backgroundColor("#0b1020")
      .nodeId("id")
      .nodeVal("val")
      .nodeLabel("label")
      .linkColor((l) =>
        l.edgeId != null && l.edgeId === selectedEdgeRef.current?.id
          ? "rgba(124, 156, 255, 1)"
          : l.manual
            ? "rgba(124, 156, 255, 0.7)"
            : "rgba(154, 166, 201, 0.28)"
      )
      .linkWidth((l) =>
        l.edgeId != null && l.edgeId === selectedEdgeRef.current?.id
          ? 2.6
          : l.manual
            ? 1.8
            : 1.2
      )
      .linkLineDash((l) => (l.manual ? null : [2, 2]))
      .linkDirectionalArrowLength((l) => (l.directed ? 4.5 : 0))
      .linkDirectionalArrowRelPos(0.92)
      .linkDirectionalArrowColor((l) =>
        l.directed ? "rgba(124, 156, 255, 0.9)" : "rgba(154, 166, 201, 0.4)"
      )
      .linkCanvasObjectMode((l) => (l.label ? "after" : undefined))
      .linkCanvasObject((link, ctx, scale) => {
        const text = link.label?.trim();
        if (!text) return;
        const start = link.source;
        const end = link.target;
        if (typeof start !== "object" || typeof end !== "object" || start === null || end === null) {
          return;
        }
        const a = start as GNode;
        const b = end as GNode;
        if (a.x == null || a.y == null || b.x == null || b.y == null) return;
        const fontSize = 11 / scale;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#c5cde6";
        ctx.fillText(text.length > 28 ? text.slice(0, 28) + "…" : text, (a.x + b.x) / 2, (a.y + b.y) / 2);
      })
      .nodeCanvasObject((node, ctx, scale) => {
        const r = node.kind === "session" ? 9 : 5;
        const isSelected = node.debtId != null && node.debtId === selectedRef.current;
        const isPending = node.debtId != null && node.debtId === pendingRef.current;
        const inComponent = node.debtId != null && componentRef.current.has(node.debtId);

        const islandComplete = node.debtId != null && completeIslandRef.current.has(node.debtId);
        const islandFog = node.debtId != null && fogIslandRef.current.has(node.debtId);

        if (islandComplete) {
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r + 7, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(74, 222, 128, 0.14)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r + 5, 0, 2 * Math.PI);
          ctx.strokeStyle = "rgba(74, 222, 128, 0.55)";
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (islandFog && !node.resolved) {
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r + 4, 0, 2 * Math.PI);
          ctx.strokeStyle = "rgba(154, 166, 201, 0.4)";
          ctx.lineWidth = 1.2;
          ctx.setLineDash([2, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (isSelected || isPending) {
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r + 3, 0, 2 * Math.PI);
          ctx.strokeStyle = isPending ? "#7c9cff" : "#eef2ff";
          ctx.lineWidth = 1.5;
          if (isPending) ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (inComponent) {
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r + 3, 0, 2 * Math.PI);
          ctx.strokeStyle = "rgba(238, 242, 255, 0.35)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
        if (node.resolved) {
          ctx.fillStyle = "rgba(74, 222, 128, 0.35)";
          ctx.fill();
          ctx.strokeStyle = node.color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = node.color;
          ctx.fill();
        }

        if (node.kind === "session" || scale > 1.1) {
          const fontSize = (node.kind === "session" ? 13 : 11) / scale;
          ctx.font = `${node.kind === "session" ? "700 " : ""}${fontSize}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = node.kind === "session" ? "#eef2ff" : "#9aa6c9";
          const label = node.label.length > 24 ? node.label.slice(0, 24) + "…" : node.label;
          ctx.fillText(label, node.x!, node.y! + r + 2);
        }
      })
      .onNodeClick((node) => {
        if (node.kind !== "debt" || node.debtId == null) return;
        const gid = graphIdRef.current;
        if (linkModeRef.current && gid !== null) {
          const pending = pendingRef.current;
          if (pending === null) {
            setPendingLink(node.debtId);
          } else if (pending !== node.debtId) {
            db.addGraphEdge(gid, pending, node.debtId).then((ok) => {
              setPendingLink(null);
              if (!ok) {
                toastRef.current(tRef.current("toastAlreadyLinked"));
                return;
              }
              const nextEdges = [
                ...edgesRef.current,
                {
                  id: -1,
                  graph_id: gid,
                  a_debt: pending,
                  b_debt: node.debtId!,
                  directed: 0,
                  label: "",
                },
              ];
              const beforeA = islandOf(pending, nodeIdsRef.current, edgesRef.current, debtsRef.current);
              const beforeB = islandOf(node.debtId!, nodeIdsRef.current, edgesRef.current, debtsRef.current);
              const after = islandOf(pending, nodeIdsRef.current, nextEdges, debtsRef.current);
              void onMapChangeRef.current();
              if (enlargedCompleteIsland(beforeA, after) || enlargedCompleteIsland(beforeB, after)) {
                toastRef.current(tRef.current("toastIslandEnlarge"));
              } else {
                toastRef.current(tRef.current("toastLinked"));
              }
            });
          } else {
            setPendingLink(null);
          }
        } else {
          onSelectDebt(node.debtId);
        }
      })
      .onLinkClick((link) => {
        if (!link.manual || link.edgeId == null) return;
        const row = edgesRef.current.find((e) => e.id === link.edgeId);
        if (!row) return;
        setPendingLink(null);
        setSelectedEdge(row);
        setEdgeLabel(row.label ?? "");
      })
      .onBackgroundClick(() => {
        setPendingLink(null);
        setSelectedEdge(null);
      })
      .onNodeRightClick((node) => {
        const gid = graphIdRef.current;
        if (gid === null || node.kind !== "debt" || node.debtId == null) return;
        db.removeGraphNode(gid, node.debtId).then(() => {
          void onMapChangeRef.current();
          toastRef.current(tRef.current("toastNodeRemoved"));
        });
      });

    graphRef.current = graph;

    const resize = () => graph.width(el.clientWidth).height(el.clientHeight);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    return () => {
      ro.disconnect();
      graph._destructor();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- graph data ----------

  useEffect(() => {
    const nodes: GNode[] = [];
    const links: GLink[] = [];

    const debtNode = (d: Debt): GNode => ({
      id: `d${d.id}`,
      kind: "debt",
      debtId: d.id,
      label: d.title,
      color: d.status === "resolved" ? "#4ade80" : TIER_META[d.tier].color,
      val: 3,
      resolved: d.status === "resolved",
    });

    const visible = debts.filter((d) => d.status !== "evicted");

    if (currentGraphId !== null) {
      // only nodes the user added to this graph
      const idSet = new Set(nodeIds);
      const included = visible.filter((d) => idSet.has(d.id));
      for (const d of included) nodes.push(debtNode(d));

      const linked = new Set(edges.map((e) => `${e.a_debt}-${e.b_debt}`));
      for (const e of edges) {
        if (idSet.has(e.a_debt) && idSet.has(e.b_debt)) {
          links.push({
            source: `d${e.a_debt}`,
            target: `d${e.b_debt}`,
            edgeId: e.id,
            manual: true,
            directed: isDirected(e),
            label: e.label?.trim() || undefined,
          });
        }
      }

      const bySession = new Map<number, number[]>();
      for (const d of included) {
        if (d.session_id !== null) {
          bySession.set(d.session_id, [...(bySession.get(d.session_id) ?? []), d.id]);
        }
      }
      for (const ids of bySession.values()) {
        if (ids.length > 6) continue; // avoid clutter on large groups
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = ids[i];
            const b = ids[j];
            if (!linked.has(`${a}-${b}`) && !linked.has(`${b}-${a}`)) {
              links.push({ source: `d${a}`, target: `d${b}`, manual: false });
            }
          }
        }
      }
    }

    graphRef.current?.graphData({ nodes, links });
  }, [debts, currentGraphId, nodeIds, edges]);

  useEffect(() => {
    if (selectedId == null) {
      componentRef.current = new Set();
    } else {
      componentRef.current = new Set(componentOf(selectedId, visibleGraphNodeIds(nodeIds, debts), edges).nodes);
    }
    const complete = new Set<number>();
    const fog = new Set<number>();
    for (const isle of islands) {
      if (isle.complete) for (const id of isle.nodeIds) complete.add(id);
      else for (const id of isle.nodeIds) fog.add(id);
    }
    completeIslandRef.current = complete;
    fogIslandRef.current = fog;
    const g = graphRef.current;
    if (g) g.graphData(g.graphData());
  }, [selectedId, nodeIds, edges, debts, islands]);

  useEffect(() => {
    if (!selectedEdge) return;
    if (!edges.some((e) => e.id === selectedEdge.id)) setSelectedEdge(null);
  }, [edges, selectedEdge]);

  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.graphData(g.graphData());
  }, [selectedEdge?.id]);

  const copyComponent = useCallback(() => {
    if (currentGraphId === null) {
      setCreating(true);
      showToast(t("toastNeedGraph"));
      return;
    }
    const visible = visibleGraphNodeIds(nodeIds, debts);
    if (selectedId == null || !visible.includes(selectedId)) {
      showToast(t("toastGraphCopyNeedNode"));
      return;
    }
    const clip = componentOf(selectedId, visible, edges);
    if (clip.nodes.length === 0) {
      showToast(t("toastGraphCopyNeedNode"));
      return;
    }
    graphClip = clip;
    setHasClip(true);
    showToast(t("toastGraphCopied", { n: clip.nodes.length }));
  }, [currentGraphId, selectedId, nodeIds, edges, showToast, t]);

  const pasteComponent = useCallback(async () => {
    if (currentGraphId === null) {
      setCreating(true);
      showToast(t("toastNeedGraph"));
      return;
    }
    if (!graphClip) {
      showToast(t("toastGraphPasteEmpty"));
      return;
    }
    const live = new Set(debts.filter((d) => d.status !== "evicted").map((d) => d.id));
    const clip: ComponentClip = {
      nodes: graphClip.nodes.filter((id) => live.has(id)),
      edges: graphClip.edges.filter((e) => live.has(e.a_debt) && live.has(e.b_debt)),
    };
    if (clip.nodes.length === 0) {
      showToast(t("toastGraphPasteNone"));
      return;
    }
    const completeBefore = new Set(
      islands.filter((isle) => isle.complete).flatMap((isle) => isle.nodeIds)
    );
    const hit = clip.nodes.find((id) => completeBefore.has(id));
    const beforeIsle = hit != null ? islandOf(hit, nodeIds, edges, debts) : null;
    const result = await db.pasteGraphComponent(currentGraphId, clip);
    const nextIds = [...new Set([...nodeIds, ...clip.nodes])];
    const have = new Set(edges.map((e) => `${e.a_debt}:${e.b_debt}`));
    const nextEdges = [
      ...edges,
      ...clip.edges
        .filter((e) => !have.has(`${e.a_debt}:${e.b_debt}`) && !have.has(`${e.b_debt}:${e.a_debt}`))
        .map((e) => ({
          id: -1,
          graph_id: currentGraphId,
          a_debt: e.a_debt,
          b_debt: e.b_debt,
          directed: e.directed ? 1 : 0,
          label: e.label,
        })),
    ];
    const after = hit != null ? islandOf(hit, nextIds, nextEdges, debts) : null;
    await onMapChange();
    if (result.nodes === 0 && result.edges === 0) {
      showToast(t("toastGraphPasteNone"));
    } else if (enlargedCompleteIsland(beforeIsle, after)) {
      showToast(t("toastIslandEnlarge"));
    } else {
      showToast(t("toastGraphPasted"));
    }
  }, [currentGraphId, debts, edges, islands, nodeIds, onMapChange, showToast, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "c") {
        if (selectedId == null || currentGraphId === null || !nodeIds.includes(selectedId)) return;
        e.preventDefault();
        copyComponent();
      } else if (key === "v") {
        if (!graphClip || currentGraphId === null) return;
        e.preventDefault();
        void pasteComponent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copyComponent, pasteComponent, selectedId, currentGraphId, nodeIds]);

  // ---------- toolbar actions ----------

  const createNewGraph = async () => {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    if (creatingLock.current) return;
    creatingLock.current = true;
    try {
      const id = await db.createGraph(name);
      setNewName("");
      setCreating(false);
      setLastGraphId(id);
      await onMapChange();
      selectGraph(id);
      setPickerOpen(true);
    } finally {
      creatingLock.current = false;
    }
  };

  const renameGraph = async () => {
    const name = renameValue.trim();
    if (!currentGraph || !name || name === currentGraph.name) {
      setRenaming(false);
      return;
    }
    await db.renameGraph(currentGraph.id, name);
    setRenaming(false);
    await onMapChange();
    showToast(t("toastGraphRenamed"));
  };

  const saveSelectedEdge = async (
    patch: Partial<Pick<GraphEdge, "a_debt" | "b_debt" | "directed" | "label">>
  ) => {
    if (!selectedEdge || currentGraphId === null) return;
    const next = { ...selectedEdge, ...patch };
    await db.updateGraphEdge(
      next.id,
      next.a_debt,
      next.b_debt,
      isDirected(next),
      next.label ?? ""
    );
    setSelectedEdge(next);
    await onMapChange();
  };

  const currentGraph = graphs.find((g) => g.id === currentGraphId) ?? null;
  const nodeIdSet = new Set(nodeIds);
  const pickable = debts.filter(
    (d) =>
      d.status === "open" &&
      !nodeIdSet.has(d.id) &&
      (pickerTier === "all" || d.tier === pickerTier) &&
      (pickerQuery.trim() === "" ||
        d.title.toLowerCase().includes(pickerQuery.trim().toLowerCase()) ||
        (d.session_topic ?? "").toLowerCase().includes(pickerQuery.trim().toLowerCase()))
  );

  return (
    <div className="graph-wrap">
      <div className="graph-container" ref={containerRef} />

      <div className="graph-toolbar">
        <select
          className="session-select"
          value={currentGraphId ?? ""}
          onChange={(e) => {
            selectGraph(e.target.value ? Number(e.target.value) : null);
          }}
        >
          <option value="">{t("pickGraph")}</option>
          {graphs.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        {currentGraph &&
          (renaming ? (
            <input
              autoFocus
              className="session-input graph-rename-input"
              placeholder={t("graphName")}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) renameGraph();
                if (e.key === "Escape") setRenaming(false);
              }}
              onBlur={renameGraph}
            />
          ) : (
            <button
              className="ghost-btn graph-name-btn"
              title={t("rename")}
              onClick={() => {
                setRenameValue(currentGraph.name);
                setRenaming(true);
              }}
            >
              {currentGraph.name} <span className="edit-pencil">✎</span>
            </button>
          ))}

        {creating ? (
          <input
            autoFocus
            className="session-input"
            placeholder={t("newGraphName")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void createNewGraph();
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            onBlur={() => void createNewGraph()}
          />
        ) : (
          <button className="ghost-btn" onClick={() => setCreating(true)}>
            {t("newGraph")}
          </button>
        )}

        <span className="toolbar-sep" />
        <button
          className={`ghost-btn ${pickerOpen ? "toolbar-active" : ""} ${!currentGraph ? "toolbar-dim" : ""}`}
          onClick={() => {
            if (currentGraph) {
              setPickerOpen((v) => !v);
            } else {
              setCreating(true);
              showToast(t("toastNeedGraph"));
            }
          }}
        >
          {t("addNode")}
        </button>
        <button
          className={`ghost-btn ${linkMode ? "toolbar-active" : ""} ${!currentGraph ? "toolbar-dim" : ""}`}
          onClick={() => {
            if (!currentGraph) {
              setCreating(true);
              showToast(t("toastNeedGraph"));
              return;
            }
            setLinkMode((v) => !v);
            setPendingLink(null);
          }}
        >
            {t("linkMode")}
        </button>
        <button
          type="button"
          className={`ghost-btn ${!currentGraph || selectedId == null || !nodeIdSet.has(selectedId) ? "toolbar-dim" : ""}`}
          title={t("graphCopyHint")}
          onClick={copyComponent}
        >
          {t("graphCopy")}
        </button>
        <button
          type="button"
          className={`ghost-btn ${!currentGraph || !hasClip ? "toolbar-dim" : ""}`}
          title={t("graphPasteHint")}
          onClick={() => void pasteComponent()}
        >
          {t("graphPaste")}
        </button>
        {currentGraph && (
          <span className="graph-territory">
            {t("completeTerritory", { n: mapTerritory.land })}
            {mapTerritory.investigating > 0 && (
              <span className="graph-investigating">
                {t("islandInvestigating", { n: mapTerritory.investigating })}
              </span>
            )}
          </span>
        )}
        {currentGraph && (
          <MoreMenu>
            <ConfirmButton
              label={t("deleteGraph")}
              confirmLabel={t("confirmDelete")}
              className="more-menu-item"
              onConfirm={async () => {
                await db.deleteGraph(currentGraph.id);
                selectGraph(null);
                await onMapChange();
                showToast(t("toastGraphDeleted", { name: currentGraph.name }));
              }}
            />
          </MoreMenu>
        )}
      </div>

      {linkMode && currentGraph && (
        <div className="graph-hint">
          {pendingLink !== null ? t("secondNode") : t("connectTwo")}
        </div>
      )}

      {selectedEdge && currentGraph && (
        <aside className="edge-editor">
          <div className="edge-editor-header">
            <span>{t("edgeEdit")}</span>
            <button type="button" className="ghost-btn" onClick={() => setSelectedEdge(null)}>
              {t("done")}
            </button>
          </div>
          <label className="detail-label">{t("edgeLabel")}</label>
          <input
            className="session-input"
            value={edgeLabel}
            placeholder={t("edgeLabel")}
            onChange={(e) => setEdgeLabel(e.target.value)}
            onBlur={() => {
              if (edgeLabel.trim() !== (selectedEdge.label ?? "").trim()) {
                void saveSelectedEdge({ label: edgeLabel });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.currentTarget.blur();
              }
            }}
          />
          <label className="detail-label">{t("edgeDirection")}</label>
          <div className="edge-dir-line">
            <button
              type="button"
              className={`edge-dir-btn${!isDirected(selectedEdge) ? " on" : ""}`}
              title={t("edgeUndirected")}
              aria-label={t("edgeUndirected")}
              onClick={() => void saveSelectedEdge({ directed: 0 })}
            >
              —
            </button>
            <button
              type="button"
              className={`edge-dir-btn${isDirected(selectedEdge) ? " on" : ""}`}
              title={t("edgeDirection")}
              aria-label={t("edgeDirection")}
              onClick={() => {
                if (!isDirected(selectedEdge)) {
                  void saveSelectedEdge({ directed: 1 });
                  return;
                }
                void saveSelectedEdge({
                  a_debt: selectedEdge.b_debt,
                  b_debt: selectedEdge.a_debt,
                  directed: 1,
                });
              }}
            >
              ⇄
            </button>
            <p className="edge-dir-ends">
              {isDirected(selectedEdge) ? (
                <>
                  <span>{shortTitle(debts.find((d) => d.id === selectedEdge.a_debt)?.title ?? "", 22)}</span>
                  <span className="edge-dir-sign">→</span>
                  <span>{shortTitle(debts.find((d) => d.id === selectedEdge.b_debt)?.title ?? "", 22)}</span>
                </>
              ) : (
                <>
                  <span>{shortTitle(debts.find((d) => d.id === selectedEdge.a_debt)?.title ?? "", 22)}</span>
                  <span className="edge-dir-sign">·</span>
                  <span>{shortTitle(debts.find((d) => d.id === selectedEdge.b_debt)?.title ?? "", 22)}</span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="ghost-btn"
            onClick={async () => {
              await db.removeGraphEdgeById(selectedEdge.id);
              setSelectedEdge(null);
              await onMapChange();
              showToast(t("toastEdgeRemoved"));
            }}
          >
            {t("unlink")}
          </button>
        </aside>
      )}

      {!currentGraph && !creating && (
        <div className="graph-empty">
          <div className="empty-glyph big" aria-hidden="true">◎</div>
          <p>{t("emptyGraph")}</p>
          <p className="empty-sub">{t("emptyGraphHint")}</p>
          <button className="primary-btn" onClick={() => setCreating(true)}>
            {t("newGraph")}
          </button>
        </div>
      )}

      {currentGraph && nodeIds.length === 0 && !pickerOpen && (
        <div className="graph-empty">
          <div className="empty-glyph big" aria-hidden="true">◎</div>
          <p>{t("emptyGraph")}</p>
          <p className="empty-sub">{t("emptyGraphHint")}</p>
          <button className="primary-btn" onClick={() => setPickerOpen(true)}>
            {t("addNode")}
          </button>
        </div>
      )}

      {pickerOpen && currentGraph && (
        <aside className="node-picker">
          <div className="node-picker-header">
            <span>{t("nodeAdd")}</span>
            <button className="ghost-btn" onClick={() => setPickerOpen(false)}>
              {t("done")}
            </button>
          </div>
          <div className="node-picker-tiers">
            <button
              className={`tier-chip ${pickerTier === "all" ? "active" : ""}`}
              onClick={() => setPickerTier("all")}
            >
              {t("all")}
            </button>
            {TIER_ORDER.map((t) => (
              <button
                key={t}
                className={`tier-chip ${pickerTier === t ? "active" : ""}`}
                style={pickerTier === t ? { borderColor: TIER_META[t].color, color: TIER_META[t].color } : {}}
                onClick={() => setPickerTier(t)}
              >
                {TIER_META[t].label}
              </button>
            ))}
          </div>
          <input
            className="node-picker-search"
            placeholder={t("searchTitle")}
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
          />
          <div className="node-picker-list">
            {pickable.length === 0 && (
              <div className="column-empty">{t("none")}</div>
            )}
            {pickable.map((d) => (
              <button
                key={d.id}
                className="node-picker-item"
                onClick={async () => {
                  await db.addGraphNode(currentGraph.id, d.id);
                  await onMapChange();
                  showToast(t("toastIsletAdded"));
                }}
              >
                <span className="picker-dot" style={{ background: TIER_META[d.tier].color }} />
                <span className="picker-title">{d.title}</span>
                {d.session_topic && <span className="picker-session">◈ {d.session_topic}</span>}
              </button>
            ))}
          </div>
        </aside>
      )}

      <div className="graph-legend">
        <span><i style={{ background: TIER_META.cache.color }} /> Cache</span>
        <span><i style={{ background: TIER_META.ram.color }} /> RAM</span>
        <span><i style={{ background: TIER_META.storage.color }} /> Storage</span>
        <span><i style={{ background: TIER_META.inbox.color }} /> Inbox</span>
        <span><i style={{ background: "rgba(74,222,128,0.5)", border: "1.5px solid #4ade80" }} /> {t("legendResolved")}</span>
      </div>
    </div>
  );
}
