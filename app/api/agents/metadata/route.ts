import { NextResponse } from "next/server";
import { updateAgentMetadata } from "@/lib/marketplace/listing";

export const runtime = "nodejs";

/**
 * POST /api/agents/metadata — autonomous post-listing metadata update.
 * No bond, no re-confirmation. Only the original lister can call (contract-enforced).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { erc8004TokenId, metadataURI } = body;
    if (erc8004TokenId == null || !metadataURI) {
      return NextResponse.json({ ok: false, error: "erc8004TokenId and metadataURI are required" }, { status: 400 });
    }

    const rawKey = process.env.ERC8004_SIGNER_KEY ?? "";
    const signer = (rawKey.startsWith("0x") ? rawKey : "0x" + rawKey) as `0x${string}`;

    const txHash = await updateAgentMetadata(signer, BigInt(erc8004TokenId), metadataURI);
    return NextResponse.json({ ok: true, txHash });
  } catch (e: any) {
    const msg = e?.shortMessage || e?.message || "unknown error";
    console.error("/api/agents/metadata error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
