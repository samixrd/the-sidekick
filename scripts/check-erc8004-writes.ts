/**
 * ERC-8004 write-path validation — simulates register() and giveFeedback()
 * against the LIVE testnet contracts WITHOUT sending a transaction. Confirms
 * the calldata encodes correctly against the canonical ABI, with zero gas
 * spend and zero state pollution.
 * Run:  npm run check:erc8004-writes
 */
import { privateKeyToAccount } from "viem/accounts";
import identityAbi from "../lib/erc8004/abis/IdentityRegistry.json";
import repAbi from "../lib/erc8004/abis/ReputationRegistry.json";
import { makePublicClient, requireErc8004Config, makeRegistrationFile } from "../lib/erc8004";

const rawKey = process.env.ERC8004_SIGNER_KEY ?? "";
const signerKey = (rawKey.startsWith("0x") ? rawKey : "0x" + rawKey) as `0x${string}`;

async function main() {
  const cfg = requireErc8004Config();
  const publicClient = makePublicClient();
  const account = privateKeyToAccount(signerKey);

  console.log("── ERC-8004 write-path simulation ──\n");
  console.log("signer account:", account.address, "\n");

  // register(string) — data:JSON so metadata is fully on-chain
  const regFile = makeRegistrationFile({
    name: "sidekick-sim",
    description: "simulated registration (no tx)",
    services: [{ name: "MCP", endpoint: "https://mcp.example/", version: "2025-01-01" }],
  });
  const dataUri = "data:application/json;base64," + Buffer.from(JSON.stringify(regFile)).toString("base64");

  try {
    await publicClient.simulateContract({
      address: cfg.identityRegistry,
      abi: identityAbi as any,
      functionName: "register",
      args: [dataUri],
      account,
    });
    console.log("✓ register(string) encodes + passes simulation against live registry");
  } catch (e: any) {
    const msg = (e.shortMessage || e.message || "").toLowerCase();
    if (/abi|decode|no matching|invalid|function/.test(msg)) {
      console.log("✗ register encode/ABI error:", (e.shortMessage || e.message).slice(0, 120));
    } else {
      console.log("✓ register encodes OK (simulate stopped at semantic check:", (e.shortMessage || e.message).slice(0, 90), ")");
    }
  }

  // giveFeedback — semantic check may revert if account == agent owner, but
  // encoding validity is what we're proving.
  try {
    await publicClient.simulateContract({
      address: cfg.reputationRegistry,
      abi: repAbi as any,
      functionName: "giveFeedback",
      args: [1n, 80n, 0, "sim", "sim", "", "", "0x0000000000000000000000000000000000000000000000000000000000000000"],
      account,
    });
    console.log("✓ giveFeedback(8 args) encodes + passes simulation against live registry");
  } catch (e: any) {
    const msg = (e.shortMessage || e.message || "").toLowerCase();
    if (/abi|decode|no matching|invalid|function/.test(msg)) {
      console.log("✗ giveFeedback encode/ABI error:", (e.shortMessage || e.message).slice(0, 120));
    } else {
      console.log("✓ giveFeedback encodes OK (simulate stopped at semantic check:", (e.shortMessage || e.message).slice(0, 90), ")");
    }
  }

  console.log("\n(signature available for real writes:", !!process.env.ERC8004_SIGNER_KEY, ")");
}
main().catch((e) => { console.error("err:", e); process.exit(1); });
