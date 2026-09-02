import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/scores — latest Trust Score + Risk Label breakdown per wallet.
 * Reads the most recent agent_snapshots row per wallet (the INSERT-only trend's
 * latest point), with the composite + 3 sub-scores + verified, and the risk
 * labels for that point.
 */
export async function GET() {
  const admin = createAdminSupabaseClient();
  const { data: rows, error } = await admin
    .from("agent_snapshots")
    .select("wallet, snapshot_timestamp, trust_score, trust_age_activity, trust_reputation, trust_bond, trust_risk_penalty, trust_verified, risk_label_count, risk_labels, data_confidence, first_tx_timestamp, tx_count")
    .order("snapshot_timestamp", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // latest per wallet
  const seen = new Set<string>();
  const latest: any[] = [];
  for (const r of rows ?? []) {
    if (seen.has(r.wallet)) continue;
    seen.add(r.wallet);
    if (r.trust_score === null || r.trust_score === undefined) continue; // skip unscored (e.g. zero-addr probe) rows
    latest.push({
      wallet: r.wallet,
      snapshot_timestamp: r.snapshot_timestamp,
      trust_score: r.trust_score,
      breakdown: {
        age_activity: r.trust_age_activity,
        reputation: r.trust_reputation,
        bond_relative: r.trust_bond,
        risk_penalty: r.trust_risk_penalty,
      },
      verified: r.trust_verified,
      risk_label_count: r.risk_label_count,
      risk_labels: safeJson(r.risk_labels),
      data_confidence: r.data_confidence,
      first_tx_timestamp: r.first_tx_timestamp,
      tx_count: r.tx_count,
    });
  }
  return NextResponse.json({ scores: latest });
}

function safeJson(s: string): any[] {
  try { return JSON.parse(s || "[]"); } catch { return []; }
}
