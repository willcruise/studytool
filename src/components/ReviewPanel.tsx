import type { Debt, GraphEdge, Session } from "../types";
import { TIER_META } from "../types";
import { checkExcerpt } from "../richtext";
import { daysSince, parseUtc } from "../time";
import { ConfirmButton } from "./ConfirmButton";
import { useI18n, type TFn } from "../i18n";

const GC_IDLE_DAYS = 45;

interface Scored {
  debt: Debt;
  score: number;
  reasons: string[];
}

function neighborMap(edges: GraphEdge[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    const list = map.get(a) ?? [];
    list.push(b);
    map.set(a, list);
  };
  for (const e of edges) {
    add(e.a_debt, e.b_debt);
    add(e.b_debt, e.a_debt);
  }
  return map;
}

function scoreDebts(
  debts: Debt[],
  activeSession: Session | null,
  edges: GraphEdge[],
  t: TFn
): Scored[] {
  const byId = new Map(debts.map((d) => [d.id, d]));
  const neighbors = neighborMap(edges);
  const tierWeight = { cache: 4, ram: 2, inbox: 1, storage: 0.5 } as const;
  return debts
    .map((debt) => {
      const reasons: string[] = [];
      let score = tierWeight[debt.tier];
      reasons.push(t("reasonTier", { tier: TIER_META[debt.tier].label }));

      if (activeSession && debt.session_id === activeSession.id) {
        score += 3;
        reasons.push(t("reasonSession", { topic: activeSession.topic }));
      }

      const age = daysSince(debt.created_at);
      score += Math.min(age / 7, 4);
      if (age >= 1) reasons.push(t("reasonAge", { n: Math.floor(age) }));

      if (debt.time_spent_min > 0) reasons.push(t("reasonInvested", { n: debt.time_spent_min }));

      const linked = (neighbors.get(debt.id) ?? [])
        .map((id) => byId.get(id))
        .filter((d): d is Debt => !!d && d.status === "open");
      if (linked.some((d) => d.tier === "cache")) {
        score += 3;
        reasons.push(t("reasonCacheLink"));
      } else if (linked.length > 0) {
        score += 2;
        reasons.push(t("reasonMapLink"));
      }

      return { debt, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

function gcCandidates(debts: Debt[]): Debt[] {
  return debts
    .filter(
      (d) =>
        d.tier !== "cache" &&
        d.touch_count <= 2 &&
        daysSince(d.last_touched) >= GC_IDLE_DAYS
    )
    .sort((a, b) => parseUtc(a.last_touched) - parseUtc(b.last_touched));
}

interface Props {
  debts: Debt[];
  dueChecks: Debt[];
  graphEdges: GraphEdge[];
  activeSession: Session | null;
  digActive: boolean;
  onSelect: (id: number) => void;
  onStartDig: (id: number, minutes: number) => void;
  onEvict: (id: number) => void;
  onEvictMany: (ids: number[]) => void;
  onStillHolds: (id: number) => void;
  onReopen: (id: number) => void;
}

export function ReviewPanel({
  debts,
  dueChecks,
  graphEdges,
  activeSession,
  digActive,
  onSelect,
  onStartDig,
  onEvict,
  onEvictMany,
  onStillHolds,
  onReopen,
}: Props) {
  const { t } = useI18n();
  const top = scoreDebts(debts, activeSession, graphEdges, t).slice(0, 3);
  const gc = gcCandidates(debts);

  return (
    <div className="review">
      <section className="review-section">
        <h3 className="review-heading">{t("meetAgain")}</h3>
        {dueChecks.length === 0 && <div className="column-empty">{t("none")}</div>}
        {dueChecks.map((debt) => (
          <div key={debt.id} className="review-card review-check">
            <div className="review-body">
              <div className="debt-title">{debt.title}</div>
              <p className="review-check-body">{checkExcerpt(debt.check_content, 360)}</p>
            </div>
            <div className="review-actions">
              <button className="primary-btn" onClick={() => onStillHolds(debt.id)}>
                {t("stillHolds")}
              </button>
              <button className="ghost-btn" onClick={() => onReopen(debt.id)}>
                {t("reopen")}
              </button>
              <button className="ghost-btn" onClick={() => onSelect(debt.id)}>
                {t("source")}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="review-section">
        <h3 className="review-heading">{t("todaySuggest")}</h3>
        {top.length === 0 && <div className="column-empty">{t("none")}</div>}
        {top.map(({ debt, reasons }, i) => (
          <div key={debt.id} className="review-card">
            <div className="review-rank">{i + 1}</div>
            <div className="review-body">
              <div className="debt-title">{debt.title}</div>
              <div className="review-reasons">
                {reasons.map((r) => (
                  <span key={r} className="reason-chip">{r}</span>
                ))}
              </div>
            </div>
            <div className="review-actions">
              <button
                className="dig-start-btn"
                disabled={digActive}
                onClick={() => onStartDig(debt.id, 30)}
              >
                ⛏ {t("minutes", { n: 30 })}
              </button>
              <button className="ghost-btn" onClick={() => onSelect(debt.id)}>
                {t("open")}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="review-section">
        <h3 className="review-heading">{t("gcCandidates")}</h3>
        {gc.length === 0 && <div className="column-empty">{t("none")}</div>}
        {gc.map((d) => (
          <div key={d.id} className="gc-row">
            <div className="gc-body" onClick={() => onSelect(d.id)}>
              <span className="debt-title">{d.title}</span>
              <span className="gc-age">{t("idleDays", { n: Math.floor(daysSince(d.last_touched)) })}</span>
            </div>
            <button className="ghost-btn" onClick={() => onEvict(d.id)}>
              {t("evict")}
            </button>
          </div>
        ))}
        {gc.length > 1 && (
          <ConfirmButton
            label={t("evictAll", { n: gc.length })}
            confirmLabel={t("evictAllConfirm")}
            className="danger-btn gc-all"
            onConfirm={() => onEvictMany(gc.map((d) => d.id))}
          />
        )}
      </section>
    </div>
  );
}
