/**
 * Deploy AgentListing to BSC testnet for real.
 * Uses the funded signer (ERC8004_SIGNER_KEY, the token-2026 owner). Records the
 * deployed address to .env (AGENT_LISTING_CONTRACT) so the API/lib read it from
 * config, not hardcoded.
 *
 * Run:  npm run deploy:listing
 */
import { createWalletClient, createPublicClient, http, parseEther } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.cwd(), "contracts", "build");
const abi = JSON.parse(readFileSync(resolve(dir, "contracts_AgentListing_sol_AgentListing.abi"), "utf8"));
const bytecode = ("0x" + readFileSync(resolve(dir, "contracts_AgentListing_sol_AgentListing.bin"), "utf8").trim()) as `0x${string}`;
const envPath = resolve(process.cwd(), ".env");

function loadEnv() {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
    if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
  }
}

async function main() {
  loadEnv();
  const MIN_BOND = parseEther(process.env.MIN_BOND_ETH ?? "0.01");
  const IDENTITY_REGISTRY = (process.env.ERC8004_IDENTITY_REGISTRY ?? "") as `0x${string}`;
  const rawKey = process.env.ERC8004_SIGNER_KEY ?? "";
  const key = (rawKey.startsWith("0x") ? rawKey : "0x" + rawKey) as `0x${string}`;
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account });
  const publicClient = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });

  console.log("── deploy AgentListing · BSC testnet ──");
  console.log("signer        :", account.address);
  console.log("min bond      :", MIN_BOND.toString(), "wei");
  console.log("identityReg   :", IDENTITY_REGISTRY);

  const hash = await wallet.deployContract({
    abi,
    bytecode,
    args: [MIN_BOND, IDENTITY_REGISTRY as `0x${string}`],
    value: 0n,
  });
  console.log("tx hash       :", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const addr = receipt.contractAddress;
  console.log("deployed at   :", addr);
  console.log("gas used      :", receipt.gasUsed.toString());

  // write AGENT_LISTING_CONTRACT to .env
  let env = readFileSync(envPath, "utf8");
  if (/^AGENT_LISTING_CONTRACT=/m.test(env)) {
    env = env.replace(/^AGENT_LISTING_CONTRACT=.*$/m, `AGENT_LISTING_CONTRACT="${addr}"`);
  } else {
    env += `\n# ── AgentListing (deployed on BSC testnet) ──\nAGENT_LISTING_CONTRACT="${addr}"\n`;
  }
  writeFileSync(envPath, env);
  console.log("\nwrote AGENT_LISTING_CONTRACT to .env");
}

main().catch((e) => { console.error("deploy failed:", e.shortMessage || e.message || e); process.exit(1); });
