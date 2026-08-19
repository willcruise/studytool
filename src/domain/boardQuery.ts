import type { Debt, Session, Status, Tier } from "../types";
import { visibleBoardTiers } from "../types";
import { matchesQuery } from "../richtext";
import { parseUtc } from "../time";

export function debtsByStatus(all: Debt[], status: Status): Debt[] {
  return all.filter((d) => d.status === status);
}

export function sessionScopedOpen(
  open: Debt[],
  sessionOnly: boolean,
  activeSession: Session | null
): Debt[] {
  if (sessionOnly && activeSession) {
    return open.filter((d) => d.session_id === activeSession.id);
  }
  return open;
}

export function filterByQuery(debts: Debt[], query: string): Debt[] {
  const q = query.trim().toLowerCase();
  if (!q) return debts;
  return debts.filter((d) => matchesQuery(d, q));
}

export function dueCheckDebts(resolved: Debt[], now = Date.now()): Debt[] {
  return resolved.filter(
    (d) => d.next_review_at !== null && parseUtc(d.next_review_at) <= now
  );
}

export function archiveDebts(
  resolved: Debt[],
  evicted: Debt[],
  filter: "resolved" | "evicted",
  query: string
): Debt[] {
  return filterByQuery(filter === "resolved" ? resolved : evicted, query);
}

export function boardTiers(showRam: boolean, showStorage: boolean): Tier[] {
  return visibleBoardTiers(showRam, showStorage);
}

export function childrenOf(all: Debt[], parentId: number): Debt[] {
  return all.filter((d) => d.parent_id === parentId);
}
