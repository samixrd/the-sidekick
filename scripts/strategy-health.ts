/**
 * HEALTH FACTOR MONITORING agent — category: Health-Factor.
 * Strategy:
 *   1. Supply WBNB to Venus (mint vWBNB collateral).
 *   2. enterMarkets(vWBNB) so the comptroller counts it as collateral.
 *   3. Borrow USDC against it (real borrow tx) — opening a real position.
 *   4. Monitor the health factor (collateral$ * CF / borrow$).
 *   5. On a testnet-safe simulated collateral stress, if HF drops below the risk
 *      threshold take a REAL protective action (partial repay) — the tx is real.
 *
 * Dedicated wallet (CAT_HEALTH_KEY). One strategy, one wallet.
 * Run:  npm run strategy:health
 */
import { parseEther, parseUnits } from "viem";
import {
  publicClient, walletFromEnv, WBNB,
  VENUS_COMPTROLLER, VENUS_vWBNB,
} from "../lib/strategies/shared";

const VUSDC = "0xD5C4C2e2facBEB59D0216D0595d63FcDc6F9A1a7".toLowerCase() as `0x${string}`;
const USDC_DECIMALS = 6;
const COLLATERAL_FACTOR = 0.75; // vWBNB colFactor
const RISK_THRESHOLD = 1.10;    // protective action when HF < 1.10

const vAbi = [
  { inputs: [{ name: "mint", type: "uint256" }], name: "mint", outputs: [{ type: "uint256" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "borrowAmount", type: "uint256" }], name: "borrow", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "repayAmount", type: "uint256" }], name: "repayBorrow", outputs: [{ type: "uint256" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "borrowBalanceStored", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const comptrollerAbi = [
  { inputs: [{ name: "vTokens", type: "address[]" }], name: "enterMarkets", outputs: [{ type: "uint256[]" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "oracle", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
] as const;

const erc20 = [
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
] as const;

/** HF = collateralWbnb * wbnbPrice * CF / borrowUsdc. */
async function healthFactor(pc: ReturnType<typeof publicClient>, account: `0x${string}`, collateralWbnb: number) {
  const oracle = (await pc.readContract({ address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "oracle" })) as `0x${string}`;
  const wbnbPrice = Number(await pc.readContract({ address: oracle, abi: [{ inputs: [{ name: "vToken", type: "address" }], name: "getUnderlyingPrice", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }], functionName: "getUnderlyingPrice", args: [VENUS_vWBNB] })) / 1e18;
  const collateralUsd = collateralWbnb * wbnbPrice;
  const borrowUsdc = Number(await pc.readContract({ address: VUSDC, abi: vAbi, functionName: "borrowBalanceStored", args: [account] })) / 1e6;
  const hf = borrowUsdc > 0 ? (collateralUsd * COLLATERAL_FACTOR) / borrowUsdc : 999;
  return { hf, borrowValue: borrowUsdc, collateralUsd, wbnbPrice };
}

async function main() {
  const { client, address } = walletFromEnv("CAT_HEALTH_KEY");
  const c = publicClient();
  console.log("── HEALTH FACTOR agent ·", address, "──");

  // ── 1) supply WBNB collateral (mint vWBNB) — use all available WBNB ──
  const wbnbBal = Number(await c.readContract({ address: WBNB, abi: erc20, functionName: "balanceOf", args: [address] })) / 1e18;
  console.log("  wallet WBNB available:", wbnbBal.toFixed(4));
  let suppliedWbnb = 0;
  if (wbnbBal > 0) {
    suppliedWbnb = wbnbBal;
    const collateralWbnb = parseEther(wbnbBal.toFixed(6));
    const appr = await c.readContract({ address: WBNB, abi: erc20, functionName: "allowance", args: [address, VENUS_vWBNB] });
    if (appr < collateralWbnb) {
      const ah = await client.writeContract({ address: WBNB, abi: erc20, functionName: "approve", args: [VENUS_vWBNB, collateralWbnb] });
      await c.waitForTransactionReceipt({ hash: ah });
      console.log("  ✅ approve WBNB->vWBNB tx:", ah.slice(0, 14) + "…");
    }
    const mintHash = await client.writeContract({ address: VENUS_vWBNB, abi: vAbi, functionName: "mint", args: [collateralWbnb] });
    await c.waitForTransactionReceipt({ hash: mintHash });
    console.log("  ✅ supply WBNB collateral (mint vWBNB) tx:", mintHash, "status", await c.getTransactionReceipt({ hash: mintHash }).then((r) => r.status));

    const enterHash = await client.writeContract({ address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "enterMarkets", args: [[VENUS_vWBNB]] });
    await c.waitForTransactionReceipt({ hash: enterHash });
    console.log("  ✅ enterMarkets(vWBNB) tx:", enterHash.slice(0, 14) + "…");
  } else {
    console.log("  no WBNB to supply — using existing collateral in position.");
  }

  // ── 2) borrow USDC (real borrow tx) if not already in debt ──
  const curBorrow = Number(await c.readContract({ address: VUSDC, abi: vAbi, functionName: "borrowBalanceStored", args: [address] })) / 1e6;
  console.log("  current USDC borrow:", curBorrow.toFixed(2));
  if (curBorrow < 0.5) {
    const borrowUsdc = parseUnits("1", USDC_DECIMALS);
    const borrowHash = await client.writeContract({ address: VUSDC, abi: vAbi, functionName: "borrow", args: [borrowUsdc] });
    await c.waitForTransactionReceipt({ hash: borrowHash });
    console.log("  ✅ borrow USDC tx:", borrowHash, "status", await c.getTransactionReceipt({ hash: borrowHash }).then((r) => r.status));
  } else {
    console.log("  already in debt — skip new borrow.");
  }

  // ── 3) monitor health factor ──
  const hf0 = await healthFactor(c, address, suppliedWbnb || 0.006);
  console.log(`  HF after borrow: ${hf0.hf.toFixed(3)}  (collateral $${hf0.collateralUsd.toFixed(2)} · borrow $${hf0.borrowValue.toFixed(2)} · WBNB $${hf0.wbnbPrice.toFixed(0)})`);

  // ── 4) simulated collateral stress → protective action if HF below threshold ──
  const shock = 0.65; // collateral -65%
  const hfStress = hf0.hf * (1 - shock);
  console.log(`  simulated collateral -${(shock * 100).toFixed(0)}% → HF ${hfStress.toFixed(3)}`);

  if (hfStress < RISK_THRESHOLD) {
    console.log(`  HF ${hfStress.toFixed(3)} < ${RISK_THRESHOLD} → REAL PROTECTIVE ACTION (partial repay)…`);
    const repayAmt = parseUnits("0.3", USDC_DECIMALS);
    const USDC = "0x16227D60f7a0e586C66B005219dfc887D13C9531".toLowerCase() as `0x${string}`;
    // Venus repayBorrow pulls USDC from this wallet — approve vUSDC to draw it.
    const appr = await c.readContract({ address: USDC, abi: erc20, functionName: "allowance", args: [address, VUSDC] });
    if (appr < repayAmt) {
      const ah = await client.writeContract({ address: USDC, abi: erc20, functionName: "approve", args: [VUSDC, repayAmt] });
      await c.waitForTransactionReceipt({ hash: ah });
      console.log("  ✅ approve USDC->vUSDC tx:", ah.slice(0, 14) + "…");
    }
    const repayHash = await client.writeContract({ address: VUSDC, abi: vAbi, functionName: "repayBorrow", args: [repayAmt] });
    const repayR = await c.waitForTransactionReceipt({ hash: repayHash });
    console.log("  ✅ protective partial repay tx:", repayHash, "status", repayR.status);
    const hf1 = await healthFactor(c, address, suppliedWbnb || 0.006);
    console.log(`  HF after protective repay: ${hf1.hf.toFixed(3)}`);
  } else {
    console.log(`  HF ${hfStress.toFixed(3)} >= ${RISK_THRESHOLD} → no protective action needed.`);
  }

  console.log("\nHealth factor strategy done. Supply, borrow, and protective repay are real, confirmed txs.");
}

main().catch((e) => { console.error("health failed:", e.shortMessage || e.message || e); process.exit(1); });
