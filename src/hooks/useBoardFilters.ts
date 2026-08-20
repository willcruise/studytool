import { useMemo, useState } from "react";
import type { Debt, Session, Tier } from "../types";
import {
  archiveDebts,
  boardTiers,
  debtsByStatus,
  dueCheckDebts,
  filterByQuery,
  sessionScopedOpen,
} from "../domain/boardQuery";

export function useBoardFilters(allDebts: Debt[], activeSession: Session | null) {
  const [query, setQuery] = useState("");
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<"resolved" | "evicted">("resolved");
  const [sessionOnly, setSessionOnly] = useState(true);
  const [showRam, setShowRam] = useState(false);
  const [showStorage, setShowStorage] = useState(false);
  const [captureTier, setCaptureTier] = useState<Tier>("inbox");

  const openDebts = useMemo(() => debtsByStatus(allDebts, "open"), [allDebts]);
  const resolvedDebts = useMemo(() => debtsByStatus(allDebts, "resolved"), [allDebts]);
  const evictedDebts = useMemo(() => debtsByStatus(allDebts, "evicted"), [allDebts]);

  const visibleOpen = useMemo(
    () => filterByQuery(sessionScopedOpen(openDebts, sessionOnly, activeSession), query),
    [openDebts, sessionOnly, activeSession, query]
  );
  const visibleTiers = useMemo(
    () => boardTiers(showRam, showStorage),
    [showRam, showStorage]
  );
  const dueChecks = useMemo(() => dueCheckDebts(resolvedDebts), [resolvedDebts]);
  const archiveItems = useMemo(
    () => archiveDebts(resolvedDebts, evictedDebts, archiveFilter, archiveQuery),
    [archiveFilter, resolvedDebts, evictedDebts, archiveQuery]
  );

  const selectTier = (tier: Tier) => {
    if (tier === "ram") {
      if (showRam) {
        setShowRam(false);
        if (captureTier === "ram") setCaptureTier(showStorage ? "storage" : "inbox");
      } else {
        setShowRam(true);
        setCaptureTier("ram");
      }
      return;
    }
    if (tier === "storage") {
      if (showStorage) {
        setShowStorage(false);
        if (captureTier === "storage") setCaptureTier(showRam ? "ram" : "inbox");
      } else {
        setShowStorage(true);
        setCaptureTier("storage");
      }
      return;
    }
    setCaptureTier(tier);
  };

  const revealTier = (tier: Tier) => {
    if (tier === "ram") setShowRam(true);
    if (tier === "storage") setShowStorage(true);
  };

  return {
    query,
    setQuery,
    archiveQuery,
    setArchiveQuery,
    archiveFilter,
    setArchiveFilter,
    sessionOnly,
    setSessionOnly,
    showRam,
    showStorage,
    captureTier,
    selectTier,
    revealTier,
    openDebts,
    resolvedDebts,
    evictedDebts,
    visibleOpen,
    visibleTiers,
    dueChecks,
    archiveItems,
  };
}
