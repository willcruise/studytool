import { useState } from "react";
import type { Debt } from "../types";
import { checkIsReady } from "../richtext";
import { parseUtc } from "../time";

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
}

export function DigBar({ debt, now, onFinishEarly }: BarProps) {
  const remaining = parseUtc(debt.dig_until!) - now;
  return (
    <div className="dig-bar">
      <span className="dig-pulse" />
      <span className="dig-label">파보는 중</span>
      <span className="dig-title">{debt.title}</span>
      <span className="dig-timer">{fmt(remaining)}</span>
      <button className="ghost-btn" onClick={onFinishEarly}>
        지금 끝내기
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
  const [mode, setMode] = useState<"choose" | "return">("choose");
  const [text, setText] = useState("");

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3 className="modal-title">
          {expired ? "⏰ 타임박스 종료" : "파보기 마무리"} — {debt.title}
        </h3>
        <p className="modal-sub">
          {minutesSpent}분 탐색했습니다. 여기서 멈추고 정리해야 메인 학습으로 돌아갈 수
          있습니다.
        </p>

        {mode === "choose" && (
          <div className="modal-choices">
            <button
              className="primary-btn"
              onClick={() => {
                if (checkIsReady(debt.check_content)) onResolve();
                else onNeedCheck();
              }}
            >
              이해했다 — Check 확인하고 상환
            </button>
            <button className="ghost-btn" onClick={() => setMode("return")}>
              아직이다 — 여기까지 기록하고 복귀
            </button>
          </div>
        )}

        {mode === "return" && (
          <>
            <textarea
              autoFocus
              className="detail-note"
              placeholder="여기까지 이해한 것 (비워도 됩니다) — 메모에 기록됩니다"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="detail-actions">
              <button className="primary-btn" onClick={() => onReturn(text.trim())}>
                메인 학습으로 복귀
              </button>
              <button className="ghost-btn" onClick={() => setMode("choose")}>
                뒤로
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
