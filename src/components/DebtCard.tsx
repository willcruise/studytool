import type { Debt, Tier } from "../types";
import { TIER_META, TIER_ORDER } from "../types";
import { relativeAge } from "../time";

interface Props {
  debt: Debt;
  selected: boolean;
  onSelect: (id: number) => void;
  onMove: (id: number, tier: Tier) => void;
}

export function DebtCard({ debt, selected, onSelect, onMove }: Props) {
  return (
    <div
      className={`debt-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(debt.id)}
    >
      <div className="debt-title">{debt.title}</div>
      <div className="debt-meta">
        {debt.parent_title && <span className="debt-session">↳ {debt.parent_title}</span>}
        {debt.session_topic && <span className="debt-session">◈ {debt.session_topic}</span>}
        {debt.source_url && <span className="debt-badge">링크</span>}
        {debt.source_file && <span className="debt-badge">논문</span>}
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
