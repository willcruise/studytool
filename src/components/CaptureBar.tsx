import { forwardRef, useState } from "react";
import type { Tier } from "../types";
import { TIER_META, TIER_ORDER } from "../types";

interface Props {
  onCapture: (title: string, tier: Tier, sourceUrl: string | null, note: string) => void;
  query: string;
  onQuery: (q: string) => void;
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
  { onCapture, query, onQuery },
  ref
) {
  const [value, setValue] = useState("");
  const [tier, setTier] = useState<Tier>("inbox");

  const submit = () => {
    const { title, sourceUrl, note } = parseInput(value);
    if (!title) return;
    onCapture(title, tier, sourceUrl, note);
    setValue("");
  };

  return (
    <div className="capture-bar">
      <textarea
        ref={ref}
        rows={Math.min(6, Math.max(1, value.split("\n").length))}
        className="capture-input"
        placeholder="지금 걸리는 것… (Enter 저장 · Shift+Enter 줄바꿈)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <input
        className="board-search"
        placeholder="보드에서 찾기"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="capture-tiers">
        {TIER_ORDER.map((t) => (
          <button
            key={t}
            className={`tier-chip ${tier === t ? "active" : ""}`}
            style={tier === t ? { borderColor: TIER_META[t].color, color: TIER_META[t].color } : {}}
            onClick={() => setTier(t)}
            title={TIER_META[t].hint}
          >
            {TIER_META[t].label}
          </button>
        ))}
      </div>
    </div>
  );
});
