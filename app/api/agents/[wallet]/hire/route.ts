import { NextResponse } from "next/server";
import { createDelegation, resolveAgentKey, type HireStep } from "@/lib/hire/create-delegation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[wallet]/hire — real create-delegation flow, streamed as SSE.
 *
 * Body: { spendCapTbnb, tokenScope: string[], minLiquidity, days, user, agentId, agentName }
 *   user      — the DELEGATING OWNER (the connected wallet). This is the actual
 *               connected wallet, never mocked.
 *   agentKey  — NEVER accepted from the client; resolved server-side by agent wallet.
 *
 * Streams one SSE event per real step: session-grant → create-hire → erc8183-job
 * → persist, each carrying the real tx hash (linked to BscScan by the client).
 * On any step failure, streams a `{step, error}` event and closes with 500.
 */
export async function POST(req: Request, { params }: { params: { wallet: string } }) {
  const agentWallet = String(params.wallet).toLowerCase() as `0x${string}`;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const { spendCapTbnb, tokenScope, minLiquidity, days, user, agentId, agentName } = body ?? {};
  if (!user || !/^0x[a-fA-F0-9]{40}$/.test(String(user))) return NextResponse.json({ error: "user (connected wallet required)" }, { status: 400 });
  if (spendCapTbnb == null || !Array.isArray(tokenScope) || minLiquidity == null || days == null) {
    return NextResponse.json({ error: "spendCapTbnb, tokenScope, minLiquidity, days required" }, { status: 400 });
  }

  const agentKey = resolveAgentKey(agentWallet);
  if (!agentKey) return NextResponse.json({ error: `no private key available for agent ${agentWallet.slice(0, 10)}…` }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const onStep = async (s: HireStep) => send(s);
        const result = await createDelegation({
          agentId: String(agentId ?? agentWallet), agentName: String(agentName ?? "Agent"),
          agentWallet, spendCapTbnb: Number(spendCapTbnb), tokenScope: tokenScope.map((t: string) => t as `0x${string}`),
          minLiquidity: Number(minLiquidity), days: Number(days), user: String(user), agentKey, onStep,
        });
        send({ step: "done", done: true, result });
        controller.close();
      } catch (e: any) {
        const msg = e?.shortMessage || e?.message || "unknown error";
        send({ step: "error", error: msg });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
