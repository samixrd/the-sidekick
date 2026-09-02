/**
 * CLI self-listing example — how an AGENT'S OWN WALLET calls listAgent.
 *
 * This is the "self-listing" path: the agent's wallet (an EOA it owns) signs and
 * sends the bond-backed listAgent transaction directly — EXACTLY the same
 * function a human owner's wallet uses. No special-casing by caller.
 *
 * NOTE ON SAFETY: the bond (msg.value) is sent in this explicit, signed tx.
 * This is the ONLY way the spend can happen — there is no autonomous path.
 * A real agent would hold its private key and call this when it decides to list.
 *
 * USAGE (from a real agent's wallet — e.g. via an EnvVar, AWS KMS, or a custodian):
 *   ERC8004_SIGNER_KEY=<agent-wallet-pk> npm run examples:self-list
 */
import { createWalletClient, createPublicClient, http, parseEther } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
}

const AGENT_LISTING = process.env.AGENT_LISTING_CONTRACT as `0x${string}`;
const ABI = JSON.parse(readFileSync(resolve(process.cwd(), "lib/marketplace/abis/AgentListing.json"), "utf8"));

async function main() {
  // The agent's OWN wallet signs (private key from env).
  const raw = process.env.ERC8004_SIGNER_KEY ?? "";
  const key = (raw.startsWith("0x") ? raw : "0x" + raw) as `0x${string}`;
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account });
  const publicClient = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });

  // This agent is self-listing its ERC-8004 identity (tokenId 2026) with its own
  // wallet as the payment wallet.
  const tokenId = 2026n;
  const category = 0; // Rebalancing
  const metadataURI = "https://sidekick.example/listings/token-2026.json";
  const bond = parseEther("0.01");

  console.log("── self-listing (agent's own wallet) ──");
  console.log("agent wallet :", account.address);
  console.log("tokenId      :", tokenId.toString());
  console.log("category     :", category, "(Rebalancing)");
  console.log("bond         :", bond.toString(), "wei");
  console.log("contract     :", AGENT_LISTING);

  const hash = await wallet.writeContract({
    address: AGENT_LISTING,
    abi: ABI,
    functionName: "listAgent",
    args: [tokenId, category, metadataURI, account.address],
    value: bond,
  });
  console.log("tx hash      :", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status       :", receipt.status === "success" ? "success" : "failed");
  console.log("\nListed. Next steps: the API record is written by POST /api/agents/list,");
  console.log("or record it manually. Metadata can be tweaked autonomously later via");
  console.log("updateAgentMetadata (no bond).");
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
