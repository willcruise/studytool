import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import * as db from "./db";
import type { Session } from "./types";
import { parseInput } from "./components/CaptureBar";
import "./QuickCapture.css";

export default function QuickCapture() {
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
          placeholder="궁금한 것을 던지고 Enter — Shift+Enter 줄바꿈"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
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
          <span className="quick-saved">저장됨 ✓</span>
        ) : (
          <>
            <span>{session ? `◈ ${session.topic} 세션에 연결됨` : "세션 없음"}</span>
            <span className="quick-keys">Enter 저장 · Shift+Enter 줄바꿈 · Esc 닫기</span>
          </>
        )}
      </div>
    </div>
  );
}
