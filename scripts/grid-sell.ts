/**
 * Grid (GRD-07) — execute 3 REAL sell trades (WBNB→USDT) at spaced price points,
 * simulating buy-low/sell-high grid range behavior (fixes "buy-only").
 * Run:  npm run grid:sell
 */
import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const env = readFileSync(process.cwd() + "/.env", "utf8");
const keys = JSON.parse(readFileSync("D:/BNB HACKATHON/the-tape/agents/.agent-wallets.json", "utf8"));
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34DdD".toLowerCase() as `0x${string}`;
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd".toLowerCase() as `0x${string}`;
const ROUTER = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1".toLowerCase() as `0x${string}`;
const erc20Abi = [
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
] as const;
const routerAbi = [
  { inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], name: "swapExactTokensForTokens", outputs: [{ type: "uint256[]" }], stateMutability: "nonpayable", type: "function" },
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pub = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });
  const key = "0x" + keys["GRD-07"].replace(/^0x/, "");
  const account = privateKeyToAccount(key as `0x${string}`);
  const agent = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account });
  console.log("GRD-07:", account.address);
  console.log("tBNB:", (Number(await pub.getBalance({ address: account.address })) / 1e18).toFixed(6));

  // approve WBNB -> router (once)
  const appr = await agent.writeContract({ address: WBNB as `0x${string}`, abi: erc20Abi, functionName: "approve", args: [ROUTER, parseUnits("0.004", 18)] });
  await pub.waitForTransactionReceipt({ hash: appr });
  console.log("approved WBNB->router:", appr.slice(0, 14) + "…");

  // 3 sells at spaced intervals (different price points), selling ~0.0008 WBNB each
  const sells = [parseUnits("0.0008", 18), parseUnits("0.0009", 18), parseUnits("0.0008", 18)];
  let i = 0;
  for (const amt of sells) {
    i++;
    const bal = Number(await pub.readContract({ address: WBNB as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) / 1e18;
    if (bal < Number(amt) / 1e18) { console.log(`  sell #${i}: insufficient WBNB (${bal.toFixed(6)})`); continue; }
    const tx = await agent.writeContract({ address: ROUTER as `0x${string}`, abi: routerAbi, functionName: "swapExactTokensForTokens", args: [amt, 0n, [WBNB, USDT], account.address, BigInt(Math.floor(Date.now() / 1000) + 600)] });
    const r = await pub.waitForTransactionReceipt({ hash: tx });
    // read USDT received + WBNB spent for reporting
    const usdtAfter = Number(await pub.readContract({ address: USDT as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) / 1e18;
    console.log(`  ✅ sell #${i} (WBNB->USDT ${Number(amt) / 1e18} WBNB) tx ${tx.slice(0,18)}… | status ${r.status} | USDT now ${usdtAfter.toFixed(8)}`);
    await sleep(30_000); // space blocks so prices differ
  }
  console.log("done. final WBNB:", (Number(await pub.readContract({ address: WBNB as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) / 1e18).toFixed(6));
}
main().catch((e) => { console.error("ERR:", e.shortMessage || e.message || e); process.exit(1); });
