import { NextRequest, NextResponse } from "next/server";
import { getContract, encodeFunctionData, parseAbi } from "viem";
import { readFileSync } from "node:fs";
import { requireErc8004Config, makePublicClient } from "@/lib/erc8004/config";
import { makeRegistrationFile, registerAgentIdentity } from "@/lib/erc8004/identity";
import { categoryToEnum, getListing } from "@/lib/marketplace/listing";
import { persistListing } from "@/lib/marketplace/listing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOND_WEI = 10_000_000_000_000_000n; // 0.01 tBNB
const listingAbi = JSON.parse(readFileSync("contracts/build/contracts_AgentListing_sol_AgentListing.abi", "utf8"));

/** Server-side registrar key for the identity mint (no value moves). */
function registrarKey(): `0x${string}` {
  const raw = (process.env.ERC8004_SIGNER_KEY ?? "").trim();
  if (!raw) throw new Error("ERC8004_SIGNER_KEY not set — cannot mint identity");
  return (raw.startsWith("0x") ? raw : "0x" + raw) as `0x${string}`;
}

/**
 * POST /api/agents/list — List an agent.
 *
 * The CONNECTED WALLET signs the BOND transaction (per requirement: "the
 * connected wallet signs the bond transaction, not a server-held key"). The
 * server NEVER holds the signing key for the bond — it only:
 *   (a) registers/confirms the ERC-8004 identity if needed (gas-paid metadata
 *       mint; the server registrar pays gas, no value moves), and
 *   (b) returns the listAgent calldata the connected wallet must sign.
 *
 * Phases:
 *   phase "prepare"  { agentWallet, category, description, lister }   →
 *       registers identity if needed, returns { phase:"list", tokenId, listTx:{to,data,value} }.
 *       (The register is a server action; the BOND is wallet-signed.)
 *   phase "finalize" { tokenId, listTxHash, agentWallet, category, description, lister } →
 *       { ok, listing } — verify on-chain + persist to Supabase.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const cfg = requireErc8004Config();
  const pub = makePublicClient();
  const phase = String(body.phase ?? "prepare");

  try {
    if (phase === "finalize") return await finalize(body, cfg, pub);

    // ── prepare ──
    const { agentWallet, category, description, lister } = body;
    if (!agentWallet || !/^0x[a-fA-F0-9]{40}$/.test(agentWallet)) {
      return NextResponse.json({ ok: false, error: "agentWallet (0x address) required" }, { status: 400 });
    }
    if (!category || !["Rebalancing", "Grid Trading", "Yield", "Health-Factor"].includes(category)) {
      return NextResponse.json({ ok: false, error: `invalid category '${category}'` }, { status: 400 });
    }
    if (!description || description.trim().length < 5) {
      return NextResponse.json({ ok: false, error: "description must be at least 5 chars" }, { status: 400 });
    }

    const dataUri = "data:application/json;base64," + Buffer.from(JSON.stringify(makeRegistrationFile({
      name: `Hermes — ${category}`,
      description: description.trim(),
      services: [{ name: "A2A", endpoint: "https://sidekick.example/.well-known/agent-card.json", version: "0.3.0" }],
      supportedTrust: ["reputation", "crypto-economic"],
    }))).toString("base64");

    // register/confirm ERC-8004 identity if the wallet doesn't already own one
    let tokenId = await identityForWallet(pub, cfg.identityRegistry, agentWallet as `0x${string}`);
    if (!tokenId) {
      tokenId = await registerAgentIdentity(registrarKey(), dataUri); // server pays gas; no value moves
    }

    const data = encodeFunctionData({ abi: listingAbi, functionName: "listAgent", args: [tokenId, categoryToEnum(category), dataUri, agentWallet] });
    return NextResponse.json({
      ok: true, phase: "list",
      tokenId: tokenId.toString(),
      listingContract: cfg.agentListing,
      bondWei: BOND_WEI.toString(),
      listTx: { to: cfg.agentListing, data, value: BOND_WEI.toString() },
      metadataURI: dataUri, category, agentWallet, lister: lister ?? agentWallet,
      registerTx: null, // registration was a server action, no wallet signature needed
    });
  } catch (e: any) {
    console.error("/api/agents/list error:", e?.shortMessage || e?.message || e);
    return NextResponse.json({ ok: false, error: e?.shortMessage || e?.message || "failed" }, { status: 500 });
  }
}

async function finalize(body: any, cfg: ReturnType<typeof requireErc8004Config>, pub: ReturnType<typeof makePublicClient>) {
  const tokenId = BigInt(body.tokenId);
  const listTxHash = String(body.listTxHash);
  const contract = getContract({ address: cfg.agentListing, abi: listingAbi as any, client: pub });

  const mined = await pub.getTransactionReceipt({ hash: listTxHash as `0x${string}` }).catch(() => null);
  if (!mined) return NextResponse.json({ ok: false, error: "list tx not found / not mined yet" }, { status: 400 });
  if (mined.status !== "success") return NextResponse.json({ ok: false, error: "list tx reverted" }, { status: 400 });

  const listed = (await contract.read.isAgentListed([tokenId])) as boolean;
  if (!listed) return NextResponse.json({ ok: false, error: "token not listed on-chain (did the tx call listAgent?)" }, { status: 400 });

  const listing = await getListing(tokenId);
  const record = await persistListing({
    erc8004TokenId: tokenId,
    lister: body.lister,
    agentWallet: body.agentWallet,
    category: body.category,
    metadataURI: body.metadataURI,
    bondWei: listing.bond,
    txHash: listTxHash,
    listingContract: cfg.agentListing,
  });
  return NextResponse.json({ ok: true, phase: "finalize", tokenId: tokenId.toString(), listTxHash, bond: listing.bond.toString(), listing: record });
}

/** Find an ERC-8004 tokenId owned by a wallet (bounded scan of recent mints), else null. */
async function identityForWallet(pub: ReturnType<typeof makePublicClient>, identityRegistry: string, wallet: `0x${string}`): Promise<bigint | null> {
  try {
    const idc = getContract({ address: identityRegistry as `0x${string}`, abi: parseAbi(["function ownerOf(uint256) view returns (address)"]), client: pub });
    for (let id = 2075; id >= 2026; id--) {
      try {
        const owner = (await idc.read.ownerOf([BigInt(id)])) as string;
        if (owner.toLowerCase() === wallet.toLowerCase()) return BigInt(id);
      } catch { /* not minted */ }
    }
  } catch {}
  return null;
}
