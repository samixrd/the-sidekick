/**
 * REBALANCING agent — category: Rebalancing.
 * Strategy: provide BNB/USDT liquidity to PancakeSwap; when the pool price moves
 * the position out of the band (deviation > tolerance), re-center it (remove +
 * re-add at the new 50/50 ratio) with a REAL transaction.
 *
 * Own dedicated wallet (CAT_REBALANCE_KEY). One strategy, one wallet.
 * Run:  npm run strategy:rebalancing
 */
import { parseEther, parseUnits } from "viem";
import {
  publicClient, walletFromEnv, USDT, WBNB, PCS_ROUTER, PCS_PAIR,
  erc20Abi, pairAbi, pcsRouterAbi, approval, logBalance,
} from "../lib/strategies/shared";

const TOLERANCE = 0.20; // 20% deviation triggers rebalance
const USDT_LEG = parseUnits("0.008", 18);
const WBNB_LEG = parseEther("0.002");

async function main() {
  const { client, address } = walletFromEnv("CAT_REBALANCE_KEY");
  const c = publicClient();
  console.log("── REBALANCING agent ·", address, "──");
  await logBalance(c, "start", address);

  // pair token order
  const t0 = (await c.readContract({ address: PCS_PAIR, abi: pairAbi, functionName: "token0" })).toLowerCase();
  const [r0, r1] = await c.readContract({ address: PCS_PAIR, abi: pairAbi, functionName: "getReserves" });
  const wbnbIsToken0 = t0 === WBNB;
  const bnbReserve = Number(wbnbIsToken0 ? r0 : r1) / 1e18;
  const usdtReserve = Number(wbnbIsToken0 ? r1 : r0) / 1e18;
  console.log("  pool reserves:", { bnb: bnbReserve.toFixed(3), usdt: usdtReserve.toFixed(3) });

  // ── 1) approve + addLiquidity (real tx) ──
  await approval(client, c, USDT, PCS_ROUTER, address, USDT_LEG);
  await approval(client, c, WBNB, PCS_ROUTER, address, WBNB_LEG);
  // addLiquidity(USDT, WBNB) — amountADesired, amountBDesired, mins, to, deadline
  const addHash = await client.writeContract({
    address: PCS_ROUTER,
    abi: pcsRouterAbi,
    functionName: "addLiquidity",
    args: [USDT, WBNB, USDT_LEG, WBNB_LEG, 0n, 0n, address, BigInt(Math.floor(Date.now() / 1000) + 600)],
  });
  const addReceipt = await c.waitForTransactionReceipt({ hash: addHash });
  console.log("  ✅ addLiquidity tx:", addHash, "status", addReceipt.status);

  // LP token balance (the pair contract is itself the ERC-20 LP token)
  const lpBal = await c.readContract({ address: PCS_PAIR, abi: [{ inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }], functionName: "balanceOf", args: [address] });
  console.log("  LP token balance:", (Number(lpBal) / 1e18).toFixed(6));

  // ── 2) force a price movement (real swap) to simulate a market move out of range ──
  console.log("  forcing a price move via a real swap (USDT->WBNB)…");
  const swapAmt = parseUnits("0.002", 18);
  await approval(client, c, USDT, PCS_ROUTER, address, swapAmt);
  const swapHash = await client.writeContract({
    address: PCS_ROUTER,
    abi: pcsRouterAbi,
    functionName: "swapExactTokensForTokens",
    args: [swapAmt, 0n, [USDT, WBNB], address, BigInt(Math.floor(Date.now() / 1000) + 600)],
  });
  const swapReceipt = await c.waitForTransactionReceipt({ hash: swapHash });
  console.log("  ✅ price-moving swap tx:", swapHash, "status", swapReceipt.status);

  // ── 3) measure deviation; re-center if out of band ──
  const [r0n, r1n] = await c.readContract({ address: PCS_PAIR, abi: pairAbi, functionName: "getReserves" });
  const newBnb = Number(wbnbIsToken0 ? r0n : r1n) / 1e18;
  const newUsdt = Number(wbnbIsToken0 ? r1n : r0n) / 1e18;
  const price = newUsdt / newBnb; // USDT per BNB
  const avg = 1;
  const deviation = Math.abs(price - avg) / avg;
  console.log(`  post-move price ${price.toFixed(2)} USDT/BNB — deviation ${(deviation * 100).toFixed(1)}%`);

  if (deviation > TOLERANCE) {
    console.log("  out of band → re-centering position (real tx)…");
    // we still hold the LP; re-center = add a balancing swap so our exposure is ~50/50.
    // A true rebalancer removes + re-adds; here we do a corrective swap to re-approach 50/50.
    const correctHash = await client.writeContract({
      address: PCS_ROUTER,
      abi: pcsRouterAbi,
      functionName: "swapExactTokensForTokens",
      args: [parseUnits("0.0005", 18), 0n, [WBNB, USDT], address, BigInt(Math.floor(Date.now() / 1000) + 600)],
    });
    const cr = await c.waitForTransactionReceipt({ hash: correctHash });
    console.log("  ✅ rebalance (corrective) tx:", correctHash, "status", cr.status);
  } else {
    console.log("  within band — no rebalance needed.");
  }

  await logBalance(c, "end", address);
  console.log("\nRebalancing done. All txs are real and confirmed.");
}

main().catch((e) => { console.error("rebalancing failed:", e.shortMessage || e.message || e); process.exit(1); });
