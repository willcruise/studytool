import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { Debt, Session, Tier } from "./types";
import * as db from "./db";
import { checkExcerpt, checkIsReady, htmlToText } from "./richtext";
import { getImageSink, ingestImageFile, ingestImagePath, isImagePath } from "./images";
import { importFile } from "./files";
import { CaptureBar } from "./components/CaptureBar";
import { SessionPicker } from "./components/SessionPicker";
import { Board } from "./components/Board";
import { DetailPanel } from "./components/DetailPanel";
import { DigBar, DigEndModal, parseUtc } from "./components/Dig";
import { GraphView } from "./components/GraphView";
import { ReviewPanel } from "./components/ReviewPanel";
import "./App.css";

async function notify(title: string, body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) sendNotification({ title, body });
  } catch {
    /* notifications are best-effort */
  }
}

type View = "board" | "graph" | "review" | "resolved";

function matchesQuery(d: Debt, q: string): boolean {
  if (!q) return true;
  const hay = [
    d.title,
    htmlToText(d.note),
    htmlToText(d.check_content),
    d.summary ?? "",
    d.session_topic ?? "",
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

export default function App() {
  const [allDebts, setAllDebts] = useState<Debt[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [stats, setStats] = useState<db.Stats>({ open: 0, resolved: 0 });
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
  const digNotifiedRef = useRef(false);

  const selectedIdRef = useRef<number | null>(null);
  const activeSessionRef = useRef<Session | null>(null);
  selectedIdRef.current = selectedId;
  activeSessionRef.current = activeSession;

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const refresh = useCallback(async () => {
    const [d, s, active, st] = await Promise.all([
      db.listAllDebts(),
      db.listSessions(),
      db.getActiveSession(),
      db.getStats(),
    ]);
    setAllDebts(d);
    setSessions(s);
    setActiveSession(active);
    setStats(st);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openDebts = useMemo(() => allDebts.filter((d) => d.status === "open"), [allDebts]);
  const resolvedDebts = useMemo(
    () => allDebts.filter((d) => d.status === "resolved"),
    [allDebts]
  );
  const evictedDebts = useMemo(
    () => allDebts.filter((d) => d.status === "evicted"),
    [allDebts]
  );
  const visibleOpen = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return openDebts;
    return openDebts.filter((d) => matchesQuery(d, q));
  }, [openDebts, query]);
  const archiveItems = (archiveFilter === "resolved" ? resolvedDebts : evictedDebts).filter(
    (d) => {
      const q = query.trim().toLowerCase();
      return matchesQuery(d, q);
    }
  );
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
          ? Math.max(0, Math.round((Date.now() - parseUtc(current.dig_started_at)) / 60000))
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

  // ---------- external file drop (Tauri drag-drop event) ----------

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === "over") {
        setDropActive(true);
      } else if (event.payload.type === "leave") {
        setDropActive(false);
      } else if (event.payload.type === "drop") {
        setDropActive(false);
        const paths = event.payload.paths;
        try {
          const targetId = selectedIdRef.current;
          const sink = getImageSink();
          let inserted = 0;
          let attached = 0;
          for (const p of paths) {
            if (sink && targetId !== null && isImagePath(p)) {
              const stored = await ingestImagePath(targetId, p);
              if (stored) {
                sink(stored);
                inserted += 1;
                continue;
              }
            }
            const stored = await importFile(p);
            const filename = p.split("/").pop() ?? "file";
            if (targetId !== null) {
              await db.addAttachment(targetId, filename, stored);
            } else {
              const id = await db.createDebt({
                title: filename,
                tier: "inbox",
                sessionId: activeSessionRef.current?.id ?? null,
              });
              await db.addAttachment(id, filename, stored);
            }
            attached += 1;
          }
          setAttachmentsVersion((v) => v + 1);
          if (attached > 0) await refresh();
          showToast(
            inserted > 0
              ? `사진 ${inserted}장을 에디터에 추가했습니다`
              : targetId !== null
                ? `파일 ${attached}개를 선택된 항목에 첨부했습니다`
                : `파일 ${paths.length}개를 인박스에 추가했습니다`
          );
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
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest?.("[contenteditable='true'], .rich-editor")
      ) {
        return;
      }

      const items = e.clipboardData?.items ?? [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const targetId = selectedIdRef.current;
          const sink = getImageSink();
          if (sink && targetId !== null) {
            const stored = await ingestImageFile(targetId, file);
            sink(stored);
            setAttachmentsVersion((v) => v + 1);
            showToast("사진을 에디터에 넣었습니다");
            return;
          }
          if (targetId !== null) {
            await ingestImageFile(targetId, file);
            showToast("이미지를 선택된 항목에 첨부했습니다");
          } else {
            const id = await db.createDebt({
              title: "붙여넣은 이미지",
              tier: "inbox",
              sessionId: activeSessionRef.current?.id ?? null,
            });
            await ingestImageFile(id, file);
            showToast("이미지를 인박스에 추가했습니다");
          }
          setAttachmentsVersion((v) => v + 1);
          await refresh();
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

  const VIEWS: { key: View; label: string }[] = [
    { key: "board", label: "보드" },
    { key: "graph", label: "지도" },
    { key: "review", label: "리뷰" },
    { key: "resolved", label: "탐험 완료" },
  ];

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
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {activeDig && !digModalOpen && (
        <DigBar debt={activeDig} now={now} onFinishEarly={() => setDigFinishRequested(true)} />
      )}

      {view === "board" && (
        <CaptureBar onCapture={capture} query={query} onQuery={setQuery} />
      )}

      <main className={`main ${selected ? "with-panel" : ""}`}>
        {view === "board" && (
          <Board
            debts={visibleOpen}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onMove={async (id, tier) => {
              await db.setTier(id, tier);
              await refresh();
            }}
          />
        )}

        {view === "graph" && (
          <GraphView
            debts={allDebts}
            sessions={sessions}
            selectedId={selectedId}
            onSelectDebt={(id) => setSelectedId(id)}
            showToast={showToast}
          />
        )}

        {view === "review" && (
          <ReviewPanel
            debts={openDebts}
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
          />
        )}

        {view === "resolved" && (
          <div className="archive-wrap">
            <div className="archive-toolbar">
              <div className="view-toggle">
                <button
                  className={archiveFilter === "resolved" ? "active" : ""}
                  onClick={() => setArchiveFilter("resolved")}
                >
                  탐험 완료 {resolvedDebts.length}
                </button>
                <button
                  className={archiveFilter === "evicted" ? "active" : ""}
                  onClick={() => setArchiveFilter("evicted")}
                >
                  방출됨 {evictedDebts.length}
                </button>
              </div>
              <input
                className="board-search"
                placeholder="보관함에서 찾기"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="resolved-list">
              {archiveItems.length === 0 && (
                <div className="column-empty">
                  {archiveFilter === "resolved"
                    ? "아직 탐험 완료한 영역이 없습니다"
                    : "방출된 항목이 없습니다"}
                </div>
              )}
              {archiveItems.map((d) => (
                <div
                  key={d.id}
                  className={`resolved-item ${d.id === selectedId ? "selected" : ""}`}
                  onClick={() => setSelectedId(d.id)}
                >
                  <div className="debt-title">{d.title}</div>
                  <div className="resolved-item-summary">
                    {archiveFilter === "resolved"
                      ? d.summary || checkExcerpt(d.check_content)
                      : htmlToText(d.note) || "(메모 없음)"}
                  </div>
                  {d.session_topic && <div className="debt-session">◈ {d.session_topic}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {selected && (
          <DetailPanel
            debt={selected}
            digActive={activeDig !== null}
            onStartDig={startDig}
            attachmentsVersion={attachmentsVersion}
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
                ? "놓으면 에디터에 사진이 들어갑니다 (다른 파일은 첨부)"
                : "놓으면 선택된 항목에 첨부됩니다"
              : "놓으면 인박스에 추가됩니다"}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
