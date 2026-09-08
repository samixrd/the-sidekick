/**
 * TREASURY TOP-UP — keeps the 4 strategy wallets funded so the 24/7 loop can
 * never look dead from an empty balance. Real transfers from the main signer
 * (ERC8004_SIGNER_KEY), printed with tx hashes.
 *
 * Thresholds (per wallet):
 *   native tBNB < 0.010  -> send 0.012 (gas + strategy headroom)
 *   USDT        < 0.008  -> send 0.010 (grid-buy / yield-convert leg)
 *   WBNB        < 0.004  -> wrap 0.004 (grid-sell / LP leg)
 * Runs safely at any frequency (idempotent: only tops up what is below floor).
 * Run:  npm run treasury:topup
 */
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { envGet } from "../lib/env";

const RPC = envGet("BSC_TESTNET_RPC_URL") || "https://bsc-testnet-rpc.publicnode.com";
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34DdD".toLowerCase() as `0x${string}`;
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd".toLowerCase() as `0x${string}`;
const ERC20 = [
  { inputs: [{ name: "a", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;
const WBNB_ABI = [
  { inputs: [], name: "deposit", outputs: [], stateMutability: "payable", type: "function" },
] as const;

const AGENTS: { name: string; envKey: string; fallbackAddr?: string }[] = [
  { name: "Grid", envKey: "CAT_GRID_KEY" },
  { name: "Rebalancing", envKey: "CAT_REBALANCE_KEY" },
  { name: "Yield", envKey: "CAT_YIELD_KEY" },
  { name: "Health-Factor", envKey: "CAT_HEALTH_KEY" },
];
const FLOOR = { bnb: 0.010, usdt: 0.008, wbnb: 0.004 };
const SEND = { bnb: "0.012", usdt: "0.010", wbnb: "0.004" };

async function main() {
  const pub = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
  const mainKey = envGet("ERC8004_SIGNER_KEY").replace(/^0x/, "");
  if (!mainKey) throw new Error("ERC8004_SIGNER_KEY missing");
  const mainAcct = privateKeyToAccount(("0x" + mainKey) as `0x${string}`);
  const main = createWalletClient({ chain: bscTestnet, transport: http(RPC), account: mainAcct });
  const mainBnb = Number(formatEther(await pub.getBalance({ address: mainAcct.address })));
  const mainUsdt = Number(await pub.readContract({ address: USDT, abi: ERC20, functionName: "balanceOf", args: [mainAcct.address] })) / 1e18;
  console.log(`treasury ${mainAcct.address.slice(0, 10)}… | BNB ${mainBnb.toFixed(4)} | USDT ${mainUsdt.toFixed(4)}`);
  if (mainBnb < 0.05 && mainUsdt < 0.05) { console.log("treasury itself low — nothing to do"); return; }

  let sent = 0;
  for (const a of AGENTS) {
    const k = envGet(a.envKey).replace(/^0x/, "");
    if (!k) { console.log(`${a.name}: no key`); continue; }
    const acct = privateKeyToAccount(("0x" + k) as `0x${string}`);
    const bal = async (t: "bnb" | "usdt" | "wbnb") => {
      if (t === "bnb") return Number(formatEther(await pub.getBalance({ address: acct.address })));
      const token = t === "usdt" ? USDT : WBNB;
      return Number(await pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [acct.address] })) / 1e18;
    };
    // native BNB
    if ((await bal("bnb")) < FLOOR.bnb && mainBnb > Number(SEND.bnb) * 2) {
      const h = await main.sendTransaction({ to: acct.address, value: parseEther(SEND.bnb) });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log(`${a.name}: +${SEND.bnb} BNB tx ${h.slice(0, 14)}…`);
      sent++;
    }
    // USDT
    if ((await bal("usdt")) < FLOOR.usdt && mainUsdt > Number(SEND.usdt) * 2) {
      const h = await main.writeContract({ address: USDT, abi: [{ inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], name: "transfer", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" }] as const, functionName: "transfer", args: [acct.address, parseEther(SEND.usdt)] });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log(`${a.name}: +${SEND.usdt} USDT tx ${h.slice(0, 14)}…`);
      sent++;
    }
    // WBNB — wrapped FROM THE AGENT (its own deposit tx, so the wrap event is
    // attributed to the agent, like every other strategy action).
    if ((await bal("wbnb")) < FLOOR.wbnb && (await bal("bnb")) > FLOOR.bnb + Number(SEND.wbnb)) {
      const wc = createWalletClient({ chain: bscTestnet, transport: http(RPC), account: acct });
      const h = await wc.writeContract({ address: WBNB, abi: WBNB_ABI, functionName: "deposit", value: parseEther(SEND.wbnb) });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log(`${a.name}: wrapped +${SEND.wbnb} WBNB tx ${h.slice(0, 14)}…`);
      sent++;
    }
  }
  console.log(sent ? `topped up (${sent} txs)` : "all wallets above floors — no action");
}
main().catch((e) => { console.error(e?.shortMessage || e?.message || e); process.exit(1); });
