import { useRef, useState } from "react";
import type { Session } from "../types";
import { ConfirmButton } from "./ConfirmButton";
import { useI18n } from "../i18n";

interface Props {
  sessions: Session[];
  active: Session | null;
  onSelect: (id: number | null) => void;
  onCreate: (topic: string) => void;
  onRename: (id: number, topic: string) => void;
  onDelete: (id: number) => void;
}

export function SessionPicker({ sessions, active, onSelect, onCreate, onRename, onDelete }: Props) {
  const { t } = useI18n();
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
          placeholder={mode === "create" ? t("topic") : t("name")}
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
      <span className="session-label">{t("session")}</span>
      <select
        className="session-select"
        value={active?.id ?? ""}
        onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{t("sessionNone")}</option>
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
        title={t("newTopic")}
      >
        {t("newTopic")}
      </button>
      {active && (
        <>
          <button
            className="ghost-btn"
            title={t("rename")}
            onClick={() => {
              setText(active.topic);
              setMode("rename");
            }}
          >
            ✎
          </button>
          <ConfirmButton
            label="－"
            confirmLabel={t("deleteConfirm")}
            className="ghost-btn session-delete"
            title={t("delete")}
            onConfirm={() => onDelete(active.id)}
          />
        </>
      )}
    </div>
  );
}
