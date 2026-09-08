/**
 * THE SIDEKICK — BNB testnet chain indexer.
 *
 * For each wallet in `agent_wallets`, fetch + decode BNB-paired on-chain activity
 * (PancakeSwap swaps + Venus lend events) and:
 *   - insert new rows into `events`        (deduped on tx_hash+wallet+type+token_in)
 *   - insert one snapshot row into `agent_snapshots` per wallet (INSERT-only)
 *
 * Run on demand:   npm run index:run
 * Scheduled every 15 min via GitHub Actions (.github/workflows/agent-autonomy.yml),
 * resuming from `indexer_checkpoints` high-watermarks (migration 0011).
 *
 * Persistence is through the Supabase ADMIN client (service role), bypassing RLS
 * intentionally — the indexer is the privileged writer. Never run in a browser.
 */

import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import type { Address } from "viem";
import { CHAIN_ID, RPC_URLS, LOGS_CHUNK, DEFAULT_WINDOW_BLOCKS } from "./config";
import { scanWalletActivity, type IndexedEvent } from "./decode";
import { createAdminSupabaseClient } from "../supabase/admin";
import { scanGuardSpends, persistGuardSpends, updateDelegationAmountUsed } from "./guard-spends";
import { scoreAllWallets } from "../scoring/engine";

// Deterministic env: ambient (CI secrets) wins, local .env fills gaps.
import { loadEnv } from "../env";
loadEnv();

// Config
const FROM_BLOCK_OVERRIDE = BigInt(process.env.INDEXER_FROM_BLOCK ?? "0");
const LATENCY_BLOCKS = BigInt(process.env.INDEXER_LATENCY ?? "20");

let indexedEvents = 0;
let walletsTouched = 0;
let decodeFailures = 0;

/** Build a public client. Use publicnode directly (no multi-RPC fallback):
 *  the companion seed nodes reject getLogs ranges, and publicnode reliably
 *  serves the recent rolling window we scan. Retries are handled in the scan
 *  loop. Set BSC_TESTNET_RPC_URL to point elsewhere if needed. */
function makeClient() {
  return createPublicClient({
    chain: bscTestnet,
    transport: http(RPC_URLS[0]),
  });
}

/** Bound the scan start: honor an explicit override, else roll back DEFAULT_WINDOW_BLOCKS. */
function fromBlockOverride(toBlock: bigint): bigint {
  if (FROM_BLOCK_OVERRIDE > 0n) return FROM_BLOCK_OVERRIDE;
  return toBlock > DEFAULT_WINDOW_BLOCKS ? toBlock - DEFAULT_WINDOW_BLOCKS : 0n;
}

/**
 * High-watermark checkpoints (indexer_checkpoints, migration 0011): resume from
 * last_block+1 so a frequent (15-min) cron only scans the blocks mined since
 * the previous run — near-real-time visibility without re-walking history.
 * Falls back to the rolling-window floor on a cold start or if the stored mark
 * is stale/invalid. Insert-then-update upsert keeps it safe on first run.
 */
async function checkpointFrom(admin: ReturnType<typeof createAdminSupabaseClient>, wallet: string, toBlock: bigint): Promise<bigint> {
  const floor = fromBlockOverride(toBlock); // window fallback + explicit override
  if (FROM_BLOCK_OVERRIDE > 0n) return FROM_BLOCK_OVERRIDE;
  try {
    const { data } = await admin.from("indexer_checkpoints").select("last_block").eq("wallet", wallet).maybeSingle();
    const last = data ? BigInt(String(data.last_block)) : 0n;
    if (last > 0n && last + 1n <= toBlock) {
      // never scan more than the window floor back (publicnode prunes old logs)
      return last + 1n > floor ? last + 1n : floor;
    }
  } catch { /* table missing -> window mode */ }
  return floor;
}
async function saveCheckpoint(admin: ReturnType<typeof createAdminSupabaseClient>, wallet: string, block: bigint): Promise<void> {
  try {
    await admin.from("indexer_checkpoints").upsert(
      { wallet, last_block: String(block), updated_at: new Date().toISOString() },
      { onConflict: "wallet" },
    );
  } catch { /* best-effort; next run falls back to the window */ }
}

/** Resolve block timestamps for a set of events via cached getBlock. */
async function stampEvents(
  client: ReturnType<typeof makeClient>,
  events: IndexedEvent[],
  cache: Map<string, string>,
) {
  for (const e of events) {
    const key = String(e.block_number);
    if (cache.has(key)) {
      e.block_timestamp = cache.get(key)!;
      continue;
    }
    try {
      const block = await client.getBlock({ blockNumber: BigInt(e.block_number) });
      const ts = new Date(Number(block.timestamp) * 1000).toISOString();
      cache.set(key, ts);
      e.block_timestamp = ts;
    } catch {
      /* leave empty */
    }
  }
}

/** Compute the behavior flags at a point in time (append-only snapshot). */
function computeFlags(events: IndexedEvent[]) {
  const swaps = events.filter((e) => e.event_type === "pancakeswap_swap");
  const lends = events.filter((e) => e.event_type.startsWith("venus_"));
  const flags = new Set<string>();
  if (events.length === 0) flags.add("no_activity");
  if (swaps.length === 0 && lends.length === 0) flags.add("no_bnb_activity");
  const buys = swaps.filter((e) => String(e.token_in).includes("usdt") || !String(e.token_in).includes("wbnb"));
  if (swaps.length > 0 && buys.length === 0) flags.add("sell_only");
  if (swaps.length > 0 && buys.length === swaps.length) flags.add("buy_only");
  if (swaps.length + lends.length > 20) flags.add("high_frequency");
  return {
    flag_count: flags.size,
    flags: [...flags],
    behavior_consistent: !flags.has("sell_only") && !flags.has("buy_only"),
    swap_count: swaps.length,
    lend_count: lends.length,
  };
}

async function main() {
  console.log("── THE SIDEKICK · BNB testnet indexer ──");
  const client = makeClient();

  let latestBlock: bigint;
  try {
    latestBlock = await client.getBlockNumber();
  } catch (e) {
    console.error(`RPC unreachable: ${(e as Error).message}`);
    process.exit(1);
  }
  console.log(`chain ${CHAIN_ID} · latest block ${latestBlock}`);

  // ── 1. read tracked wallets ──
  const admin = createAdminSupabaseClient();
  const { data: wallets, error: walletErr } = await admin.from("agent_wallets").select("wallet,label");
  if (walletErr) {
    console.error(`cannot read agent_wallets: ${walletErr.message}`);
    process.exit(1);
  }
  const tracked: string[] = (wallets ?? []).map((w: any) => String(w.wallet).toLowerCase());
  if (tracked.length === 0) {
    console.log("no tracked wallets in agent_wallets — nothing to index.");
    process.exit(0);
  }
  console.log(`tracking ${tracked.length} wallet(s)`);

  // ── 2. scan per wallet from its high-watermark (rolling window as floor) ──
  const toBlock = latestBlock - LATENCY_BLOCKS;
  const tsCache = new Map<string, string>();

  for (const wallet of tracked) {
    try {
      console.log(`\n[${wallet.slice(0, 10)}…]`);

      // chunked scan to survive RPC range limits
      let localEvents: IndexedEvent[] = [];
      let from = await checkpointFrom(admin, wallet, toBlock);
      while (from <= toBlock) {
        let to = from + LOGS_CHUNK - 1n;
        if (to > toBlock) to = toBlock;
        try {
          const evs = await scanWalletActivity(client, wallet as Address, from, to, tsCache);
          localEvents.push(...evs);
        } catch (e) {
          decodeFailures++;
          console.log(`  scan ${from}–${to} ERR: ${(e as Error).message.slice(0, 70)}`);
        }
        if (to === toBlock) break;
        from = to + 1n;
      }
      await saveCheckpoint(admin, wallet, toBlock);

      // dedupe locally by tx+type+token_in
      const seenDedupe = new Set<string>();
      localEvents = localEvents.filter((e) => {
        const key = `${e.tx_hash}|${e.event_type}|${e.token_in ?? ""}`;
        if (seenDedupe.has(key)) return false;
        seenDedupe.add(key);
        return true;
      });

      // fill timestamps for any still-empty
      await stampEvents(client, localEvents, tsCache);

      if (localEvents.length === 0) {
        console.log(`  no BNB-paired activity in window — snapshot only`);
      }

      // ── 3. insert events (dedupe at DB layer via ON CONFLICT) ──
      let inserted = 0;
      for (const e of localEvents) {
        // Use '' (not NULL) as the token sentinel so Postgres' unique index
        // (tx_hash,wallet,event_type,token_in) actually dedupes — NULL≠NULL.
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
        if (error) {
          decodeFailures++;
          console.log(`  insert ERR ${e.tx_hash.slice(0, 12)}…: ${error.message.slice(0, 60)}`);
        } else {
          inserted++;
        }
      }
      indexedEvents += inserted;

      // ── 4. snapshot (append-only, one row per wallet per run) ──
      const flags = computeFlags(localEvents);
      // age_days = wallet age relative to window (approximate; refined by later events)
      const firstTs = localEvents.length
        ? Math.min(...localEvents.map((e) => new Date(e.block_timestamp).getTime()))
        : Date.now();
      const ageDays = Math.max(0, (Date.now() - firstTs) / 86_400_000);

      const snap = await admin.from("agent_snapshots").insert({
        wallet,
        snapshot_timestamp: new Date().toISOString(),
        age_days: Number(ageDays.toFixed(4)),
        tx_count: localEvents.length,
        flag_count: flags.flag_count,
        behavior_consistent: flags.behavior_consistent,
        behavior_detail: flags.flags.join(", "),
        swap_count: flags.swap_count,
        lend_count: flags.lend_count,
      });
      if (snap.error) {
        console.log(`  snapshot ERR: ${snap.error.message.slice(0, 60)}`);
      } else {
        walletsTouched++;
        console.log(
          `  snapshot: ${localEvents.length} events | flags=${flags.flag_count} (${flags.flags.join(",")}) | consistent=${flags.behavior_consistent}`,
        );
      }
    } catch (e) {
      decodeFailures++;
      console.log(`  wallet ERR: ${(e as Error).message.slice(0, 70)}`);
    }
  }

  // ── 4b. Guard Router spend scan -> guard_spends + recompute amount_used ──
  try {
    const guardFrom = await checkpointFrom(admin, "_guard", toBlock);
    const spends = await scanGuardSpends(client, guardFrom, toBlock);
    await saveCheckpoint(admin, "_guard", toBlock);
    const spendInserted = await persistGuardSpends(spends);
    const delegationsUpdated = await updateDelegationAmountUsed();
    console.log(`  guard_spends indexed: ${spendInserted} | delegations amount_used updated: ${delegationsUpdated}`);
  } catch (e) {
    console.log(`  guard spend scan ERR: ${(e as Error).message.slice(0, 70)}`);
  }

  // ── 4c. Trust Score + Risk Labels -> agent_snapshots (INSERT-only trend) ──
  try {
    const scored = await scoreAllWallets();
    console.log(`  trust scores computed for ${scored.length} wallet(s):`);
    for (const s of scored) {
      console.log(`    ${s.wallet.slice(0,10)}… ${s.category}: trust=${s.trustScore} (ageAct=${s.ageActivity} rep=${s.reputation} bond=${s.bondRelative} penalty=${s.riskPenalty}) flags=${s.riskLabelCount} verified=${s.verified} conf=${s.dataConfidence}`);
    }
  } catch (e) {
    console.log(`  scoring ERR: ${(e as Error).message.slice(0, 70)}`);
  }

  // ── 5. summary ──
  console.log("\n── INDEXER RUN COMPLETE ──");
  console.log(`  events indexed      : ${indexedEvents}`);
  console.log(`  wallets touched     : ${walletsTouched}/${tracked.length}`);
  console.log(`  decode failures     : ${decodeFailures}`);
  console.log(`  latest block        : ${latestBlock}`);
}

main().catch((e) => {
  console.error("indexer fatal:", e);
  process.exit(1);
});
