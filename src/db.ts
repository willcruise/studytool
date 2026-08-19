import Database from "@tauri-apps/plugin-sql";
import type { Attachment, Debt, Session, Status, Tier } from "./types";
import { toEditorHtml } from "./richtext";

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
  SELECT d.*, s.topic AS session_topic,
    (SELECT COUNT(*) FROM attachments a WHERE a.debt_id = d.id) AS attachment_count
  FROM debts d LEFT JOIN sessions s ON s.id = d.session_id
`;

export async function listDebts(status: Status = "open"): Promise<Debt[]> {
  const d = await getDb();
  return d.select<Debt[]>(
    `${DEBT_SELECT} WHERE d.status = $1 ORDER BY d.created_at DESC`,
    [status]
  );
}

export async function listAllDebts(): Promise<Debt[]> {
  const d = await getDb();
  return d.select<Debt[]>(`${DEBT_SELECT} ORDER BY d.created_at DESC`);
}

export async function createDebt(input: {
  title: string;
  tier?: Tier;
  note?: string;
  sessionId?: number | null;
  sourceUrl?: string | null;
}): Promise<number> {
  const d = await getDb();
  const res = await d.execute(
    `INSERT INTO debts (title, tier, note, session_id, source_url)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.title,
      input.tier ?? "inbox",
      input.note ? toEditorHtml(input.note) : "",
      input.sessionId ?? null,
      input.sourceUrl ?? null,
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
     last_touched = datetime('now') WHERE id = $2`,
    [summary, id]
  );
}

export async function reopenDebt(id: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE debts SET status = 'open', resolved_at = NULL,
     dig_until = NULL, dig_started_at = NULL,
     last_touched = datetime('now') WHERE id = $1`,
    [id]
  );
}

export async function evictDebt(id: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE debts SET status = 'evicted', dig_until = NULL, dig_started_at = NULL,
     last_touched = datetime('now') WHERE id = $1`,
    [id]
  );
}

export async function deleteDebt(id: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    "DELETE FROM graph_edges WHERE a_debt = $1 OR b_debt = $1",
    [id]
  );
  await d.execute("DELETE FROM graph_nodes WHERE debt_id = $1", [id]);
  await d.execute("DELETE FROM attachments WHERE debt_id = $1", [id]);
  await d.execute("DELETE FROM debts WHERE id = $1", [id]);
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
      const start = new Date(row.dig_started_at.replace(" ", "T") + "Z").getTime();
      spent = Math.max(0, Math.round((Date.now() - start) / 60000));
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
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = `<p>[${stamp} 파보기] ${escaped}</p>`;
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

export interface GraphMeta {
  id: number;
  name: string;
  created_at: string;
}

export interface GraphEdge {
  a_debt: number;
  b_debt: number;
}

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

export async function listGraphEdges(graphId: number): Promise<GraphEdge[]> {
  const d = await getDb();
  return d.select<GraphEdge[]>(
    "SELECT a_debt, b_debt FROM graph_edges WHERE graph_id = $1",
    [graphId]
  );
}

export async function addGraphEdge(
  graphId: number,
  a: number,
  b: number
): Promise<void> {
  const d = await getDb();
  // store edges in canonical order so duplicates in either direction are rejected
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await d.execute(
    "INSERT OR IGNORE INTO graph_edges (graph_id, a_debt, b_debt) VALUES ($1, $2, $3)",
    [graphId, lo, hi]
  );
}

export async function removeGraphEdge(
  graphId: number,
  a: number,
  b: number
): Promise<void> {
  const d = await getDb();
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await d.execute(
    "DELETE FROM graph_edges WHERE graph_id = $1 AND a_debt = $2 AND b_debt = $3",
    [graphId, lo, hi]
  );
}

// ---------- stats ----------

export interface Stats {
  open: number;
  resolved: number;
}

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
