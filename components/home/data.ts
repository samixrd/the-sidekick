import type { MetricsResult } from "@/lib/metrics";

export const CATEGORIES = ["All", "Rebalancing", "Grid Trading", "Yield", "Health-Factor"] as const;
export type Category = (typeof CATEGORIES)[number];

export const SIDECASE_TEST_TOKEN_ID = 2026; // token 2026 = Sidekick test-listing (infra test data)

export interface StatsResponse {
  totalAgents: number;
  tvlDelegated: number;
  totalHires: number;
  live: boolean;
}

/** A merged agent card record = score + metrics, joined by wallet + tokenId. */
export interface AgentCardData {
  wallet: string;
  tokenId: number;
  category: string;
  name: string;              // "Hermes — <Category>"
  trustScore: number | null;
  verified: boolean;
  status: "verified" | "new" | "limited";
  txCount: number;
  lastActionAgoMin: number | null;
  activity: { status: "Active" | "Idle"; lastActionAgoMin: number | null; note: string };
  recent12h: { txCount: number; byType: Record<string, number> };
  strategyConsistent: boolean | null;
  description: string;
  dataConfidence: string | null;
  // ── compare-view fields (from the same /api/metrics source) ──
  winRate: number | null;
  maxDrawdownPct: number | null;
  realized7d: number | null;
  realizedLifetime: number | null;
  skillLucky: "Skill-driven" | "Market-driven" | "n/a";
  pnlNote: string;
  riskNote: string;
}

const CATEGORY_ORDER = ["Grid Trading", "Rebalancing", "Yield", "Health-Factor"];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "Grid Trading": "Executes range-bound buy-low/sell-high swaps on a tight BNB/USDT range.",
  "Rebalancing": "Holds a target asset mix and re-centers back to target when it drifts out of band.",
  "Yield": "Supplies collateral to earning venues and shifts to whichever venue is paying best.",
  "Health-Factor": "Monitors collateral value vs borrow and repays pre-emptively to keep a safe health factor.",
};

const sortLabels: Record<string, string> = {
  "Trust Score": "trust",
  "Newest": "newest",
  "Most Hired": "hired",
};

/** The actual shape of a row in GET /api/scores (snake_case — Supabase). */
export interface ScoreRow {
  wallet: string;
  trust_score: number | null;
  verified: boolean;
  data_confidence: string | null;
  tx_count: number | null;
}
export interface ScoresResponse { scores: ScoreRow[] }
export interface MetricsResponse { metrics: MetricsResult[] }

/** Build card records from /api/metrics + /api/scores, excluding the test-listing. */
export function buildCards(
  scores: ScoresResponse | null,
  metrics: MetricsResponse | null,
): AgentCardData[] {
  const byWallet = new Map<string, ScoreRow>();
  if (scores?.scores) for (const s of scores.scores) if (s.wallet) byWallet.set(s.wallet.toLowerCase(), s);

  const cards: AgentCardData[] = [];
  for (const m of metrics?.metrics ?? []) {
    if (Number(m.tokenId) === SIDECASE_TEST_TOKEN_ID) continue; // exclude Sidekick test-listing
    const w = m.wallet.toLowerCase();
    const score = byWallet.get(w);
    const category = m.category;
    const name = `Hermes — ${category}`;
    const txCount = m.txCount; // lifetime indexed event count (all types)
    const dataConfidence = score?.data_confidence ?? (m.strategy.consistent === null ? "low" : "medium");
    const totalRelevant = m.txCount;
    let status: AgentCardData["status"];
    if (totalRelevant < 3) status = "limited";
    else if (score?.verified) status = "verified";
    else status = "new";

    cards.push({
      wallet: w,
      tokenId: Number(m.tokenId),
      category,
      name,
      trustScore: score?.trust_score ?? null,
      verified: score?.verified ?? false,
      status,
      txCount: txCount || m.recent12h.txCount,
      lastActionAgoMin: m.freshness.lastActionAgoMin,
      activity: m.activity,
      recent12h: m.recent12h,
      strategyConsistent: m.strategy.consistent,
      description: CATEGORY_DESCRIPTIONS[category] ?? "",
      dataConfidence,
      // compare-view fields (same metrics source)
      winRate: m.risk.winRate,
      maxDrawdownPct: m.risk.maxDrawdownPct,
      realized7d: m.pnl.realized7d,
      realizedLifetime: m.pnl.realizedLifetime,
      skillLucky: m.skillLuck.label,
      pnlNote: m.pnl.note,
      riskNote: m.risk.note,
    });
  }

  // The metrics response is keyed off listings and carries tokenId+category for
  // every real agent. We enrich each with its score by wallet. (The scores GET
  // response is snake_case and has no category/tokenId, so it cannot drive the
  // grid alone.) If a score row has no matching metrics, it is skipped — the
  // metrics drive discovery.
  return cards;
}

export { CATEGORY_ORDER, sortLabels };
