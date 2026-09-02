/**
 * Indexer config — BSC testnet RPCs, contract addresses, event ABIs.
 * Decoding is scoped to BNB-paired activity only (PancakeSwap BNB/USDT pool
 * + Venus vWBNB market), per the indexer spec.
 */
import { parseAbi } from "viem";

// ── RPCs (primary + fallbacks; different providers survive rate-limits) ──
// NOTE: blastapi is dead (moved to Alchemy). publicnode only serves RECENT
// history (older blocks are pruned), so scanning is bounded to a rolling
// window. data-seed-prebsc caps per-request block ranges — keep chunks small.
export const RPC_URLS = [
  process.env.BSC_TESTNET_RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com",
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
  "https://data-seed-prebsc-2-s2.binance.org:8545",
].filter(Boolean);

export const CHAIN_ID = 97; // BSC testnet

// getLogs chunk size — MUST stay small; the prebsc seeds reject ranges > ~2k-5k.
export const LOGS_CHUNK = 2000n;
// Rolling window scanned each run (blocks ≈ ~1.5-3s each on BSC). The 2h cron
// gap is ~5-10k blocks, so 40k gives a healthy margin (≈ 1-2 days history) plus
// downtime tolerance while keeping each run fast. Override via env.
export const DEFAULT_WINDOW_BLOCKS = 40_000n;

// ── Contracts (verified live on BSC testnet) ──
export const PCS_FACTORY = "0x6725F303b657a9451d8BA641348b6761A6CC7a17" as const;
export const PCS_ROUTER = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1" as const;
export const PCS_BNB_USDT_PAIR = "0x5F52Ad4bD4f519AE79999400ad8B83A3D002fD92" as const;

export const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
export const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34DdD" as const;
export const USDC = "0x16227D60f7a0e586C66B005219dfc887D13C9531" as const;

// BNB-paired Venus markets (decoder only consumes the ones used by the indexer):
export const VENUS_vWBNB = "0xd9E77847ec815E56ae2B9E69596C69b6972b0B1C" as const; // underlying = WBNB
export const VENUS_vBNB = "0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c" as const; // native BNB
export const VENUS_vUSDC = "0xD5C4C2e2facBEB59D0216D0595d63FcDc6F9A1a7" as const; // underlying = USDC

// ── ABIs ──
export const PCS_SWAP_ABI = parseAbi([
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

// Venus vToken events (deployed on BSC testnet — verified via 4byte directory).
// NOTE: newer Venus vToken Mint has FOUR args (adds newBalance); args are
// non-indexed, so we fetch all logs and filter by participant in JS.
export const VENUS_ABI = parseAbi([
  // supply: user deposits underlying to mint vTokens
  "event Mint(address minter, uint256 mintAmount, uint256 mintTokens, uint256 newBalance)",
  // withdraw: user redeems vTokens for underlying
  "event Redeem(address redeemer, uint256 redeemAmount, uint256 redeemTokens)",
  // borrow: user takes a loan
  "event Borrow(address borrower, uint256 borrowAmount, uint256 accountBorrows, uint256 totalBorrows)",
  // repay: user pays back principal
  "event RepayBorrow(address payer, address borrower, uint256 repayAmount, uint256 accountBorrows, uint256 totalBorrows)",
  "function underlying() view returns (address)",
]);
