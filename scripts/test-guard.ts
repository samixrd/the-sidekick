/**
 * GuardRouter end-to-end test (BSC testnet, REAL txs).
 * Session key = the Rebalancing Hermes wallet (0x0b7e22be…), which holds USDT+WBNB+gas.
 *
 * Hires:
 *   hireA: approved=[WBNB,USDT] minLiquidity=100e18  -> valid swap should PASS
 *   hireB: approved=[WBNB,USDT] minLiquidity=1e25     -> low-liquidity should REVERT
 *   hireC: approved=[OTHER]      minLiquidity=100e18  -> out-of-scope should REVERT
 */
import { createWalletClient, createPublicClient, http, parseUnits, encodeFunctionData } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const env = readFileSync(process.cwd() + "/.env", "utf8");
const keys = JSON.parse(readFileSync("D:/BNB HACKATHON/the-tape/agents/.agent-wallets.json", "utf8"));
const GUARD = (env.match(/^GUARD_ROUTER="?([^"\r\n]+)/m)?.[1] ?? "") as `0x${string}`;
const ROUTER = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
const FACTORY = "0x6725F303b657a9451d8BA641348b6761A6CC7a17";
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd".toLowerCase();
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34DdD".toLowerCase();
const OTHER = "0x000000000000000000000000000000000000dEaD".toLowerCase();

const abi = JSON.parse(readFileSync(process.cwd() + "/contracts/build/contracts_GuardRouter_sol_GuardRouter.abi", "utf8"));
const erc20Abi = [
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
];
const pairAbi = [{ inputs: [], name: "getReserves", outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }], stateMutability: "view", type: "function" }];

const rebalKey = (env.match(/^CAT_REBALANCE_KEY="?([^"\r\n]+)/m)?.[1] ?? "").replace(/^0x/, "");
const session = privateKeyToAccount(("0x" + rebalKey) as `0x${string}`);
const owner = privateKeyToAccount(("0x" + (env.match(/^ERC8004_SIGNER_KEY="?([^"\r\n]+)/m)?.[1] ?? "").replace(/^0x/, "")) as `0x${string}`);

async function main() {
  const pub = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });
  const agent = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account: session });
  const ownerW = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account: owner });

  // ── live pool reserves (real numbers used for pass/fail) ──
  const pair = (await pub.readContract({ address: FACTORY as `0x${string}`, abi: [{ inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], name: "getPair", outputs: [{ type: "address" }], stateMutability: "view", type: "function" }], functionName: "getPair", args: [WBNB as `0x${string}`, USDT as `0x${string}`] })) as `0x${string}`;
  const reserves = (await pub.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" })) as [bigint, bigint, number];
  const r0 = reserves[0];
  const r1 = reserves[1];
  const totalLiq = BigInt(r0) + BigInt(r1);
  console.log("── LIVE BNB/USDT POOL RESERVES (at test time) ──");
  console.log("  pair:", pair);
  console.log("  reserve0 (WBNB):", Number(r0) / 1e18, "WBNB");
  console.log("  reserve1 (USDT):", Number(r1) / 1e18, "USDT");
  console.log("  totalLiquidity (r0+r1):", Number(totalLiq) / 1e18, "units\n");

  // ── unique per-run salt so a re-run doesn't hit `createHire: exists` ──
  const RUN = Date.now().toString(36).slice(-4); // e.g. "k3x9"
  const hId = (id: string) => `hire${id}_${RUN}`;

  // ── create 3 hires (owner sets policy per hire) ──
  const hires = [
    { id: hId("A"), tokens: [WBNB, USDT], min: parseUnits("100", 18) },
    { id: hId("B"), tokens: [WBNB, USDT], min: parseUnits("10000000", 18) }, // 10M units >> real ~244
    { id: hId("C"), tokens: [OTHER], min: parseUnits("100", 18) },
  ];
  for (const h of hires) {
    const hh = "0x" + Buffer.from(h.id).toString("hex").padEnd(64, "0");
    const tx = await ownerW.writeContract({ address: GUARD, abi, functionName: "createHire", args: [hh as `0x${string}`, session.address, h.tokens, h.min] });
    await pub.waitForTransactionReceipt({ hash: tx });
    console.log(`  created ${h.id} → tx ${tx.slice(0,14)}… (min=${h.min})`);
  }

  // ── agent approves GuardRouter to pull USDT ──
  const approve = await agent.writeContract({ address: USDT as `0x${string}`, abi: erc20Abi, functionName: "approve", args: [GUARD, parseUnits("0.002", 18)] });
  await pub.waitForTransactionReceipt({ hash: approve });
  console.log("  agent approved GuardRouter for USDT → tx", approve.slice(0, 14) + "…\n");

  // ── helper: run a guarded swap, return result/revert ──
  async function runSwap(hid: string, amountIn: bigint) {
    const hh = "0x" + Buffer.from(hid).toString("hex").padEnd(64, "0");
    const path = [USDT, WBNB];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const args = [hh, amountIn, 0n, path, session.address, deadline] as const;
    try {
      // simulate first to capture the on-chain revert reason if any
      await pub.simulateContract({ address: GUARD, abi, functionName: "swapExactTokensForTokensGuarded", args: args as any, account: session.address });
      // real tx
      const tx = await agent.writeContract({ address: GUARD, abi, functionName: "swapExactTokensForTokensGuarded", args: args as any });
      const rec = await pub.waitForTransactionReceipt({ hash: tx });
      return { ok: true, tx, status: rec.status, gas: rec.gasUsed?.toString() };
    } catch (e: any) {
      return { ok: false, reason: e.shortMessage || e.message || String(e) };
    }
  }

  // ── PATH (a): valid swap on approved + sufficient-liquidity token (hireA) ──
  console.log("── PATH (a): VALID swap — hireA (approved=WBNB, min=100, real liq ~244) ──");
  const a = await runSwap(hId("A"), parseUnits("0.001", 18));
  if (a.ok) console.log("  ✅ SUCCEEDED tx:", a.tx, "| status", a.status, "| gas", a.gas);
  else console.log("  ❌ FAILED:", a.reason);

  // ── PATH (b1): low-liquidity (hireB min=10M >> real ~244) ──
  console.log("\n── PATH (b1): LOW-LIQUIDITY — hireB (min=10M units, real ~244) ──");
  const b1 = await runSwap(hId("B"), parseUnits("0.001", 18));
  console.log(b1.ok ? `  unexpected PASS` : `  ✅ REVERTED (expected): ${b1.reason}`);
  void b1;

  // ── PATH (b2): out-of-scope token (hireC approved=0xdead) ──
  console.log("\n── PATH (b2): OUT-OF-SCOPE — hireC (approved=0xdead, target=WBNB) ──");
  const b2 = await runSwap(hId("C"), parseUnits("0.001", 18));
  console.log(b2.ok ? `  unexpected PASS` : `  ✅ REVERTED (expected): ${b2.reason}`);
  void b2;

  console.log("\n── DONE ──");
}
main().catch((e) => { console.error("test failed:", e.shortMessage || e.message || e); process.exit(1); });
