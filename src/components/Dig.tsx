import { useEffect, useState } from "react";
import type { Debt } from "../types";
import { fmtCountdown, parseUtc } from "../time";
import { handleTextareaTab } from "../keys";
import { useI18n } from "../i18n";

const DIG_MINUTES = [15, 30, 60] as const;

// ---------- top bar shown while a dig is running ----------

interface BarProps {
  debt: Debt;
  now: number;
  onFinishEarly: () => void;
  onFloat: () => void;
}

export function DigBar({ debt, now, onFinishEarly, onFloat }: BarProps) {
  const remaining = parseUtc(debt.dig_until!) - now;
  const started = debt.dig_started_at ? parseUtc(debt.dig_started_at) : now;
  const total = Math.max(parseUtc(debt.dig_until!) - started, 1);
  const elapsed = Math.min(Math.max(total - remaining, 0), total);
  const { t } = useI18n();
  const urgent = remaining > 0 && remaining <= 60_000;
  return (
    <div className={`dig-bar${urgent ? " urgent" : ""}`}>
      <div className="dig-bar-progress" style={{ width: `${(elapsed / total) * 100}%` }} />
      <span className="dig-pulse" />
      <span className="dig-label">{t("digging")}</span>
      <span className="dig-title">{debt.title}</span>
      <span className="dig-timer">{fmtCountdown(remaining)}</span>
      <button
        type="button"
        className="ghost-btn"
        title={t("floatTimer")}
        aria-label={t("floatTimer")}
        onClick={onFloat}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M6 2h8v8h-2V5.4L5.4 12 4 10.6 10.6 4H6V2zM2 6h2v8h8v2H2V6z"
          />
        </svg>
      </button>
      <button type="button" className="ghost-btn" onClick={onFinishEarly}>
        {t("finishNow")}
      </button>
    </div>
  );
}

// ---------- forced modal when the timebox ends ----------

interface ModalProps {
  debt: Debt;
  minutesSpent: number;
  expired: boolean;
  onResolve: () => void;
  onReturn: (log: string) => void;
  onKeepDigging: (minutes: number) => void;
  onRestartDig: (minutes: number) => void;
  onDismiss: () => void;
}

export function DigEndModal({
  debt,
  minutesSpent,
  expired,
  onResolve,
  onReturn,
  onKeepDigging,
  onRestartDig,
  onDismiss,
}: ModalProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"choose" | "return" | "extend">("choose");
  const [text, setText] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mode === "choose") {
        if (!expired) onDismiss();
        return;
      }
      setMode("choose");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expired, mode, onDismiss]);

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (mode === "choose" && !expired) onDismiss();
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">
          {expired ? t("timeboxEnded") : t("digWrapup")} — {debt.title}
        </h3>
        <p className="modal-sub">{t("minutes", { n: minutesSpent })}</p>

        {mode === "choose" && (
          <div className="modal-choices">
            <button type="button" className="primary-btn" onClick={() => onResolve()}>
              {t("understoodResolve")}
            </button>
            <button type="button" className="ghost-btn" onClick={() => setMode("return")}>
              {t("notYetReturn")}
            </button>
            <button type="button" className="ghost-btn" onClick={() => setMode("extend")}>
              {expired ? t("keepDigging") : t("restartTimebox")}
            </button>
          </div>
        )}

        {mode === "extend" && (
          <>
            <label className="detail-label">
              {expired ? t("keepDiggingMore") : t("restartTimebox")}
            </label>
            <div className="detail-actions">
              {DIG_MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="dig-start-btn"
                  onClick={() => (expired ? onKeepDigging(m) : onRestartDig(m))}
                >
                  ⛏ {t("minutes", { n: m })}
                </button>
              ))}
            </div>
            <div className="detail-actions">
              <button type="button" className="ghost-btn" onClick={() => setMode("choose")}>
                {t("back")}
              </button>
            </div>
          </>
        )}

        {mode === "return" && (
          <>
            <textarea
              autoFocus
              className="detail-note"
              placeholder={t("memoOptional")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => handleTextareaTab(e, text, setText)}
            />
            <div className="detail-actions">
              <button type="button" className="primary-btn" onClick={() => onReturn(text.trim())}>
                {t("returnToStudy")}
              </button>
              <button type="button" className="ghost-btn" onClick={() => setMode("choose")}>
                {t("back")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
