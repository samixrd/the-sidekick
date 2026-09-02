/**
 * Prove the SPECIFIC session key is registered and revocable in the Keystore.
 * keyId = keccak256(publicKey). We record the session keyId at grant time, then
 * (re)revoke and check isValidKey(sessionKeyId) flips false on-chain.
 */
import { createClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { createPublicClient, http, keccak256, toHex } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const env = readFileSync(".env", "utf8");
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
  const client = createClient({ chains: [BNB_TESTNET] });
  const signer = signerFromPrivateKey(("0x" + agentKey) as `0x${string}`);

  // grant a fresh session, capture its public key + derived keyId
  const wallet = await client.createWallet({ signer });
  const session = await client.grantSession({
    wallet, signer, chainId: 97,
    permissions: { calls: [{ to: "0x43a67d1476994f14a37bd39f7db29fb3d4058529" }], spend: [{ limit: 1_000_000_000_000_000n, period: "day" }] },
    expiry: Math.floor(Date.now() / 1000) + 2 * 86400,
  });
  const sessionKeyAddress = (session.signer as any)?.address;
  const sessionPk = (session.signer as any)?.publicKey ?? ""; // hex public key
  const sessionKeyId = keccak256((sessionPk.startsWith("0x") ? sessionPk : "0x" + sessionPk) as `0x${string}`);
  console.log("session key addr :", sessionKeyAddress);
  console.log("session keyId   :", sessionKeyId);
  const isValidBefore = await pub.readContract({ address: KEYSTORE, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [agent.address, sessionKeyId] });
  console.log("isValidKey(sessionKeyId) BEFORE revoke:", isValidBefore);

  const revokeRes = await client.revokeSession({ wallet, signer, session, chainId: 97 });
  console.log("revoke tx:", revokeRes.transactionHash ?? "");

  const isValidAfter = await pub.readContract({ address: KEYSTORE, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [agent.address, sessionKeyId] });
  console.log("isValidKey(sessionKeyId) AFTER revoke :", isValidAfter);
  console.log("\n→ specific session key valid→", isValidBefore, "→ invalid→", isValidAfter,
    isValidBefore && !isValidAfter ? "✓ PROVED the exact session key is revoked on-chain" : "(check)");
}
main().catch((e) => { console.error("ERR:", e.shortMessage || e.message || String(e)); process.exit(1); });
