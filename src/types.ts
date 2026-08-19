export type Tier = "inbox" | "cache" | "ram" | "storage";
export type Status = "open" | "resolved" | "evicted";

export interface Session {
  id: number;
  topic: string;
  created_at: string;
  is_active: number;
}

export interface Debt {
  id: number;
  title: string;
  note: string;
  tier: Tier;
  status: Status;
  session_id: number | null;
  session_topic?: string | null;
  source_url: string | null;
  source_file: string | null;
  summary: string | null;
  check_content: string;
  parent_id: number | null;
  parent_title?: string | null;
  created_at: string;
  last_touched: string;
  touch_count: number;
  resolved_at: string | null;
  next_review_at: string | null;
  review_stage: number;
  dig_until: string | null;
  dig_started_at: string | null;
  time_spent_min: number;
  attachment_count?: number;
}

export interface Attachment {
  id: number;
  debt_id: number;
  filename: string;
  path: string;
  created_at: string;
}

export const TIER_META: Record<Tier, { label: string; hint: string; color: string }> = {
  inbox: { label: "Inbox", hint: "일단 던져놓는 곳", color: "#8b8fa3" },
  cache: { label: "Cache", hint: "지금 진도를 막는 것", color: "#e5534b" },
  ram: { label: "RAM", hint: "주말·자투리에 볼 것", color: "#d4a72c" },
  storage: { label: "Storage", hint: "언젠가 파볼 큰 주제", color: "#539bf5" },
};

export const TIER_ORDER: Tier[] = ["inbox", "cache", "ram", "storage"];

export function visibleBoardTiers(showRam: boolean, showStorage: boolean): Tier[] {
  return TIER_ORDER.filter(
    (t) => t === "inbox" || t === "cache" || (t === "ram" && showRam) || (t === "storage" && showStorage)
  );
}

export type View = "board" | "graph" | "review" | "resolved";

export const VIEWS: { key: View; label: string }[] = [
  { key: "board", label: "보드" },
  { key: "graph", label: "지도" },
  { key: "review", label: "리뷰" },
  { key: "resolved", label: "탐험 완료" },
];

export interface GraphMeta {
  id: number;
  name: string;
  created_at: string;
}

export interface GraphEdge {
  a_debt: number;
  b_debt: number;
}

export interface Stats {
  open: number;
  resolved: number;
}
