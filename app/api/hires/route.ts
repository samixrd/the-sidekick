import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/hires?wallet=0x… — the connected wallet's delegation history,
 * joined with the agent's listing (name/category) for rendering.
 *
 * Supports the corrected data model: multiple hires of the same agent appear as
 * separate rows. Each row carries amount_used (real from guard_spends tracking),
 * expiry, session_key, guard_router, job id + tx, and status.
 */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "wallet (0x address) required" }, { status: 400 });
  }
  const admin = createAdminSupabaseClient();
  const { data: hires, error } = await admin
    .from("delegations")
    .select("*")
    .ilike("user_id", wallet.toLowerCase())
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // join agent name + category from agent_listings
  const wallets = [...new Set((hires ?? []).map((h) => h.agent_wallet))];
  const listings = new Map<string, { category: string }>();
  if (wallets.length) {
    const { data: ls } = await admin.from("agent_listings").select("agent_wallet, category").in("agent_wallet", wallets);
    for (const l of ls ?? []) listings.set(l.agent_wallet, { category: l.category });
  }

  const now = Math.floor(Date.now() / 1000);
  const rows = (hires ?? []).map((h) => ({
    id: h.id,
    agentId: h.agent_id,
    agentWallet: h.agent_wallet,
    agentName: `Hermes — ${listings.get(h.agent_wallet)?.category ?? h.agent_id?.replace("Hermes-", "") ?? "Agent"}`,
    category: listings.get(h.agent_wallet)?.category ?? null,
    status: h.status,
    spendCap: h.spend_cap,
    amountUsed: h.amount_used,
    expiry: h.expiry,
    expired: h.expiry ? now > Number(h.expiry) : false,
    sessionKey: h.session_key,
    guardRouter: h.guard_router,
    jobId: h.erc8183_job_id,
    jobTx: h.erc8183_tx_hash,
    sessionTx: h.tx_hash,
    revokedTx: h.revoked_tx,
    sessionPublicKey: h.session_public_key,
    createdAt: h.created_at,
  }));

  return NextResponse.json(
    { wallet: wallet.toLowerCase(), counts: { total: rows.length, active: rows.filter((r) => r.status === "active").length }, hires: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
}
