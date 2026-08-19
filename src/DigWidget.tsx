import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getActiveDig } from "./db";
import type { Debt } from "./types";
import { fmtCountdown, parseUtc } from "./time";
import { rememberDigWindowPos, startDigWindowDrag } from "./digFloat";
import { useI18n } from "./i18n";
import "./DigWidget.css";

export default function DigWidget() {
  const { t } = useI18n();
  const [debt, setDebt] = useState<Debt | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const sawFocus = useRef(false);
  const dismissArmed = useRef(false);

  const send = async (event: "dig-dock" | "dig-finish-early") => {
    if (busy.current) return;
    busy.current = true;
    try {
      await emit(event);
      await getCurrentWindow().hide();
    } catch {
      busy.current = false;
    }
  };

  const dock = () => send("dig-dock");
  const finish = () => send("dig-finish-early");

  useEffect(() => {
    const tick = window.setInterval(async () => {
      setNow(Date.now());
      setDebt(await getActiveDig());
    }, 1000);
    void getActiveDig().then(setDebt);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const win = getCurrentWindow();
    const unmoved = win.onMoved(({ payload }) => {
      rememberDigWindowPos(payload.x, payload.y);
    });
    const unfocus = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        sawFocus.current = true;
        dismissArmed.current = false;
        window.setTimeout(() => {
          dismissArmed.current = true;
        }, 400);
        return;
      }
      if (!sawFocus.current || !dismissArmed.current || busy.current) return;
      void dock();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void dock();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unmoved.then((fn) => fn());
      unfocus.then((fn) => fn());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const remaining = debt?.dig_until ? parseUtc(debt.dig_until) - now : 0;

  return (
    <div className="dig-widget">
      <div className="dig-widget-drag" onMouseDown={startDigWindowDrag}>
        <span className="dig-pulse" />
        <div className="dig-widget-copy">
          <span className="dig-label">{t("digging")}</span>
          <span className="dig-title">{debt?.title ?? t("digging")}</span>
        </div>
        <span className="dig-timer">{fmtCountdown(remaining)}</span>
      </div>
      <div
        className="dig-widget-actions"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="ghost-btn"
          title={t("dockTimer")}
          aria-label={t("dockTimer")}
          onClick={() => void dock()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              fill="currentColor"
              d="M3 3h10v2H3V3zm0 3h10v7H3V6zm1.5 1.5v4h7v-4h-7z"
            />
          </svg>
        </button>
        <button type="button" className="ghost-btn" onClick={() => void finish()}>
          {t("finishNow")}
        </button>
      </div>
    </div>
  );
}
