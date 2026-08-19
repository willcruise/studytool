import type { Debt, Tier } from "../types";
import { TIER_META, TIER_ORDER } from "../types";
import { DebtCard } from "./DebtCard";

interface Props {
  debts: Debt[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onMove: (id: number, tier: Tier) => void;
}

export function Board({ debts, selectedId, onSelect, onMove }: Props) {
  return (
    <div className="board">
      {TIER_ORDER.map((tier) => {
        const items = debts.filter((d) => d.tier === tier);
        const meta = TIER_META[tier];
        return (
          <div key={tier} className="board-column">
            <div className="column-header">
              <span className="column-dot" style={{ background: meta.color }} />
              <span className="column-title">{meta.label}</span>
              <span className="column-hint">{meta.hint}</span>
              <span className="column-count">{items.length}</span>
            </div>
            <div className="column-body">
              {items.length === 0 && <div className="column-empty">비어 있음</div>}
              {items.map((d) => (
                <DebtCard
                  key={d.id}
                  debt={d}
                  selected={d.id === selectedId}
                  onSelect={onSelect}
                  onMove={onMove}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
