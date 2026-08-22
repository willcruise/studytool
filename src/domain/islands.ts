import type { Debt, GraphEdge } from "../types";

export type ComponentClip = {
  nodes: number[];
  edges: { a_debt: number; b_debt: number; directed: boolean; label: string }[];
};

export interface Island {
  nodeIds: number[];
  open: number;
  resolved: number;
  complete: boolean;
}

export interface GraphTopology {
  graphId: number;
  nodeIds: number[];
  edges: GraphEdge[];
}

export interface Territory {
  land: number;
  islands: number;
  investigating: number;
}

export type IslandBeat = "completed" | "enlarged" | "charted" | "none";

export function isDirectedEdge(e: { directed?: number | boolean }): boolean {
  return Number(e.directed) === 1 || e.directed === true;
}

export function visibleGraphNodeIds(nodeIds: number[], debts: Debt[]): number[] {
  const live = new Set(debts.filter((d) => d.status !== "evicted").map((d) => d.id));
  return nodeIds.filter((id) => live.has(id));
}

function undirectedAdj(nodeIds: number[], edges: GraphEdge[]): Map<number, number[]> {
  const idSet = new Set(nodeIds);
  const adj = new Map<number, number[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (!idSet.has(e.a_debt) || !idSet.has(e.b_debt)) continue;
    adj.get(e.a_debt)!.push(e.b_debt);
    adj.get(e.b_debt)!.push(e.a_debt);
  }
  return adj;
}

function walk(start: number, adj: Map<number, number[]>): Set<number> {
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) ?? []) stack.push(m);
  }
  return seen;
}

function clipOf(seen: Set<number>, edges: GraphEdge[]): ComponentClip {
  return {
    nodes: [...seen],
    edges: edges
      .filter((e) => seen.has(e.a_debt) && seen.has(e.b_debt))
      .map((e) => ({
        a_debt: e.a_debt,
        b_debt: e.b_debt,
        directed: isDirectedEdge(e),
        label: e.label ?? "",
      })),
  };
}

/** Undirected walk on manual edges only — same connectivity as copy/paste. */
export function componentOf(
  start: number,
  nodeIds: number[],
  edges: GraphEdge[]
): ComponentClip {
  const idSet = new Set(nodeIds);
  if (!idSet.has(start)) return { nodes: [], edges: [] };
  return clipOf(walk(start, undirectedAdj(nodeIds, edges)), edges);
}

function scoreIsland(nodeIds: number[], byId: Map<number, Debt>): Island {
  let open = 0;
  let resolved = 0;
  for (const id of nodeIds) {
    const d = byId.get(id);
    if (!d || d.status === "evicted") continue;
    if (d.status === "resolved") resolved += 1;
    else open += 1;
  }
  return {
    nodeIds,
    open,
    resolved,
    complete: nodeIds.length > 0 && open === 0 && resolved === nodeIds.length,
  };
}

export function islandsOnGraph(
  nodeIds: number[],
  edges: GraphEdge[],
  debts: Debt[]
): Island[] {
  const visible = visibleGraphNodeIds(nodeIds, debts);
  const adj = undirectedAdj(visible, edges);
  const byId = new Map(debts.map((d) => [d.id, d]));
  const remaining = new Set(visible);
  const out: Island[] = [];
  for (const id of visible) {
    if (!remaining.has(id)) continue;
    const nodes = [...walk(id, adj)];
    for (const n of nodes) remaining.delete(n);
    out.push(scoreIsland(nodes, byId));
  }
  return out;
}

export function islandOf(
  start: number,
  nodeIds: number[],
  edges: GraphEdge[],
  debts: Debt[]
): Island | null {
  const visible = visibleGraphNodeIds(nodeIds, debts);
  if (!visible.includes(start)) return null;
  const byId = new Map(debts.map((d) => [d.id, d]));
  return scoreIsland([...walk(start, undirectedAdj(visible, edges))], byId);
}

export function territoryFromIslands(islands: Island[]): Territory {
  let land = 0;
  let complete = 0;
  let investigating = 0;
  for (const isle of islands) {
    if (isle.complete) {
      land += isle.nodeIds.length;
      complete += 1;
    } else {
      investigating += isle.open;
    }
  }
  return { land, islands: complete, investigating };
}

export function territoryOnGraph(
  nodeIds: number[],
  edges: GraphEdge[],
  debts: Debt[]
): Territory {
  return territoryFromIslands(islandsOnGraph(nodeIds, edges, debts));
}

export function groupTopologies(
  nodes: { graph_id: number; debt_id: number }[],
  edges: GraphEdge[]
): GraphTopology[] {
  const byGraph = new Map<number, GraphTopology>();
  for (const n of nodes) {
    const g = byGraph.get(n.graph_id) ?? { graphId: n.graph_id, nodeIds: [], edges: [] };
    g.nodeIds.push(n.debt_id);
    byGraph.set(n.graph_id, g);
  }
  for (const e of edges) {
    const g = byGraph.get(e.graph_id) ?? { graphId: e.graph_id, nodeIds: [], edges: [] };
    g.edges.push(e);
    byGraph.set(e.graph_id, g);
  }
  return [...byGraph.values()];
}

export function completeTerritory(topos: GraphTopology[], debts: Debt[]): Territory {
  let land = 0;
  let islands = 0;
  let investigating = 0;
  for (const g of topos) {
    const t = territoryOnGraph(g.nodeIds, g.edges, debts);
    land += t.land;
    islands += t.islands;
    investigating += t.investigating;
  }
  return { land, islands, investigating };
}

export function islandsForDebt(
  debtId: number,
  topos: GraphTopology[],
  debts: Debt[]
): Island[] {
  const out: Island[] = [];
  for (const g of topos) {
    const isle = islandOf(debtId, g.nodeIds, g.edges, debts);
    if (isle) out.push(isle);
  }
  return out;
}

export type RepayBeat = "completed" | "charted";

/** True if any island this card sits on just flipped from investigating to complete. */
export function repayBeatAcross(
  debtId: number,
  topos: GraphTopology[],
  beforeDebts: Debt[],
  afterDebts: Debt[]
): RepayBeat {
  const before = islandsForDebt(debtId, topos, beforeDebts);
  const after = islandsForDebt(debtId, topos, afterDebts);
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) {
    if (after[i].complete && !before[i].complete) return "completed";
  }
  return "charted";
}

export function islandAfterChange(
  before: Island | null,
  after: Island | null,
  mode: "repay" | "join"
): IslandBeat {
  if (mode === "repay") {
    if (after?.complete && before && !before.complete) return "completed";
    return "charted";
  }
  if (before?.complete && after && !after.complete) return "enlarged";
  return "none";
}

/** True when attaching onto land that was fully charted and is investigating again. */
export function enlargedCompleteIsland(before: Island | null, after: Island | null): boolean {
  return islandAfterChange(before, after, "join") === "enlarged";
}
