import type { Debt } from "../types";
import { checkExcerpt, htmlToText } from "../richtext";

interface Props {
  items: Debt[];
  filter: "resolved" | "evicted";
  resolvedCount: number;
  evictedCount: number;
  query: string;
  selectedId: number | null;
  onFilter: (filter: "resolved" | "evicted") => void;
  onQuery: (q: string) => void;
  onSelect: (id: number) => void;
}

export function ArchivePanel({
  items,
  filter,
  resolvedCount,
  evictedCount,
  query,
  selectedId,
  onFilter,
  onQuery,
  onSelect,
}: Props) {
  return (
    <div className="archive-wrap">
      <div className="archive-toolbar">
        <div className="view-toggle">
          <button
            className={filter === "resolved" ? "active" : ""}
            onClick={() => onFilter("resolved")}
          >
            탐험 완료 {resolvedCount}
          </button>
          <button
            className={filter === "evicted" ? "active" : ""}
            onClick={() => onFilter("evicted")}
          >
            방출됨 {evictedCount}
          </button>
        </div>
        <input
          className="board-search"
          placeholder="보관함에서 찾기"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      <div className="resolved-list">
        {items.length === 0 && (
          <div className="column-empty">
            {filter === "resolved" ? "아직 탐험 완료한 영역이 없습니다" : "방출된 항목이 없습니다"}
          </div>
        )}
        {items.map((d) => (
          <div
            key={d.id}
            className={`resolved-item ${d.id === selectedId ? "selected" : ""}`}
            onClick={() => onSelect(d.id)}
          >
            <div className="debt-title">{d.title}</div>
            <div className="resolved-item-summary">
              {filter === "resolved"
                ? d.summary || checkExcerpt(d.check_content)
                : htmlToText(d.note) || "(메모 없음)"}
            </div>
            {d.session_topic && <div className="debt-session">◈ {d.session_topic}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
