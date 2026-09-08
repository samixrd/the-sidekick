import { NextResponse } from "next/server";
import { computeAllMetrics } from "@/lib/metrics";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[wallet] — bundled agent-detail payload, all from real indexed
 * data. Reuses the same metrics computation as /api/metrics, plus the score,
 * the full events feed, the hire/job (delegation) records, and the snapshot
 * trust-score trend (for the sparkline).
 */
export async function GET(_req: Request, { params }: { params: { wallet: string } }) {
  const wallet = String(params.wallet).toLowerCase();
  const admin = createAdminSupabaseClient();

  // 1. metrics (same computation as /api/metrics)
  const all = await computeAllMetrics();
  const metric = all.find((m) => m.wallet.toLowerCase() === wallet) ?? null;

  // 2. score — latest snapshot for this wallet
  const { data: score } = await admin
    .from("agent_snapshots")
    .select("trust_score, trust_age_activity, trust_reputation, trust_bond, trust_risk_penalty, trust_verified, risk_label_count, risk_labels, data_confidence, first_tx_timestamp, tx_count, snapshot_timestamp")
    .eq("wallet", wallet)
    .order("snapshot_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 3. full events feed (newest first) — every real tx
  const { data: events } = await admin
    .from("events")
    .select("event_type, token_in, token_out, amount_in, amount_out, tx_hash, block_number, block_timestamp, counterparty")
    .eq("wallet", wallet)
    .order("block_timestamp", { ascending: false });

  // 4. trend sparkline — non-null trust scores over time
  const { data: trend } = await admin
    .from("agent_snapshots")
    .select("snapshot_timestamp, trust_score")
    .eq("wallet", wallet)
    .order("snapshot_timestamp", { ascending: true });

  // 5. hire / job records (delegations) for this agent
  const { data: hires } = await admin
    .from("delegations")
    .select("id, status, spend_cap, token_scope, min_liquidity, expiry, amount_used, erc8183_job_id, erc8183_tx_hash, session_key, guard_router, tx_hash, created_at")
    .eq("agent_wallet", wallet)
    .order("created_at", { ascending: false });

  // 5b. decision feed — every strategy-loop cycle outcome (executed AND skipped,
  // with the on-chain reason + tx when it acted). Written directly by the loop,
  // so it is visible the second it happens — no indexer lag. Audit-only table.
  const { data: runs } = await admin
    .from("strategy_runs")
    .select("category, action, status, reason, tx_hash, created_at")
    .eq("agent_wallet", wallet)
    .order("created_at", { ascending: false })
    .limit(30);

  const listing = await admin.from("agent_listings").select("erc8004_token_id, category, bond_wei").eq("agent_wallet", wallet).maybeSingle();

  return NextResponse.json({
    wallet,
    metric,
    score: score ?? null,
    events: events ?? [],
    trend: (trend ?? []).filter((t: any) => t.trust_score !== null).map((t: any) => ({ at: t.snapshot_timestamp, trust: Number(t.trust_score) })),
    hires: hires ?? [],
    runs: runs ?? [],
    listing: listing.data ?? null,
  });
}
