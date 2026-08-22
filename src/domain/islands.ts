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

export function isDirectedEdge(e: { directed?: number | boolean }): boolean {
  return Number(e.directed) === 1 || e.directed === true;
}

export function visibleGraphNodeIds(nodeIds: number[], debts: Debt[]): number[] {
  const live = new Set(
    debts.filter((d) => d.status !== "evicted").map((d) => d.id)
  );
  return nodeIds.filter((id) => live.has(id));
}

/** Undirected walk on manual edges only — same connectivity as copy/paste. */
export function componentOf(
  start: number,
  nodeIds: number[],
  edges: GraphEdge[]
): ComponentClip {
  const idSet = new Set(nodeIds);
  if (!idSet.has(start)) return { nodes: [], edges: [] };
  const adj = new Map<number, number[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (!idSet.has(e.a_debt) || !idSet.has(e.b_debt)) continue;
    adj.get(e.a_debt)!.push(e.b_debt);
    adj.get(e.b_debt)!.push(e.a_debt);
  }
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) ?? []) stack.push(m);
  }
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

function scoreIsland(nodeIds: number[], debts: Debt[]): Island {
  const byId = new Map(debts.map((d) => [d.id, d]));
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
    complete: nodeIds.length > 0 && open === 0,
  };
}

export function islandsOnGraph(
  nodeIds: number[],
  edges: GraphEdge[],
  debts: Debt[]
): Island[] {
  const visible = visibleGraphNodeIds(nodeIds, debts);
  const remaining = new Set(visible);
  const out: Island[] = [];
  for (const id of visible) {
    if (!remaining.has(id)) continue;
    const nodes = componentOf(id, visible, edges).nodes;
    for (const n of nodes) remaining.delete(n);
    out.push(scoreIsland(nodes, debts));
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
  return scoreIsland(componentOf(start, visible, edges).nodes, debts);
}

export function territoryOnGraph(
  nodeIds: number[],
  edges: GraphEdge[],
  debts: Debt[]
): Territory {
  const islands = islandsOnGraph(nodeIds, edges, debts);
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

export function islandContaining(
  debtId: number,
  topos: GraphTopology[],
  debts: Debt[]
): Island | null {
  for (const g of topos) {
    const isle = islandOf(debtId, g.nodeIds, g.edges, debts);
    if (isle) return isle;
  }
  return null;
}

export type RepayBeat = "completed" | "charted";

export function repayBeat(before: Island | null, after: Island | null): RepayBeat {
  if (after?.complete && before && !before.complete) return "completed";
  return "charted";
}

/** True when attaching onto land that was fully charted and is investigating again. */
export function enlargedCompleteIsland(before: Island | null, after: Island | null): boolean {
  if (!before?.complete || !after) return false;
  if (after.complete) return false;
  return after.nodeIds.length > before.nodeIds.length || after.open > 0;
}
