import type { Debt, Tier } from "../types";
import { TIER_META } from "../types";
import { DebtCard } from "./DebtCard";
import { useI18n, type MsgKey } from "../i18n";

const EMPTY_KEYS: Record<Tier, MsgKey> = {
  inbox: "emptyInbox",
  cache: "emptyCache",
  ram: "emptyRam",
  storage: "emptyStorage",
};

const EMPTY_GLYPH: Record<Tier, string> = {
  inbox: "✦",
  cache: "◆",
  ram: "⛏",
  storage: "▣",
};

interface Props {
  debts: Debt[];
  selectedId: number | null;
  visibleTiers: Tier[];
  onSelect: (id: number) => void;
  onMove: (id: number, tier: Tier) => void;
}

export function Board({ debts, selectedId, visibleTiers, onSelect, onMove }: Props) {
  const { t } = useI18n();
  return (
    <div className={`board cols-${visibleTiers.length}`}>
      {visibleTiers.map((tier) => {
        const items = debts.filter((d) => d.tier === tier);
        const meta = TIER_META[tier];
        return (
          <div key={tier} className="board-column" data-tier={tier}>
            <div className="column-header">
              <span className="column-dot" style={{ background: meta.color, color: meta.color }} />
              <span className="column-title">{meta.label}</span>
              <span className="column-count">{items.length}</span>
            </div>
            <div className="column-body">
              {items.length === 0 && (
                <div className="column-empty">
                  <span className="empty-glyph" aria-hidden="true">
                    {EMPTY_GLYPH[tier]}
                  </span>
                  {t(EMPTY_KEYS[tier])}
                </div>
              )}
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
