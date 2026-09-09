/**
 * Give each category wallet its token legs (real txs):
 *  - Rebalancing + Yield: transfer USDT from main, wrap tBNB→WBNB
 *  - Health: wrap tBNB→WBNB (collateral for Venus borrow)
 * Keeps keys private (in .env). Prints only addresses + tx hashes.
 * Run:  npm run setup:tokens
 */
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, createPublicClient, http, parseEther, parseUnits } from "viem";
import { bscTestnet } from "viem/chains";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RPC = "https://bsc-testnet-rpc.publicnode.com";
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34DdD".toLowerCase();
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd".toLowerCase();

for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
}

const erc20 = [
  { inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], name: "transfer", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
];
const wbnbAbi = [
  { inputs: [], name: "deposit", outputs: [], stateMutability: "payable", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
];

const USDT_AMOUNT = parseUnits("0.010", 18);
const WBNB_WRAP = parseEther("0.006");

function key(k: string) { return (k.startsWith("0x") ? k : "0x" + k) as `0x${string}`; }

async function wrap(wallet: any, pub: any, addr: string, amt: bigint) {
  const h = await wallet.writeContract({ address: WBNB as `0x${string}`, abi: wbnbAbi, functionName: "deposit", value: amt });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  const b = await pub.readContract({ address: WBNB as `0x${string}`, abi: wbnbAbi, functionName: "balanceOf", args: [addr] });
  console.log(`    wrap ${Number(amt)/1e18}→WBNB tx ${h.slice(0,14)}… (bal ${Number(b)/1e18})`);
}

async function main() {
  const pub = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
  const mainKey = process.env.ERC8004_SIGNER_KEY ?? "";
  const mainWallet = createWalletClient({ chain: bscTestnet, transport: http(RPC), account: privateKeyToAccount(key(mainKey)) });
  const mainAddr = privateKeyToAccount(key(mainKey)).address;

  const cats = [
    { env: "CAT_GRID_KEY", usdt: true, wbnb: true },
    { env: "CAT_REBALANCE_KEY", usdt: true, wbnb: true },
    { env: "CAT_YIELD_KEY", usdt: true, wbnb: true },
    { env: "CAT_HEALTH_KEY", usdt: false, wbnb: true },
  ];

  for (const cat of cats) {
    const raw = process.env[cat.env] ?? "";
    if (!raw) { console.log(`  ${cat.env}: MISSING in .env`); continue; }
    const acct = privateKeyToAccount(key(raw));
    const wallet = createWalletClient({ chain: bscTestnet, transport: http(RPC), account: acct });
    console.log(`\n[${cat.env}] ${acct.address}`);

    if (cat.usdt) {
      const h = await mainWallet.writeContract({ address: USDT as `0x${string}`, abi: erc20, functionName: "transfer", args: [acct.address, USDT_AMOUNT] });
      const r = await pub.waitForTransactionReceipt({ hash: h });
      const b = await pub.readContract({ address: USDT as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [acct.address] });
      console.log(`    USDT ${Number(USDT_AMOUNT)/1e18}-> ${Number(b)/1e18} | tx ${h.slice(0,14)}…`);
    }
    if (cat.wbnb) {
      await wrap(wallet, pub, acct.address, WBNB_WRAP);
    }
  }
  console.log("\ntoken legs set.");
}
main().catch((e) => { console.error("err:", e.shortMessage || e.message || e); process.exit(1); });
