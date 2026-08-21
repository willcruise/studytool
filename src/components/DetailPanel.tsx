import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import type { Attachment, Debt, Session } from "../types";
import { TIER_META } from "../types";
import { listAttachments, removeAttachment } from "../db";
import { basename, openAttachment } from "../files";
import { relativeAge } from "../time";
import { ConfirmButton } from "./ConfirmButton";
import { EditorDock } from "./EditorDock";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import { autosizeTextarea, handleTextareaTab } from "../keys";
import { CHECK_MIN_CHARS, checkIsReady } from "../richtext";
import { useI18n } from "../i18n";

interface Props {
  debt: Debt;
  digActive: boolean;
  onStartDig: (id: number, minutes: number) => void;
  onClose: () => void;
  onSaveNote: (id: number, note: string) => void | Promise<void>;
  onSaveCheck: (id: number, check: string) => void | Promise<void>;
  onSaveTitle: (id: number, title: string) => void;
  onSaveUrl: (id: number, url: string | null) => void;
  onSetSession: (id: number, sessionId: number | null) => void;
  sessions: Session[];
  onResolve: (id: number, summary: string) => void | Promise<void>;
  showToast: (msg: string) => void;
  flushRef?: MutableRefObject<(() => Promise<void>) | null>;
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
  showToast,
  flushRef,
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
  const { t } = useI18n();
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
  const [showPaths, setShowPaths] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
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
  noteRef.current = note;
  checkRef.current = check;
  onSaveNoteRef.current = onSaveNote;
  onSaveCheckRef.current = onSaveCheck;

  const flushNow = async (id: number) => {
    window.clearTimeout(noteTimer.current);
    window.clearTimeout(checkTimer.current);
    noteTimer.current = 0;
    checkTimer.current = 0;
    if (id !== editingIdRef.current) {
      console.warn("[DetailPanel] skip flush; editor", editingIdRef.current, "target", id);
      return;
    }
    const jobs: Promise<unknown>[] = [];
    if (noteRef.current !== origNoteRef.current) {
      jobs.push(Promise.resolve(onSaveNoteRef.current(id, noteRef.current)));
      origNoteRef.current = noteRef.current;
    }
    if (checkRef.current !== origCheckRef.current) {
      jobs.push(Promise.resolve(onSaveCheckRef.current(id, checkRef.current)));
      origCheckRef.current = checkRef.current;
    }
    await Promise.all(jobs);
  };

  useEffect(() => {
    const id = debt.id;
    return () => {
      void flushNow(id);
    };
  }, [debt.id]);

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => flushNow(editingIdRef.current);
    return () => {
      flushRef.current = null;
    };
  }, [flushRef]);

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
    setShowPaths(false);
    origNoteRef.current = debt.note;
    origCheckRef.current = debt.check_content ?? "";
    editingIdRef.current = debt.id;
  }, [debt.id]);

  useEffect(() => {
    if (debt.id !== editingIdRef.current) return;
    if (noteTimer.current) return;
    if (noteRef.current !== origNoteRef.current) return;
    if (debt.note !== noteRef.current) {
      setNote(debt.note);
      origNoteRef.current = debt.note;
      setNoteRev((n) => n + 1);
    }
  }, [debt.note, debt.id]);

  useEffect(() => {
    if (debt.id !== editingIdRef.current) return;
    if (checkTimer.current) return;
    if (checkRef.current !== origCheckRef.current) return;
    const next = debt.check_content ?? "";
    if (next !== checkRef.current) {
      setCheck(next);
      origCheckRef.current = next;
    }
  }, [debt.check_content, debt.id]);

  useEffect(() => {
    if (forceWriter) {
      setWriter(forceWriter);
      onForceWriterHandled?.();
    }
  }, [forceWriter]);

  useLayoutEffect(() => {
    if (editingTitle) autosizeTextarea(titleRef.current, 160);
  }, [editingTitle, titleValue]);

  useEffect(() => {
    if (!writer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest(".math-edit")) return;
      e.preventDefault();
      void flushNow(editingIdRef.current);
      setWriter(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [writer]);

  const queueNote = (html: string) => {
    const id = debt.id;
    if (id !== editingIdRef.current) {
      console.warn("[DetailPanel] skip memo from stale editor", id, "active", editingIdRef.current);
      return;
    }
    setNote(html);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => {
      if (editingIdRef.current !== id) return;
      onSaveNoteRef.current(id, html);
      origNoteRef.current = html;
      noteTimer.current = 0;
    }, 450);
  };

  const queueCheck = (html: string) => {
    const id = debt.id;
    if (id !== editingIdRef.current) {
      console.warn("[DetailPanel] skip check from stale editor", id, "active", editingIdRef.current);
      return;
    }
    setCheck(html);
    window.clearTimeout(checkTimer.current);
    checkTimer.current = window.setTimeout(() => {
      if (editingIdRef.current !== id) return;
      onSaveCheckRef.current(id, html);
      origCheckRef.current = html;
      checkTimer.current = 0;
    }, 450);
  };

  const flush = () => flushNow(editingIdRef.current);

  const close = () => {
    void flush();
    onClose();
  };

  const tryResolve = async () => {
    await flush();
    const html = checkRef.current;
    if (!checkIsReady(html)) {
      setWriter("check");
      showToast(t("toastNeedCheck"));
      return;
    }
    try {
      await onResolve(debt.id, html);
    } catch (err) {
      console.error(err);
      showToast(t("toastSaveFailed"));
    }
  };

  const submitSplit = () => {
    const selected = noteEditorRef.current?.selectedText() ?? "";
    const typed = splitTitle.trim();
    const title = (typed || selected.split("\n")[0] || "").slice(0, 160).trim();
    if (!title) {
      showToast(t("splitNeedTitle"));
      return;
    }
    const note = selected && selected !== title ? selected : "";
    onSplit(debt.id, title, note);
    setSplitTitle("");
  };

  const saveTitle = () => {
    const t = titleValue.replace(/\s+/g, " ").trim();
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
  const editorLive = debt.id === editingIdRef.current;
  const noteForEditor = editorLive ? note : debt.note;
  const checkForEditor = editorLive ? check : (debt.check_content ?? "");

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <span className="tier-tag" style={{ borderColor: meta.color, color: meta.color }}>
          {meta.label}
        </span>
        <button className="ghost-btn" onClick={close}>
          {t("close")}
        </button>
      </div>

      {editingTitle ? (
        <textarea
          ref={titleRef}
          autoFocus
          rows={1}
          className="detail-title-input"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onKeyDown={(e) => {
            if (handleTextareaTab(e, titleValue, setTitleValue)) return;
            if (e.key === "Enter" && e.shiftKey) {
              e.stopPropagation();
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
        <h2 className="detail-title editable" onClick={() => setEditingTitle(true)}>
          {debt.title} <span className="edit-pencil">✎</span>
        </h2>
      )}
      <div className="detail-sub">
        {relativeAge(debt.created_at)}
        {debt.time_spent_min > 0 && <span>{t("exploredMins", { n: debt.time_spent_min })}</span>}
      </div>
      {debt.parent_id && debt.parent_title && (
        <button className="parent-chip" onClick={() => onSelectRelated(debt.parent_id!)}>
          {t("parent", { title: debt.parent_title })}
        </button>
      )}

      <label className="detail-label">{t("session")}</label>
      <select
        className="session-select detail-session"
        value={debt.session_id ?? ""}
        onChange={(e) => onSetSession(debt.id, e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{t("sessionNone")}</option>
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
          placeholder="https://"
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
          <button className="edit-pencil-btn" onClick={() => setEditingUrl(true)}>
            ✎
          </button>
        </div>
      ) : (
        <button className="add-link-btn" onClick={() => setEditingUrl(true)}>
          {t("addSourceLink")}
        </button>
      )}

      {debt.source_file ? (
        <div className="detail-url-row">
          <button className={`detail-link source-file-btn${showPaths ? " show-path" : ""}`} onClick={() => openAttachment(debt.source_file!)}>
            📄 {showPaths ? debt.source_file : basename(debt.source_file)}
          </button>
          <button type="button" className="path-toggle" onClick={() => setShowPaths((v) => !v)}>
            {showPaths ? t("filename") : t("filepath")}
          </button>
          <button
            className="attachment-remove"
            onClick={() => onSaveSourceFile(debt.id, null)}
          >
            ✕
          </button>
        </div>
      ) : null}

      <div className="detail-field">
        <label className="detail-label">{t("memo")}</label>
        <EditorDock
          open={writer === "note"}
          onClose={() => {
            void flush();
            setWriter(null);
          }}
          header={
            <header className="writer-header">
              <h3>{t("memo")}</h3>
            </header>
          }
        >
          <RichEditor
            ref={noteEditorRef}
            key={`${debt.id}-note-${noteRev}`}
            debtId={debt.id}
            html={noteForEditor}
            placeholder={t("memo")}
            expanded={writer === "note"}
            onChange={queueNote}
            onExpand={() => setWriter("note")}
            onCollapse={() => {
              void flush();
              setWriter(null);
            }}
            onImageInserted={() => listAttachments(debt.id).then(setAttachments)}
          />
        </EditorDock>
      </div>

      {debt.status === "open" && diggingThis && (
        <div className="split-box hot">
          <label className="detail-label">{t("split")}</label>
          <div className="split-row">
            <input
              className="detail-url-input"
              placeholder={t("title")}
              value={splitTitle}
              onChange={(e) => setSplitTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submitSplit();
                }
              }}
            />
            <button type="button" className="ghost-btn" onClick={submitSplit}>
              {t("makeSplit")}
            </button>
          </div>
        </div>
      )}

      {childrenDebts.length > 0 && (
        <div className="child-list">
          <label className="detail-label">{t("branches", { n: childrenDebts.length })}</label>
          {childrenDebts.map((c) => (
            <button key={c.id} className="child-chip" onClick={() => onSelectRelated(c.id)}>
              <span className="picker-dot" style={{ background: TIER_META[c.tier].color }} />
              {c.title}
              {c.status !== "open" && (
                <span className="child-status">{c.status === "resolved" ? t("done") : t("evicted")}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="detail-field">
        <label className="detail-label">Check</label>
        <EditorDock
          open={writer === "check"}
          onClose={() => {
            void flush();
            setWriter(null);
          }}
          header={
            <header className="writer-header">
              <h3>Check</h3>
              {debt.status === "open" && (
                <button type="button" className="primary-btn" onClick={() => void tryResolve()}>
                  {t("resolve")}
                </button>
              )}
            </header>
          }
        >
          <RichEditor
            key={`${debt.id}-check`}
            debtId={debt.id}
            html={checkForEditor}
            placeholder="Check"
            expanded={writer === "check"}
            onChange={queueCheck}
            onExpand={() => setWriter("check")}
            onCollapse={() => {
              void flush();
              setWriter(null);
            }}
            onImageInserted={() => listAttachments(debt.id).then(setAttachments)}
          />
        </EditorDock>
        {debt.status === "open" && !checkIsReady(check) && (
          <div className="resolve-hint">{t("checkMin", { n: CHECK_MIN_CHARS })}</div>
        )}
      </div>

      <label className="detail-label">
        <span>{t("attachments", { n: attachments.length })}</span>
        {(attachments.length > 0 && !debt.source_file) && (
          <button type="button" className="path-toggle" onClick={() => setShowPaths((v) => !v)}>
            {showPaths ? t("filename") : t("filepath")}
          </button>
        )}
      </label>
      <div className="attachment-list">
        {attachments.map((a) => (
          <div key={a.id} className="attachment-row">
            <button
              className={`attachment-open${showPaths ? " show-path" : ""}`}
              onClick={() => openAttachment(a.path)}
            >
              {showPaths ? a.path : basename(a.filename)}
            </button>
            <button
              className="attachment-remove"
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
          <label className="detail-label">{t("dig")}</label>
          <div className="detail-actions">
            {[15, 30, 60].map((m) => (
              <button key={m} className="dig-start-btn" onClick={() => onStartDig(debt.id, m)}>
                ⛏ {t("minutes", { n: m })}
              </button>
            ))}
          </div>
        </div>
      )}

      {debt.status === "open" && (
        <div className="detail-actions">
          <button type="button" className="primary-btn" onClick={() => void tryResolve()}>
            {t("resolve")}
          </button>
          <ConfirmButton
            label={t("evict")}
            confirmLabel={t("evictConfirm")}
            className="ghost-btn"
            onConfirm={() => {
              void flush().then(() => onEvict(debt.id));
            }}
          />
          <ConfirmButton
            label={t("delete")}
            confirmLabel={t("confirmDelete")}
            onConfirm={() => {
              void flush().then(() => onDelete(debt.id));
            }}
          />
        </div>
      )}

      {debt.status === "evicted" && (
        <div className="detail-actions">
          <span className="evicted-note">{t("evictedNote")}</span>
          <button className="primary-btn" onClick={() => onReopen(debt.id)}>
            {t("restoreItem")}
          </button>
          <ConfirmButton label={t("deleteForever")} confirmLabel={t("confirmDelete")} onConfirm={() => onDelete(debt.id)} />
        </div>
      )}

      {debt.status === "resolved" && (
        <div className="resolved-box">
          <button className="ghost-btn" onClick={() => onReopen(debt.id)}>
            {t("reopen")}
          </button>
        </div>
      )}
    </aside>
  );
}
