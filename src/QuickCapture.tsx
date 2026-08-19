import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import * as db from "./db";
import type { Session } from "./types";
import { parseInput } from "./components/CaptureBar";
import { handleTextareaTab } from "./keys";
import { useI18n } from "./i18n";
import "./QuickCapture.css";

export default function QuickCapture() {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const reload = async () => {
    setSession(await db.getActiveSession());
    setValue("");
    setSaved(false);
    inputRef.current?.focus();
  };

  useEffect(() => {
    reload();
    const unlisten = listen("quick-open", reload);
    // hide when the palette loses focus
    const unfocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) getCurrentWindow().hide();
    });
    return () => {
      unlisten.then((fn) => fn());
      unfocus.then((fn) => fn());
    };
  }, []);

  const submit = async () => {
    const { title, sourceUrl, note } = parseInput(value);
    if (!title) return;
    await db.createDebt({
      title,
      note,
      tier: "inbox",
      sourceUrl,
      sessionId: session?.id ?? null,
    });
    await emit("debt-added");
    setSaved(true);
    setValue("");
    window.setTimeout(() => {
      setSaved(false);
      getCurrentWindow().hide();
    }, 450);
  };

  return (
    <div className="quick">
      <div className="quick-row">
        <span className="quick-mark">◈</span>
        <textarea
          ref={inputRef}
          autoFocus
          rows={Math.min(4, Math.max(2, value.split("\n").length))}
          className="quick-input"
          placeholder={t("capture")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (handleTextareaTab(e, value, setValue)) return;
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") getCurrentWindow().hide();
          }}
        />
      </div>
      <div className="quick-footer">
        {saved ? (
          <span className="quick-saved">{t("saved")}</span>
        ) : (
          <>
            <span>{session ? `◈ ${session.topic}` : t("noSession")}</span>
          </>
        )}
      </div>
    </div>
  );
}
