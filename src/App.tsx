import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import type { Debt, GraphEdge, Session, Stats, Tier, View } from "./types";
import { VIEW_ORDER, visibleBoardTiers } from "./types";
import * as db from "./db";
import { checkExcerpt, checkIsReady, matchesQuery } from "./richtext";
import { exportBackup, importBackup } from "./backup";
import { ingestDroppedPaths, ingestPastedImage, pasteTargetIsEditor } from "./ingest";
import { notify } from "./notify";
import { minutesBetween, parseUtc } from "./time";
import { LOCALES, VIEW_MSG, useI18n } from "./i18n";
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
import { digFloatEnabled, setDigFloatEnabled, setDigWindowVisible } from "./digFloat";
import "./App.css";

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const [allDebts, setAllDebts] = useState<Debt[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [stats, setStats] = useState<Stats>({ open: 0, resolved: 0 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<View>("board");
  const [query, setQuery] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<"resolved" | "evicted">("resolved");
  const [dropActive, setDropActive] = useState(false);
  const [attachmentsVersion, setAttachmentsVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [digFinishRequested, setDigFinishRequested] = useState(false);
  const [forceWriter, setForceWriter] = useState<null | "check">(null);
  const [pauseDigModal, setPauseDigModal] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(true);
  const [showRam, setShowRam] = useState(false);
  const [showStorage, setShowStorage] = useState(false);
  const [captureTier, setCaptureTier] = useState<Tier>("inbox");
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [digFloat, setDigFloatState] = useState(() => digFloatEnabled());
  const [digWindowOn, setDigWindowOn] = useState(false);
  const digNotifiedRef = useRef(false);
  const toastTimer = useRef<number | null>(null);

  const selectedIdRef = useRef<number | null>(null);
  const activeSessionRef = useRef<Session | null>(null);
  const allDebtsRef = useRef<Debt[]>([]);
  selectedIdRef.current = selectedId;
  activeSessionRef.current = activeSession;
  allDebtsRef.current = allDebts;

  const setDigFloat = (on: boolean) => {
    setDigFloatEnabled(on);
    setDigFloatState(on);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  };

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
    refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const openDebts = useMemo(() => allDebts.filter((d) => d.status === "open"), [allDebts]);
  const resolvedDebts = useMemo(
    () => allDebts.filter((d) => d.status === "resolved"),
    [allDebts]
  );
  const evictedDebts = useMemo(
    () => allDebts.filter((d) => d.status === "evicted"),
    [allDebts]
  );
  const sessionOpen = useMemo(() => {
    if (sessionOnly && activeSession) {
      return openDebts.filter((d) => d.session_id === activeSession.id);
    }
    return openDebts;
  }, [openDebts, sessionOnly, activeSession]);
  const visibleOpen = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessionOpen;
    return sessionOpen.filter((d) => matchesQuery(d, q));
  }, [sessionOpen, query]);
  const visibleTiers = useMemo(
    () => visibleBoardTiers(showRam, showStorage),
    [showRam, showStorage]
  );
  const dueChecks = useMemo(
    () =>
      resolvedDebts.filter(
        (d) => d.next_review_at !== null && parseUtc(d.next_review_at) <= Date.now()
      ),
    [resolvedDebts]
  );
  const archiveItems = useMemo(() => {
    const source = archiveFilter === "resolved" ? resolvedDebts : evictedDebts;
    const q = query.trim().toLowerCase();
    return source.filter((d) => matchesQuery(d, q));
  }, [archiveFilter, resolvedDebts, evictedDebts, query]);

  useEffect(() => {
    const unlisten = listen("debt-added", () => refresh());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  // ---------- dig (timeboxing) ----------

  const activeDig = openDebts.find((d) => d.dig_until !== null) ?? null;
  const digExpired = activeDig !== null && now >= parseUtc(activeDig.dig_until!);
  const digModalOpen =
    activeDig !== null && (digExpired || digFinishRequested) && !pauseDigModal;
  const digMinutesSpent = activeDig
    ? Math.round(
        (Math.min(now, parseUtc(activeDig.dig_until!)) -
          parseUtc(activeDig.dig_started_at ?? activeDig.dig_until!)) /
          60000
      )
    : 0;

  useEffect(() => {
    if (!activeDig) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [activeDig?.id]);

  useEffect(() => {
    if (digExpired && activeDig && !digNotifiedRef.current) {
      digNotifiedRef.current = true;
      notify(t("timeboxEnded"), activeDig.title);
      getCurrentWindow().show();
      getCurrentWindow().setFocus();
    }
    if (!digExpired) digNotifiedRef.current = false;
  }, [digExpired, activeDig?.id]);

  useEffect(() => {
    let cancelled = false;
    const want = Boolean(activeDig && !digModalOpen && digFloat);
    void setDigWindowVisible(want).then((ok) => {
      if (!cancelled) setDigWindowOn(want && ok);
    });
    return () => {
      cancelled = true;
    };
  }, [activeDig?.id, digModalOpen, digFloat]);

  useEffect(() => {
    const unFinish = listen("dig-finish-early", () => {
      setDigFinishRequested(true);
      const main = getCurrentWindow();
      void main.show().then(() => main.setFocus());
    });
    const unDock = listen("dig-dock", () => {
      setDigFloatEnabled(false);
      setDigFloatState(false);
      void setDigWindowVisible(false).then(() => setDigWindowOn(false));
    });
    return () => {
      unFinish.then((fn) => fn());
      unDock.then((fn) => fn());
    };
  }, []);

  const startDig = async (id: number, minutes: number) => {
    await db.startDig(id, minutes);
    setDigFinishRequested(false);
    setPauseDigModal(false);
    setNow(Date.now());
    await refresh();
    showToast(t("toastDigStart", { n: minutes }));
  };

  const settleDig = async (id: number) => {
    const current = allDebts.find((d) => d.id === id);
    if (!current?.dig_until) return;
    const spent =
      activeDig?.id === id
        ? digMinutesSpent
        : current.dig_started_at
          ? minutesBetween(current.dig_started_at)
          : 0;
    await db.endDig(id, spent);
    setAllDebts((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, dig_until: null, dig_started_at: null } : d
      )
    );
    setDigFinishRequested(false);
    setPauseDigModal(false);
  };

  const closeDig = async (log: string) => {
    if (!activeDig) return;
    if (log) await db.appendNoteLog(activeDig.id, log);
    await db.endDig(activeDig.id, digMinutesSpent);
    setDigFinishRequested(false);
    setPauseDigModal(false);
    await refresh();
  };

  const resolveDig = async () => {
    if (!activeDig) return;
    if (!checkIsReady(activeDig.check_content)) {
      setSelectedId(activeDig.id);
      setForceWriter("check");
      setPauseDigModal(true);
      showToast(t("toastNeedCheck"));
      return;
    }
    await db.endDig(activeDig.id, digMinutesSpent);
    await db.resolveDebt(activeDig.id, checkExcerpt(activeDig.check_content));
    setDigFinishRequested(false);
    setPauseDigModal(false);
    await refresh();
    showToast(t("toastResolved"));
  };

  // ---------- capture ----------

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

  const capture = async (title: string, tier: Tier, sourceUrl: string | null, note = "") => {
    const id = await db.createDebt({
      title,
      tier,
      note,
      sourceUrl,
      sessionId: activeSessionRef.current?.id ?? null,
    });
    await refresh();
    return id;
  };

  const ingestCtx = () => ({
    selectedId: selectedIdRef.current,
    sessionId: activeSessionRef.current?.id ?? null,
    debts: allDebtsRef.current,
  });

  const applyIngest = async (result: {
    toast: string;
    refresh: boolean;
    bumpAttachments: boolean;
  }) => {
    if (result.bumpAttachments) setAttachmentsVersion((v) => v + 1);
    if (result.refresh) await refresh();
    showToast(result.toast);
  };

  // ---------- external file drop (Tauri drag-drop event) ----------

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === "over") {
        setDropActive(true);
      } else if (event.payload.type === "leave") {
        setDropActive(false);
      } else if (event.payload.type === "drop") {
        setDropActive(false);
        try {
          await applyIngest(await ingestDroppedPaths(event.payload.paths, ingestCtx()));
        } catch (e) {
          showToast(t("toastFileFail", { error: String(e) }));
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  // ---------- global paste ----------

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (pasteTargetIsEditor(e.target)) return;

      const items = e.clipboardData?.items ?? [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          await applyIngest(await ingestPastedImage(file, ingestCtx()));
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [refresh]);

  // ---------- actions ----------

  const selected = allDebts.find((d) => d.id === selectedId) ?? null;

  const evict = async (id: number) => {
    await settleDig(id);
    await db.evictDebt(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
    showToast(t("toastEvicted"));
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">◈</span> Study Map
        </div>
        <SessionPicker
          sessions={sessions}
          active={activeSession}
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
            <span className="stat-explored">{t("statRepaid", { n: stats.resolved })}</span>
            <span className="stat-sep">·</span>
            <span className="stat-unexplored">{t("statOpen", { n: stats.open })}</span>
          </div>
          <div className="view-toggle">
            {VIEW_ORDER.map((key) => (
              <button
                key={key}
                className={view === key ? "active" : ""}
                onClick={() => setView(key)}
              >
                {key === "review" && dueChecks.length > 0
                  ? t("reviewCount", { n: dueChecks.length })
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
              aria-pressed={digFloat}
              onClick={() => setDigFloat(!digFloat)}
            >
              {digFloat ? t("dockTimer") : t("floatTimer")}
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

      {activeDig && !digModalOpen && !digWindowOn && (
        <DigBar
          debt={activeDig}
          now={now}
          onFinishEarly={() => setDigFinishRequested(true)}
          onFloat={() => setDigFloat(true)}
        />
      )}

      {view === "board" && (
        <CaptureBar
          onCapture={capture}
          query={query}
          onQuery={setQuery}
          sessionTopic={activeSession?.topic ?? null}
          sessionOnly={sessionOnly}
          onToggleSession={() => setSessionOnly((v) => !v)}
          captureTier={captureTier}
          extraTiers={{ ram: showRam, storage: showStorage }}
          onSelectTier={selectTier}
        />
      )}

      <main className={`main ${selected ? "with-panel" : ""}`}>
        {view === "board" && (
          <Board
            debts={visibleOpen}
            selectedId={selectedId}
            visibleTiers={visibleTiers}
            onSelect={(id) => setSelectedId(id)}
            onMove={async (id, tier) => {
              await db.setTier(id, tier);
              if (tier === "ram") setShowRam(true);
              if (tier === "storage") setShowStorage(true);
              await refresh();
            }}
          />
        )}

        {view === "graph" && (
          <GraphView
            debts={allDebts}
            selectedId={selectedId}
            onSelectDebt={(id) => setSelectedId(id)}
            showToast={showToast}
          />
        )}

        {view === "review" && (
          <ReviewPanel
            debts={openDebts}
            dueChecks={dueChecks}
            graphEdges={graphEdges}
            activeSession={activeSession}
            digActive={activeDig !== null}
            onSelect={(id) => setSelectedId(id)}
            onStartDig={startDig}
            onEvict={evict}
            onEvictMany={async (ids) => {
              for (const id of ids) {
                await settleDig(id);
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
            items={archiveItems}
            filter={archiveFilter}
            resolvedCount={resolvedDebts.length}
            evictedCount={evictedDebts.length}
            query={query}
            selectedId={selectedId}
            onFilter={setArchiveFilter}
            onQuery={setQuery}
            onSelect={setSelectedId}
          />
        )}

        {selected && (
          <DetailPanel
            debt={selected}
            digActive={activeDig !== null}
            onStartDig={startDig}
            attachmentsVersion={attachmentsVersion}
            diggingThis={activeDig?.id === selected.id}
            childrenDebts={allDebts.filter((d) => d.parent_id === selected.id)}
            onSelectRelated={(id) => setSelectedId(id)}
            onSplit={async (parentId, title, note) => {
              const parent = allDebts.find((d) => d.id === parentId);
              await db.createDebt({
                title,
                note,
                tier: "cache",
                sessionId: parent?.session_id ?? activeSessionRef.current?.id ?? null,
                parentId,
              });
              await refresh();
              showToast(t("toastSplit"));
            }}
            onSaveSourceFile={async (id, path) => {
              await db.updateDebt(id, { source_file: path });
              await refresh();
            }}
            onClose={() => setSelectedId(null)}
            forceWriter={forceWriter}
            onForceWriterHandled={() => setForceWriter(null)}
            onSaveNote={async (id, note) => {
              await db.updateDebt(id, { note });
              setAllDebts((prev) => prev.map((d) => (d.id === id ? { ...d, note } : d)));
            }}
            onSaveCheck={async (id, check) => {
              await db.updateDebt(id, { check_content: check });
              setAllDebts((prev) =>
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
            sessions={sessions}
            onResolve={async (id, checkHtml) => {
              await db.updateDebt(id, { check_content: checkHtml });
              await settleDig(id);
              await db.resolveDebt(id, checkExcerpt(checkHtml) || t("checkFallback"));
              setDigFinishRequested(false);
              setPauseDigModal(false);
              await refresh();
              showToast(t("toastResolved"));
            }}
            onReopen={async (id) => {
              await db.reopenDebt(id);
              await refresh();
            }}
            onEvict={evict}
            onDelete={async (id) => {
              await settleDig(id);
              await db.deleteDebt(id);
              setSelectedId(null);
              await refresh();
            }}
          />
        )}
      </main>

      {digModalOpen && activeDig && (
        <DigEndModal
          debt={activeDig}
          minutesSpent={digMinutesSpent}
          expired={digExpired}
          onResolve={resolveDig}
          onNeedCheck={() => {
            setSelectedId(activeDig.id);
            setForceWriter("check");
            setPauseDigModal(true);
            showToast(t("toastWriteCheck"));
          }}
          onReturn={closeDig}
        />
      )}

      {dropActive && (
        <div className="drop-overlay">
          <div className="drop-overlay-text">
            {selectedId !== null ? t("dropHere") : t("dropInbox")}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
