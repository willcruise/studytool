import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import type { Debt, GraphEdge, Session, Stats, Tier, View } from "./types";
import { VIEWS, visibleBoardTiers } from "./types";
import * as db from "./db";
import { checkExcerpt, checkIsReady, matchesQuery } from "./richtext";
import { getImageSink } from "./images";
import { exportBackup, importBackup } from "./backup";
import { ingestDroppedPaths, ingestPastedImage, pasteTargetIsEditor } from "./ingest";
import { notify } from "./notify";
import { minutesBetween, parseUtc } from "./time";
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
  const digNotifiedRef = useRef(false);
  const toastTimer = useRef<number | null>(null);

  const selectedIdRef = useRef<number | null>(null);
  const activeSessionRef = useRef<Session | null>(null);
  const allDebtsRef = useRef<Debt[]>([]);
  selectedIdRef.current = selectedId;
  activeSessionRef.current = activeSession;
  allDebtsRef.current = allDebts;

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
      notify("타임박스 종료", `"${activeDig.title}" — Check를 작성하고 메인 학습으로 복귀하세요`);
      getCurrentWindow().show();
      getCurrentWindow().setFocus();
    }
    if (!digExpired) digNotifiedRef.current = false;
  }, [digExpired, activeDig?.id]);

  const startDig = async (id: number, minutes: number) => {
    await db.startDig(id, minutes);
    setDigFinishRequested(false);
    setPauseDigModal(false);
    setNow(Date.now());
    await refresh();
    showToast(`${minutes}분 타임박스 시작 — 알람이 울리면 정리하고 복귀합니다`);
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
      showToast("상환하려면 핵심 Check를 먼저 작성하세요");
      return;
    }
    await db.endDig(activeDig.id, digMinutesSpent);
    await db.resolveDebt(activeDig.id, checkExcerpt(activeDig.check_content));
    setDigFinishRequested(false);
    setPauseDigModal(false);
    await refresh();
    showToast("상환 완료 — 지도의 한 영역을 밝혔습니다");
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
          showToast(`파일 저장 실패: ${e}`);
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
    showToast("방출했습니다 — 진짜 중요하면 다시 마주치게 됩니다");
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
            showToast("세션을 삭제했습니다 — 연결됐던 항목은 남아 있습니다");
          }}
        />
        <div className="header-right">
          <div className="stats" title="갚아야 할 빚이 아니라, 탐험할 지도입니다">
            <span className="stat-explored">탐험 완료 {stats.resolved}</span>
            <span className="stat-sep">·</span>
            <span className="stat-unexplored">미탐험 {stats.open}</span>
          </div>
          <div className="view-toggle">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                className={view === v.key ? "active" : ""}
                onClick={() => setView(v.key)}
              >
                {v.key === "review" && dueChecks.length > 0
                  ? `리뷰 ${dueChecks.length}`
                  : v.label}
              </button>
            ))}
          </div>
          <MoreMenu>
            <button
              type="button"
              className="more-menu-item"
              role="menuitem"
              title="데이터베이스와 첨부를 zip으로 저장"
              onClick={async () => {
                try {
                  if (await exportBackup()) showToast("백업을 저장했습니다");
                } catch (e) {
                  showToast(`백업 실패: ${e}`);
                }
              }}
            >
              백업
            </button>
            <ConfirmButton
              label="복원"
              confirmLabel="덮어쓸까요?"
              className="more-menu-item"
              title="백업 zip으로 현재 데이터를 덮어씁니다"
              onConfirm={async () => {
                try {
                  const ok = await importBackup();
                  if (ok) {
                    showToast("복원했습니다. 다시 불러옵니다");
                    window.setTimeout(() => window.location.reload(), 500);
                  }
                } catch (e) {
                  showToast(`복원 실패: ${e}`);
                }
              }}
            />
          </MoreMenu>
        </div>
      </header>

      {activeDig && !digModalOpen && (
        <DigBar debt={activeDig} now={now} onFinishEarly={() => setDigFinishRequested(true)} />
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
              showToast(`${ids.length}개 항목을 방출했습니다`);
            }}
            onStillHolds={async (id) => {
              const result = await db.advanceReview(id);
              await refresh();
              showToast(
                result === "done"
                  ? "이 Check는 지도에 남았습니다"
                  : "다음에 다시 만납니다"
              );
            }}
            onReopen={async (id) => {
              await db.reopenDebt(id);
              setSelectedId(id);
              await refresh();
              showToast("다시 열었습니다");
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
              showToast("Cache에 갈래를 만들었습니다");
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
              await db.resolveDebt(id, checkExcerpt(checkHtml) || "핵심 Check");
              setDigFinishRequested(false);
              setPauseDigModal(false);
              await refresh();
              showToast("상환 완료 — 지도의 한 영역을 밝혔습니다");
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
            showToast("Check를 작성한 뒤 상환하기를 누르세요");
          }}
          onReturn={closeDig}
        />
      )}

      {dropActive && (
        <div className="drop-overlay">
          <div className="drop-overlay-text">
            {selectedId !== null
              ? getImageSink()
                ? "놓으면 에디터에 사진이 들어갑니다 (PDF는 출처, 다른 파일은 첨부)"
                : "놓으면 선택된 항목에 붙습니다 (PDF는 출처 파일)"
              : "놓으면 인박스에 추가됩니다 (PDF는 출처가 있는 항목으로)"}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
