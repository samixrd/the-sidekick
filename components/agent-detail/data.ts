import type { MetricsResult } from "@/lib/metrics";

export interface ScoreRow {
  trust_score: number | null;
  trust_age_activity: number | null;
  trust_reputation: number | null;
  trust_bond: number | null;
  trust_risk_penalty: number | null;
  trust_verified: boolean | null;
  risk_label_count: number | null;
  risk_labels: string | null;
  data_confidence: string | null;
  first_tx_timestamp: string | null;
  tx_count: number | null;
  snapshot_timestamp: string | null;
}

export interface EventRow {
  event_type: string;
  token_in: string | null;
  token_out: string | null;
  amount_in: string | null;
  amount_out: string | null;
  tx_hash: string;
  block_number: number | null;
  block_timestamp: string | null;
  counterparty: string | null;
}

export interface TrendPoint { at: string; trust: number }

export interface HireRow {
  id: string;
  status: string;
  spend_cap: number | null;
  token_scope: string | null;
  min_liquidity: number | null;
  expiry: number | null;
  amount_used: number | null;
  erc8183_job_id: string | null;
  erc8183_tx_hash: string | null;
  session_key: string | null;
  guard_router: string | null;
  tx_hash: string | null;
  created_at: string | null;
}

export interface ListingRow {
  erc8004_token_id: number;
  category: string;
  bond_wei: string;
}

export interface AgentDetail {
  wallet: string;
  metric: MetricsResult | null;
  score: ScoreRow | null;
  events: EventRow[];
  trend: TrendPoint[];
  hires: HireRow[];
  listing: ListingRow | null;
}

// ── honest-null formatters ────────────────────────────────────────
export function fmtUsd(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined) return "—";
  const sign = v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toFixed(digits)}`;
}

export function fmtAgoMin(min: number | null | undefined): string {
  if (min === null || min === undefined) return "No activity yet";
  if (min < 1) return "<1 min ago";
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}

/** Human-readable action tag for an event row. */
export function eventAction(e: EventRow): string {
  const t = e.event_type;
  if (t === "pancakeswap_swap") {
    const wbnb = "0xae13d989dac2f0debff460ac112a837c89baa7cd";
    return String(e.token_in).toLowerCase() === wbnb ? "Sell" : "Buy";
  }
  if (t === "venus_supply") return "Lend";
  if (t === "venus_borrow") return "Borrow";
  if (t === "venus_repay") return "Repay";
  if (t === "venus_redeem") return "Withdraw";
  return t.replace("venus_", "").replace("pancakeswap_", "");
}

export function shortToken(addr: string | null): string {
  if (!addr || !addr.startsWith("0x")) return "—";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return hash.slice(0, 10) + "…" + hash.slice(-6);
}

export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "Grid Trading": "Executes range-bound buy-low/sell-high swaps on a tight BNB/USDT range.",
  "Rebalancing": "Holds a target asset mix and re-centers back to target when it drifts out of band.",
  "Yield": "Supplies collateral to earning venues and shifts to whichever venue is paying best.",
  "Health-Factor": "Monitors collateral value vs borrow and repays pre-emptively to keep a safe health factor.",
};

export function tokenScopeList(scope: string | null): string[] {
  try { return scope ? JSON.parse(scope) : []; } catch { return []; }
}

export function bscscanTxUrl(hash: string | null | undefined): string {
  return hash ? `https://testnet.bscscan.com/tx/${hash}` : "https://testnet.bscscan.com";
}

export function bscscanAddressUrl(wallet: string): string {
  return `https://testnet.bscscan.com/address/${wallet}`;
}
