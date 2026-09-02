/**
 * Deploy GuardRouter to BSC testnet (real tx, using the verified PCS V2 router +
 * factory). Records the deployed address to .env (GUARD_ROUTER).
 * Run:  npm run deploy:guard
 */
import { createWalletClient, createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const envPath = resolve(process.cwd(), ".env");
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
}

// Verified on-chain (BSC testnet, PancakeSwap V2):
const ROUTER = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
const FACTORY = "0x6725F303b657a9451d8BA641348b6761A6CC7a17";
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "contracts", "build");
const abi = JSON.parse(readFileSync(resolve(dir, "contracts_GuardRouter_sol_GuardRouter.abi"), "utf8"));
const bytecode = ("0x" + readFileSync(resolve(dir, "contracts_GuardRouter_sol_GuardRouter.bin"), "utf8").trim()) as `0x${string}`;

async function main() {
  const pub = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });
  const raw = (process.env.ERC8004_SIGNER_KEY ?? "").replace(/^0x/, "");
  const account = privateKeyToAccount(("0x" + raw) as `0x${string}`);
  const wallet = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account });
  console.log("deployer:", account.address);
  console.log("router  :", ROUTER);
  console.log("factory :", FACTORY);

  const hash = await wallet.deployContract({ abi, bytecode, args: [ROUTER, FACTORY] });
  console.log("deploy tx:", hash);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const addr = receipt.contractAddress!;
  console.log("GuardRouter deployed ->", addr, "| status", receipt.status, "| gas", receipt.gasUsed);

  let env = readFileSync(envPath, "utf8");
  if (/^GUARD_ROUTER=/m.test(env)) env = env.replace(/^GUARD_ROUTER=.*$/m, `GUARD_ROUTER="${addr}"`);
  else env += `\nGUARD_ROUTER="${addr}"\n`;
  writeFileSync(envPath, env);
  console.log("recorded GUARD_ROUTER in .env");
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
