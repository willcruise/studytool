import type { Debt, Tier } from "../types";
import { TIER_META, TIER_ORDER } from "../types";

interface Props {
  debt: Debt;
  selected: boolean;
  onSelect: (id: number) => void;
  onMove: (id: number, tier: Tier) => void;
}

export function relativeAge(sqliteUtc: string): string {
  const then = new Date(sqliteUtc.replace(" ", "T") + "Z").getTime();
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

export function DebtCard({ debt, selected, onSelect, onMove }: Props) {
  return (
    <div
      className={`debt-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(debt.id)}
    >
      <div className="debt-title">{debt.title}</div>
      <div className="debt-meta">
        {debt.session_topic && <span className="debt-session">◈ {debt.session_topic}</span>}
        {debt.source_url && <span className="debt-badge">링크</span>}
        {(debt.attachment_count ?? 0) > 0 && (
          <span className="debt-badge">첨부 {debt.attachment_count}</span>
        )}
        <span className="debt-age">{relativeAge(debt.created_at)}</span>
      </div>
      <div className="debt-actions" onClick={(e) => e.stopPropagation()}>
        {TIER_ORDER.filter((t) => t !== debt.tier).map((t) => (
          <button
            key={t}
            className="move-btn"
            style={{ color: TIER_META[t].color }}
            title={`${TIER_META[t].label}(${TIER_META[t].hint})로 이동`}
            onClick={() => onMove(debt.id, t)}
          >
            → {TIER_META[t].label}
          </button>
        ))}
      </div>
    </div>
  );
}
