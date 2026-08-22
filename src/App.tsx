import { useMemo, useRef, useState } from "react";
import { LOCALES, VIEW_MSG, useI18n } from "./i18n";
import { VIEW_ORDER } from "./types";
import type { Debt, Tier, View } from "./types";
import * as db from "./db";
import { checkExcerpt } from "./richtext";
import { exportBackup, importBackup } from "./backup";
import { lastGraphId, setLastGraphId } from "./graphPref";
import {
  completeTerritory,
  groupTopologies,
  islandContaining,
  repayBeat,
} from "./domain/islands";
import { useToast } from "./hooks/useToast";
import { useStudyData } from "./hooks/useStudyData";
import { useBoardFilters } from "./hooks/useBoardFilters";
import { useDigSession } from "./hooks/useDigSession";
import { useFileIngest } from "./hooks/useFileIngest";
import { CaptureBar } from "./components/CaptureBar";
import { SessionPicker } from "./components/SessionPicker";
import { Board } from "./components/Board";
import { DetailPanel } from "./components/DetailPanel";
import { DigBar, DigEndModal } from "./components/Dig";
import { GraphView } from "./components/GraphView";
import { ReviewPanel } from "./components/ReviewPanel";
import { ArchivePanel } from "./components/ArchivePanel";
import { ConfirmButton } from "./components/ConfirmButton";
import { MoreMenu } from "./components/MoreMenu";
import "./App.css";

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const { toast, showToast } = useToast();
  const [view, setView] = useState<View>("board");
  const flushDetailRef = useRef<(() => Promise<void>) | null>(null);
  const data = useStudyData();
  const board = useBoardFilters(data.allDebts, data.activeSession);
  const topos = useMemo(
    () => groupTopologies(data.graphNodes, data.graphEdges),
    [data.graphNodes, data.graphEdges]
  );
  const territory = useMemo(
    () => completeTerritory(topos, data.allDebts),
    [topos, data.allDebts]
  );
  const announceRepay = (id: number, snapshot: Debt[]) => {
    const before = islandContaining(id, topos, snapshot);
    const afterDebts = snapshot.map((d) =>
      d.id === id ? { ...d, status: "resolved" as const } : d
    );
    const after = islandContaining(id, topos, afterDebts);
    if (repayBeat(before, after) === "completed") {
      showToast(t("toastIslandComplete", { n: completeTerritory(topos, afterDebts).land }));
    } else {
      showToast(t("toastResolved"));
    }
  };
  const dig = useDigSession({
    openDebts: board.openDebts,
    allDebts: data.allDebts,
    setAllDebts: data.setAllDebts,
    refresh: data.refresh,
    setSelectedId: data.setSelectedId,
    showToast,
    t,
    onRepaid: announceRepay,
    flushDetailRef,
  });
  const { dropActive, attachmentsVersion } = useFileIngest({
    selectedIdRef: data.selectedIdRef,
    activeSessionRef: data.activeSessionRef,
    allDebtsRef: data.allDebtsRef,
    refresh: data.refresh,
    showToast,
  });

  const capture = async (title: string, tier: Tier, sourceUrl: string | null, note = "") => {
    const id = await db.createDebt({
      title,
      tier,
      note,
      sourceUrl,
      sessionId: data.activeSessionRef.current?.id ?? null,
    });
    await data.refresh();
    return id;
  };

  const evict = async (id: number) => {
    try {
      await flushDetailRef.current?.();
    } catch {
      /* evict with whatever is already saved */
    }
    await dig.settleDig(id);
    await db.evictDebt(id);
    if (data.selectedId === id) data.setSelectedId(null);
    await data.refresh();
    showToast(t("toastEvicted"));
  };

  const { selected, selectedId, setSelectedId, refresh } = data;
  const { activeDig } = dig;

  return (
    <div className={`app${activeDig ? " digging" : ""}`}>
      <header className="header">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <span className="brand-name">Study Map</span>
        </div>
        <SessionPicker
          sessions={data.sessions}
          active={data.activeSession}
          onSelect={async (id) => {
            await db.activateSession(id);
            await refresh();
          }}
          onCreate={async (topic) => {
            await db.createSession(topic);
            await refresh();
          }}
          onRename={async (id, topic) => {
            await db.renameSession(id, topic);
            await refresh();
          }}
          onDelete={async (id) => {
            await db.deleteSession(id);
            await refresh();
            showToast(t("toastSessionDeleted"));
          }}
        />
        <div className="header-right">
          <div className="stats">
            <span className="stat-pill stat-territory">{t("completeTerritory", { n: territory.land })}</span>
            <span className="stat-pill stat-explored">{t("statRepaid", { n: data.stats.resolved })}</span>
            <span className="stat-pill stat-unexplored">{t("statOpen", { n: data.stats.open })}</span>
          </div>
          <div className="view-toggle">
            {VIEW_ORDER.map((key) => (
              <button
                key={key}
                className={`${view === key ? "active" : ""}${
                  key === "review" && board.dueChecks.length > 0 ? " has-due" : ""
                }`}
                onClick={() => setView(key)}
              >
                <span className="view-ico" aria-hidden="true">
                  {key === "board" ? "▦" : key === "graph" ? "◎" : key === "review" ? "↻" : "✦"}
                </span>
                {key === "review" && board.dueChecks.length > 0
                  ? t("reviewCount", { n: board.dueChecks.length })
                  : t(VIEW_MSG[key])}
              </button>
            ))}
          </div>
          <MoreMenu title={t("more")}>
            <button
              type="button"
              className="more-menu-item"
              role="menuitem"
              onClick={async () => {
                try {
                  if (await exportBackup()) showToast(t("toastBackupSaved"));
                } catch (e) {
                  showToast(t("toastBackupFailed", { error: String(e) }));
                }
              }}
            >
              {t("backup")}
            </button>
            <ConfirmButton
              label={t("restore")}
              confirmLabel={t("restoreConfirm")}
              className="more-menu-item"
              onConfirm={async () => {
                try {
                  const ok = await importBackup();
                  if (ok) {
                    showToast(t("toastRestoreOk"));
                    window.setTimeout(() => window.location.reload(), 500);
                  }
                } catch (e) {
                  showToast(t("toastRestoreFailed", { error: String(e) }));
                }
              }}
            />
            <div className="more-menu-sep" />
            <button
              type="button"
              className="more-menu-item"
              role="menuitem"
              aria-pressed={dig.digFloat}
              onClick={() => dig.setDigFloat(!dig.digFloat)}
            >
              {dig.digFloat ? t("dockTimer") : t("floatTimer")}
            </button>
            <div className="more-menu-sep" />
            <div className="more-menu-label">{t("language")}</div>
            <div className="more-menu-langs">
              {LOCALES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`more-menu-lang${locale === l.id ? " active" : ""}`}
                  onClick={() => setLocale(l.id)}
                >
                  {l.native}
                </button>
              ))}
            </div>
          </MoreMenu>
        </div>
      </header>

      {activeDig && !dig.digExpired && !dig.digModalOpen && (
        <DigBar
          debt={activeDig}
          now={dig.now}
          floating={dig.digFloat}
          onFinishEarly={() => void dig.requestFinish()}
          onFloat={() => dig.setDigFloat(!dig.digFloat)}
        />
      )}

      {view === "board" && (
        <CaptureBar
          onCapture={capture}
          query={board.query}
          onQuery={board.setQuery}
          sessionTopic={data.activeSession?.topic ?? null}
          sessionOnly={board.sessionOnly}
          onToggleSession={() => board.setSessionOnly((v) => !v)}
          captureTier={board.captureTier}
          extraTiers={{ ram: board.showRam, storage: board.showStorage }}
          onSelectTier={board.selectTier}
        />
      )}

      <main className={`main ${selected ? "with-panel" : ""}`}>
        {view === "board" && (
          <Board
            debts={board.visibleOpen}
            selectedId={selectedId}
            visibleTiers={board.visibleTiers}
            onSelect={setSelectedId}
            onMove={async (id, tier) => {
              await db.setTier(id, tier);
              board.revealTier(tier);
              await refresh();
            }}
          />
        )}

        {view === "graph" && (
          <GraphView
            debts={data.allDebts}
            selectedId={selectedId}
            onSelectDebt={setSelectedId}
            showToast={showToast}
            mapRevision={`${data.graphNodes.map((n) => `${n.graph_id}:${n.debt_id}`).join(",")}|${data.graphEdges.map((e) => e.id).join(",")}`}
          />
        )}

        {view === "review" && (
          <ReviewPanel
            debts={board.openDebts}
            dueChecks={board.dueChecks}
            graphEdges={data.graphEdges}
            activeSession={data.activeSession}
            digActive={activeDig !== null}
            onSelect={setSelectedId}
            onStartDig={dig.startDig}
            onEvict={evict}
            onEvictMany={async (ids) => {
              for (const id of ids) {
                await dig.settleDig(id);
                await db.evictDebt(id);
              }
              setSelectedId(null);
              await refresh();
              showToast(t("toastEvictedMany", { n: ids.length }));
            }}
            onStillHolds={async (id) => {
              const result = await db.advanceReview(id);
              await refresh();
              showToast(result === "done" ? t("toastReviewDone") : t("toastReviewNext"));
            }}
            onReopen={async (id) => {
              await db.reopenDebt(id);
              setSelectedId(id);
              await refresh();
              showToast(t("toastReopened"));
            }}
          />
        )}

        {view === "resolved" && (
          <ArchivePanel
            items={board.archiveItems}
            filter={board.archiveFilter}
            resolvedCount={board.resolvedDebts.length}
            evictedCount={board.evictedDebts.length}
            query={board.archiveQuery}
            selectedId={selectedId}
            onFilter={board.setArchiveFilter}
            onQuery={board.setArchiveQuery}
            onSelect={setSelectedId}
          />
        )}

        {selected && (
          <DetailPanel
            key={selected.id}
            debt={selected}
            digActive={activeDig !== null}
            onStartDig={dig.startDig}
            attachmentsVersion={attachmentsVersion}
            graphs={data.graphs}
            onMap={data.graphNodes.some((n) => n.debt_id === selected.id)}
            onInvestigate={async (graphId) => {
              let gid = graphId ?? lastGraphId();
              if (gid != null && !data.graphs.some((g) => g.id === gid)) gid = null;
              if (gid == null && data.graphs.length === 1) gid = data.graphs[0].id;
              if (gid == null && data.graphs.length === 0) {
                const name =
                  selected.title.replace(/\s+/g, " ").trim().slice(0, 80) || t("investigate");
                gid = await db.createGraph(name);
              }
              if (gid == null) return;
              const existing = await db.listGraphNodeIds(gid);
              if (existing.includes(selected.id)) {
                setLastGraphId(gid);
                showToast(t("toastAlreadyInvestigating"));
                return;
              }
              await db.addGraphNode(gid, selected.id);
              setLastGraphId(gid);
              await refresh();
              showToast(t("toastIsletAdded"));
            }}
            onSplit={async (parentId, title, note) => {
              const parent = data.allDebts.find((d) => d.id === parentId);
              const before = islandContaining(parentId, topos, data.allDebts);
              const childId = await db.createDebt({
                title,
                note,
                tier: "cache",
                sessionId: parent?.session_id ?? data.activeSessionRef.current?.id ?? null,
              });
              if (childId) {
                await db.recordSplitGraph(parentId, childId, parent?.title ?? title);
              }
              await refresh();
              if (before?.complete) showToast(t("toastIslandEnlarge"));
              else showToast(t("toastSplit"));
            }}
            onSaveSourceFile={async (id, path) => {
              await db.updateDebt(id, { source_file: path });
              await refresh();
            }}
            onClose={() => setSelectedId(null)}
            forceWriter={dig.forceWriter}
            onForceWriterHandled={() => dig.setForceWriter(null)}
            onSaveNote={async (id, note) => {
              await db.updateDebt(id, { note });
              data.setAllDebts((prev) => prev.map((d) => (d.id === id ? { ...d, note } : d)));
            }}
            onSaveCheck={async (id, check) => {
              await db.updateDebt(id, { check_content: check });
              data.setAllDebts((prev) =>
                prev.map((d) => (d.id === id ? { ...d, check_content: check } : d))
              );
            }}
            onSaveTitle={async (id, title) => {
              await db.updateDebt(id, { title });
              await refresh();
            }}
            onSaveUrl={async (id, url) => {
              await db.updateDebt(id, { source_url: url });
              await refresh();
            }}
            onSetSession={async (id, sessionId) => {
              await db.updateDebt(id, { session_id: sessionId });
              await refresh();
            }}
            sessions={data.sessions}
            flushRef={flushDetailRef}
            showToast={showToast}
            onResolve={async (id, checkHtml) => {
              const snapshot = data.allDebts;
              try {
                await db.updateDebt(id, { check_content: checkHtml });
                await dig.settleDig(id);
                await db.resolveDebt(id, checkExcerpt(checkHtml) || t("checkFallback"));
                dig.clearDigUi();
                await refresh();
                announceRepay(id, snapshot);
              } catch (err) {
                console.error(err);
                showToast(t("toastSaveFailed"));
              }
            }}
            onReopen={async (id) => {
              await db.reopenDebt(id);
              await refresh();
            }}
            onEvict={evict}
            onDelete={async (id) => {
              try {
                await flushDetailRef.current?.();
              } catch {
                /* delete with whatever is already saved */
              }
              await dig.settleDig(id);
              await db.deleteDebt(id);
              setSelectedId(null);
              await refresh();
            }}
          />
        )}
      </main>

      {dropActive && (
        <div className="drop-overlay">
          <div className="drop-overlay-text">
            {selectedId !== null ? t("dropHere") : t("dropInbox")}
          </div>
        </div>
      )}

      <div id="writer-layer" className="writer-layer" />
      {dig.digModalOpen && activeDig && (
        <DigEndModal
          debt={activeDig}
          minutesSpent={dig.digMinutesSpent}
          expired={dig.digExpired}
          onResolve={dig.resolveDig}
          onReturn={dig.closeDig}
          onKeepDigging={dig.extendDig}
          onRestartDig={dig.restartDig}
          onDismiss={dig.resumeDig}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
