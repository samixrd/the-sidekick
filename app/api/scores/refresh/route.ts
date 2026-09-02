import { NextRequest, NextResponse } from "next/server";
import { scoreAllWallets } from "@/lib/scoring/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scores/refresh
 * On-demand Trust Score + Risk Label recompute. Reuses the EXACT same computation
 * the indexer cron already runs (lib/scoring/engine.scoreAllWallets) — no
 * duplicated logic.
 *
 * Body (optional): { "wallet": "0x..." } — recompute a single wallet; omit to
 * recompute all listed wallets.
 *
 * Returns: { scores: ScoredWallet[] } with the composite + 3 sub-scores + verified
 * + risk labels. persist=true (default) so the INSERT-only trend is updated.
 */
export async function POST(req: NextRequest) {
  let wallet: string | undefined;
  try {
    const body = await req.json().catch(() => null);
    if (body && body.wallet) wallet = String(body.wallet);
  } catch {
    // empty body = recompute all
  }

  if (wallet && !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "wallet must be a 0x-address" }, { status: 400 });
  }

  try {
    const scores = await scoreAllWallets({ wallet, persist: true });
    const serialized = scores.map((s) => ({ ...s, tokenId: s.tokenId.toString() }));
    return NextResponse.json({ wallet: wallet ?? null, count: serialized.length, scores: serialized });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
