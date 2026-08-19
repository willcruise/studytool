import type { Debt, GraphEdge, Session } from "../types";
import { TIER_META } from "../types";
import { checkExcerpt } from "../richtext";
import { daysSince, parseUtc } from "../time";
import { ConfirmButton } from "./ConfirmButton";

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
  edges: GraphEdge[]
): Scored[] {
  const byId = new Map(debts.map((d) => [d.id, d]));
  const neighbors = neighborMap(edges);
  const tierWeight = { cache: 4, ram: 2, inbox: 1, storage: 0.5 } as const;
  return debts
    .map((debt) => {
      const reasons: string[] = [];
      let score = tierWeight[debt.tier];
      reasons.push(`${TIER_META[debt.tier].label} 계층`);

      if (activeSession && debt.session_id === activeSession.id) {
        score += 3;
        reasons.push(`현재 세션(${activeSession.topic})과 연결`);
      }

      const age = daysSince(debt.created_at);
      score += Math.min(age / 7, 4);
      if (age >= 1) reasons.push(`${Math.floor(age)}일 경과`);

      if (debt.time_spent_min > 0) reasons.push(`이미 ${debt.time_spent_min}분 투자함`);

      const linked = (neighbors.get(debt.id) ?? [])
        .map((id) => byId.get(id))
        .filter((d): d is Debt => !!d && d.status === "open");
      if (linked.some((d) => d.tier === "cache")) {
        score += 3;
        reasons.push("Cache 항목과 지도에서 연결됨");
      } else if (linked.length > 0) {
        score += 2;
        reasons.push("지도에서 다른 미탐험과 연결됨");
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
  const top = scoreDebts(debts, activeSession, graphEdges).slice(0, 3);
  const gc = gcCandidates(debts);

  return (
    <div className="review">
      <section className="review-section">
        <h3 className="review-heading">다시 만나기</h3>
        <p className="review-desc">
          예전에 쓴 Check입니다. 지금 읽어도 성립하면 넘기고, 흔들리면 다시 엽니다.
        </p>
        {dueChecks.length === 0 && (
          <div className="column-empty">오늘은 다시 볼 Check가 없습니다.</div>
        )}
        {dueChecks.map((debt) => (
          <div key={debt.id} className="review-card review-check">
            <div className="review-body">
              <div className="debt-title">{debt.title}</div>
              <p className="review-check-body">{checkExcerpt(debt.check_content, 360)}</p>
            </div>
            <div className="review-actions">
              <button className="primary-btn" onClick={() => onStillHolds(debt.id)}>
                아직 성립한다
              </button>
              <button className="ghost-btn" onClick={() => onReopen(debt.id)}>
                다시 열기
              </button>
              <button className="ghost-btn" onClick={() => onSelect(debt.id)}>
                원문
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="review-section">
        <h3 className="review-heading">오늘의 상환 제안</h3>
        <p className="review-desc">
          백로그 전체가 아니라, 지금 갚으면 가장 효과가 큰 항목만 골랐습니다. 하나 골라
          타임박스로 파보세요.
        </p>
        {top.length === 0 && <div className="column-empty">열린 항목이 없습니다. 깨끗하네요.</div>}
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
                title={digActive ? "이미 파보는 중입니다" : "30분 타임박스 시작"}
                onClick={() => onStartDig(debt.id, 30)}
              >
                ⛏ 30분
              </button>
              <button className="ghost-btn" onClick={() => onSelect(debt.id)}>
                열기
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="review-section">
        <h3 className="review-heading">가비지 컬렉션 후보</h3>
        <p className="review-desc">
          {GC_IDLE_DAYS}일 이상 손대지 않은 항목입니다. 진짜 중요한 지식이라면 다른 공부를
          하다가 반드시 다시 마주칩니다 — 죄책감 없이 방출하세요.
        </p>
        {gc.length === 0 && (
          <div className="column-empty">방출할 후보가 없습니다. 리스트가 건강합니다.</div>
        )}
        {gc.map((d) => (
          <div key={d.id} className="gc-row">
            <div className="gc-body" onClick={() => onSelect(d.id)}>
              <span className="debt-title">{d.title}</span>
              <span className="gc-age">{Math.floor(daysSince(d.last_touched))}일 방치</span>
            </div>
            <button className="ghost-btn" onClick={() => onEvict(d.id)}>
              방출
            </button>
          </div>
        ))}
        {gc.length > 1 && (
          <ConfirmButton
            label={`모두 방출 (${gc.length}개)`}
            confirmLabel="정말 모두 방출?"
            className="danger-btn gc-all"
            onConfirm={() => onEvictMany(gc.map((d) => d.id))}
          />
        )}
      </section>
    </div>
  );
}
