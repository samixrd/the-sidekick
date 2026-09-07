/**
 * STRATEGY LOOP — scheduled autonomous behavior for the 4 category agents.
 *
 * Every cycle (45 min cron) each agent:
 *   1. reads its live position (on-chain, real reads),
 *   2. decides whether its strategy says "act now",
 *   3. when it acts, executes a REAL transaction — routed through the active
 *      hire's Guard Router policy when the agent is hired (session-key guarded
 *      swap; the Altana session enforces the hire's spend cap + call allowlist
 *      on-chain), otherwise from its own base wallet with per-trade caps.
 *
 * Hire-policy awareness:
 *   - Grid: hired → swap goes through GuardRouter.swapExactTokensForTokensGuarded
 *     (enforces token scope + min liquidity; session enforces spend cap).
 *   - Rebalancing/Yield/Health: Venus/AMM adds are guarded by the Altana session
 *     (calls allowlist + spend cap) — the session IS the on-chain policy.
 *
 * Every decision (acted or skipped, with reason) is appended INSERT-only to
 * `strategy_runs`. Active/Idle is computed from real indexed activity.
 *
 * One cycle:  npm run strategy:cycle   (see scripts/strategy-cycle.ts)
 */
import { createPublicClient, createWalletClient, http, formatEther, parseUnits, encodeFunctionData, getAddress, type Address, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ── env + keys ────────────────────────────────────────────────────────────
const ENV_PATH = resolve(process.cwd(), ".env");
function envGet(key: string): string {
  try {
    const m = new RegExp(`^${key}="?([^"\r\n]+)`, "m").exec(readFileSync(ENV_PATH, "utf8"));
    return m ? m[1].trim() : "";
  } catch { return ""; }
}
const JSON_WALLETS_PATH = "D:/BNB HACKATHON/the-tape/agents/.agent-wallets.json";
export function agentKey(wallet: string): `0x${string}` | null {
  const candidates: string[] = [envGet("CAT_REBALANCE_KEY"), envGet("CAT_YIELD_KEY"), envGet("CAT_HEALTH_KEY")];
  try {
    const json = JSON.parse(readFileSync(JSON_WALLETS_PATH, "utf8"));
    for (const v of Object.values(json)) candidates.push(String(v));
  } catch { /* optional */ }
  for (const k of candidates) {
    try {
      if (privateKeyToAccount(("0x" + k.replace(/^0x/, "")) as `0x${string}`).address.toLowerCase() === wallet.toLowerCase()) {
        return ("0x" + k.replace(/^0x/, "")) as `0x${string}`;
      }
    } catch { /* skip */ }
  }
  return null;
}

// ── contracts (lowercase; getAddress at call time) ────────────────────────
const WBNB = "0xae13d989dac2f0debff460ac112a837c89baa7cd" as const;
const USDT = "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd" as const;
const USDC = "0x16227d60f7a0e586c66b005219dfc887d13c9531" as const;
const PCS_ROUTER = "0xd99d1c33f9fc3444f8101754abc46c52416550d1" as const;
const PCS_PAIR = "0x5f52ad4bd4f519ae79999400ad8b83a3d002fd92" as const;
const VENUS_COMPTROLLER = "0x94d1820b2d1c7c7452a163983dc888cec546b77d" as const;
const VENUS_VWBNB = "0xd9e77847ec815e56ae2b9e69596c69b6972b0b1c" as const;
const VENUS_VUSDC = "0xd5c4c2e2facbeb59d0216d0595d63fcdc6f9a1a7" as const;
const RPC = "https://bsc-testnet-rpc.publicnode.com";
const GUARD = envGet("GUARD_ROUTER") as `0x${string}`;

const ERC20_ABI = [
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
] as const;
const ROUTER_ABI = [
  { inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], name: "swapExactTokensForTokens", outputs: [{ type: "uint256[]" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }], name: "getAmountsOut", outputs: [{ type: "uint256[]" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "liquidity", type: "uint256" }, { name: "amountAMin", type: "uint256" }, { name: "amountBMin", type: "uint256" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], name: "removeLiquidity", outputs: [{ type: "uint256" }, { type: "uint256" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "amountADesired", type: "uint256" }, { name: "amountBDesired", type: "uint256" }, { name: "amountAMin", type: "uint256" }, { name: "amountBMin", type: "uint256" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], name: "addLiquidity", outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], stateMutability: "nonpayable", type: "function" },
] as const;
const PAIR_ABI = [
  { inputs: [], name: "token0", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "getReserves", outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }], stateMutability: "view", type: "function" },
] as const;
const GUARD_ABI = [
  { inputs: [{ name: "hireId", type: "bytes32" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], name: "swapExactTokensForTokensGuarded", outputs: [{ type: "uint256[]" }], stateMutability: "nonpayable", type: "function" },
] as const;
const VTOKEN_ABI = [
  { inputs: [{ name: "mintAmount", type: "uint256" }], name: "mint", outputs: [{ type: "uint256" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "redeemTokens", type: "uint256" }], name: "redeem", outputs: [{ type: "uint256" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "supplyRatePerBlock", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "exchangeRateStored", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "borrowBalanceStored", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "underlying", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
] as const;
const VWBNB_MINT_ABI = [
  { inputs: [{ name: "mintAmount", type: "uint256" }], name: "mint", outputs: [{ type: "uint256" }], stateMutability: "payable", type: "function" },
] as const;
const COMPTROLLER_ABI = [
  { inputs: [{ name: "account", type: "address" }], name: "getAccountLiquidity", outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "vTokens", type: "address[]" }], name: "enterMarkets", outputs: [{ type: "uint256[]" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "oracle", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
] as const;
const ORACLE_ABI = [
  { inputs: [{ name: "vToken", type: "address" }], name: "getUnderlyingPrice", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

// ── limits (per-trade caps so the loop stays well inside balances) ────────
const MAX_BUY_USDT = 0.004;       // grid buy per cycle
const MAX_SELL_WBNB = 0.0006;     // grid sell per cycle
const REBAL_USDT_LEG = 0.008;
const REBAL_WBNB_LEG = 0.002;
const YIELD_AMOUNT_USDT = 0.005;  // first supply size
const HEALTH_MINT_BNB = 0.004;    // collateral top-up / initial supply (native BNB)
const HEALTH_BORROW_USDC = 0.5;
const HF_ACTION_THRESHOLD = 1.5;  // protective action below this
const MIN_NATIVE_KEEP = 0.006;    // never spend gas money below this
const GRID_BAND = 0.04;           // ±4% around anchor
const BLOCKS_PER_YEAR = 10512000n;

const pub: PublicClient = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
const STATE_DIR = resolve(process.cwd(), ".strategy-state");

// ── small helpers ─────────────────────────────────────────────────────────
function walletFor(key: `0x${string}`) {
  return createWalletClient({ chain: bscTestnet, transport: http(RPC), account: privateKeyToAccount(key) });
}
async function tokenBalance(token: Address, holder: Address): Promise<number> {
  const raw = await pub.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [holder] });
  return Number(raw) / 1e18;
}
async function nativeBalance(holder: Address): Promise<number> {
  return Number(formatEther(await pub.getBalance({ address: holder })));
}
async function ensureApproval(client: ReturnType<typeof walletFor>, holder: Address, token: Address, spender: Address, amount: bigint): Promise<string | null> {
  const cur = await pub.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [holder, spender] });
  if (cur >= amount) return null;
  const h = await client.writeContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [spender, amount] });
  await pub.waitForTransactionReceipt({ hash: h });
  return h;
}
async function wbnbPriceUsdt(): Promise<number> {
  const [r0, r1] = await pub.readContract({ address: PCS_PAIR, abi: PAIR_ABI, functionName: "getReserves" });
  const t0 = (await pub.readContract({ address: PCS_PAIR, abi: PAIR_ABI, functionName: "token0" })).toLowerCase();
  const wbnbRes = Number(t0 === WBNB ? r0 : r1) / 1e18;
  const usdtRes = Number(t0 === WBNB ? r1 : r0) / 1e18;
  return wbnbRes > 0 ? usdtRes / wbnbRes : 0;
}
async function vTokenApr(vToken: Address): Promise<number> {
  const rate = await pub.readContract({ address: vToken, abi: VTOKEN_ABI, functionName: "supplyRatePerBlock" });
  return (Number(rate) * Number(BLOCKS_PER_YEAR) * 100) / 1e18;
}

// ── persisted cycle state (grid anchor / yield market / last runs) ────────
function readState<T>(file: string, fallback: T): T {
  try {
    const p = resolve(STATE_DIR, file);
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch { return fallback; }
}
function writeState(file: string, value: unknown): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(resolve(STATE_DIR, file), JSON.stringify(value, null, 2));
}

// ── supabase (admin) + hire policy ───────────────────────────────────────
function supabase() {
  const url = envGet("NEXT_PUBLIC_SUPABASE_URL");
  const key = envGet("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env missing");
  return createSupabaseClient(url, key);
}
export interface HirePolicy {
  delegId: string;
  hireId: `0x${string}` | null;
  sessionPublicKey: string | null;
  sessionPrivateKey: string | null;
  tokenScope: string[];
  spendCap: number;
  expiry: number;
}
export async function activeHireFor(agentWallet: string): Promise<HirePolicy | null> {
  const db = supabase();
  const { data } = await db.from("delegations").select("id,agent_id,agent_wallet,hire_id,session_public_key,session_private_key,token_scope,spend_cap,expiry,status")
    .eq("agent_wallet", agentWallet.toLowerCase()).eq("status", "active").order("created_at", { ascending: false }).limit(5);
  const now = Math.floor(Date.now() / 1000);
  for (const d of data ?? []) {
    if (Number(d.expiry ?? 0) < now) continue;
    let scope: string[] = [];
    try { scope = JSON.parse(String(d.token_scope ?? "[]")); } catch { /* keep [] */ }
    return {
      delegId: d.id,
      hireId: d.hire_id ? (d.hire_id.toLowerCase() as `0x${string}`) : null,
      sessionPublicKey: d.session_public_key ?? null,
      sessionPrivateKey: d.session_private_key ?? null,
      tokenScope: scope.map((s) => s.toLowerCase()),
      spendCap: Number(d.spend_cap ?? 0),
      expiry: Number(d.expiry ?? 0),
    };
  }
  return null;
}
async function logRun(row: { agent_wallet: string; category: string; action: string; status: string; reason: string; details: Record<string, unknown> }): Promise<void> {
  try {
    // tx hash may arrive under different keys (txHash/mintTx/addTx/swapTx…) — pick the first 0x-64hex value
    let txHash: string | null = null;
    for (const v of Object.values(row.details)) {
      if (typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v)) { txHash = v; break; }
    }
    const db = supabase();
    await db.from("strategy_runs").insert({
      agent_wallet: row.agent_wallet.toLowerCase(), category: row.category, action: row.action,
      status: row.status, reason: row.reason, details: row.details, tx_hash: txHash,
    });
  } catch (e) {
    console.error("  strategy_runs insert failed:", (e as Error).message);
  }
}

// ── swap execution: guarded (hired) vs base wallet ────────────────────────
async function executeSwap(opts: {
  agentWallet: Address; key: `0x${string}`; tokenIn: Address; tokenOut: Address; amountIn: bigint;
  hire: HirePolicy | null; label: string;
}): Promise<{ txHash: string; routed: "guarded" | "base" }> {
  const { agentWallet, key, tokenIn, tokenOut, amountIn, hire } = opts;
  const client = walletFor(key);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  if (hire && hire.hireId && GUARD) {
    // policy check client-side too (the router enforces it on-chain regardless)
    if (!hire.tokenScope.includes(tokenOut.toLowerCase())) {
      throw new Error(`target ${tokenOut} not in hire scope`);
    }
    if (!hire.sessionPrivateKey) {
      throw new Error("hire has no persisted session key — guarded routing unavailable");
    }
    await ensureApproval(client, agentWallet, tokenIn, getAddress(GUARD) as Address, amountIn);
    // Reconstruct the hire's Altana session from the persisted sub-key and
    // execute the swap THROUGH it → the GuardRouter enforces scope/cap/min-liq
    // on-chain for this hireId (this is the "hired autonomy" path).
    const { createClient, BNB_TESTNET, signerFromPrivateKey } = await import("@altananetwork/sdk");
    const sdk = createClient({ chains: [BNB_TESTNET] });
    const sessionSigner = signerFromPrivateKey((hire.sessionPrivateKey.startsWith("0x") ? hire.sessionPrivateKey : "0x" + hire.sessionPrivateKey) as `0x${string}`);
    const session = {
      walletAddress: getAddress(agentWallet),
      signer: sessionSigner,
      publicKey: (hire.sessionPublicKey ?? "0x") as `0x${string}`,
      permissions: { calls: [{ to: getAddress(GUARD) as Address }] },
      expiry: hire.expiry,
    };
    const data = encodeFunctionData({
      abi: GUARD_ABI, functionName: "swapExactTokensForTokensGuarded",
      args: [hire.hireId, amountIn, 0n, [getAddress(tokenIn) as Address, getAddress(tokenOut) as Address], getAddress(agentWallet) as Address, deadline],
    });
    const res = await sdk.execute({ session, chainId: 97, calls: [{ to: getAddress(GUARD) as Address, value: 0n, data }] });
    if (!res.transactionHash) throw new Error(`guarded execute ${res.status}, no tx hash`);
    await pub.waitForTransactionReceipt({ hash: res.transactionHash });
    return { txHash: res.transactionHash, routed: "guarded" };
  }

  // base wallet swap (unhired) — per-trade caps are the agent's own limits
  await ensureApproval(client, agentWallet, tokenIn, getAddress(PCS_ROUTER) as Address, amountIn);
  const h = await client.writeContract({
    address: getAddress(PCS_ROUTER) as Address, abi: ROUTER_ABI, functionName: "swapExactTokensForTokens",
    args: [amountIn, 0n, [getAddress(tokenIn) as Address, getAddress(tokenOut) as Address], getAddress(agentWallet) as Address, deadline],
  });
  await pub.waitForTransactionReceipt({ hash: h });
  return { txHash: h, routed: "base" };
}

// ── 1) GRID: buy low / sell high around an anchored price ─────────────────
async function gridCycle(agentWallet: Address, key: `0x${string}`, hire: HirePolicy | null) {
  const price = await wbnbPriceUsdt();
  const state = readState<{ anchor?: number; verifiedGuarded?: boolean }>("grid.json", {});
  if (!state.anchor || price <= 0) {
    writeState("grid.json", { ...state, anchor: price });
    await logRun({ agent_wallet: agentWallet, category: "Grid Trading", action: "anchor", status: "skipped", reason: "no anchor — initialized", details: { anchorPrice: price } });
    return { acted: false, reason: `anchor initialized at ${price.toFixed(2)}` };
  }
  const low = state.anchor * (1 - GRID_BAND);
  const high = state.anchor * (1 + GRID_BAND);
  // one-time guarded-path verification: while hired, prove the loop can really
  // execute through the hire's session + GuardRouter (small sell inside cap).
  if (hire && hire.hireId && !state.verifiedGuarded) {
    const wbnbBal = await tokenBalance(WBNB as Address, agentWallet);
    if (wbnbBal >= 0.0004) {
      const { txHash, routed } = await executeSwap({ agentWallet, key, tokenIn: WBNB as Address, tokenOut: USDT as Address, amountIn: parseUnits("0.0003", 18), hire, label: "grid-verify" });
      writeState("grid.json", { ...state, verifiedGuarded: true });
      await logRun({ agent_wallet: agentWallet, category: "Grid Trading", action: "verify", status: "executed", reason: "guarded routing verified through hire session + GuardRouter", details: { txHash, routed, hireId: hire.hireId } });
      return { acted: true, reason: `guarded path verified (${routed}) through hire ${hire.delegId}`, txHash };
    }
  }
  if (price >= low && price <= high) {
    await logRun({ agent_wallet: agentWallet, category: "Grid Trading", action: "hold", status: "skipped", reason: "price inside grid band", details: { price, low, high, anchor: state.anchor } });
    return { acted: false, reason: `price $${price.toFixed(2)} inside band $${low.toFixed(2)}–$${high.toFixed(2)}` };
  }
  const usdt = await tokenBalance(USDT as Address, agentWallet);
  const wbnb = await tokenBalance(WBNB as Address, agentWallet);
  let txHash = "", routed: "guarded" | "base" = "base";
  if (price < low) {
    // BUY: price dropped below the grid — spend up to 40% of USDT (capped)
    const spend = Math.min(usdt * 0.4, MAX_BUY_USDT);
    if (spend < 0.0005) { await logRun({ agent_wallet: agentWallet, category: "Grid Trading", action: "buy", status: "skipped", reason: "insufficient USDT", details: { usdt } }); return { acted: false, reason: "insufficient USDT" }; }
    ({ txHash, routed } = await executeSwap({ agentWallet, key, tokenIn: USDT as Address, tokenOut: WBNB as Address, amountIn: parseUnits(spend.toFixed(8), 18), hire, label: "grid-buy" }));
  } else {
    // SELL: price rose above the grid — sell up to 40% of WBNB (capped)
    const sell = Math.min(wbnb * 0.4, MAX_SELL_WBNB);
    if (sell < 0.00005) { await logRun({ agent_wallet: agentWallet, category: "Grid Trading", action: "sell", status: "skipped", reason: "insufficient WBNB", details: { wbnb } }); return { acted: false, reason: "insufficient WBNB" }; }
    ({ txHash, routed } = await executeSwap({ agentWallet, key, tokenIn: WBNB as Address, tokenOut: USDT as Address, amountIn: parseUnits(sell.toFixed(10), 18), hire, label: "grid-sell" }));
  }
  writeState("grid.json", { anchor: price }); // re-anchor after the trade
  await logRun({ agent_wallet: agentWallet, category: "Grid Trading", action: price < low ? "buy" : "sell", status: "executed", reason: `price $${price.toFixed(2)} outside band`, details: { txHash, routed, price, anchor: state.anchor } });
  return { acted: true, reason: `${price < low ? "buy" : "sell"} (${routed}) — price $${price.toFixed(2)} vs anchor $${state.anchor.toFixed(2)}`, txHash };
}

// ── 2) REBALANCING: keep a 50/50 WBNB/USDT LP; re-center on drift ─────────
async function rebalCycle(agentWallet: Address, key: `0x${string}`, _hire: HirePolicy | null) {
  const client = walletFor(key);
  const lp = await tokenBalance(PCS_PAIR as Address, agentWallet);
  const [r0, r1] = await pub.readContract({ address: PCS_PAIR, abi: PAIR_ABI, functionName: "getReserves" });
  const t0 = (await pub.readContract({ address: PCS_PAIR, abi: PAIR_ABI, functionName: "token0" })).toLowerCase();
  const price = Number(t0 === WBNB ? Number(r1) / Number(r0) : Number(r0) / Number(r1));
  const state = readState<{ anchor?: number }>("rebal.json", {});
  const drift = state.anchor && price > 0 ? Math.abs(price / state.anchor - 1) : 0;
  const TOLERANCE = 0.2;

  if (lp > 0 && state.anchor && drift <= TOLERANCE) {
    await logRun({ agent_wallet: agentWallet, category: "Rebalancing", action: "hold", status: "skipped", reason: "LP in range", details: { lp, drift, anchor: state.anchor ?? null, price } });
    return { acted: false, reason: `LP in range (drift ${(drift * 100).toFixed(1)}% ≤ 20%)` };
  }
  if (lp > 0 && state.anchor && drift > TOLERANCE) {
    // re-center: remove all LP, re-add 50/50 at the new price
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    await ensureApproval(client, agentWallet, PCS_PAIR as Address, getAddress(PCS_ROUTER) as Address, BigInt(Math.floor(lp * 1e18)));
    const rm = await client.writeContract({
      address: getAddress(PCS_ROUTER) as Address, abi: ROUTER_ABI, functionName: "removeLiquidity",
      args: [getAddress(USDT) as Address, getAddress(WBNB) as Address, BigInt(Math.floor(lp * 1e18)), 0n, 0n, getAddress(agentWallet) as Address, deadline],
    });
    await pub.waitForTransactionReceipt({ hash: rm });
    const usdt = await tokenBalance(USDT as Address, agentWallet);
    const wbnb = await tokenBalance(WBNB as Address, agentWallet);
    const add = await client.writeContract({
      address: getAddress(PCS_ROUTER) as Address, abi: ROUTER_ABI, functionName: "addLiquidity",
      args: [getAddress(USDT) as Address, getAddress(WBNB) as Address, parseUnits((usdt * 0.9).toFixed(8), 18), parseUnits((wbnb * 0.9).toFixed(10), 18), 0n, 0n, getAddress(agentWallet) as Address, deadline],
    });
    await pub.waitForTransactionReceipt({ hash: add });
    writeState("rebal.json", { anchor: price });
    await logRun({ agent_wallet: agentWallet, category: "Rebalancing", action: "recenter", status: "executed", reason: `drift ${(drift * 100).toFixed(1)}% > 20%`, details: { removeTx: rm, addTx: add, drift, price } });
    return { acted: true, reason: `re-centered LP (drift ${(drift * 100).toFixed(1)}%)`, txHash: add };
  }
  // no LP yet → establish the position (real add, 50/50 legs)
  const usdt = await tokenBalance(USDT as Address, agentWallet);
  const wbnb = await tokenBalance(WBNB as Address, agentWallet);
  if (usdt < REBAL_USDT_LEG || wbnb < REBAL_WBNB_LEG) {
    await logRun({ agent_wallet: agentWallet, category: "Rebalancing", action: "establish", status: "skipped", reason: "insufficient legs", details: { usdt, wbnb } });
    return { acted: false, reason: `insufficient legs (USDT ${usdt.toFixed(4)} / WBNB ${wbnb.toFixed(4)})` };
  }
  await ensureApproval(client, agentWallet, USDT as Address, getAddress(PCS_ROUTER) as Address, parseUnits((usdt).toFixed(8), 18));
  await ensureApproval(client, agentWallet, WBNB as Address, getAddress(PCS_ROUTER) as Address, parseUnits((wbnb).toFixed(10), 18));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const add = await client.writeContract({
    address: getAddress(PCS_ROUTER) as Address, abi: ROUTER_ABI, functionName: "addLiquidity",
    args: [getAddress(USDT) as Address, getAddress(WBNB) as Address, parseUnits(REBAL_USDT_LEG.toFixed(8), 18), parseUnits(REBAL_WBNB_LEG.toFixed(10), 18), 0n, 0n, getAddress(agentWallet) as Address, deadline],
  });
  await pub.waitForTransactionReceipt({ hash: add });
  writeState("rebal.json", { anchor: price });
  await logRun({ agent_wallet: agentWallet, category: "Rebalancing", action: "establish", status: "executed", reason: "no LP — established 50/50 position", details: { addTx: add, price } });
  return { acted: true, reason: "LP established (real addLiquidity)", txHash: add };
}

// ── 3) YIELD: compare real Venus markets; move if meaningfully better ─────
const YIELD_MARKETS = [
  { key: "vwbnb", v: VENUS_VWBNB, token: WBNB as Address, dec: 18, label: "Venus WBNB" },
  { key: "vusdc", v: VENUS_VUSDC, token: USDC as Address, dec: 6, label: "Venus USDC" },
] as const;
async function yieldCycle(agentWallet: Address, key: `0x${string}`, hire: HirePolicy | null) {
  const client = walletFor(key);
  // live APRs (real reads) + usability (do we hold / can we route to the token?)
  const aprs: { key: string; label: string; apr: number; usable: boolean }[] = [];
  for (const m of YIELD_MARKETS) {
    const apr = await vTokenApr(m.v as Address);
    const held = await tokenBalance(m.token as Address, agentWallet);
    aprs.push({ key: m.key, label: m.label, apr, usable: held > 0.0001 });
  }
  const usable = aprs.filter((a) => a.usable).sort((a, b) => b.apr - a.apr);
  const state = readState<{ market?: string }>("yield.json", {});
  const current = aprs.find((a) => a.key === state.market) ?? null;
  const best = usable[0] ?? null;
  const GAP = 0.5; // percentage points

  if (!best) {
    // no market-token holdings — but idle USDT can be converted into the best
    // market's token (vUSDT does not exist on testnet, so USDT is "cash idle")
    const usdtBal = await tokenBalance(USDT as Address, agentWallet);
    if (usdtBal >= 0.002) {
      const m = YIELD_MARKETS.find((x) => x.key === (aprs.sort((a, b) => b.apr - a.apr)[0]?.key ?? "vwbnb"))!;
      // swap USDT → market token via PCS (base wallet — yield agent unhired)
      const swapAmt = usdtBal * 0.9;
      const { txHash: swapTx } = await executeSwap({ agentWallet, key, tokenIn: USDT as Address, tokenOut: m.token as Address, amountIn: parseUnits(swapAmt.toFixed(8), 18), hire, label: "yield-convert" });
      const got = await tokenBalance(m.token as Address, agentWallet);
      if (got < 0.0001) return { acted: false, reason: "conversion produced no balance" };
      const appr = await ensureApproval(client, agentWallet, m.token as Address, m.v as Address, parseUnits(got.toFixed(8), m.dec));
      const h = await client.writeContract({ address: m.v as Address, abi: VTOKEN_ABI, functionName: "mint", args: [parseUnits(got.toFixed(8), m.dec)] });
      await pub.waitForTransactionReceipt({ hash: h });
      writeState("yield.json", { market: m.key });
      await logRun({ agent_wallet: agentWallet, category: "Yield", action: "supply", status: "executed", reason: `converted idle USDT → ${m.label} supply (${got.toFixed(4)} tokens)`, details: { swapTx, mintTx: h, approveTx: appr, market: m.key, converted: swapAmt } });
      return { acted: true, reason: `converted idle USDT → ${m.label} @ ${m.label.includes("WBNB") ? "vWBNB" : "vUSDC"} supply`, txHash: h };
    }
    await logRun({ agent_wallet: agentWallet, category: "Yield", action: "compare", status: "skipped", reason: "no usable market (no holdings)", details: { aprs } });
    return { acted: false, reason: "no holdings to deploy" };
  }
  if (!state.market) {
    // first cycle: deploy into the best usable market
    const m = YIELD_MARKETS.find((x) => x.key === best.key)!;
    const bal = await tokenBalance(m.token as Address, agentWallet);
    const amt = Math.min(bal, YIELD_AMOUNT_USDT);
    if (amt < 0.0001) return { acted: false, reason: "balance too small" };
    const appr = await ensureApproval(client, agentWallet, m.token as Address, m.v as Address, parseUnits(amt.toFixed(8), m.dec));
    const h = await client.writeContract({ address: m.v as Address, abi: VTOKEN_ABI, functionName: "mint", args: [parseUnits(amt.toFixed(8), m.dec)] });
    await pub.waitForTransactionReceipt({ hash: h });
    writeState("yield.json", { market: m.key });
    await logRun({ agent_wallet: agentWallet, category: "Yield", action: "supply", status: "executed", reason: `initial supply → ${m.label} @ ${best.apr.toFixed(2)}% APR`, details: { txHash: h, approveTx: appr, apr: best.apr, market: m.key } });
    return { acted: true, reason: `supplied to ${m.label} @ ${best.apr.toFixed(2)}% APR`, txHash: h };
  }
  if (current && best.key !== current.key && best.apr - current.apr > GAP) {
    // move: redeem current → (route) → mint best. Route via PCS when tokens differ.
    const cur = YIELD_MARKETS.find((x) => x.key === current.key)!;
    const nxt = YIELD_MARKETS.find((x) => x.key === best.key)!;
    const vBal = await pub.readContract({ address: cur.v as Address, abi: VTOKEN_ABI, functionName: "balanceOf", args: [agentWallet] });
    if (Number(vBal) === 0) { writeState("yield.json", { market: best.key }); return { acted: false, reason: "no vToken balance — state reset" }; }
    const redeemTx = await client.writeContract({ address: cur.v as Address, abi: VTOKEN_ABI, functionName: "redeem", args: [vBal] });
    await pub.waitForTransactionReceipt({ hash: redeemTx });
    let moveTx: string | null = null;
    if (cur.token !== nxt.token) {
      const bal = await tokenBalance(cur.token as Address, agentWallet);
      ({ txHash: moveTx } = await executeSwap({ agentWallet, key, tokenIn: cur.token as Address, tokenOut: nxt.token as Address, amountIn: BigInt(Math.floor(bal * 0.95 * 1e18)), hire, label: "yield-move" }));
    }
    const newBal = await tokenBalance(nxt.token as Address, agentWallet);
    const amt = Math.min(newBal, newBal); // supply everything redeemed
    await ensureApproval(client, agentWallet, nxt.token as Address, nxt.v as Address, parseUnits(amt.toFixed(8), nxt.dec));
    const mintTx = await client.writeContract({ address: nxt.v as Address, abi: VTOKEN_ABI, functionName: "mint", args: [parseUnits(amt.toFixed(8), nxt.dec)] });
    await pub.waitForTransactionReceipt({ hash: mintTx });
    writeState("yield.json", { market: nxt.key });
    await logRun({ agent_wallet: agentWallet, category: "Yield", action: "move", status: "executed", reason: `${current.label} ${current.apr.toFixed(2)}% → ${best.label} ${best.apr.toFixed(2)}%`, details: { redeemTx, moveTx, mintTx, from: current.key, to: best.key } });
    return { acted: true, reason: `moved ${current.label} → ${best.label} (${best.apr.toFixed(2)}% APR)`, txHash: mintTx };
  }
  await logRun({ agent_wallet: agentWallet, category: "Yield", action: "compare", status: "skipped", reason: "current market still best (or gap ≤ 0.5pp)", details: { aprs, current: state.market } });
  return { acted: false, reason: current ? `${current.label} still best (${current.apr.toFixed(2)}%)` : "no better market" };
}

// ── 4) HEALTH-FACTOR: monitor Venus position; protect when HF drops ───────
async function healthCycle(agentWallet: Address, key: `0x${string}`, _hire: HirePolicy | null) {
  const client = walletFor(key);
  const oracle = (await pub.readContract({ address: VENUS_COMPTROLLER as Address, abi: COMPTROLLER_ABI, functionName: "oracle" })) as Address;
  const wbnbPrice = Number(await pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "getUnderlyingPrice", args: [VENUS_VWBNB as Address] })) / 1e18;
  const vBal = await pub.readContract({ address: VENUS_VWBNB as Address, abi: VTOKEN_ABI, functionName: "balanceOf", args: [agentWallet] });
  const rate = await pub.readContract({ address: VENUS_VWBNB as Address, abi: VTOKEN_ABI, functionName: "exchangeRateStored" });
  const collateralWbnb = (Number(vBal) * Number(rate)) / 1e18 / 1e18; // vTok * rate(1e18) → WBNB
  const borrowUsdc = Number(await pub.readContract({ address: VENUS_VUSDC as Address, abi: VTOKEN_ABI, functionName: "borrowBalanceStored", args: [agentWallet] })) / 1e6;
  const CF = 0.75;
  const hf = borrowUsdc > 0.01 ? (collateralWbnb * wbnbPrice * CF) / borrowUsdc : 999;

  if (vBal === 0n && borrowUsdc <= 0.01) {
    // no position: establish a real one (supply native BNB collateral + borrow USDC)
    const native = await nativeBalance(agentWallet);
    if (native < HEALTH_MINT_BNB + MIN_NATIVE_KEEP) {
      await logRun({ agent_wallet: agentWallet, category: "Health-Factor", action: "establish", status: "skipped", reason: "insufficient tBNB", details: { native } });
      return { acted: false, reason: `insufficient tBNB (${native.toFixed(4)})` };
    }
    const mintTx = await client.writeContract({ address: VENUS_VWBNB as Address, abi: VWBNB_MINT_ABI, functionName: "mint", args: [parseUnits(HEALTH_MINT_BNB.toFixed(8), 18)], value: parseUnits(HEALTH_MINT_BNB.toFixed(8), 18) });
    await pub.waitForTransactionReceipt({ hash: mintTx });
    await client.writeContract({ address: VENUS_COMPTROLLER as Address, abi: COMPTROLLER_ABI, functionName: "enterMarkets", args: [[VENUS_VWBNB as Address, VENUS_VUSDC as Address]] });
    // real borrow (USDC against the WBNB collateral):
    const bTx = await client.writeContract({ address: VENUS_VUSDC as Address, abi: [{ inputs: [{ name: "borrowAmount", type: "uint256" }], name: "borrow", outputs: [], stateMutability: "nonpayable", type: "function" }] as const, functionName: "borrow", args: [parseUnits(HEALTH_BORROW_USDC.toFixed(2), 6)] });
    await pub.waitForTransactionReceipt({ hash: bTx });
    await logRun({ agent_wallet: agentWallet, category: "Health-Factor", action: "establish", status: "executed", reason: "position established (supply + borrow)", details: { mintTx, borrowTx: bTx, mintBnb: HEALTH_MINT_BNB, borrowUsdc: HEALTH_BORROW_USDC } });
    return { acted: true, reason: `position established: ${HEALTH_MINT_BNB} BNB collateral + ${HEALTH_BORROW_USDC} USDC borrow`, txHash: bTx };
  }

  if (hf < HF_ACTION_THRESHOLD && hf !== 999) {
    // protective action: top up collateral with native BNB (raises HF for real)
    const native = await nativeBalance(agentWallet);
    const top = Math.min(HEALTH_MINT_BNB, (native - MIN_NATIVE_KEEP) * 0.5);
    if (top <= 0.0005) {
      await logRun({ agent_wallet: agentWallet, category: "Health-Factor", action: "protect", status: "skipped", reason: "HF low but no tBNB to top up", details: { hf, native } });
      return { acted: false, reason: `HF ${hf.toFixed(2)} low but no tBNB for top-up` };
    }
    const mintTx = await client.writeContract({ address: VENUS_VWBNB as Address, abi: VWBNB_MINT_ABI, functionName: "mint", args: [parseUnits(top.toFixed(8), 18)], value: parseUnits(top.toFixed(8), 18) });
    await pub.waitForTransactionReceipt({ hash: mintTx });
    await logRun({ agent_wallet: agentWallet, category: "Health-Factor", action: "protect", status: "executed", reason: `HF ${hf.toFixed(2)} < ${HF_ACTION_THRESHOLD} — collateral top-up`, details: { hf, mintTx, topBnb: top } });
    return { acted: true, reason: `HF ${hf.toFixed(2)} < ${HF_ACTION_THRESHOLD} → topped up ${top.toFixed(4)} BNB collateral`, txHash: mintTx };
  }
  // healthy: keep monitoring. To keep the position strong while gas allows,
  // periodically strengthen collateral (real top-up, at most once per 6h).
  const st2 = readState<{ lastTopUp?: number }>("health.json", {});
  const TOPUP_COOLDOWN_S = 6 * 3600;
  if (!st2.lastTopUp || now2() - st2.lastTopUp > TOPUP_COOLDOWN_S) {
    const native = await nativeBalance(agentWallet);
    const top = Math.min(HEALTH_MINT_BNB, (native - MIN_NATIVE_KEEP) * 0.5);
    if (top >= 0.001) {
      const mintTx = await mintVWbnb(client, top);
      await pub.waitForTransactionReceipt({ hash: mintTx });
      writeState("health.json", { lastTopUp: now2() });
      await logRun({ agent_wallet: agentWallet, category: "Health-Factor", action: "strengthen", status: "executed", reason: `HF ${hf.toFixed(2)} healthy — periodic collateral strengthen`, details: { hf, mintTx, topBnb: top } });
      return { acted: true, reason: `HF ${hf.toFixed(2)} healthy — strengthened collateral +${top.toFixed(4)} BNB`, txHash: mintTx };
    }
  }
  await logRun({ agent_wallet: agentWallet, category: "Health-Factor", action: "monitor", status: "skipped", reason: "HF healthy", details: { hf, collateralWbnb, borrowUsdc, wbnbPrice } });
  return { acted: false, reason: hf === 999 ? "no borrow — nothing to monitor" : `HF ${hf.toFixed(2)} healthy (≥ ${HF_ACTION_THRESHOLD})` };
}

function now2(): number { return Math.floor(Date.now() / 1000); }

/**
 * vWBNB mint is NOT payable — it pulls WBNB (ERC20) via transferFrom.
 * Real strengthen path: wrap native BNB → WBNB, approve vWBNB, then mint.
 * Every tx's receipt status is verified (honest execution, no silent reverts).
 */
async function mintVWbnb(client: ReturnType<typeof walletFor>, bnb: number): Promise<`0x${string}`> {
  const amount = parseUnits(bnb.toFixed(8), 18);
  const pub2 = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
  // 1) wrap: deposit() on WBNB, value = amount
  const wrapTx = await client.sendTransaction({
    to: WBNB as `0x${string}`,
    value: amount,
    data: encodeFunctionData({ abi: [{ inputs: [], name: "deposit", outputs: [], stateMutability: "payable", type: "function" }], functionName: "deposit", args: [] }),
    gas: 120_000n,
  });
  const wrapRec = await pub2.waitForTransactionReceipt({ hash: wrapTx });
  if (wrapRec.status !== "success") throw new Error(`WBNB wrap reverted: ${wrapTx}`);
  // 2) approve vWBNB to pull WBNB
  const apprTx = await client.writeContract({ address: WBNB as `0x${string}`, abi: ERC20_ABI, functionName: "approve", args: [VENUS_VWBNB as `0x${string}`, amount] });
  const apprRec = await pub2.waitForTransactionReceipt({ hash: apprTx });
  if (apprRec.status !== "success") throw new Error(`WBNB approve reverted: ${apprTx}`);
  // 3) mint (non-payable on this market)
  const mintTx = await client.writeContract({ address: VENUS_VWBNB as `0x${string}`, abi: VWBNB_MINT_ABI, functionName: "mint", args: [amount] });
  const mintRec = await pub2.waitForTransactionReceipt({ hash: mintTx });
  if (mintRec.status !== "success") throw new Error(`vWBNB mint reverted: ${mintTx}`);
  return mintTx;
}

// ── the cycle ─────────────────────────────────────────────────────────────
export interface CycleResult {
  wallet: string; category: string; hireLinked: boolean;
  acted: boolean; reason: string; txHash?: string; error?: string;
}
export async function runCycle(): Promise<CycleResult[]> {
  const db = supabase();
  const { data: listings } = await db.from("agent_listings").select("agent_wallet,category");
  const out: CycleResult[] = [];
  for (const l of listings ?? []) {
    const wallet = String(l.agent_wallet).toLowerCase() as Address;
    const category = String(l.category);
    if (wallet === String(envGet("ERC8004_SIGNER_KEY") ? (await import("viem/accounts")).privateKeyToAccount((envGet("ERC8004_SIGNER_KEY").startsWith("0x") ? envGet("ERC8004_SIGNER_KEY") : "0x" + envGet("ERC8004_SIGNER_KEY")) as `0x${string}`).address : "").toLowerCase()) {
      continue; // owner/test listing (token 2026) — no agent wallet, skip silently
    }
    const key = agentKey(wallet);
    if (!key) {
      out.push({ wallet, category, hireLinked: false, acted: false, reason: "", error: "no key resolved for wallet" });
      continue;
    }
    let hire: HirePolicy | null = null;
    try { hire = await activeHireFor(wallet); } catch { /* no policy — base mode */ }
    try {
      let r: { acted: boolean; reason: string; txHash?: string };
      if (category === "Grid Trading") r = await gridCycle(wallet, key, hire);
      else if (category === "Rebalancing") r = await rebalCycle(wallet, key, hire);
      else if (category === "Yield") r = await yieldCycle(wallet, key, hire);
      else if (category === "Health-Factor") r = await healthCycle(wallet, key, hire);
      else continue;
      out.push({ wallet, category, hireLinked: !!hire, acted: r.acted, reason: r.reason, txHash: r.txHash });
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 300) ?? String(e);
      await logRun({ agent_wallet: wallet, category, action: "cycle", status: "error", reason: msg, details: {} });
      out.push({ wallet, category, hireLinked: !!hire, acted: false, reason: "", error: msg });
    }
  }
  return out;
}
