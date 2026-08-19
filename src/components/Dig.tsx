import { useState } from "react";
import type { Debt } from "../types";
import { checkIsReady } from "../richtext";
import { parseUtc } from "../time";
import { handleTextareaTab } from "../keys";
import { useI18n } from "../i18n";

function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------- top bar shown while a dig is running ----------

interface BarProps {
  debt: Debt;
  now: number;
  onFinishEarly: () => void;
  onFloat: () => void;
}

export function DigBar({ debt, now, onFinishEarly, onFloat }: BarProps) {
  const remaining = parseUtc(debt.dig_until!) - now;
  const { t } = useI18n();
  return (
    <div className="dig-bar">
      <span className="dig-pulse" />
      <span className="dig-label">{t("digging")}</span>
      <span className="dig-title">{debt.title}</span>
      <span className="dig-timer">{fmt(remaining)}</span>
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
      <button className="ghost-btn" onClick={onFinishEarly}>
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
  onNeedCheck: () => void;
  onReturn: (log: string) => void;
}

export function DigEndModal({
  debt,
  minutesSpent,
  expired,
  onResolve,
  onNeedCheck,
  onReturn,
}: ModalProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"choose" | "return">("choose");
  const [text, setText] = useState("");

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3 className="modal-title">
          {expired ? t("timeboxEnded") : t("digWrapup")} — {debt.title}
        </h3>
        <p className="modal-sub">{t("minutes", { n: minutesSpent })}</p>

        {mode === "choose" && (
          <div className="modal-choices">
            <button
              className="primary-btn"
              onClick={() => {
                if (checkIsReady(debt.check_content)) onResolve();
                else onNeedCheck();
              }}
            >
              {t("understoodResolve")}
            </button>
            <button className="ghost-btn" onClick={() => setMode("return")}>
              {t("notYetReturn")}
            </button>
          </div>
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
              <button className="primary-btn" onClick={() => onReturn(text.trim())}>
                {t("returnToStudy")}
              </button>
              <button className="ghost-btn" onClick={() => setMode("choose")}>
                {t("back")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
