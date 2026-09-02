import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { CookieOptions } from "@supabase/ssr";
import { buildListing, attachIndexedSnapshots, buildIndexedAgent, LISTED_AGENT_IDS } from "@/lib/marketplace/listings";
import { AgentCard } from "@/components/agent-card";
import { RequireSupabaseEnv } from "@/components/require-supabase-env";

export const metadata = { title: "Marketplace — The Sidekick" };

async function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* server component can't set cookies */
        }
      },
    },
  });
}

async function getIndexedData() {
  try {
    const supabase = await getSupabaseClient();
    // latest snapshot per wallet (dedupe)
    const { data } = await supabase
      .from("agent_snapshots")
      .select("wallet, snapshot_timestamp, tx_count, swap_count, lend_count, flag_count, behavior_consistent")
      .order("snapshot_timestamp", { ascending: false });
    const seen = new Set<string>();
    const latest: {
      wallet: string; snapshot_timestamp: string; tx_count: number; swap_count: number; lend_count: number; flag_count: number; behavior_consistent: boolean;
    }[] = [];
    for (const row of data ?? []) {
      const w = String(row.wallet).toLowerCase();
      if (seen.has(w) || w === "0x0000000000000000000000000000000000000001") continue; // skip zero-addr probe
      seen.add(w);
      latest.push(row);
    }
    // tracked wallet labels
    const { data: walletRows } = await supabase.from("agent_wallets").select("wallet,label");
    const byWallet = new Map(walletRows?.map((w) => [String(w.wallet).toLowerCase(), w.label]) ?? []);
    return { latest, byWallet };
  } catch {
    return { latest: [], byWallet: new Map() };
  }
}

export default async function MarketplacePage() {
  const [listed, { latest, byWallet }] = await Promise.all([
    buildListing(LISTED_AGENT_IDS),
    getIndexedData().catch(() => ({ latest: [], byWallet: new Map() })),
  ]);
  const withIndexed = await attachIndexedSnapshots(listed, latest);
  const indexedOnly = latest
    .filter((s) => !listed.some((a) => String(a.agentWallet).toLowerCase() === String(s.wallet).toLowerCase()))
    .map((s) =>
      buildIndexedAgent({
        wallet: String(s.wallet).toLowerCase(),
        label: byWallet.get(String(s.wallet).toLowerCase()) ?? null,
        snapshot: s,
      }),
    );
  const agents = [...withIndexed, ...indexedOnly];
  const identityCount = withIndexed.length;
  const indexedCount = agents.filter((a) => a.indexed).length;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.25em] text-faint">
          Agentic Marketplace
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Agents</h1>
        <div className="rule mt-10" />

        <div className="mt-8 flex flex-wrap gap-3">
          <Chip label="agents" value={agents.length} />
          <Chip label="on-chain identity" value={identityCount} />
          <Chip label="with indexed data" value={indexedCount} />
          <Chip label="network" value="BSC testnet" />
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          {agents.map((a) => (
            <AgentCard key={a.agentId.toString()} agent={a} />
          ))}
        </div>

        {agents.length === 0 && (
          <p className="mt-10 text-muted">No agents listed yet. Register the first one.</p>
        )}
      </div>
      <RequireSupabaseEnv />
    </main>
  );
}

function Chip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 rounded border border-border bg-surface px-4 py-2">
      <span className="text-xs uppercase tracking-[0.18em] text-faint">{label}</span>
      <span className="font-mono text-sm tabular text-accent">{value}</span>
    </div>
  );
}
