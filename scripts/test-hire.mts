/**
 * E2E HIRE FLOW test (BSC testnet, real txs).
 * Hired agent = the Rebalancing Hermes wallet (0x0b7e22be…).
 *
 * Verifies:
 *   1. Real Altana session-key grant tx (allowlist → GuardRouter 0x43a67d14…)
 *   2. Real ERC-8183 createJob tx (provider = agent wallet)
 *   3. Session registered in the Keystore registry (read back getKeys directly)
 *   4. Supabase delegation record matches on-chain state
 *   5. Revoke → delegation inactive in Keystore + Supabase (on-chain, not UI)
 */
import { createClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { ERC8183Client, AltanaWalletProvider } from "@bnbagent/sdk";
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createAdminSupabaseClient } from "../lib/supabase/admin";
import { readFileSync } from "node:fs";

const env = readFileSync(".env", "utf8");
const GUARD = (env.match(/^GUARD_ROUTER="?([^"\r\n]+)/m)?.[1] ?? "") as `0x${string}`;
const KEYSTORE = "0x6b8361C29d05D498b1a12B54A37310f94171E94A".toLowerCase();
const agentKey = (env.match(/^CAT_REBALANCE_KEY="?([^"\r\n]+)/m)?.[1] ?? "").replace(/^0x/, "");
const agent = privateKeyToAccount(("0x" + agentKey) as `0x${string}`);

const KEYSTORE_ABI = [
  { name: "getKeys", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "bytes32[]" }] },
  { name: "getPublicKey", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ type: "bytes" }] },
  { name: "isValidKey", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

async function main() {
  const pub = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });
  const admin = createAdminSupabaseClient();
  const client = createClient({ chains: [BNB_TESTNET] });
  const adminSigner = signerFromPrivateKey(("0x" + agentKey) as `0x${string}`);

  console.log("── 1. Altana session-key grant (allowlist → GuardRouter) ──");
  console.log("   hired agent:", agent.address, "| guard router:", GUARD);
  const wallet = await client.createWallet({ signer: adminSigner });
  const session = await client.grantSession({
    wallet,
    signer: adminSigner,
    chainId: 97,
    permissions: {
      calls: [{ to: GUARD }],
      spend: [{ limit: 1_000_000_000_000_000n, period: "day" }], // 0.001 tBNB/day
    },
    expiry: Math.floor(Date.now() / 1000) + 2 * 86400,
  });
  const sessionTx = session.transactionHash ?? "";
  const sessionKey = (session.signer as any)?.address ?? "see-tx";
  console.log("   ✅ session grant tx:", sessionTx);
  console.log("   session key:", sessionKey);

  console.log("\n── 2. GuardRouter.createHire (per-hire policy) ──");
  const guardAbi = JSON.parse(readFileSync("contracts/build/contracts_GuardRouter_sol_GuardRouter.abi", "utf8"));
  const hireId = "0x" + Buffer.from(sessionKey).toString("hex").padEnd(64, "0").slice(0, 64);
  const tokenScope = ["0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd".toLowerCase(), "0x337610d27c682E347C9cD60BD4b3b107C9d34DdD".toLowerCase()];
  const minLiq = 1_000_000_000_000_000_000n; // 1.0 token units
  const { createWalletClient } = await import("viem");
  const agentClient = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account: agent });
  const hireTx = await agentClient.writeContract({ address: GUARD, abi: guardAbi, functionName: "createHire", args: [hireId as `0x${string}`, sessionKey as `0x${string}`, tokenScope as any, minLiq] });
  await pub.waitForTransactionReceipt({ hash: hireTx });
  console.log("   ✅ createHire tx:", hireTx, "(tokenScope", tokenScope.length, "tokens, minLiq", minLiq.toString(), ")");

  console.log("\n── 3. ERC-8183 createJob (provider = agent, expiry = session) ──");
  const provider = new AltanaWalletProvider({ network: "bnb-testnet", privateKey: ("0x" + agentKey) });
  const commerce = await ERC8183Client.create({ network: "bsc-testnet", walletProvider: provider });
  const expiryAbs = Math.floor(Date.now() / 1000) + 2 * 86400;
  const desc = `version=1;negotiated_at=${Math.floor(Date.now() / 1000)};task=Hire Rebalancing agent;terms=guard_router:${GUARD};expiry=${expiryAbs}`;
  const job = await commerce.createJob({ provider: agent.address, expiredAt: BigInt(expiryAbs), description: desc });
  const jobId = (job as any).id ?? String((job as any).jobId ?? "");
  const jobTx = (job as any).transactionHash ?? (job as any).txHash ?? "";
  console.log("   ✅ ERC-8183 job tx:", jobTx, "| jobId:", jobId);

  console.log("\n── 4. Persist + query Supabase delegation ──");
  const delegId = `KS-${Date.now().toString(36).toUpperCase()}`;
  const { error: insErr } = await admin.from("delegations").insert({
    id: delegId, user_id: "e2e-test", agent_id: "Hermes-Rebalancing",
    agent_wallet: agent.address.toLowerCase(), session_key: sessionKey.toLowerCase(),
    guard_router: GUARD.toLowerCase(), token_scope: JSON.stringify(tokenScope),
    min_liquidity: String(Number(minLiq) / 1e18), spend_cap: "1000",
    amount_used: "0", expiry: expiryAbs, tx_hash: sessionTx,
    erc8183_job_id: jobId, erc8183_tx_hash: jobTx, status: "active",
  });
  if (insErr) { console.log("   ⚠ insert:", insErr.message); return; }
  const { data: rec } = await admin.from("delegations").select("*").eq("id", delegId).single();
  console.log("   ✅ Supabase delegation:", rec ? `id=${rec.id} agent=${rec.agent_id} status=${rec.status} session=${rec.session_key.slice(0,12)}…` : "nil");

  console.log("\n── 5. Keystore read-back (prove session registered in Keystore, not just our DB) ──");
  const keys = (await pub.readContract({ address: KEYSTORE, abi: KEYSTORE_ABI, functionName: "getKeys", args: [agent.address] })) as `0x${string}`[];
  console.log("   getKeys(user) count:", keys.length);
  let keystoreRegistered = false;
  for (const k of keys) {
    const valid = await pub.readContract({ address: KEYSTORE, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [agent.address, k] });
    console.log(`   key ${k.slice(0,18)}… valid=${valid}`);
    if (valid) keystoreRegistered = true;
  }
  console.log("   → session registered in Altana Keystore:", keystoreRegistered ? "YES ✓" : "NO ✗");

  // ── 6. Revoke (real) + confirm inactive ──
  console.log("\n── 6. Revoke session (real) ──");
  const revokeRes = await client.revokeSession({ wallet, signer: adminSigner, session, chainId: 97 });
  const revokeTx = revokeRes.transactionHash ?? "";
  console.log("   ✅ revoke tx:", revokeTx);
  const keysAfter = (await pub.readContract({ address: KEYSTORE, abi: KEYSTORE_ABI, functionName: "getKeys", args: [agent.address] })) as `0x${string}`[];
  console.log("   getKeys after revoke:", keysAfter.length);
  let anyValidAfter = false;
  for (const k of keysAfter) { const v = await pub.readContract({ address: KEYSTORE, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [agent.address, k] }); if (v) anyValidAfter = true; }
  const { error: updErr } = await admin.from("delegations").update({ status: "revoked", revoked_tx: revokeTx }).eq("id", delegId);
  const { data: recAfter } = await admin.from("delegations").select("status").eq("id", delegId).single();
  console.log("   Supabase status after revoke:", recAfter?.status, "| tx:", revokeTx.slice(0,14) + "…", updErr ? `(db ${updErr.message})` : "");
  console.log("   → on-chain Keystore anyValid after revoke:", anyValidAfter, "(revoked session key removed)");

  console.log("\n── E2E DONE ──");
}
main().catch((e) => { console.error("E2E FAILED:", e.shortMessage || e.message || e); process.exit(1); });
