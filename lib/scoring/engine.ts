/**
 * SCORING ORCHESTRATOR — computes Trust Score + Risk Labels for all tracked
 * wallets and persists to agent_snapshots (INSERT-only trend) each indexer run.
 *
 * Wire-up: called from the indexer (alongside the Guard spend scan). Also
 * updates `delegations.risk_flag_count` so auto-revoke evaluates REAL data.
 *
 * Replaces the placeholder `computeTrustScore` in lib/scoring/index.ts.
 */
import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { createAdminSupabaseClient } from "../supabase/admin";
import { computeTrustScore } from "./trust";
import { computeRiskLabels, type RiskLabel, type EventForRisk } from "./risk";

const RPC = "https://bsc-testnet-rpc.publicnode.com";

export interface ScoredWallet {
  wallet: string;
  category: string;
  tokenId: bigint;
  ageDays: number;
  txCount: number;
  behaviorConsistent: boolean;
  firstTxTimestamp: string | null;
  trustScore: number;
  ageActivity: number;
  reputation: number;
  bondRelative: number;
  riskPenalty: number;
  verified: boolean;
  dataConfidence: string;
  riskLabelCount: number;
  riskLabels: RiskLabel[];
  snapshotInserted: boolean;
}

export interface ScoreOptions {
  /** If set, only recompute this wallet (agent_wallet address). Otherwise all listed wallets. */
  wallet?: string;
  /** Default true — write the INSERT-only snapshot row. Set false for a dry-run compute. */
  persist?: boolean;
}

/** Compute + persist scores for wallets (the shared function both the indexer cron
 *  and POST /api/scores/refresh call). Returns results for scored wallets. */
export async function scoreAllWallets(opts: ScoreOptions = {}): Promise<ScoredWallet[]> {
  const admin = createAdminSupabaseClient();
  const pub = makePub();
  const persist = opts.persist !== false;
  const onlyWallet = opts.wallet ? String(opts.wallet).toLowerCase() : null;

  // 1. load all listings -> per category, the bond comparators
  const { data: listings } = await admin.from("agent_listings").select("erc8004_token_id, agent_wallet, category, bond_wei").order("erc8004_token_id", { ascending: true });

  // 2. load events per wallet
  const { data: events } = await admin.from("events").select("wallet,event_type,token_in,token_out,amount_in,amount_out,tx_hash,block_timestamp,block_number").order("block_timestamp", { ascending: true });

  // per-wallet aggregates
  const evByWallet: Record<string, EventForRisk[]> = {};
  const firstTxByWallet: Record<string, string> = {};
  const firstSeenBlock: Record<`0x${string}`, number> = {};
  const knownPoolTokens = new Set<`0x${string}`>([
    "0xae13d989dac2f0debff460ac112a837c89baa7cd" as `0x${string}`, // WBNB
    "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd" as `0x${string}`, // USDT
    "0x16227d60f7a0e586c66b005219dfc887d13c9531" as `0x${string}`, // USDC
  ]);

  for (const e of events ?? []) {
    const w = String(e.wallet).toLowerCase();
    if (!evByWallet[w]) evByWallet[w] = [];
    evByWallet[w].push({
      wallet: w as `0x${string}`, event_type: e.event_type,
      token_in: e.token_in, token_out: e.token_out,
      amount_in: e.amount_in as string | null, amount_out: e.amount_out as string | null,
      tx_hash: e.tx_hash, block_timestamp: e.block_timestamp,
    });
    if (!firstTxByWallet[w]) firstTxByWallet[w] = String(e.block_timestamp ?? "");
    for (const t of [e.token_in, e.token_out]) {
      if (t && typeof t === "string" && (t as string).startsWith("0x")) {
        const tok = (t as `0x${string}`).toLowerCase() as `0x${string}`;
        const blk = Number(e.block_number ?? 0);
        if (firstSeenBlock[tok] === undefined || firstSeenBlock[tok] === 0 || blk < firstSeenBlock[tok]) firstSeenBlock[tok] = blk;
      }
    }
  }

  const nowBlock = Number(await pub.getBlockNumber());
  const nowMs = Date.now();

  const results: ScoredWallet[] = [];

  // Dedup listings by wallet (each agent has one listing)
  for (const l of listings ?? []) {
    const wallet = String(l.agent_wallet).toLowerCase();
    if (onlyWallet && wallet !== onlyWallet) continue; // single-wallet recompute
    const tokenId = BigInt(l.erc8004_token_id);
    const category = String(l.category);
    const myBond = BigInt(String(l.bond_wei ?? "0"));
    const categoryBonds = (listings ?? [])
      .filter((x) => String(x.category) === category)
      .map((x) => BigInt(String(x.bond_wei ?? "0")));

    const evs = evByWallet[wallet] ?? [];
    const txCount = evs.length;
    const firstTs = firstTxByWallet[wallet] ?? null;
    const ageDays = firstTs ? Math.max(0, (nowMs - Date.parse(firstTs)) / 86400000) : 0;
    const behaviorConsistent = await walletBehaviorConsistent(admin, wallet);

    // risk labels per event
    const allLabels: RiskLabel[] = [];
    for (const ev of evs) {
      const labels = await computeRiskLabels(pub, ev, knownPoolTokens, firstSeenBlock, nowBlock);
      allLabels.push(...labels);
    }
    const riskLabelCount = allLabels.length;

    const score = await computeTrustScore({
      wallet: wallet as `0x${string}`, category,
      ageDays, txCount, behaviorConsistent,
      erc8004TokenId: tokenId, erc8004Bond: myBond, categoryBonds,
      riskFlagCount: riskLabelCount,
    });

    // persist snapshot row (INSERT-only) — skipped when persist:false (dry-run)
    let inserted = true;
    if (persist) {
      const { error } = await admin.from("agent_snapshots").insert({
        wallet,
        snapshot_timestamp: new Date().toISOString(),
        age_days: Number(ageDays.toFixed(4)),
        tx_count: txCount,
        flag_count: riskLabelCount,
        behavior_consistent: behaviorConsistent,
        behavior_detail: allLabels.map((x) => x.label).join(", "),
        swap_count: evs.filter((e) => e.event_type.includes("swap")).length,
        lend_count: evs.filter((e) => e.event_type.includes("venus")).length,
        trust_score: score.composite,
        trust_age_activity: score.subScores.ageActivity,
        trust_reputation: score.subScores.reputation,
        trust_bond: score.subScores.bondRelative,
        trust_risk_penalty: score.riskPenalty,
        trust_verified: score.verified,
        risk_label_count: riskLabelCount,
        risk_labels: JSON.stringify(allLabels),
        data_confidence: score.dataConfidence,
        first_tx_timestamp: firstTs,
      });
      if (error) { inserted = false; console.log(`  score snapshot ERR ${wallet.slice(0,10)}…: ${error.message.slice(0,60)}`); }
      // update delegation risk_flag_count (real value for auto-revoke)
      await admin.from("delegations").update({ risk_flag_count: riskLabelCount }).eq("agent_wallet", wallet);
    }

    results.push({
      wallet, category, tokenId, ageDays, txCount, behaviorConsistent, firstTxTimestamp: firstTs,
      trustScore: score.composite, ageActivity: score.subScores.ageActivity,
      reputation: score.subScores.reputation, bondRelative: score.subScores.bondRelative,
      riskPenalty: score.riskPenalty, verified: score.verified, dataConfidence: score.dataConfidence,
      riskLabelCount, riskLabels: allLabels, snapshotInserted: inserted,
    });
  }

  return results;
}

async function walletBehaviorConsistent(admin: any, wallet: string): Promise<boolean> {
  const { data } = await admin.from("agent_snapshots").select("behavior_consistent").eq("wallet", wallet).order("snapshot_timestamp", { ascending: false }).limit(1).maybeSingle();
  return data ? !!data.behavior_consistent : true;
}

function makePub(): PublicClient {
  return createPublicClient({ chain: bscTestnet, transport: http(RPC) });
}
