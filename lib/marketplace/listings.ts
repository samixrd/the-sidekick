/**
 * Marketplace listing aggregation — joins ERC-8004 on-chain identity +
 * reputation with the Supabase-indexed behaviour snapshots.
 *
 * Pure read path for the listing page (Server Component). Writes go through
 * the server actions in this module's sibling server file.
 */
import { readAgentIdentity } from "../erc8004/identity";
import { getReputationClients, getReputationSummary } from "../erc8004/reputation";

export interface MarketplaceAgent {
  agentId: bigint;
  // ERC-8004 identity
  name: string;
  description: string;
  owner: string;
  agentWallet: string;
  services: { name: string; endpoint: string }[];
  supportedTrust: string[];
  // reputation
  reputationCount: bigint;
  reputationValue: bigint;
  reputationDecimals: number;
  // indexed behaviour (from Supabase snapshot, optional)
  indexed?: {
    snapshotTxCount: number;
    snapshotSwapCount: number;
    snapshotLendCount: number;
    snapshotFlags: number;
    snapshotConsistent: boolean;
    snapshotTime: string;
    wallet: string;
  } | null;
}

/**
 * Build a marketplace listing for a set of known agentIds.
 * Reads ERC-8004 identity + reputation on-chain (real, verified data).
 */
export async function buildListing(agentIds: bigint[]): Promise<MarketplaceAgent[]> {
  const out: MarketplaceAgent[] = [];
  for (const agentId of agentIds) {
    try {
      const identity = await readAgentIdentity(agentId);
      const clients = await getReputationClients(agentId).catch(() => []);
      const summary = clients.length
        ? await getReputationSummary(agentId, clients).catch(() => ({ count: 0n, summaryValue: 0n, summaryValueDecimals: 0 }))
        : { count: 0n, summaryValue: 0n, summaryValueDecimals: 0 };

      const meta = identity.metadata ?? {};
      const services = Array.isArray(meta.services)
        ? (meta.services as { name: string; endpoint: string }[])
        : [];
      const supportedTrust = Array.isArray(meta.supportedTrust)
        ? (meta.supportedTrust as string[])
        : [];

      out.push({
        agentId,
        name: String(meta.name ?? `agent-${agentId}`),
        description: String(meta.description ?? ""),
        owner: identity.owner,
        agentWallet: identity.agentWallet,
        services,
        supportedTrust,
        reputationCount: summary.count,
        reputationValue: summary.summaryValue,
        reputationDecimals: summary.summaryValueDecimals,
        indexed: null,
      });
    } catch {
      // agentId not registered / RPC hiccup — skip
    }
  }
  return out;
}

/** Attach the latest Supabase indexed snapshot to each agent whose agentWallet is tracked. */
export async function attachIndexedSnapshots(agents: MarketplaceAgent[], trackedSnapshots: any[]): Promise<MarketplaceAgent[]> {
  const byWallet = new Map<string, any>();
  for (const s of trackedSnapshots) byWallet.set(String(s.wallet).toLowerCase(), s);
  for (const a of agents) {
    const snap = byWallet.get(String(a.agentWallet).toLowerCase()) ?? byWallet.get(String(a.owner).toLowerCase());
    if (snap) {
      a.indexed = {
        snapshotTxCount: Number(snap.tx_count ?? 0),
        snapshotSwapCount: Number(snap.swap_count ?? 0),
        snapshotLendCount: Number(snap.lend_count ?? 0),
        snapshotFlags: Number(snap.flag_count ?? 0),
        snapshotConsistent: Boolean(snap.behavior_consistent),
        snapshotTime: String(snap.snapshot_timestamp ?? ""),
        wallet: String(snap.wallet),
      };
    }
  }
  return agents;
}

/** The agentIds The Sidekick currently lists (its minted identities + verified testnet agents). */
export const LISTED_AGENT_IDS: bigint[] = [
  2026n, // The Sidekick agent (minted, real)
  1n,    // real verified BSC testnet agent w/ reputation
  17n,   // real verified agent w/ reputation
];

export interface IndexedAgentInput {
  wallet: string;
  label: string | null;
  snapshot: {
    tx_count: number;
    swap_count: number;
    lend_count: number;
    flag_count: number;
    behavior_consistent: boolean;
    snapshot_timestamp: string;
  } | null;
}

/**
 * Build a marketplace entry for a behaviour-backed indexed agent (tracked
 * wallet, no ERC-8004 identity yet). agentId is synthetic (0) — surfaced from
 * indexed on-chain behaviour rather than the identity registry.
 */
export function buildIndexedAgent(input: IndexedAgentInput): MarketplaceAgent {
  const s = input.snapshot;
  return {
    agentId: 0n,
    name: input.label?.replace(/\s*\(.*\)\s*$/i, "") || `agent-${input.wallet.slice(2, 8)}`,
    description: s ? "Tracked on-chain agent — behaviour indexed from BSC testnet." : "Tracked wallet — no behaviour indexed yet.",
    owner: input.wallet,
    agentWallet: input.wallet,
    services: [],
    supportedTrust: [],
    reputationCount: 0n,
    reputationValue: 0n,
    reputationDecimals: 0,
    indexed: s
      ? {
          snapshotTxCount: Number(s.tx_count ?? 0),
          snapshotSwapCount: Number(s.swap_count ?? 0),
          snapshotLendCount: Number(s.lend_count ?? 0),
          snapshotFlags: Number(s.flag_count ?? 0),
          snapshotConsistent: Boolean(s.behavior_consistent),
          snapshotTime: String(s.snapshot_timestamp ?? ""),
          wallet: input.wallet,
        }
      : null,
  };
}
