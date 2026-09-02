/**
 * Rebalancing — execute a REAL re-center SELL: close part of the WBNB position
 * back to USDT (demonstrates an actual rebalance event). Run: npm run rebal:sell
 */
import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const env = readFileSync(process.cwd() + "/.env", "utf8");
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

async function main() {
  const pub = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });
  const key = (env.match(/^CAT_REBALANCE_KEY="?([^"\r\n]+)/m)?.[1] ?? "").replace(/^0x/, "");
  const account = privateKeyToAccount(("0x" + key) as `0x${string}`);
  const agent = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account });
  console.log("Rebalancing:", account.address);
  console.log("tBNB:", (Number(await pub.getBalance({ address: account.address })) / 1e18).toFixed(6));

  const wbnbBal = Number(await pub.readContract({ address: WBNB, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) / 1e18;
  console.log("WBNB holding:", wbnbBal.toFixed(6));
  const sellAmt = wbnbBal * 0.5; // re-center: close half the WBNB position back to USDT
  const raw = parseUnits(sellAmt.toFixed(6), 18);
  console.log("re-center: selling", sellAmt.toFixed(6), "WBNB (50%) back to USDT");

  const appr = await agent.writeContract({ address: WBNB, abi: erc20Abi, functionName: "approve", args: [ROUTER, raw] });
  await pub.waitForTransactionReceipt({ hash: appr });
  const tx = await agent.writeContract({ address: ROUTER, abi: routerAbi, functionName: "swapExactTokensForTokens", args: [raw, 0n, [WBNB, USDT], account.address, BigInt(Math.floor(Date.now() / 1000) + 600)] });
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  const usdt = Number(await pub.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) / 1e18;
  const wbnbAfter = Number(await pub.readContract({ address: WBNB, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) / 1e18;
  console.log(`  ✅ re-center sell tx ${tx.slice(0,18)}… | status ${r.status} | WBNB ${wbnbBal.toFixed(6)}→${wbnbAfter.toFixed(6)} | USDT now ${usdt.toFixed(6)}`);
}
main().catch((e) => { console.error("ERR:", e.shortMessage || e.message || e); process.exit(1); });
