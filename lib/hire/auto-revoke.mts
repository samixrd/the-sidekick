/**
 * AUTO-REVOKE check (scheduled, runs alongside the 2h indexer cron).
 *
 * REAL:
 *   - `amount_used` is read from the delegation record — the indexer derives it
 *     from `guard_spends` (session-routed spend cross-referenced by hire_id).
 *   - Revoke a live delegation on-chain via the Keystore `revokeKey(user, keyId)`
 *     with keyId = keccak256(session_public_key). Provable via isValidKey.
 *     `session_public_key` is stored at hire time.
 *
 * REVOKE TRIGGERS (real condition logic):
 *   1. expiry passed
 *   2. spend cap exhausted (amount_used >= cap)
 *   3. risk-label count >= threshold (REAL — computed by the Step 7 risk-label
 *      engine via scoreAllWallets → delegation.risk_flag_count / snapshot
 *      risk_label_count; NOT a primitive behavior flag)
 *
 * Run:  npm run auto:revoke
 */
import { createClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { createWalletClient, createPublicClient, http, keccak256 } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createAdminSupabaseClient } from "../supabase/admin";
import { envGet } from "../env";

const admin = createAdminSupabaseClient();
const KEYSTORE = "0x6b8361C29d05D498b1a12B54A37310f94171E94A".toLowerCase();
const RISK_FLAG_THRESHOLD = 3; // real risk-label count (Step 7) at/above which a delegation auto-revokes

async function main() {
  const { data: active, error } = await admin.from("delegations").select("*").eq("status", "active");
  if (error) { console.log("query err:", error.message); return; }
  console.log("active delegations:", (active ?? []).length, "\n");
  const now = Math.floor(Date.now() / 1000);
  let revoked = 0;

  for (const d of active ?? []) {
    // amount_used is DERIVED by the indexer from `guard_spends` (session-routed
    // spend cross-referenced by hire_id) and written to the delegation record.
    // Auto-revoke reads that authoritative value — it does not re-derive from
    // arbitrary wallet events.
    const flagCount = await latestFlagCount(admin, d.agent_wallet);
    console.log(`[${d.agent_id}] cap=${d.spend_cap} used=${d.amount_used} expiry=${d.expiry} flags=${flagCount}`);

    const reason = evaluate({ ...d, risk_flag_count: flagCount }, now);
    if (reason) {
      console.log(`   → AUTO-REVOKE: ${reason}`);
      const ok = await revokeDelegation(d, reason);
      if (ok) revoked++;
    } else {
      console.log("   → OK (no action)");
    }
    console.log("");
  }
  console.log(`auto-revoked ${revoked} delegation(s).`);
}

/** Returns a reason string if the delegation should be revoked, else null. */
function evaluate(d: any, now: number): string | null {
  if (Number(d.expiry) && now > Number(d.expiry)) return `expired (${d.expiry} < now)`;
  const cap = Number(d.spend_cap);
  if (cap > 0 && Number(d.amount_used) >= cap) return `spend cap exhausted (${d.amount_used}/${cap})`;
  const fc = Number(d.risk_flag_count ?? 0);
  if (fc >= RISK_FLAG_THRESHOLD) return `risk-flag count ${fc} >= ${RISK_FLAG_THRESHOLD} (STUB — pending Step 7 scoring)`;
  return null;
}

/** Latest REAL risk-label count (from the scoring engine's risk_label_count, not the primitive behavior flag). */
async function latestFlagCount(admin: any, wallet: string) {
  // Prefer the delegation's real risk_flag_count (set by scoreAllWallets from the
  // risk engine). Fall back to the snapshot's risk_label_count.
  const { data: del } = await admin.from("delegations").select("risk_flag_count").eq("agent_wallet", wallet).limit(1).maybeSingle();
  if (del && del.risk_flag_count !== null && del.risk_flag_count !== undefined) return Number(del.risk_flag_count);
  const { data: snap } = await admin.from("agent_snapshots").select("risk_label_count").eq("wallet", wallet.toLowerCase()).order("snapshot_timestamp", { ascending: false }).limit(1).maybeSingle();
  return snap ? Number(snap.risk_label_count ?? 0) : 0;
}

/** Revoke a delegation's session key in the Keystore registry (real on-chain). */
async function revokeDelegation(d: any, reason: string) {
  if (!d.session_public_key) { console.log(`   (no session_public_key stored — cannot auto-revoke ${d.agent_id})`); return false; }
  try {
    const key = resolveAgentKey();
    const signer = privateKeyToAccount(key);
    const walletClient = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account: signer });
    const publicClient = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });
    // keyId = keccak256(publicKey); Keystore.revokeKey(user, keyId) removes the
    // session key from the public registry (real, provable via isValidKey).
    const keyId = keccak256(d.session_public_key as `0x${string}`);
    const isValidBefore = await publicClient.readContract({ address: KEYSTORE, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [d.agent_wallet, keyId] });
    const tx = await walletClient.writeContract({ address: KEYSTORE, abi: KEYSTORE_ABI, functionName: "revokeKey", args: [d.agent_wallet, keyId] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const isValidAfter = await publicClient.readContract({ address: KEYSTORE, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [d.agent_wallet, keyId] });
    const { error } = await admin.from("delegations").update({ status: "revoked", revoked_tx: tx, updated_at: new Date().toISOString() }).eq("id", d.id);
    console.log(`   ✅ auto-revoked: tx ${tx.slice(0, 18)}… | isValidKey ${isValidBefore}→${isValidAfter} | Supabase→revoked ${error ? `(db ${error.message})` : "✓"}`);
    return isValidBefore && !isValidAfter;
  } catch (e) {
    console.log("   revoke err:", (e as Error).message?.slice(0, 140));
    return false;
  }
}

const KEYSTORE_ABI = [
  { name: "revokeKey", type: "function", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [] },
  { name: "isValidKey", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

/** The admin key that grants/revokes sessions for the agent (the category signer). */
function resolveAgentKey(): `0x${string}` {
  const k = envGet("CAT_REBALANCE_KEY").replace(/^0x/, "");
  if (k) return ("0x" + k) as `0x${string}`;
  const m = envGet("ERC8004_SIGNER_KEY").replace(/^0x/, "");
  return ("0x" + m) as `0x${string}`;
}

main().catch((e) => { console.error("auto-revoke err:", e.message || e); process.exit(1); });
