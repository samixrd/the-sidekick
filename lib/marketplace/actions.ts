"use server";

/**
 * Marketplace write actions — post reputation feedback (server-side signer).
 * (Agent registration + listing are now the connected-wallet-signed flow via
 * POST /api/agents/list; the old registerAgentAction server action is removed.)
 */
import { revalidatePath } from "next/cache";
import { giveFeedback } from "../erc8004/reputation";

function signerKey(): `0x${string}` {
  const raw = (process.env.ERC8004_SIGNER_KEY ?? "").trim();
  if (!raw) throw new Error("ERC8004_SIGNER_KEY not set — cannot sign write txs");
  return (raw.startsWith("0x") ? raw : "0x" + raw) as `0x${string}`;
}

export interface FeedbackResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

/** Post a reputation feedback entry for an agent (used after a hire completes). */
export async function postFeedbackAction(input: {
  agentId: string;
  value: number;
  valueDecimals: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
}): Promise<FeedbackResult> {
  try {
    const txHash = await giveFeedback(signerKey(), {
      agentId: BigInt(input.agentId),
      value: BigInt(Math.round(input.value * 10 ** input.valueDecimals)),
      valueDecimals: input.valueDecimals,
      tag1: input.tag1 ?? "",
      tag2: input.tag2 ?? "",
      endpoint: input.endpoint ?? "",
      feedbackURI: input.feedbackURI ?? "",
    });
    revalidatePath("/marketplace");
    return { ok: true, txHash };
  } catch (e: any) {
    return { ok: false, error: e.shortMessage || e.message };
  }
}
