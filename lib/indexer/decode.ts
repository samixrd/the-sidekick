/**
 * Decoders — turn raw chain logs into `events` table rows.
 * Scoped to BNB-paired activity only: PancakeSwap BNB/USDT pool + Venus
 * vWBNB/vBNB lend markets.
 */
import type { Address, PublicClient } from "viem";
import {
  PCS_BNB_USDT_PAIR,
  PCS_SWAP_ABI,
  USDT,
  USDC,
  VENUS_ABI,
  VENUS_vBNB,
  VENUS_vWBNB,
  VENUS_vUSDC,
  WBNB,
} from "./config";

export type IndexedEvent = {
  wallet: string;
  event_type: string;
  token_in: string | null;
  token_out: string | null;
  amount_in: string | null;
  amount_out: string | null;
  tx_hash: string;
  block_number: number;
  block_timestamp: string;
  counterparty: string | null;
};

const rawAmount = (v: unknown): string => (typeof v === "bigint" ? v.toString() : String(v));
const addr = (v: unknown): string => (typeof v === "string" ? v.toLowerCase() : "");

/** Decode a PancakeSwap V2 Swap log from the BNB/USDT pool into an event row. */
function decodePancakeSwap(log: {
  transactionHash?: string;
  blockNumber?: bigint;
  args?: any;
  address?: Address;
}): IndexedEvent | null {
  if (!log.transactionHash || !log.blockNumber || !log.args) return null;
  const { amount0In, amount1In, amount0Out, amount1Out, to, sender } = log.args;
  const a0in = BigInt(amount0In ?? 0);
  const a1in = BigInt(amount1In ?? 0);
  const a0out = BigInt(amount0Out ?? 0);
  const a1out = BigInt(amount1Out ?? 0);

  // token0 = USDT, token1 = WBNB (BNB/USDT pool).
  const usdtIn = a0in > 0n;    // buy USDT leg
  const wbnbIn = a1in > 0n;    // sell WBNB leg
  const usdtOut = a0out > 0n;  // sell USDT received
  const wbnbOut = a1out > 0n;  // buy WBNB received
  // Accept BOTH directions: buy (USDT in / WBNB out) OR sell (WBNB in / USDT out).
  if (!usdtIn && !usdtOut && !wbnbIn && !wbnbOut) return null; // no BNB-paired leg

  // "buy" = USDT in / WBNB out (the wallet paid USDT to receive WBNB). A sell is
  // the inverse (WBNB in / USDT out) — the decoder is direction-agnostic below.
  const buy = usdtIn || (!wbnbIn && wbnbOut); // prefer the buy orientation when ambiguous
  const token_in = (buy ? USDT : WBNB).toLowerCase();
  const token_out = (buy ? WBNB : USDT).toLowerCase();

  return {
    wallet: addr(to),
    event_type: "pancakeswap_swap",
    token_in,
    token_out,
    amount_in: buy ? rawAmount(a0in) : rawAmount(a1in),
    amount_out: buy ? rawAmount(a1out) : rawAmount(a0out),
    tx_hash: log.transactionHash.toLowerCase(),
    block_number: Number(log.blockNumber),
    block_timestamp: "",
    counterparty: addr(sender),
  };
}

/** Decode a Venus vToken Mint/Redeem/Borrow/RepayBorrow log into an event row. */
function decodeVenus(
  log: { transactionHash?: string; blockNumber?: bigint; args?: any; address?: Address },
  eventName: "Mint" | "Redeem" | "Borrow" | "RepayBorrow",
): IndexedEvent | null {
  if (!log.transactionHash || !log.blockNumber || !log.args) return null;
  const a = log.args;
  const typeMap: Record<typeof eventName, { type: string; participant: string; amount: string }> = {
    Mint: { type: "venus_supply", participant: addr(a.minter), amount: rawAmount(a.mintAmount) },
    Redeem: { type: "venus_withdraw", participant: addr(a.redeemer), amount: rawAmount(a.redeemAmount) },
    Borrow: { type: "venus_borrow", participant: addr(a.borrower), amount: rawAmount(a.borrowAmount) },
    RepayBorrow: { type: "venus_repay", participant: addr(a.payer), amount: rawAmount(a.repayAmount) },
  };
  const m = typeMap[eventName];
  if (!m) return null;

  // Resolve the market's underlying token (WBNB for vWBNB/vBNB, USDC for vUSDC).
  const contractAddr = addr(log.address);
  const token = contractAddr === VENUS_vUSDC.toLowerCase() ? USDC : WBNB;

  const isProviding = eventName === "Mint" || eventName === "Borrow";
  const isWithdrawing = eventName === "Redeem" || eventName === "RepayBorrow";
  return {
    wallet: m.participant,
    event_type: m.type,
    token_in: isProviding ? token.toLowerCase() : null,
    token_out: isWithdrawing ? token.toLowerCase() : null,
    amount_in: isProviding ? m.amount : null,
    amount_out: isWithdrawing ? m.amount : null,
    tx_hash: log.transactionHash.toLowerCase(),
    block_number: Number(log.blockNumber),
    block_timestamp: "",
    counterparty: addr(log.address),
  };
}

/**
 * Fetch + decode all BNB-paired activity for a wallet within [fromBlock, toBlock].
 * Resolves block timestamps via a shared cache to avoid N+1 getBlock calls.
 */
export async function scanWalletActivity(
  client: PublicClient,
  wallet: Address,
  fromBlock: bigint,
  toBlock: bigint,
  tsCache: Map<string, string>,
): Promise<IndexedEvent[]> {
  const out: IndexedEvent[] = [];
  const stamp = async (blockNumber: bigint): Promise<string> => {
    const key = blockNumber.toString();
    if (tsCache.has(key)) return tsCache.get(key)!;
    try {
      const block = await client.getBlock({ blockNumber });
      const ts = new Date(Number(block.timestamp) * 1000).toISOString();
      tsCache.set(key, ts);
      return ts;
    } catch {
      return "";
    }
  };

  // ── PancakeSwap BNB/USDT swaps ──
  try {
    const logs = await client.getLogs({
      address: PCS_BNB_USDT_PAIR,
      event: PCS_SWAP_ABI[0] as any,
      args: { to: wallet },
      fromBlock,
      toBlock,
    });
    for (const l of logs as any[]) {
      const e = decodePancakeSwap(l);
      if (!e) continue;
      e.block_timestamp = await stamp(l.blockNumber!);
      if (e.block_timestamp) out.push(e);
    }
  } catch (e) {
    throw new Error(`PCS scan failed: ${(e as Error).message}`);
  }

  // ── Venus vWBNB + vBNB + vUSDC lend events ──
  // NOTE: Venus Mint/Redeem emit NO indexed participant, so a topic filter on
  // `args:{minter}` would silently match nothing. Fetch ALL logs for each event
  // and filter by the decoded participant in JS instead.
  const venusEvents = VENUS_ABI.filter((a: any) => a.type === "event");
  for (const contract of [VENUS_vWBNB, VENUS_vBNB, VENUS_vUSDC]) {
    for (const ev of venusEvents as any[]) {
      const name = ev.name as "Mint" | "Redeem" | "Borrow" | "RepayBorrow";
      try {
        const logs = await client.getLogs({ address: contract, event: ev, fromBlock, toBlock });
        for (const l of logs as any[]) {
          const e = decodeVenus(l, name);
          if (!e || e.wallet.toLowerCase() !== wallet.toLowerCase()) continue;
          e.block_timestamp = await stamp(l.blockNumber!);
          if (e.block_timestamp) out.push(e);
        }
      } catch {
        // some venus events unsupported on a market — skip
      }
    }
  }

  return out;
}
