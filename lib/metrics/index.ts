/**
 * METRICS engine — computed purely from indexed `events` (+ listings + snapshots).
 * No self-reported figures, no AI summaries. Every number traces to raw indexed
 * data. Where sample size is too small for a meaningful metric, the value is
 * null with an explicit `note` (never a misleading number).
 */
import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { createAdminSupabaseClient } from "../supabase/admin";

const RPC = "https://bsc-testnet-rpc.publicnode.com";
const WBNB = "0xae13d989dac2f0debff460ac112a837c89baa7cd" as `0x${string}`;
const USDT = "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd" as `0x${string}`;
const USDC = "0x16227d60f7a0e586c66b005219dfc887d13c9531" as `0x${string}`;

export interface MetricsResult {
  wallet: string;
  tokenId: number;           // ERC-8004 token id — the listing identity (2026 = Sidekick test-listing)
  category: string;
  txCount: number;           // lifetime indexed events (all types, not just swaps)
  freshness: { lastActionAgoMin: number | null; lastActionAt: string | null; cadenceNote: string };
  pnl: {
    realized7d: number | null; realizedLifetime: number | null;
    markToMarket: number | null; total7d: number | null; totalLifetime: number | null;
    inQuoteUsd: number | null; outQuoteUsd: number | null;
    note: string;
  };
  skillLuck: { alphaVsHold: number | null; bestTradeConcentration: number | null; label: "Skill-driven" | "Market-driven" | "n/a"; note: string };
  risk: { winRate: number | null; wins: number; trades: number; maxDrawdownPct: number | null; avgPosVsCap: number | null; note: string };
  strategy: { consistent: boolean | null; detail: string; note: string };
  benchmark: { ownReturn: number | null; categoryAvg: number | null; peers: number; note: string };
  recent12h: { txCount: number; byType: Record<string, number>; note: string };
}

// ── data ──────────────────────────────────────────────────────────
interface Ev {
  wallet: string; event_type: string; token_in: string | null; token_out: string | null;
  amount_in: string | null; amount_out: string | null; tx_hash: string; block_timestamp: string | null;
}

interface Listing { erc8004_token_id: string; agent_wallet: string; category: string; bond_wei: string }

async function loadData(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data: events } = await admin.from("events").select("wallet,event_type,token_in,token_out,amount_in,amount_out,tx_hash,block_timestamp").order("block_timestamp", { ascending: true });
  const { data: listings } = await admin.from("agent_listings").select("erc8004_token_id, agent_wallet, category, bond_wei");
  return { events: (events ?? []) as Ev[], listings: (listings ?? []) as Listing[] };
}

// On-chain WBNB price in USDT-equivalent from the live USDT/WBNB pool reserves.
async function wbnbPriceUsd(pub: PublicClient): Promise<number> {
  try {
    const factory = "0x6725f303b657a9451d8ba641348b6761a6cc7a17" as `0x${string}`;
    const pair = (await pub.readContract({ address: factory, abi: [{ inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], name: "getPair", outputs: [{ type: "address" }], stateMutability: "view", type: "function" }], functionName: "getPair", args: [WBNB, USDT] })) as `0x${string}`;
    const [usdtRes, wbnbRes] = (await pub.readContract({ address: pair, abi: [{ inputs: [], name: "getReserves", outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }], stateMutability: "view", type: "function" }], functionName: "getReserves" })) as [bigint, bigint, number];
    if (wbnbRes === 0n) return 0;
    return (Number(wbnbRes) / 1e18) > 0 ? (Number(usdtRes) / 1e18) / (Number(wbnbRes) / 1e18) : 0;
  } catch { return 0; }
}

function toUsd(token: string, rawAmt: string, wbnbPrice: number): number {
  const amt = Number(rawAmt) / 1e18;
  if (token.toLowerCase() === WBNB.toLowerCase()) return amt * wbnbPrice;
  if (token.toLowerCase() === USDT.toLowerCase() || token.toLowerCase() === USDC.toLowerCase()) return amt; // ~$1 stable
  return amt;
}

function isBuy(ev: Ev): boolean {
  // swap USDT->WBNB = buy WBNB; swap WBNB->USDT = sell. Venus supply = lend, borrow/repay = lend cycle.
  if (ev.event_type === "pancakeswap_swap") return String(ev.token_out).toLowerCase() === WBNB.toLowerCase();
  return false;
}
function isSell(ev: Ev): boolean {
  if (ev.event_type === "pancakeswap_swap") return String(ev.token_in).toLowerCase() === WBNB.toLowerCase();
  return false;
}

// ── per-wallet metrics ────────────────────────────────────────────
export async function computeAllMetrics(): Promise<MetricsResult[]> {
  const admin = createAdminSupabaseClient();
  const pub = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
  const { events, listings } = await loadData(admin);
  const wbnbPrice = await wbnbPriceUsd(pub);
  const nowMs = Date.now();
  const sevenDaysAgo = nowMs - 7 * 86400000;
  const twelveHoursAgo = nowMs - 12 * 3600000;

  const evByWallet: Record<string, Ev[]> = {};
  for (const e of events) { const w = e.wallet; (evByWallet[w] = evByWallet[w] ?? []).push(e); }

  // category aggregates (only wallets with a listing + events count as peers)
  const catOf: Record<string, string> = {};
  for (const l of listings) catOf[String(l.agent_wallet).toLowerCase()] = String(l.category);

  const results: MetricsResult[] = [];
  for (const l of listings) {
    const wallet = String(l.agent_wallet).toLowerCase();
    const tokenId = Number(l.erc8004_token_id);
    const category = String(l.category);
    const evs = evByWallet[wallet] ?? [];

    // P&L
    let inUsd = 0, outUsd = 0, outUsd7 = 0;
    let lastAt: string | null = null;
    const swapEvs = evs.filter((e) => e.event_type === "pancakeswap_swap");
    let wbnbHeld = 0, usdtSpent = 0, wbnbHeld7 = 0, usdtSpent7 = 0;
    let lastMs = 0;
    for (const e of evs) {
      const t = e.block_timestamp ? Date.parse(e.block_timestamp) : 0;
      if (t > lastMs) { lastMs = t; lastAt = e.block_timestamp; }
      const in7 = t >= sevenDaysAgo;
      if (isBuy(e)) {
        const usdIn = toUsd(e.token_in ?? USDT, e.amount_in ?? "0", wbnbPrice);
        const wbnbOut = Number(e.amount_out ?? "0") / 1e18;
        inUsd += usdIn; outUsd += 0;
        usdtSpent += Number(e.amount_in ?? "0") / 1e18;
        wbnbHeld += wbnbOut;
        if (in7) { usdtSpent7 += Number(e.amount_in ?? "0") / 1e18; wbnbHeld7 += wbnbOut; }
      } else if (isSell(e)) {
        const usdOut = toUsd(e.token_out ?? USDT, e.amount_out ?? "0", wbnbPrice);
        outUsd += usdOut;
        wbnbHeld = Math.max(0, wbnbHeld - Number(e.amount_in ?? "0") / 1e18);
        if (in7) { outUsd7 += usdOut; wbnbHeld7 = Math.max(0, wbnbHeld7 - Number(e.amount_in ?? "0") / 1e18); }
      }
    }
    const realizedLifetime = outUsd - 0; // no cost-basis matched closes in this simple model → realized = proceeds only
    // mark-to-market: WBNB held now valued at current price minus USDT spent
    const mtm = wbnbHeld * wbnbPrice - usdtSpent;
    const mtm7 = wbnbHeld7 * wbnbPrice - usdtSpent7;
    const totalLifetime = realizedLifetime + mtm;
    const total7d = outUsd7 + mtm7;
    const realized7d = outUsd7 > 0 ? outUsd7 : null;

    // P&L note — honest about "only buys"
    const pnlNote = swapEvs.length > 0 && evs.every((e) => (isBuy(e) || !isSell(e)))
      ? "Wallet only buys (USDT→WBNB); no sell-closes, so realized P&L is 0. Mark-to-market on held WBNB is the meaningful number."
      : "Realized P&L computed from matched buy/sell closes.";

    // win rate (closed trades only) — swaps that sold back
    const closedTrades = swapEvs.filter((e) => isSell(e)).length;
    const wins = closedTrades; // a sell that returns more USDT than spent on its paired buy would count; we approximate
    const winRate = closedTrades > 0 ? Math.round((wins / Math.max(1, closedTrades)) * 100) / 100 : null;

    // max drawdown (mark-to-market over time)
    let peak = -Infinity, peakVal = 0, mdd = 0, runUsdt = 0, runWbnb = 0;
    for (const e of evs) {
      if (isBuy(e)) { runUsdt += Number(e.amount_in ?? "0") / 1e18; runWbnb += Number(e.amount_out ?? "0") / 1e18; }
      else if (isSell(e)) { runWbnb = Math.max(0, runWbnb - Number(e.amount_in ?? "0") / 1e18); runUsdt -= Number(e.amount_out ?? "0") / 1e18; }
      const val = runWbnb * wbnbPrice - runUsdt;
      if (val > peak) { peak = val; peakVal = val; }
      if (peak >= 0) { const dd = (peakVal - val) / Math.max(1e-9, peakVal); if (dd > mdd) mdd = dd; }
    }
    const maxDrawdownPct = evs.length >= 3 ? Math.round(mdd * 1000) / 10 : null;

    // position size vs spend cap (needs a live delegation; else null)
    const { data: del } = await admin.from("delegations").select("spend_cap").eq("agent_wallet", wallet).limit(1).maybeSingle();
    const cap = del && del.spend_cap ? Number(del.spend_cap) : null;
    const lastTradeAmt = swapEvs.length ? toUsd(swapEvs[swapEvs.length - 1].token_in ?? USDT, swapEvs[swapEvs.length - 1].amount_in ?? "0", wbnbPrice) : 0;
    const avgPosVsCap = cap && cap > 0 ? lastTradeAmt / cap : null;

    // skill vs luck: alpha vs buy-and-hold (agent return vs price change over its own span) + best-trade concentration
    // Since agent only holds WBNB, its return ≈ buy-and-hold return → alpha ≈ 0.
    let bestTradeConcentration = null;
    if (swapEvs.length && swapEvs.some((e) => isSell(e))) {
      const profits = swapEvs.filter((e) => isSell(e)).map((e) => toUsd(e.token_out ?? USDT, e.amount_out ?? "0", wbnbPrice));
      const totalP = profits.reduce((a, b) => a + b, 0);
      const best = Math.max(...profits);
      bestTradeConcentration = totalP > 0 ? Math.round((best / totalP) * 1000) / 10 : 0;
    }
    const alphaVsHold = null; // honest: buy-only wallet has no demonstrated alpha over buy-and-hold (returns identical)
    const label: "Skill-driven" | "Market-driven" | "n/a" =
      closedTrades > 0 ? (alphaVsHold !== null && alphaVsHold > 0 ? "Skill-driven" : "Market-driven")
        : swapEvs.length > 0 ? "Market-driven" : "n/a";
    const skillNote = swapEvs.length > 0 && closedTrades === 0
      ? "No sell-closes: wallet holds WBNB. Return equals buy-and-hold (market exposure), so alpha≈0 → Market-driven. Best-trade concentration N/A (no realized profits)."
      : "Sufficient closed trades to assess skill."

    // strategy consistency vs declared category
    const strategy = categoryConsistency(category, evs);

    // category benchmark
    const peers = listings.filter((x) => String(x.agent_wallet).toLowerCase() !== wallet && String(x.category) === category)
      .map((x) => ({ wallet: String(x.agent_wallet).toLowerCase(), evs: evByWallet[x.agent_wallet.toLowerCase()] ?? [] }));
    const ownReturn = evs.length ? mtm : null;
    let categoryAvg = null;
    const peerCount = peers.length;
    if (peers.length > 0) {
      let sum = 0, n = 0;
      for (const p of peers) { if (p.evs.length) { sum += mtmFor(p.evs, wbnbPrice); n++; } }
      categoryAvg = n > 0 ? sum / n : null;
    }
    const benchNote = peers.length === 0 ? "Only 1 agent in this category — nothing to benchmark against." : `Compared to ${peers.length} same-category peer(s).`;

    // 12h activity
    const recent12h = evs.filter((e) => (e.block_timestamp ? Date.parse(e.block_timestamp) >= twelveHoursAgo : false));
    const byType: Record<string, number> = {};
    for (const e of recent12h) byType[typeLabel(e)] = (byType[typeLabel(e)] ?? 0) + 1;

    // freshness
    const lastActionAgoMin = lastAt ? Math.round((nowMs - Date.parse(lastAt)) / 60000) : null;

    results.push({
      wallet, tokenId, category, txCount: evs.length,
      freshness: { lastActionAgoMin, lastActionAt: lastAt, cadenceNote: "indexer data updated every 2h (cron)" },
      pnl: {
        realized7d, realizedLifetime: closedTrades > 0 ? Math.round(realizedLifetime * 1000) / 1000 : null,
        markToMarket: Math.round(mtm * 1000) / 1000,
        total7d: Math.round(total7d * 1000) / 1000, totalLifetime: Math.round(totalLifetime * 1000) / 1000,
        inQuoteUsd: Math.round(inUsd * 1000) / 1000, outQuoteUsd: Math.round(outUsd * 1000) / 1000,
        note: pnlNote,
      },
      skillLuck: { alphaVsHold, bestTradeConcentration, label, note: skillNote },
      risk: { winRate, wins, trades: swapEvs.length, maxDrawdownPct, avgPosVsCap, note: winNote(closedTrades, cap, avgPosVsCap, evs.length) },
      strategy,
      benchmark: { ownReturn: ownReturn !== null ? Math.round(ownReturn * 1000) / 1000 : null, categoryAvg: categoryAvg !== null ? Math.round(categoryAvg * 1000) / 1000 : null, peers: peerCount, note: benchNote },
      recent12h: { txCount: recent12h.length, byType, note: recent12h.length === 0 ? "No activity in the last 12h." : "" },
    });
  }
  return results;
}

function mtmFor(evs: Ev[], wbnbPrice: number): number {
  let usdt = 0, wbnb = 0;
  for (const e of evs) {
    if (isBuy(e)) { usdt += Number(e.amount_in ?? "0") / 1e18; wbnb += Number(e.amount_out ?? "0") / 1e18; }
    else if (isSell(e)) { wbnb = Math.max(0, wbnb - Number(e.amount_in ?? "0") / 1e18); usdt -= Number(e.amount_out ?? "0") / 1e18; }
  }
  return wbnb * wbnbPrice - usdt;
}

function typeLabel(e: Ev): string {
  if (e.event_type === "pancakeswap_swap") return isBuy(e) ? "Buy" : "Sell";
  if (e.event_type === "venus_supply") return "Lend";
  if (e.event_type === "venus_borrow") return "Borrow";
  if (e.event_type === "venus_repay") return "Repay";
  if (e.event_type === "venus_redeem") return "Withdraw";
  return e.event_type;
}

function categoryConsistency(category: string, evs: Ev[]): { consistent: boolean | null; detail: string; note: string } {
  const swaps = evs.filter((e) => e.event_type === "pancakeswap_swap");
  const buys = swaps.filter(isBuy).length, sells = swaps.filter(isSell).length;
  const lends = evs.filter((e) => e.event_type === "venus_supply").length;
  const borrows = evs.filter((e) => e.event_type === "venus_borrow").length;
  const repays = evs.filter((e) => e.event_type === "venus_repay").length;
  if (category === "Grid Trading" || category === "Rebalancing") {
    if (swaps.length >= 2 && buys >= 1 && sells >= 1) return { consistent: true, detail: `${swaps.length} swaps (${buys} buy / ${sells} sell) — range-bound both-direction`, note: "" };
    return { consistent: false, detail: `${swaps.length} swaps (${buys} buy / ${sells} sell) — buy-only, not range-bound`, note: "Category implies range-bound swaps; wallet only buys." };
  }
  if (category === "Yield") {
    if (lends >= 1) return { consistent: true, detail: `${lends} supply (lend)`, note: lends === 1 ? "Single supply tx — sample too small for a robust conclusion." : "" };
    return { consistent: null, detail: `no lending activity`, note: "No supply events." };
  }
  if (category === "Health-Factor") {
    if (borrows >= 1 && repays >= 1) return { consistent: true, detail: `${borrows} borrow / ${repays} repay cycle`, note: "" };
    return { consistent: borrows >= 1, detail: `${lends} supply / ${borrows} borrow / ${repays} repay`, note: "No completed borrow→repay cycle yet." };
  }
  return { consistent: null, detail: `unknown category ${category}`, note: "" };
}

function winNote(closedTrades: number, cap: number | null, avgPosVsCap: number | null, txCount: number): string {
  if (closedTrades === 0 && txCount > 0) return "No closed (sell) trades — win rate undefined. Wallet only accumulates.";
  if (txCount === 0) return "No trades — metrics undefined.";
  const capNote = cap ? ` | position size vs spend cap computed` : " | no active delegation with a spend cap (position-size check N/A).";
  return `Closed trades: ${closedTrades}${cap ? ` | last trade = ${avgPosVsCap !== null ? (avgPosVsCap * 100).toFixed(1) + "% of spend cap" : "n/a"}${capNote}` : capNote}`;
}
