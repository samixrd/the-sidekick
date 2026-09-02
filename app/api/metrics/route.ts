import { NextResponse } from "next/server";
import { computeAllMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/metrics — computed per-wallet metrics, derived purely from indexed
 * data. Ready for direct frontend consumption.
 *
 * Returns: { metrics: MetricsResult[], generatedAt } for every listed wallet.
 * No-store: the grid must reflect new listings (e.g. token 2041) immediately.
 */
export async function GET() {
  try {
    const metrics = await computeAllMetrics();
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        metrics: metrics.map((m) => ({ ...m, tokenId: m.tokenId.toString() })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
