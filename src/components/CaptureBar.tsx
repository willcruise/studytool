import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import type { Tier } from "../types";
import { TIER_META, TIER_ORDER } from "../types";
import { parseInput } from "../domain/capture";
import { autosizeTextarea, handleTextareaTab } from "../keys";
import { useI18n } from "../i18n";

export { parseInput } from "../domain/capture";

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
  const localRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    autosizeTextarea(localRef.current, 140);
  }, [value]);

  const submit = () => {
    const { title, sourceUrl, note } = parseInput(value);
    if (!title) return;
    onCapture(title, captureTier, sourceUrl, note);
    setValue("");
  };

  return (
    <div className="capture-bar">
      <div className="capture-field">
        <span className="capture-spark" aria-hidden="true">
          ✦
        </span>
        <textarea
          ref={(node) => {
            localRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          rows={1}
          className="capture-input"
          placeholder={t("capturePlaceholder")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (handleTextareaTab(e, value, setValue)) return;
            if (e.key === "Enter" && e.shiftKey) {
              e.stopPropagation();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <input
        className="board-search"
        placeholder={t("search")}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="capture-tiers">
        {TIER_ORDER.map((tier) => {
          const on =
            tier === "ram"
              ? extraTiers.ram
              : tier === "storage"
                ? extraTiers.storage
                : captureTier === tier;
          return (
            <button
              key={tier}
              className={`tier-chip ${on ? "active" : ""}`}
              style={on ? { borderColor: TIER_META[tier].color, color: TIER_META[tier].color } : {}}
              onClick={() => onSelectTier(tier)}
            >
              {TIER_META[tier].label}
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
