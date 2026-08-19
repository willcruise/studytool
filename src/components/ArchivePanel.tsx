import type { Debt } from "../types";
import { checkExcerpt, htmlToText } from "../richtext";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
  return (
    <div className="archive-wrap">
      <div className="archive-toolbar">
        <div className="view-toggle">
          <button
            className={filter === "resolved" ? "active" : ""}
            onClick={() => onFilter("resolved")}
          >
            {t("viewResolved")} {resolvedCount}
          </button>
          <button
            className={filter === "evicted" ? "active" : ""}
            onClick={() => onFilter("evicted")}
          >
            {t("evictedTab", { n: evictedCount })}
          </button>
        </div>
        <input
          className="board-search"
          placeholder={t("search")}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      <div className="resolved-list">
        {items.length === 0 && <div className="column-empty">{t("none")}</div>}
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
                : htmlToText(d.note) || "—"}
            </div>
            {d.session_topic && <div className="debt-session">◈ {d.session_topic}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
