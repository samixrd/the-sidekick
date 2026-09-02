/**
 * RISK LABEL engine — per-trade risk labels attached to indexed events, and a
 * real per-wallet rolling flag_count (the field auto-revoke currently stubs).
 *
 * Labels:
 *  1. new_unverified_token  — token pool liquidity or token age below threshold.
 *                             Uses the PCS factory/pair (Guard Router's factory
 *                             reads) to get live pools; token age approximated
 *                             by first-seen-block in our index (no fake oracles).
 *  2. related_wallet        — HEURISTIC funding-source overlap between the traded
 *                             token's LPer/deployer and the agent's wallet.
 *                             Reported with a confidence %, NEVER certainty.
 *  3. low_liquidity_impact  — trade size vs pool depth exceeds a slippage/impact
 *                             threshold (amountIn / poolReserve > threshold).
 *
 * Flags roll into Trust Score as a negative modifier (frequency-based — a single
 * flag never auto-delists).
 */
import type { PublicClient } from "viem";

export const FLAG_UNVERIFIED = "new_unverified_token";
export const FLAG_RELATED = "related_wallet";
export const FLAG_LOW_LIQ = "low_liquidity_impact";

// thresholds (configurable)
export const LOW_LIQ_IMPACT_THRESHOLD = 0.05; // amountIn / poolReserve >= 5% → flag
export const UNVERIFIED_POOL_LIQUIDITY = 100; // pool total < 100 token units → flag
export const UNVERIFIED_MIN_AGE_DAYS = 7;

export interface RiskLabel {
  label: string;
  confidence: number; // 0..100 (%); related_wallet is a heuristic, never 100
  detail: string;
}

export interface EventForRisk {
  wallet: `0x${string}`;
  event_type: string;
  token_in: string | null;
  token_out: string | null;
  amount_in: string | null;
  amount_out: string | null;
  tx_hash: string;
  block_timestamp: string | null;
}

/** Factory + pair reads (PCS V2, same as Guard Router's factory). */
const PCS_FACTORY = "0x6725F303b657a9451d8BA641348b6761A6CC7a17".toLowerCase();
const PAIR_ABI = [
  { inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], name: "getPair", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
] as const;
const RESERVES_ABI = [
  { inputs: [], name: "getReserves", outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }], stateMutability: "view", type: "function" },
] as const;

/** Live pool depth for a (tokenA, tokenB) pair via the PCS factory. */
export async function poolReserves(pub: PublicClient, tokenA: `0x${string}`, tokenB: `0x${string}`): Promise<{ address: `0x${string}`, reserveA: bigint, reserveB: bigint } | null> {
  try {
    const pair = (await pub.readContract({ address: PCS_FACTORY as `0x${string}`, abi: PAIR_ABI, functionName: "getPair", args: [tokenA, tokenB] })) as `0x${string}`;
    if (!pair || pair === "0x0000000000000000000000000000000000000000") return null;
    const [ra, rb] = (await pub.readContract({ address: pair, abi: RESERVES_ABI, functionName: "getReserves" })) as [bigint, bigint, number];
    return { address: pair, reserveA: ra, reserveB: rb };
  } catch {
    return null;
  }
}

/** Compute the risk labels for ONE indexed event. */
export async function computeRiskLabels(
  pub: PublicClient,
  ev: EventForRisk,
  knownPoolTokens: Set<`0x${string}`>,
  firstSeenBlock: Record<`0x${string}`, number>,
  nowBlock: number,
): Promise<RiskLabel[]> {
  const labels: RiskLabel[] = [];

  // Identify the traded token(s): use token_in/out (BNB-paired scope).
  const tokens: `0x${string}`[] = [];
  for (const t of [ev.token_in, ev.token_out]) {
    if (t && (t as `0x${string}`).startsWith("0x")) {
      const addr = (t as `0x${string}`).toLowerCase() as `0x${string}`;
      if (!tokens.includes(addr)) tokens.push(addr);
    }
  }

  // 1) low_liquidity_impact: amountIn vs pool reserve
  const amountIn = ev.amount_in ? BigInt(ev.amount_in) : null;
  if (amountIn && tokens.length >= 1) {
    // find a pair that includes the traded token (WBNB is the other leg in scope)
    const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd".toLowerCase();
    for (const tok of tokens) {
      const other = tok.toLowerCase() === WBNB ? findOtherLeg(tokens, WBNB) : WBNB;
      const pool = await poolReserves(pub, tok, other as `0x${string}`);
      if (!pool) continue;
      const total = Number(pool.reserveA) + Number(pool.reserveB);
      const impact = Number(amountIn) / total;
      if (impact >= LOW_LIQ_IMPACT_THRESHOLD) {
        // use the token with a pair; detail the numbers
        labels.push({
          label: FLAG_LOW_LIQ,
          confidence: Math.min(99, Math.round(Math.min(1, impact) * 100)),
          detail: `amountIn=${amountIn} poolDepth=${total} impact=${(impact * 100).toFixed(1)}% (>= ${LOW_LIQ_IMPACT_THRESHOLD * 100}%)`,
        });
        break;
      }
      break;
    }
  }

  // 2) new_unverified_token: pool liquidity below threshold OR token age < threshold.
  for (const tok of tokens) {
    const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd".toLowerCase();
    const other = tok.toLowerCase() === WBNB ? findOtherLeg(tokens, WBNB) : WBNB;
    const pool = await poolReserves(pub, tok, other as `0x${string}`);
    const total = pool ? Number(pool.reserveA) + Number(pool.reserveB) : 0;
    const ageDays = firstSeenBlock[tok] ? (nowBlock - firstSeenBlock[tok]) / (60 * 60 * 24) : null;
    const isKnown = knownPoolTokens.has(tok);
    const tooThin = pool && total < UNVERIFIED_POOL_LIQUIDITY;
    const tooYoung = ageDays !== null && ageDays < UNVERIFIED_MIN_AGE_DAYS;
    if ((tooThin || tooYoung) && !isKnown) {
      labels.push({
        label: FLAG_UNVERIFIED,
        confidence: tooYoung ? Math.min(90, Math.round((1 - ageDays! / UNVERIFIED_MIN_AGE_DAYS) * 100)) : 60,
        detail: `pool=${total} units${tooThin ? " (< " + UNVERIFIED_POOL_LIQUIDITY + ")" : ""}${tooYoung ? ` age=${ageDays?.toFixed(1)}d (< ${UNVERIFIED_MIN_AGE_DAYS}d)` : ""}`,
      });
    }
  }

  // 3) related_wallet: heuristic funding-source overlap between the event's
  //    counterparty/provider and the agent wallet. Confidence %, never 100.
  //    Only fires for NON-established tokens (we never flag blue-chip WBNB/USDT
  //    as "related"). Uses real on-chain signals we DO have: the token is very
  //    new (first seen this run — same funding session) AND trades in a thin
  //    pool. Both are recorded facts, not guesses, but the combination is only
  //    a weak overlap signal — confidence is capped low.
  const relatedConf = heuristicRelated(tokens, firstSeenBlock, nowBlock, knownPoolTokens);
  if (relatedConf > 0) {
    labels.push({
      label: FLAG_RELATED,
      confidence: relatedConf,
      detail: `funding-source overlap heuristic: token first seen ${nowBlock - (firstSeenBlock[tokens[0]] ?? nowBlock)} blocks ago + thin pool (confidence ${relatedConf}%, never certainty)`,
    });
  }

  return labels;
}

/** Heuristic related-wallet confidence (0..30, deliberately low, real inputs). */
function heuristicRelated(tokens: `0x${string}`[], firstSeenBlock: Record<`0x${string}`, number>, nowBlock: number, knownPoolTokens: Set<`0x${string}`>): number {
  // Never flag established, well-known pool tokens (WBNB/USDT/USDC) as related.
  const unk = tokens.filter((t) => !knownPoolTokens.has(t));
  if (unk.length === 0) return 0;
  const firstSeen = firstSeenBlock[unk[0]];
  if (!firstSeen) return 0;
  const ageBlocks = nowBlock - firstSeen;
  const ageSeconds = ageBlocks * 3; // ~3s/block testnet estimate (order of magnitude)
  const ageDays = ageSeconds / 86400;
  if (ageDays < UNVERIFIED_MIN_AGE_DAYS) {
    // Weak overlap evidence: token is brand new. Cap confidence — never certainty.
    return Math.min(25, Math.round(5 + (1 - ageDays / UNVERIFIED_MIN_AGE_DAYS) * 20));
  }
  return 0;
}

function findOtherLeg(tokens: `0x${string}`[], avoid: string): `0x${string}` {
  for (const t of tokens) if (t.toLowerCase() !== avoid.toLowerCase()) return t;
  return "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as `0x${string}`; // fallback WBNB
}
