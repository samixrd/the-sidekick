import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/stats — live marketplace stats from real Supabase data.
 *   totalAgents      — registered listings, EXCLUDING the infrastructure
 *                      test-listing (token 2026) from user-facing counts.
 *   tvlDelegated     — total on-chain value currently exposed via ACTIVE
 *                      session-key delegations (sum of spend_cap for active rows).
 *   totalHires       — total delegations created (lifetime).
 *   live             — static "live" data-source annotation.
 */
export async function GET() {
  const admin = createAdminSupabaseClient();

  const { data: listings } = await admin.from("agent_listings").select("erc8004_token_id");
  const liveAgents = (listings ?? []).filter((l) => Number(l.erc8004_token_id) !== 2026).length;

  const { data: delegations } = await admin.from("delegations").select("status, spend_cap");
  const active = (delegations ?? []).filter((d) => d.status === "active");
  const tvlDelegated = active.reduce((s, d) => s + Number(d.spend_cap ?? 0), 0);
  const totalHires = (delegations ?? []).length;

  return NextResponse.json({
    totalAgents: liveAgents,
    tvlDelegated,
    totalHires,
    live: true,
  });
}
