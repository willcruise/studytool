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

  const send = async (event: "dig-dock" | "dig-finish-early") => {
    if (busy.current) return;
    busy.current = true;
    try {
      await emit(event);
      await getCurrentWindow().hide();
    } catch {
      /* unlock immediately so a failed click can retry */
    } finally {
      window.setTimeout(() => {
        busy.current = false;
      }, 400);
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
    busy.current = false;
  }, [debt?.id]);

  useEffect(() => {
    const win = getCurrentWindow();
    const unmoved = win.onMoved(({ payload }) => {
      rememberDigWindowPos(payload.x, payload.y);
    });
    return () => {
      unmoved.then((fn) => fn());
    };
  }, []);

  const remaining = debt?.dig_until ? parseUtc(debt.dig_until) - now : 0;
  const started = debt?.dig_started_at ? parseUtc(debt.dig_started_at) : now;
  const total = debt?.dig_until ? Math.max(parseUtc(debt.dig_until) - started, 1) : 1;
  const elapsed = Math.min(Math.max(total - remaining, 0), total);
  const urgent = remaining > 0 && remaining <= 60_000;

  return (
    <div className={`dig-widget${urgent ? " urgent" : ""}`}>
      <div className="dig-widget-progress" style={{ width: `${(elapsed / total) * 100}%` }} />
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
