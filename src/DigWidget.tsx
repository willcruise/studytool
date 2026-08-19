import { useEffect, useState } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { getActiveDig } from "./db";
import type { Debt } from "./types";
import { parseUtc } from "./time";
import { useI18n } from "./i18n";
import "./DigWidget.css";

function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function DigWidget() {
  const { t } = useI18n();
  const [debt, setDebt] = useState<Debt | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const load = async () => setDebt(await getActiveDig());
    load();
    const poll = window.setInterval(load, 1000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  if (!debt?.dig_until) {
    return <div className="dig-widget empty">{t("digging")}</div>;
  }

  const remaining = parseUtc(debt.dig_until) - now;

  return (
    <div className="dig-widget">
      <div className="dig-widget-drag" data-tauri-drag-region>
        <span className="dig-pulse" />
        <div className="dig-widget-copy">
          <span className="dig-label">{t("digging")}</span>
          <span className="dig-title">{debt.title}</span>
        </div>
        <span className="dig-timer">{fmt(remaining)}</span>
      </div>
      <div className="dig-widget-actions">
        <button
          className="ghost-btn"
          title={t("dockTimer")}
          aria-label={t("dockTimer")}
          onClick={() => emitTo("main", "dig-dock")}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              fill="currentColor"
              d="M3 3h10v2H3V3zm0 3h10v7H3V6zm1.5 1.5v4h7v-4h-7z"
            />
          </svg>
        </button>
        <button className="ghost-btn" onClick={() => emitTo("main", "dig-finish-early")}>
          {t("finishNow")}
        </button>
      </div>
    </div>
  );
}
