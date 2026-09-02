/**
 * TRUST SCORE engine (replaces the placeholder in lib/scoring/index.ts).
 *
 * composite = 0.40 * ageActivity + 0.30 * reputation + 0.30 * bondRelative
 *   then minus a frequency-based risk-flag penalty (no single flag auto-delists).
 *
 * Each sub-score is 0..100:
 *   ageActivity  — age since first indexed tx + tx frequency/consistency.
 *   reputation   — aggregated ERC-8004 Reputation Registry feedback (Step 3).
 *   bondRelative — stake bond size relative to other agents in the same CATEGORY
 *                  (from agent_listings).
 *
 * Data-sparse handling: a wallet with < MIN_TX meaningful events is reported with
 * a `data_confidence: "low"` flag rather than a misleading trusted number.
 */
import type { Address } from "viem";
import { getReputationSummary, type ReputationSummary } from "../erc8004/reputation";

export const VERIFY_DAYS = 7;            // verified badge threshold
export const MIN_TX_FOR_VERIFIED = 3;    // minIndexedTx for verified badge
export const MIN_TX_FOR_MEANINGFUL = 3;  // below this → data_confidence=low

export interface TrustScoreInput {
  wallet: Address;
  category: string;
  ageDays: number;           // since first indexed tx
  txCount: number;           // total indexed events
  behaviorConsistent: boolean;
  erc8004TokenId: bigint;    // identity tokenId (for reputation)
  erc8004Bond: bigint;       // this agent's bond (wei)
  categoryBonds: bigint[];   // all bonds in the same category (incl. this)
  riskFlagCount: number;     // real computed rolling flag count (from risk engine)
}

export interface TrustScoreResult {
  wallet: Address;
  category: string;
  composite: number;         // 0..100
  subScores: { ageActivity: number; reputation: number; bondRelative: number };
  riskPenalty: number;       // subtracted already from composite
  verified: boolean;         // computed boolean (no manual step)
  dataConfidence: "low" | "medium" | "high";
}

/** age/activity sub-score (0..100): 50% age maturity, 50% activity. */
function ageActivityScore(ageDays: number, txCount: number, consistent: boolean): number {
  // age maturity: ramp to 100 over VERIFY_DAYS*2 (14 days), capped.
  const age = Math.min(100, (ageDays / (VERIFY_DAYS * 2)) * 100);
  // activity: 10+ txs = full marks; scale linearly, +10 consistency bonus (capped).
  let activity = Math.min(100, txCount * 10);
  if (consistent) activity = Math.min(100, activity + 10);
  const s = age * 0.5 + activity * 0.5;
  return Math.round(Math.max(0, Math.min(100, s)) * 10) / 10;
}

/** ERC-8004 reputation sub-score (0..100). No feedback → neutral 0 (honest), not a guess. */
function reputationScore(summary: ReputationSummary | null): number {
  if (!summary || Number(summary.count) === 0) return 0; // truly no reputation evidence
  // normalise the raw aggregate (value scaled by 10^decimals) into 0..100.
  const raw = Number(summary.summaryValue) / Math.pow(10, summary.summaryValueDecimals);
  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}

/** bond sub-score (0..100): bond relative to the max bond in its category. */
function bondRelativeScore(bond: bigint, categoryBonds: bigint[]): number {
  const maxBond = categoryBonds.reduce((m, b) => (b > m ? b : m), 0n);
  if (maxBond === 0n) return 50; // no comparators → neutral
  const s = (Number(bond) / Number(maxBond)) * 100;
  return Math.round(Math.max(0, Math.min(100, s)) * 10) / 10;
}

/** Verified badge — pure computed boolean: age & min tx, no manual step. */
export function isVerified(ageDays: number, txCount: number): boolean {
  return ageDays >= VERIFY_DAYS && txCount >= MIN_TX_FOR_VERIFIED;
}

async function readReputation(tokenId: bigint): Promise<ReputationSummary | null> {
  try {
    return await getReputationSummary(tokenId, []);
  } catch {
    return null;
  }
}

/** Compute the full trust score for one wallet from raw inputs. */
export async function computeTrustScore(input: TrustScoreInput): Promise<TrustScoreResult> {
  const reputation = await readReputation(input.erc8004TokenId);

  const ageActivity = ageActivityScore(input.ageDays, input.txCount, input.behaviorConsistent);
  const reputationScoreValue = reputationScore(reputation);
  const bondRelative = bondRelativeScore(input.erc8004Bond, input.categoryBonds);

  // composite
  let composite = 0.4 * ageActivity + 0.3 * reputationScoreValue + 0.3 * bondRelative;

  // risk penalty: frequency-based, capped at 20; no single flag delists.
  const riskPenalty = Math.min(20, input.riskFlagCount * 4);
  composite = Math.max(0, Math.min(100, composite - riskPenalty));

  const dataConfidence = input.txCount >= MIN_TX_FOR_MEANINGFUL ? "high" : input.txCount > 0 ? "medium" : "low";

  return {
    wallet: input.wallet,
    category: input.category,
    composite: Math.round(composite * 10) / 10,
    subScores: { ageActivity, reputation: reputationScoreValue, bondRelative },
    riskPenalty,
    verified: isVerified(input.ageDays, input.txCount),
    dataConfidence,
  };
}
