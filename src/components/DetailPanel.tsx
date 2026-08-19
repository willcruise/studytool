import { useEffect, useRef, useState } from "react";
import type { Attachment, Debt, Session } from "../types";
import { TIER_META } from "../types";
import { listAttachments, removeAttachment } from "../db";
import { basename, openAttachment } from "../files";
import { relativeAge } from "../time";
import { ConfirmButton } from "./ConfirmButton";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import { CHECK_MIN_CHARS, checkIsReady } from "../richtext";

interface Props {
  debt: Debt;
  digActive: boolean;
  onStartDig: (id: number, minutes: number) => void;
  onClose: () => void;
  onSaveNote: (id: number, note: string) => void;
  onSaveCheck: (id: number, check: string) => void;
  onSaveTitle: (id: number, title: string) => void;
  onSaveUrl: (id: number, url: string | null) => void;
  onSetSession: (id: number, sessionId: number | null) => void;
  sessions: Session[];
  onResolve: (id: number, summary: string) => void;
  onReopen: (id: number) => void;
  onEvict: (id: number) => void;
  onDelete: (id: number) => void;
  forceWriter?: null | "check";
  onForceWriterHandled?: () => void;
  /** bumped by the parent whenever attachments change externally (e.g. file drop) */
  attachmentsVersion: number;
  diggingThis?: boolean;
  childrenDebts: Debt[];
  onSelectRelated: (id: number) => void;
  onSplit: (parentId: number, title: string, note: string) => void;
  onSaveSourceFile: (id: number, path: string | null) => void;
}

export function DetailPanel({
  debt,
  digActive,
  onStartDig,
  onClose,
  onSaveNote,
  onSaveCheck,
  onSaveTitle,
  onSaveUrl,
  onSetSession,
  sessions,
  onResolve,
  onReopen,
  onEvict,
  onDelete,
  forceWriter,
  onForceWriterHandled,
  attachmentsVersion,
  diggingThis = false,
  childrenDebts,
  onSelectRelated,
  onSplit,
  onSaveSourceFile,
}: Props) {
  const [note, setNote] = useState(debt.note);
  const [check, setCheck] = useState(debt.check_content ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(debt.title);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlValue, setUrlValue] = useState(debt.source_url ?? "");
  const [writer, setWriter] = useState<null | "note" | "check">(null);
  const [noteRev, setNoteRev] = useState(0);
  const [splitTitle, setSplitTitle] = useState("");
  const [splitting, setSplitting] = useState(false);
  const noteEditorRef = useRef<RichEditorHandle>(null);
  const noteTimer = useRef<number>(0);
  const checkTimer = useRef<number>(0);
  const noteRef = useRef(note);
  const checkRef = useRef(check);
  const origNoteRef = useRef(debt.note);
  const origCheckRef = useRef(debt.check_content ?? "");
  const editingIdRef = useRef(debt.id);
  const onSaveNoteRef = useRef(onSaveNote);
  const onSaveCheckRef = useRef(onSaveCheck);
  const idAtNoteRef = useRef(debt.id);
  noteRef.current = note;
  checkRef.current = check;
  onSaveNoteRef.current = onSaveNote;
  onSaveCheckRef.current = onSaveCheck;

  const flushNow = (id: number) => {
    window.clearTimeout(noteTimer.current);
    window.clearTimeout(checkTimer.current);
    noteTimer.current = 0;
    checkTimer.current = 0;
    if (noteRef.current !== origNoteRef.current) {
      onSaveNoteRef.current(id, noteRef.current);
      origNoteRef.current = noteRef.current;
    }
    if (checkRef.current !== origCheckRef.current) {
      onSaveCheckRef.current(id, checkRef.current);
      origCheckRef.current = checkRef.current;
    }
  };

  useEffect(() => {
    return () => {
      flushNow(editingIdRef.current);
    };
  }, [debt.id]);

  useEffect(() => {
    setNote(debt.note);
    setCheck(debt.check_content ?? "");
    setEditingTitle(false);
    setTitleValue(debt.title);
    setEditingUrl(false);
    setUrlValue(debt.source_url ?? "");
    setWriter(null);
    setNoteRev(0);
    setSplitTitle("");
    setSplitting(false);
    origNoteRef.current = debt.note;
    origCheckRef.current = debt.check_content ?? "";
    editingIdRef.current = debt.id;
  }, [debt.id]);

  useEffect(() => {
    const sameItem = idAtNoteRef.current === debt.id;
    idAtNoteRef.current = debt.id;
    if (!sameItem || noteTimer.current) return;
    if (debt.note !== noteRef.current) {
      setNote(debt.note);
      origNoteRef.current = debt.note;
      setNoteRev((n) => n + 1);
    }
  }, [debt.note, debt.id]);

  useEffect(() => {
    if (forceWriter) {
      setWriter(forceWriter);
      onForceWriterHandled?.();
    }
  }, [forceWriter]);

  const queueNote = (html: string) => {
    setNote(html);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => {
      onSaveNote(debt.id, html);
      origNoteRef.current = html;
      noteTimer.current = 0;
    }, 450);
  };

  const queueCheck = (html: string) => {
    setCheck(html);
    window.clearTimeout(checkTimer.current);
    checkTimer.current = window.setTimeout(() => {
      onSaveCheck(debt.id, html);
      origCheckRef.current = html;
      checkTimer.current = 0;
    }, 450);
  };

  const flush = () => flushNow(editingIdRef.current);

  const close = () => {
    flush();
    onClose();
  };

  const submitSplit = () => {
    const selected = noteEditorRef.current?.selectedText() ?? "";
    const typed = splitTitle.trim();
    const title = (typed || selected.split("\n")[0] || "").slice(0, 160).trim();
    if (!title) return;
    const note = selected && selected !== title ? selected : "";
    onSplit(debt.id, title, note);
    setSplitTitle("");
  };

  const saveTitle = () => {
    const t = titleValue.trim();
    if (t && t !== debt.title) onSaveTitle(debt.id, t);
    setEditingTitle(false);
  };

  const saveUrl = () => {
    const u = urlValue.trim();
    onSaveUrl(debt.id, u === "" ? null : u);
    setEditingUrl(false);
  };

  useEffect(() => {
    listAttachments(debt.id).then(setAttachments);
  }, [debt.id, attachmentsVersion]);

  const meta = TIER_META[debt.tier];

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <span className="tier-tag" style={{ borderColor: meta.color, color: meta.color }}>
          {meta.label}
        </span>
        <button className="ghost-btn" onClick={close}>
          닫기 ✕
        </button>
      </div>

      {editingTitle ? (
        <textarea
          autoFocus
          rows={Math.min(6, Math.max(1, titleValue.split("\n").length))}
          className="detail-title-input"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && e.shiftKey) {
              e.preventDefault();
              const el = e.currentTarget;
              const start = el.selectionStart;
              const end = el.selectionEnd;
              const next = titleValue.slice(0, start) + "\n" + titleValue.slice(end);
              setTitleValue(next);
              requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = start + 1;
              });
              return;
            }
            if (e.key === "Enter" && e.shiftKey) {
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              saveTitle();
            }
            if (e.key === "Escape") {
              setTitleValue(debt.title);
              setEditingTitle(false);
            }
          }}
          onBlur={saveTitle}
        />
      ) : (
        <h2 className="detail-title editable" title="클릭해서 제목 수정" onClick={() => setEditingTitle(true)}>
          {debt.title} <span className="edit-pencil">✎</span>
        </h2>
      )}
      <div className="detail-sub">
        {relativeAge(debt.created_at)}
        {debt.time_spent_min > 0 && <span> · 지금까지 {debt.time_spent_min}분 탐색</span>}
      </div>
      {debt.parent_id && debt.parent_title && (
        <button className="parent-chip" onClick={() => onSelectRelated(debt.parent_id!)}>
          원본 ↳ {debt.parent_title}
        </button>
      )}

      <label className="detail-label">세션</label>
      <select
        className="session-select detail-session"
        value={debt.session_id ?? ""}
        onChange={(e) => onSetSession(debt.id, e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">(세션 없음)</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.topic}
          </option>
        ))}
      </select>

      {editingUrl ? (
        <input
          autoFocus
          className="detail-url-input"
          placeholder="https:// 출처 링크 (비우면 제거)"
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) saveUrl();
            if (e.key === "Escape") {
              setUrlValue(debt.source_url ?? "");
              setEditingUrl(false);
            }
          }}
          onBlur={saveUrl}
        />
      ) : debt.source_url ? (
        <div className="detail-url-row">
          <a className="detail-link" href={debt.source_url} target="_blank" rel="noreferrer">
            {debt.source_url}
          </a>
          <button className="edit-pencil-btn" title="링크 수정" onClick={() => setEditingUrl(true)}>
            ✎
          </button>
        </div>
      ) : (
        <button className="add-link-btn" onClick={() => setEditingUrl(true)}>
          ＋ 출처 링크 추가
        </button>
      )}

      {debt.source_file ? (
        <div className="detail-url-row">
          <button className="detail-link source-file-btn" onClick={() => openAttachment(debt.source_file!)}>
            📄 {basename(debt.source_file)}
          </button>
          <button
            className="attachment-remove"
            title="출처 파일 제거"
            onClick={() => onSaveSourceFile(debt.id, null)}
          >
            ✕
          </button>
        </div>
      ) : debt.status === "open" ? (
        <div className="attachment-empty source-file-hint">
          PDF·논문을 창에 드롭하면 출처 파일이 됩니다
        </div>
      ) : null}

      <label className="detail-label">메모</label>
      {writer === "note" && <div className="writer-backdrop" onClick={() => { flush(); setWriter(null); }} />}
      <div className={`editor-dock ${writer === "note" ? "open" : ""}`}>
        {writer === "note" && (
          <header className="writer-header">
            <div>
              <h3>메모</h3>
              <p className="writer-hint">사진은 기존 내용 아래에 추가됩니다. 붙여넣기·드래그·사진 버튼을 쓰면 됩니다.</p>
            </div>
          </header>
        )}
        <RichEditor
          ref={noteEditorRef}
          key={`${debt.id}-note-${noteRev}`}
          debtId={debt.id}
          html={note}
          placeholder="맥락, 스크랩, 다음 질문… 사진도 붙여넣기 하세요"
          expanded={writer === "note"}
          onChange={queueNote}
          onExpand={() => setWriter("note")}
          onCollapse={() => {
            flush();
            setWriter(null);
          }}
          onImageInserted={() => listAttachments(debt.id).then(setAttachments)}
        />
      </div>

      {debt.status === "open" && (diggingThis || splitting) && (
        <div className={`split-box ${diggingThis ? "hot" : ""}`}>
          <label className="detail-label">
            {diggingThis ? "파보는 중 — 갈래로 쪼개기" : "갈래로 쪼개기"}
          </label>
          <p className="split-hint">
            메모에서 줄을 선택한 뒤 만들거나, 제목을 직접 적으세요. Cache에 새 카드가 생기고 원본은 남습니다.
          </p>
          <div className="split-row">
            <input
              className="detail-url-input"
              placeholder="새 카드 제목 (또는 메모에서 선택)"
              value={splitTitle}
              onChange={(e) => setSplitTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submitSplit();
                }
              }}
            />
            <button className="ghost-btn" onClick={submitSplit}>
              갈래 만들기
            </button>
          </div>
        </div>
      )}
      {debt.status === "open" && !diggingThis && !splitting && (
        <button className="add-link-btn" onClick={() => setSplitting(true)}>
          ＋ 갈래로 쪼개기
        </button>
      )}

      {childrenDebts.length > 0 && (
        <div className="child-list">
          <label className="detail-label">갈래 ({childrenDebts.length})</label>
          {childrenDebts.map((c) => (
            <button key={c.id} className="child-chip" onClick={() => onSelectRelated(c.id)}>
              <span className="picker-dot" style={{ background: TIER_META[c.tier].color }} />
              {c.title}
              {c.status !== "open" && (
                <span className="child-status">{c.status === "resolved" ? "완료" : "방출"}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <label className="detail-label">
        Check <span className="label-required">핵심 · 상환 전 필수</span>
      </label>
      {writer === "check" && <div className="writer-backdrop" onClick={() => { flush(); setWriter(null); }} />}
      <div className={`editor-dock ${writer === "check" ? "open" : ""}`}>
        {writer === "check" && (
          <header className="writer-header">
            <div>
              <h3>Check — 핵심</h3>
              <p className="writer-hint">이해한 핵심만. 사진은 기존 글을 지우지 않고 이어서 들어갑니다.</p>
            </div>
          </header>
        )}
        <RichEditor
          key={`${debt.id}-check`}
          debtId={debt.id}
          html={check}
          placeholder="이 개념의 핵심을 내 언어로. 왜 그렇게 동작하는지까지."
          expanded={writer === "check"}
          onChange={queueCheck}
          onExpand={() => setWriter("check")}
          onCollapse={() => {
            flush();
            setWriter(null);
          }}
          onImageInserted={() => listAttachments(debt.id).then(setAttachments)}
        />
      </div>
      {debt.status === "open" && !checkIsReady(check) && (
        <div className="resolve-hint">상환하려면 Check를 {CHECK_MIN_CHARS}자 이상 작성하세요</div>
      )}

      <label className="detail-label">첨부 ({attachments.length})</label>
      <div className="attachment-list">
        {attachments.length === 0 && (
          <div className="attachment-empty">
            {debt.source_file
              ? "다른 파일은 여기에 첨부됩니다"
              : "이 패널이 열린 채 파일을 드롭하세요"}
          </div>
        )}
        {attachments.map((a) => (
          <div key={a.id} className="attachment-row">
            <button className="attachment-open" onClick={() => openAttachment(a.path)}>
              {basename(a.filename)}
            </button>
            <button
              className="attachment-remove"
              title="첨부 제거"
              onClick={async () => {
                await removeAttachment(a.id);
                setAttachments(await listAttachments(debt.id));
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {debt.status === "open" && !digActive && (
        <div className="dig-start">
          <label className="detail-label">타임박스로 파보기 (끝나면 Check를 요구합니다)</label>
          <div className="detail-actions">
            {[15, 30, 60].map((m) => (
              <button key={m} className="dig-start-btn" onClick={() => onStartDig(debt.id, m)}>
                ⛏ {m}분
              </button>
            ))}
          </div>
        </div>
      )}

      {debt.status === "open" && (
        <div className="detail-actions">
          <button
            className="primary-btn"
            disabled={!checkIsReady(check)}
            title={checkIsReady(check) ? "Check를 기준으로 상환합니다" : "Check를 먼저 작성하세요"}
            onClick={() => {
              flush();
              onResolve(debt.id, check);
            }}
          >
            상환하기
          </button>
          <button className="ghost-btn" onClick={() => onEvict(debt.id)} title="GC: 필요 없어진 항목 방출">
            방출 (GC)
          </button>
          <ConfirmButton label="삭제" onConfirm={() => onDelete(debt.id)} />
        </div>
      )}

      {debt.status === "evicted" && (
        <div className="detail-actions">
          <span className="evicted-note">방출된 항목입니다</span>
          <button className="primary-btn" onClick={() => onReopen(debt.id)}>
            복원
          </button>
          <ConfirmButton label="완전 삭제" onConfirm={() => onDelete(debt.id)} />
        </div>
      )}

      {debt.status === "resolved" && (
        <div className="resolved-box">
          <p className="resolve-hint">Check가 상환 기록입니다. 위에서 계속 고칠 수 있습니다.</p>
          <button className="ghost-btn" onClick={() => onReopen(debt.id)}>
            다시 열기
          </button>
        </div>
      )}
    </aside>
  );
}
