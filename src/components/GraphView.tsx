import { useCallback, useEffect, useRef, useState } from "react";
import ForceGraph from "force-graph";
import type { Debt, GraphEdge, GraphMeta, Tier } from "../types";
import { TIER_META, TIER_ORDER } from "../types";
import * as db from "../db";
import { ConfirmButton } from "./ConfirmButton";
import { useI18n } from "../i18n";

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
  manual?: boolean;
}

interface Props {
  debts: Debt[];
  selectedId: number | null;
  onSelectDebt: (id: number) => void;
  showToast: (msg: string) => void;
}

export function GraphView({ debts, selectedId, onSelectDebt, showToast }: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph<GNode, GLink> | null>(null);

  const [graphs, setGraphs] = useState<GraphMeta[]>([]);
  const [currentGraphId, setCurrentGraphId] = useState<number | null>(null);
  const [nodeIds, setNodeIds] = useState<number[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTier, setPickerTier] = useState<Tier | "all">("all");
  const [linkMode, setLinkMode] = useState(false);
  const [pendingLink, setPendingLink] = useState<number | null>(null);
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
  const toastRef = useRef(showToast);
  const tRef = useRef(t);
  selectedRef.current = selectedId;
  graphIdRef.current = currentGraphId;
  linkModeRef.current = linkMode;
  pendingRef.current = pendingLink;
  toastRef.current = showToast;
  tRef.current = t;

  const loadGraphs = useCallback(async () => {
    setGraphs(await db.listGraphs());
  }, []);

  const loadGraphContent = useCallback(async (gid: number | null) => {
    if (gid === null) {
      setNodeIds([]);
      setEdges([]);
    } else {
      const [ids, es] = await Promise.all([db.listGraphNodeIds(gid), db.listGraphEdges(gid)]);
      setNodeIds(ids);
      setEdges(es);
    }
  }, []);

  const topologyKey = debts.map((d) => `${d.id}:${d.parent_id ?? ""}`).join(",");

  useEffect(() => {
    void loadGraphs();
  }, [loadGraphs, topologyKey]);

  useEffect(() => {
    loadGraphContent(currentGraphId);
    setLinkMode(false);
    setPendingLink(null);
    setPickerOpen(false);
  }, [currentGraphId, loadGraphContent]);

  useEffect(() => {
    if (currentGraphId === null) return;
    void loadGraphContent(currentGraphId);
  }, [topologyKey, currentGraphId, loadGraphContent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingLink !== null) {
        setPendingLink(null);
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
  }, [pendingLink, linkMode, pickerOpen, creating]);

  // ---------- force-graph instance ----------

  useEffect(() => {
    const el = containerRef.current!;
    const graph = new ForceGraph<GNode, GLink>(el)
      .backgroundColor("#0b1020")
      .nodeId("id")
      .nodeVal("val")
      .nodeLabel("label")
      .linkColor((l) => (l.manual ? "rgba(124, 156, 255, 0.7)" : "rgba(154, 166, 201, 0.28)"))
      .linkWidth((l) => (l.manual ? 1.8 : 1.2))
      .linkLineDash((l) => (l.manual ? null : [2, 2]))
      .linkDirectionalArrowLength((l) => (l.manual ? 6 : 0))
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor((l) =>
        l.manual ? "rgba(124, 156, 255, 0.9)" : "rgba(154, 166, 201, 0.4)"
      )
      .nodeCanvasObject((node, ctx, scale) => {
        const r = node.kind === "session" ? 9 : 5;
        const isSelected = node.debtId != null && node.debtId === selectedRef.current;
        const isPending = node.debtId != null && node.debtId === pendingRef.current;

        if (isSelected || isPending) {
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r + 3, 0, 2 * Math.PI);
          ctx.strokeStyle = isPending ? "#7c9cff" : "#eef2ff";
          ctx.lineWidth = 1.5;
          if (isPending) ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
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
            db.addGraphEdge(gid, pending, node.debtId).then(() => {
              setPendingLink(null);
              loadGraphContent(gid);
            });
          } else {
            setPendingLink(null);
          }
        } else {
          onSelectDebt(node.debtId);
        }
      })
      .onLinkClick((link) => {
        if (!linkModeRef.current) return;
        const gid = graphIdRef.current;
        if (gid === null || !link.manual) return;
        // after layout starts, source/target are node objects; before that, string ids like "d12"
        const endpointDebtId = (end: GLink["source"]): number | null => {
          if (typeof end === "object" && end !== null) return (end as GNode).debtId ?? null;
          if (typeof end === "string" && end.startsWith("d")) return Number(end.slice(1));
          return null;
        };
        const a = endpointDebtId(link.source);
        const b = endpointDebtId(link.target);
        if (a == null || b == null) return;
        db.removeGraphEdge(gid, a, b).then(() => {
          loadGraphContent(gid);
          toastRef.current(tRef.current("toastEdgeRemoved"));
        });
      })
      .onNodeRightClick((node) => {
        const gid = graphIdRef.current;
        if (gid === null || node.kind !== "debt" || node.debtId == null) return;
        db.removeGraphNode(gid, node.debtId).then(() => {
          loadGraphContent(gid);
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

      const directed = new Set(edges.map((e) => `${e.a_debt}-${e.b_debt}`));
      for (const e of edges) {
        if (idSet.has(e.a_debt) && idSet.has(e.b_debt)) {
          links.push({ source: `d${e.a_debt}`, target: `d${e.b_debt}`, manual: true });
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
            if (!directed.has(`${a}-${b}`) && !directed.has(`${b}-${a}`)) {
              links.push({ source: `d${a}`, target: `d${b}`, manual: false });
            }
          }
        }
      }
    }

    graphRef.current?.graphData({ nodes, links });
  }, [debts, currentGraphId, nodeIds, edges]);

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
      await loadGraphs();
      setCurrentGraphId(id);
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
    await loadGraphs();
    showToast(t("toastGraphRenamed"));
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
            setRenaming(false);
            setCurrentGraphId(e.target.value ? Number(e.target.value) : null);
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
        {currentGraph && (
          <ConfirmButton
            label={t("deleteGraph")}
            confirmLabel={t("confirmDelete")}
            onConfirm={async () => {
              await db.deleteGraph(currentGraph.id);
              setCurrentGraphId(null);
              await loadGraphs();
              showToast(t("toastGraphDeleted", { name: currentGraph.name }));
            }}
          />
        )}
      </div>

      {linkMode && currentGraph && (
        <div className="graph-hint">
          {pendingLink !== null ? t("secondNode") : t("connectTwo")}
        </div>
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
                  await loadGraphContent(currentGraph.id);
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
