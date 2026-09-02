/**
 * REVOKE A DELEGATION — shared by the scheduled auto-revoke check and the
 * My Agents one-click revoke API. All REAL on-chain (BSC testnet).
 *
 * A session key is registered in the Altana Keystore under the AGENT's wallet
 * (the session was granted by the agent's admin key). To revoke on-chain we
 * compute keyId = keccak256(session_public_key) and call
 * Keystore.revokeKey(agentWallet, keyId) — signed by the agent's admin key
 * (resolved server-side, never from the client). Provable via isValidKey.
 *
 * Returns the revoke tx hash + a boolean confirming isValidKey flipped true→false.
 */
import { createWalletClient, createPublicClient, http, keccak256 } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createAdminSupabaseClient } from "../supabase/admin";
import { resolveAgentKey } from "./create-delegation";

const KEYSTORE = "0x6b8361C29d05D498b1a12B54A37310f94171E94A".toLowerCase();
const KEYSTORE_ABI = [
  { name: "revokeKey", type: "function", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [] },
  { name: "isValidKey", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

export interface RevokeResult {
  ok: boolean;
  tx?: string;
  isValidBefore?: boolean;
  isValidAfter?: boolean;
  error?: string;
}

export async function revokeDelegation(delegation: { id: string; agent_wallet: string; session_public_key: string | null; agent_id?: string }): Promise<RevokeResult> {
  if (!delegation.session_public_key) {
    return { ok: false, error: `no session_public_key stored — cannot revoke ${delegation.agent_id ?? delegation.id}` };
  }
  const admin = createAdminSupabaseClient();
  const KEY = resolveAgentKey(delegation.agent_wallet as `0x${string}`);
  if (!KEY) return { ok: false, error: `no admin key for ${delegation.agent_wallet.slice(0, 10)}…` };
  try {
    const signer = privateKeyToAccount(KEY);
    const walletClient = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account: signer });
    const publicClient = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });
    const keyId = keccak256(delegation.session_public_key as `0x${string}`) as `0x${string}`;
    const isValidBefore = (await publicClient.readContract({ address: KEYSTORE as `0x${string}`, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [delegation.agent_wallet as `0x${string}`, keyId] })) as boolean;
    const tx = await walletClient.writeContract({ address: KEYSTORE as `0x${string}`, abi: KEYSTORE_ABI, functionName: "revokeKey", args: [delegation.agent_wallet as `0x${string}`, keyId] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const isValidAfter = (await publicClient.readContract({ address: KEYSTORE as `0x${string}`, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [delegation.agent_wallet as `0x${string}`, keyId] })) as boolean;
    await admin.from("delegations").update({ status: "revoked", revoked_tx: tx, updated_at: new Date().toISOString() }).eq("id", delegation.id);
    return { ok: isValidBefore && !isValidAfter, tx, isValidBefore, isValidAfter };
  } catch (e) {
    return { ok: false, error: (e as Error).message?.slice(0, 160) };
  }
}
