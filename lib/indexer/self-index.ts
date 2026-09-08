/**
 * SELF-INDEX — the instant an agent's own tx confirms, its events land in
 * `events` (same decoder, same ON CONFLICT dedupe as the cron indexer).
 *
 * WHY: judge-visible freshness must not depend on "when the next indexer run
 * happens". The strategy loop knows exactly which tx it executed — so it
 * indexes its own receipt immediately, seconds after confirmation. The 15-min
 * indexer cron stays as the catch-up/fallback path (user txs, missed blocks);
 * dedupe is DB-enforced, so double-scanning is harmless.
 */
import type { Address, PublicClient } from "viem";
import { scanWalletActivity } from "./decode";
import { scanGuardSpends, persistGuardSpends, updateDelegationAmountUsed } from "./guard-spends";

type Admin = { from: (t: string) => any };

/** Scan [block-40, block] for this wallet's BNB-paired activity + guard spends. */
export async function selfIndexTxWindow(
  admin: Admin,
  client: PublicClient,
  wallet: Address,
  block: bigint,
): Promise<number> {
  const from = block > 40n ? block - 40n : 0n;
  const events = await scanWalletActivity(client, wallet, from, block, new Map());
  let inserted = 0;
  for (const e of events) {
    const tokenIn = e.token_in ?? "";
    const tokenOut = e.token_out ?? "";
    const { error } = await admin.from("events").upsert(
      {
        wallet: e.wallet,
        event_type: e.event_type,
        token_in: tokenIn || null,
        token_out: tokenOut || null,
        amount_in: e.amount_in,
        amount_out: e.amount_out,
        tx_hash: e.tx_hash,
        block_number: e.block_number,
        block_timestamp: e.block_timestamp,
        counterparty: e.counterparty,
      },
      { onConflict: "tx_hash,wallet,event_type", ignoreDuplicates: true },
    );
    if (!error) inserted++;
  }
  // guarded spends ride the same window (one extra getLogs) so delegation
  // amount_used is live for the spend-cap UI + auto-revoke, not cron-stale.
  try {
    const spends = await scanGuardSpends(client, from, block);
    if (spends.length > 0) {
      await persistGuardSpends(spends);
      await updateDelegationAmountUsed();
    }
  } catch { /* next cron pass catches up */ }
  return inserted;
}
