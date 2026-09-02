/**
 * Scoring — the real Trust Score + Risk Label engine (no longer a placeholder).
 *
 * The placeholder `scoreAgent = 100 - flags*15` is replaced. The composite is now:
 *   trust = 0.40*ageActivity + 0.30*reputation + 0.30*bondRelative - riskPenalty
 */
export { computeTrustScore, isVerified, VERIFY_DAYS, MIN_TX_FOR_VERIFIED, MIN_TX_FOR_MEANINGFUL, type TrustScoreInput, type TrustScoreResult } from "./trust";
export { computeRiskLabels, FLAG_LOW_LIQ, FLAG_UNVERIFIED, FLAG_RELATED, type RiskLabel, type EventForRisk, poolReserves } from "./risk";
export { scoreAllWallets, type ScoredWallet } from "./engine";
