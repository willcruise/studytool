import Database from "@tauri-apps/plugin-sql";
import type { Attachment, Debt, GraphEdge, GraphMeta, Session, Stats, Tier } from "./types";
import { escapeHtml, toEditorHtml } from "./richtext";
import { minutesBetween } from "./time";
import { t } from "./i18n";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:studymap.db");
    await db.execute("PRAGMA foreign_keys = ON");
  }
  return db;
}

// ---------- sessions ----------

export async function listSessions(): Promise<Session[]> {
  const d = await getDb();
  return d.select<Session[]>("SELECT * FROM sessions ORDER BY created_at DESC");
}

export async function getActiveSession(): Promise<Session | null> {
  const d = await getDb();
  const rows = await d.select<Session[]>(
    "SELECT * FROM sessions WHERE is_active = 1 LIMIT 1"
  );
  return rows[0] ?? null;
}

export async function createSession(topic: string): Promise<Session> {
  const d = await getDb();
  await d.execute("UPDATE sessions SET is_active = 0");
  await d.execute("INSERT INTO sessions (topic, is_active) VALUES ($1, 1)", [topic]);
  const rows = await d.select<Session[]>(
    "SELECT * FROM sessions WHERE is_active = 1 LIMIT 1"
  );
  return rows[0];
}

export async function renameSession(id: number, topic: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE sessions SET topic = $1 WHERE id = $2", [topic, id]);
}

export async function deleteSession(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE debts SET session_id = NULL WHERE session_id = $1", [id]);
  await d.execute("DELETE FROM sessions WHERE id = $1", [id]);
}

export async function activateSession(id: number | null): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE sessions SET is_active = 0");
  if (id !== null) {
    await d.execute("UPDATE sessions SET is_active = 1 WHERE id = $1", [id]);
  }
}

// ---------- debts ----------

const DEBT_SELECT = `
  SELECT d.*, s.topic AS session_topic, p.title AS parent_title,
    (SELECT COUNT(*) FROM attachments a WHERE a.debt_id = d.id) AS attachment_count
  FROM debts d
  LEFT JOIN sessions s ON s.id = d.session_id
  LEFT JOIN debts p ON p.id = d.parent_id
`;

export async function listAllDebts(): Promise<Debt[]> {
  const d = await getDb();
  return d.select<Debt[]>(`${DEBT_SELECT} ORDER BY d.created_at DESC`);
}

export async function getActiveDig(): Promise<Debt | null> {
  const d = await getDb();
  const rows = await d.select<Debt[]>(
    `${DEBT_SELECT} WHERE d.dig_until IS NOT NULL LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function getDebt(id: number): Promise<Debt | null> {
  const d = await getDb();
  const rows = await d.select<Debt[]>(`${DEBT_SELECT} WHERE d.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createDebt(input: {
  title: string;
  tier?: Tier;
  note?: string;
  sessionId?: number | null;
  sourceUrl?: string | null;
  sourceFile?: string | null;
  parentId?: number | null;
}): Promise<number> {
  const d = await getDb();
  const res = await d.execute(
    `INSERT INTO debts (title, tier, note, session_id, source_url, source_file, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.title,
      input.tier ?? "inbox",
      input.note ? toEditorHtml(input.note) : "",
      input.sessionId ?? null,
      input.sourceUrl ?? null,
      input.sourceFile ?? null,
      input.parentId ?? null,
    ]
  );
  return res.lastInsertId ?? 0;
}

export async function setTier(id: number, tier: Tier): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE debts SET tier = $1, last_touched = datetime('now'),
     touch_count = touch_count + 1 WHERE id = $2`,
    [tier, id]
  );
}

export async function updateDebt(
  id: number,
  fields: {
    title?: string;
    note?: string;
    source_url?: string | null;
    source_file?: string | null;
    session_id?: number | null;
    check_content?: string;
  }
): Promise<void> {
  const d = await getDb();
  const sets: string[] = ["last_touched = datetime('now')"];
  const args: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = $${i++}`);
      args.push(value);
    }
  }
  args.push(id);
  await d.execute(`UPDATE debts SET ${sets.join(", ")} WHERE id = $${i}`, args);
}

export async function resolveDebt(id: number, summary: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE debts SET status = 'resolved', summary = $1,
     resolved_at = datetime('now'), dig_until = NULL, dig_started_at = NULL,
     next_review_at = datetime('now', '+3 days'), review_stage = 0,
     last_touched = datetime('now') WHERE id = $2`,
    [summary, id]
  );
}

export async function reopenDebt(id: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE debts SET status = 'open', resolved_at = NULL,
     dig_until = NULL, dig_started_at = NULL,
     next_review_at = NULL, review_stage = 0,
     last_touched = datetime('now') WHERE id = $1`,
    [id]
  );
}

export async function evictDebt(id: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE debts SET status = 'evicted', dig_until = NULL, dig_started_at = NULL,
     next_review_at = NULL,
     last_touched = datetime('now') WHERE id = $1`,
    [id]
  );
}

export async function deleteDebt(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE debts SET parent_id = NULL WHERE parent_id = $1", [id]);
  await d.execute(
    "DELETE FROM graph_edges WHERE a_debt = $1 OR b_debt = $1",
    [id]
  );
  await d.execute("DELETE FROM graph_nodes WHERE debt_id = $1", [id]);
  await d.execute("DELETE FROM attachments WHERE debt_id = $1", [id]);
  await d.execute("DELETE FROM debts WHERE id = $1", [id]);
}

export async function advanceReview(id: number): Promise<"next" | "done"> {
  const d = await getDb();
  const rows = await d.select<{ review_stage: number }[]>(
    "SELECT review_stage FROM debts WHERE id = $1",
    [id]
  );
  const stage = rows[0]?.review_stage ?? 0;
  if (stage >= 2) {
    await d.execute(
      `UPDATE debts SET next_review_at = NULL, review_stage = 3,
       last_touched = datetime('now') WHERE id = $1`,
      [id]
    );
    return "done";
  }
  const offset = stage === 0 ? "+14 days" : "+45 days";
  await d.execute(
    `UPDATE debts SET review_stage = review_stage + 1,
     next_review_at = datetime('now', $1),
     last_touched = datetime('now') WHERE id = $2`,
    [offset, id]
  );
  return "next";
}

// ---------- dig (timeboxing) ----------

export async function startDig(id: number, minutes: number): Promise<void> {
  const d = await getDb();
  const open = await d.select<{ id: number; dig_started_at: string | null }[]>(
    "SELECT id, dig_started_at FROM debts WHERE dig_until IS NOT NULL"
  );
  for (const row of open) {
    let spent = 0;
    if (row.dig_started_at) {
      spent = minutesBetween(row.dig_started_at);
    }
    await d.execute(
      `UPDATE debts SET dig_until = NULL, dig_started_at = NULL,
       time_spent_min = time_spent_min + $1 WHERE id = $2`,
      [spent, row.id]
    );
  }
  await d.execute(
    `UPDATE debts SET dig_until = datetime('now', '+' || $1 || ' minutes'),
     dig_started_at = datetime('now'),
     last_touched = datetime('now'), touch_count = touch_count + 1 WHERE id = $2`,
    [String(minutes), id]
  );
}

export async function extendDig(id: number, minutes: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE debts SET
       dig_until = datetime(
         CASE
           WHEN dig_until IS NOT NULL AND dig_until > datetime('now')
           THEN dig_until
           ELSE datetime('now')
         END,
         '+' || $1 || ' minutes'
       ),
       last_touched = datetime('now')
     WHERE id = $2 AND dig_until IS NOT NULL`,
    [String(minutes), id]
  );
}

export async function restartDig(id: number, minutes: number, spentSoFar: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE debts SET
       time_spent_min = time_spent_min + $1,
       dig_started_at = datetime('now'),
       dig_until = datetime('now', '+' || $2 || ' minutes'),
       last_touched = datetime('now')
     WHERE id = $3 AND dig_until IS NOT NULL`,
    [Math.max(0, Math.round(spentSoFar)), String(minutes), id]
  );
}

export async function endDig(id: number, minutesSpent: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE debts SET dig_until = NULL, dig_started_at = NULL,
     time_spent_min = time_spent_min + $1,
     last_touched = datetime('now') WHERE id = $2`,
    [Math.max(0, Math.round(minutesSpent)), id]
  );
}

export async function appendNoteLog(id: number, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const d = await getDb();
  const stamp = new Date().toISOString().slice(0, 10);
  const escaped = escapeHtml(trimmed);
  const html = `<p>[${stamp} ${t("digLog")}] ${escaped}</p>`;
  await d.execute(
    `UPDATE debts SET note = CASE WHEN note = '' THEN $1 ELSE note || $1 END,
     last_touched = datetime('now') WHERE id = $2`,
    [html, id]
  );
}

// ---------- attachments ----------

export async function listAttachments(debtId: number): Promise<Attachment[]> {
  const d = await getDb();
  return d.select<Attachment[]>(
    "SELECT * FROM attachments WHERE debt_id = $1 ORDER BY created_at",
    [debtId]
  );
}

export async function addAttachment(
  debtId: number,
  filename: string,
  path: string
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO attachments (debt_id, filename, path) VALUES ($1, $2, $3)",
    [debtId, filename, path]
  );
}

export async function removeAttachment(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM attachments WHERE id = $1", [id]);
}

// ---------- user-defined graphs ----------

export async function listGraphs(): Promise<GraphMeta[]> {
  const d = await getDb();
  return d.select<GraphMeta[]>("SELECT * FROM graphs ORDER BY created_at");
}

export async function createGraph(name: string): Promise<number> {
  const d = await getDb();
  const res = await d.execute("INSERT INTO graphs (name) VALUES ($1)", [name]);
  return res.lastInsertId ?? 0;
}

export async function renameGraph(id: number, name: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE graphs SET name = $1 WHERE id = $2", [name, id]);
}

export async function deleteGraph(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM graph_edges WHERE graph_id = $1", [id]);
  await d.execute("DELETE FROM graph_nodes WHERE graph_id = $1", [id]);
  await d.execute("DELETE FROM graphs WHERE id = $1", [id]);
}

export async function listGraphNodeIds(graphId: number): Promise<number[]> {
  const d = await getDb();
  const rows = await d.select<{ debt_id: number }[]>(
    "SELECT debt_id FROM graph_nodes WHERE graph_id = $1",
    [graphId]
  );
  return rows.map((r) => r.debt_id);
}

export async function addGraphNode(graphId: number, debtId: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT OR IGNORE INTO graph_nodes (graph_id, debt_id) VALUES ($1, $2)",
    [graphId, debtId]
  );
}

export async function removeGraphNode(graphId: number, debtId: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    "DELETE FROM graph_edges WHERE graph_id = $1 AND (a_debt = $2 OR b_debt = $2)",
    [graphId, debtId]
  );
  await d.execute("DELETE FROM graph_nodes WHERE graph_id = $1 AND debt_id = $2", [
    graphId,
    debtId,
  ]);
}

export async function listAllGraphEdges(): Promise<GraphEdge[]> {
  const d = await getDb();
  return d.select<GraphEdge[]>("SELECT id, a_debt, b_debt, directed, label FROM graph_edges");
}

export async function listGraphEdges(graphId: number): Promise<GraphEdge[]> {
  const d = await getDb();
  return d.select<GraphEdge[]>(
    "SELECT id, a_debt, b_debt, directed, label FROM graph_edges WHERE graph_id = $1",
    [graphId]
  );
}

export async function addGraphEdge(
  graphId: number,
  from: number,
  to: number,
  opts?: { directed?: boolean; label?: string }
): Promise<boolean> {
  if (from === to) return false;
  const d = await getDb();
  const existing = await d.select<{ id: number }[]>(
    `SELECT id FROM graph_edges
     WHERE graph_id = $1 AND ((a_debt = $2 AND b_debt = $3) OR (a_debt = $3 AND b_debt = $2))`,
    [graphId, from, to]
  );
  if (existing.length > 0) return false;
  await d.execute(
    `INSERT INTO graph_edges (graph_id, a_debt, b_debt, directed, label)
     VALUES ($1, $2, $3, $4, $5)`,
    [graphId, from, to, opts?.directed ? 1 : 0, opts?.label ?? ""]
  );
  return true;
}

export async function updateGraphEdge(
  id: number,
  a: number,
  b: number,
  directed: boolean,
  label: string
): Promise<void> {
  if (a === b) return;
  const d = await getDb();
  await d.execute(
    `UPDATE graph_edges SET a_debt = $1, b_debt = $2, directed = $3, label = $4 WHERE id = $5`,
    [a, b, directed ? 1 : 0, label.trim(), id]
  );
}

export async function removeGraphEdge(graphId: number, from: number, to: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    `DELETE FROM graph_edges
     WHERE graph_id = $1 AND ((a_debt = $2 AND b_debt = $3) OR (a_debt = $3 AND b_debt = $2))`,
    [graphId, from, to]
  );
}

export async function removeGraphEdgeById(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM graph_edges WHERE id = $1", [id]);
}

export async function pasteGraphComponent(
  destId: number,
  clip: {
    nodes: number[];
    edges: { a_debt: number; b_debt: number; directed: boolean; label: string }[];
  }
): Promise<{ nodes: number; edges: number }> {
  let nodes = 0;
  let edges = 0;
  const existing = new Set(await listGraphNodeIds(destId));
  for (const id of clip.nodes) {
    if (existing.has(id)) continue;
    await addGraphNode(destId, id);
    existing.add(id);
    nodes++;
  }
  for (const e of clip.edges) {
    if (!existing.has(e.a_debt) || !existing.has(e.b_debt)) continue;
    const ok = await addGraphEdge(destId, e.a_debt, e.b_debt, {
      directed: e.directed,
      label: e.label,
    });
    if (ok) edges++;
  }
  return { nodes, edges };
}

/** Parent → child on every graph the parent already sits on, or a new graph named after the parent. */
export async function recordSplitGraph(
  parentId: number,
  childId: number,
  parentTitle: string
): Promise<void> {
  const d = await getDb();
  let graphs = await d.select<{ graph_id: number }[]>(
    "SELECT graph_id FROM graph_nodes WHERE debt_id = $1",
    [parentId]
  );
  if (graphs.length === 0) {
    const name = parentTitle.replace(/\s+/g, " ").trim().slice(0, 80) || t("split");
    const graphId = await createGraph(name);
    await addGraphNode(graphId, parentId);
    graphs = [{ graph_id: graphId }];
  }
  for (const { graph_id } of graphs) {
    await addGraphNode(graph_id, childId);
    await addGraphEdge(graph_id, parentId, childId, { directed: true });
  }
}

// ---------- stats ----------

export async function getStats(): Promise<Stats> {
  const d = await getDb();
  const rows = await d.select<{ status: string; n: number }[]>(
    "SELECT status, COUNT(*) AS n FROM debts GROUP BY status"
  );
  const stats: Stats = { open: 0, resolved: 0 };
  for (const r of rows) {
    if (r.status === "open") stats.open = r.n;
    if (r.status === "resolved") stats.resolved = r.n;
  }
  return stats;
}
