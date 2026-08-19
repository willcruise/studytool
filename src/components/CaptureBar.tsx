import { forwardRef, useState } from "react";
import type { Tier } from "../types";
import { TIER_META, TIER_ORDER } from "../types";
import { handleTextareaTab } from "../keys";
import { useI18n } from "../i18n";

interface Props {
  onCapture: (title: string, tier: Tier, sourceUrl: string | null, note: string) => void;
  query: string;
  onQuery: (q: string) => void;
  sessionTopic: string | null;
  sessionOnly: boolean;
  onToggleSession: () => void;
  captureTier: Tier;
  extraTiers: { ram: boolean; storage: boolean };
  onSelectTier: (tier: Tier) => void;
}

export function parseInput(raw: string): { title: string; sourceUrl: string | null; note: string } {
  const text = raw.replace(/\s+$/, "");
  const nl = text.indexOf("\n");
  const first = (nl === -1 ? text : text.slice(0, nl)).trim();
  const note = nl === -1 ? "" : text.slice(nl + 1).trim();
  if (/^https?:\/\/\S+$/.test(first)) {
    try {
      const u = new URL(first);
      const title = decodeURIComponent(u.hostname + u.pathname).replace(/\/$/, "");
      return { title, sourceUrl: first, note };
    } catch {
      /* fall through */
    }
  }
  return { title: first, sourceUrl: null, note };
}

export const CaptureBar = forwardRef<HTMLTextAreaElement, Props>(function CaptureBar(
  {
    onCapture,
    query,
    onQuery,
    sessionTopic,
    sessionOnly,
    onToggleSession,
    captureTier,
    extraTiers,
    onSelectTier,
  },
  ref
) {
  const { t } = useI18n();
  const [value, setValue] = useState("");

  const submit = () => {
    const { title, sourceUrl, note } = parseInput(value);
    if (!title) return;
    onCapture(title, captureTier, sourceUrl, note);
    setValue("");
  };

  return (
    <div className="capture-bar">
      <textarea
        ref={ref}
        rows={Math.min(6, Math.max(1, value.split("\n").length))}
        className="capture-input"
        placeholder={t("capturePlaceholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (handleTextareaTab(e, value, setValue)) return;
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <input
        className="board-search"
        placeholder={t("search")}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="capture-tiers">
        {TIER_ORDER.map((t) => {
          const on =
            t === "ram" ? extraTiers.ram : t === "storage" ? extraTiers.storage : captureTier === t;
          return (
            <button
              key={t}
              className={`tier-chip ${on ? "active" : ""}`}
              style={on ? { borderColor: TIER_META[t].color, color: TIER_META[t].color } : {}}
              onClick={() => onSelectTier(t)}
            >
              {TIER_META[t].label}
            </button>
          );
        })}
        {sessionTopic && (
          <button
            className={`filter-chip ${sessionOnly ? "active" : ""}`}
            onClick={onToggleSession}
          >
            {sessionOnly ? t("thisSession") : t("allSessions")}
          </button>
        )}
      </div>
    </div>
  );
});
