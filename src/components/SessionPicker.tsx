import { useRef, useState } from "react";
import type { Session } from "../types";
import { ConfirmButton } from "./ConfirmButton";

interface Props {
  sessions: Session[];
  active: Session | null;
  onSelect: (id: number | null) => void;
  onCreate: (topic: string) => void;
  onRename: (id: number, topic: string) => void;
  onDelete: (id: number) => void;
}

export function SessionPicker({ sessions, active, onSelect, onCreate, onRename, onDelete }: Props) {
  const [mode, setMode] = useState<"view" | "create" | "rename">("view");
  const [text, setText] = useState("");
  const skipBlur = useRef(false);

  const finish = (save: boolean) => {
    const t = text.trim();
    if (save && t) {
      if (mode === "create") onCreate(t);
      else if (active) onRename(active.id, t);
    }
    setText("");
    setMode("view");
  };

  if (mode !== "view") {
    return (
      <div className="session-picker">
        <input
          autoFocus
          className="session-input"
          placeholder={mode === "create" ? "지금 공부하는 주제 (예: B+ Tree)" : "세션 이름 변경"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              skipBlur.current = true;
              finish(true);
            }
            if (e.key === "Escape") {
              skipBlur.current = true;
              finish(false);
            }
          }}
          onBlur={() => {
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            finish(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="session-picker">
      <span className="session-label">세션</span>
      <select
        className="session-select"
        value={active?.id ?? ""}
        onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">(세션 없음)</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.topic}
          </option>
        ))}
      </select>
      <button
        className="ghost-btn"
        onClick={() => {
          setText("");
          setMode("create");
        }}
        title="새 세션 시작"
      >
        ＋ 새 주제
      </button>
      {active && (
        <>
          <button
            className="ghost-btn"
            title="세션 이름 변경"
            onClick={() => {
              setText(active.topic);
              setMode("rename");
            }}
          >
            ✎
          </button>
          <ConfirmButton
            label="－"
            confirmLabel="삭제?"
            className="ghost-btn session-delete"
            title="세션 삭제 (연결된 항목은 세션 없음으로 남습니다)"
            onConfirm={() => onDelete(active.id)}
          />
        </>
      )}
    </div>
  );
}
