import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Debt, GraphEdge, Session, Stats } from "../types";
import * as db from "../db";

/** Loads and refreshes the local SQLite snapshot used by every view. */
export function useStudyData() {
  const [allDebts, setAllDebts] = useState<Debt[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [stats, setStats] = useState<Stats>({ open: 0, resolved: 0 });
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selectedIdRef = useRef<number | null>(null);
  const activeSessionRef = useRef<Session | null>(null);
  const allDebtsRef = useRef<Debt[]>([]);
  selectedIdRef.current = selectedId;
  activeSessionRef.current = activeSession;
  allDebtsRef.current = allDebts;

  const refresh = useCallback(async () => {
    const [d, s, active, st, edges] = await Promise.all([
      db.listAllDebts(),
      db.listSessions(),
      db.getActiveSession(),
      db.getStats(),
      db.listAllGraphEdges(),
    ]);
    setAllDebts(d);
    setSessions(s);
    setActiveSession(active);
    setStats(st);
    setGraphEdges(edges);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unlisten = listen("debt-added", () => refresh());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  const selected = allDebts.find((d) => d.id === selectedId) ?? null;

  return {
    allDebts,
    setAllDebts,
    sessions,
    activeSession,
    stats,
    graphEdges,
    selectedId,
    setSelectedId,
    selected,
    refresh,
    selectedIdRef,
    activeSessionRef,
    allDebtsRef,
  };
}
