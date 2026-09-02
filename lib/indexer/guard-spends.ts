/**
 * Guard Router spend scanner — decodes SwapForwarded events from the GuardRouter
 * contract and inserts them into `guard_spends`. This captures spend that was
 * ROUTED THROUGH the Guard Router (per hire_id), which is what a delegation's
 * amount_used should be derived from — not arbitrary wallet activity.
 */
import type { PublicClient } from "viem";
import { createAdminSupabaseClient } from "../supabase/admin";
import { readFileSync } from "node:fs";

// GuardRouter address from .env
function guardRouterAddress(): `0x${string}` {
  const env = readFileSync(process.cwd() + "/.env", "utf8");
  return (env.match(/^GUARD_ROUTER="?([^"\r\n]+)/m)?.[1] ?? "") as `0x${string}`;
}

const SWAP_FORWARDED_TOPIC = "0x624d6b134aea03ea59dba6703ef0f443f00c2a4dba51cd86beb9367f275d579c" as const; // keccak256("SwapForwarded(bytes32,address,address[],uint256,uint256)")

export interface GuardSpend {
  hire_id: string;
  caller: string;
  amount_in: string;
  amount_out: string;
  tx_hash: string;
  block_number: number;
  block_timestamp: string | null;
}

/** Scan the GuardRouter for SwapForwarded events in [from, to] (raw topic filter — reliable). */
export async function scanGuardSpends(client: PublicClient, from: bigint, to: bigint): Promise<GuardSpend[]> {
  const guard = guardRouterAddress();
  if (!guard) return [];
  const out: GuardSpend[] = [];
  try {
    const logs = await (client.getLogs as any)({ address: guard, topics: [SWAP_FORWARDED_TOPIC], fromBlock: from, toBlock: to });
    for (const l of logs as any[]) {
      // Guard on the exact topic0 — the RPC topics filter can over-match.
      if ((l.topics[0] as string).toLowerCase() !== SWAP_FORWARDED_TOPIC.toLowerCase()) continue;
      // topic[1] = hireId (bytes32), topic[2] = caller (address); amountIn/amountOut in data.
      const hireId = (l.topics[1] as `0x${string}`).toLowerCase();
      const caller = ("0x" + (l.topics[2] as string).slice(-40)) as `0x${string}`;
      // decode data: (address[] path, uint256 amountIn, uint256 amountOut)
      let amountIn = "0";
      let amountOut = "0";
      try {
        const { decodeAbiParameters } = await import("viem");
        const decoded = decodeAbiParameters([{ name: "path", type: "address[]" }, { name: "amountIn", type: "uint256" }, { name: "amountOut", type: "uint256" }], l.data);
        amountIn = (decoded[1] as bigint).toString();
        amountOut = (decoded[2] as bigint).toString();
      } catch {}
      out.push({
        hire_id: hireId,
        caller: caller.toLowerCase(),
        amount_in: amountIn,
        amount_out: amountOut,
        tx_hash: l.transactionHash.toLowerCase(),
        block_number: Number(l.blockNumber),
        block_timestamp: null,
      });
    }
  } catch {
    // Guard may be deployed later than a scan window — skip.
  }
  return out;
}

/** Insert guard_spends rows into Supabase (dedupe on tx_hash+hire_id). */
export async function persistGuardSpends(spends: GuardSpend[]): Promise<number> {
  if (spends.length === 0) return 0;
  const admin = createAdminSupabaseClient();
  let inserted = 0;
  for (const s of spends) {
    const { error } = await admin.from("guard_spends").upsert(
      { hire_id: s.hire_id, caller: s.caller, amount_in: s.amount_in, amount_out: s.amount_out, tx_hash: s.tx_hash, block_number: s.block_number, block_timestamp: s.block_timestamp },
      { onConflict: "tx_hash,hire_id", ignoreDuplicates: true },
    );
    if (error) { console.log("  guard_spends insert ERR:", error.message.slice(0, 60)); } else { inserted++; }
  }
  return inserted;
}

/** Recompute amount_used for all active delegations from guard_spends by hire_id. */
export async function updateDelegationAmountUsed(): Promise<number> {
  const admin = createAdminSupabaseClient();
  const { data: active } = await admin.from("delegations").select("id, hire_id").eq("status", "active");
  if (!active) return 0;
  let updated = 0;
  for (const d of active) {
    if (!d.hire_id) continue;
    const { data: sums } = await admin.from("guard_spends").select("amount_in").eq("hire_id", d.hire_id.toLowerCase());
    let total = 0;
    for (const s of sums ?? []) total += Number(s.amount_in);
    const usedTnb = Math.round((total / 1e18) * 1000) / 1000;
    const { error } = await admin.from("delegations").update({ amount_used: String(usedTnb), updated_at: new Date().toISOString() }).eq("id", d.id);
    if (!error) updated++;
  }
  return updated;
}
