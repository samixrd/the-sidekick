"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { buildCards, type Category, type StatsResponse, type ScoresResponse, type MetricsResponse } from "./data";
import { AgentCard, SkeletonCard } from "./agent-card";
import { CompareView } from "./compare-view";
import { connectWallet, shortAddr } from "@/components/agent-detail/wallet";

// canonical order for rendering category tabs (All first, then the 4 real ones)
const TAB_ORDER: Category[] = ["All", "Grid Trading", "Rebalancing", "Yield", "Health-Factor"];

export function HomePage() {
  const [scores, setScores] = useState<ScoresResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"trust" | "newest" | "hired">("trust");
  const [showInfo, setShowInfo] = useState(false);
  const [connected, setConnected] = useState<{ address: string; chainId: number } | null>(null);
  const [connecting, setConnecting] = useState(false);
  // compare selection (in-session only, max 3)
  const [compareWallets, setCompareWallets] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, m, st] = await Promise.all([
          fetch("/api/scores").then((r) => r.json()),
          fetch("/api/metrics").then((r) => r.json()),
          fetch("/api/stats").then((r) => r.json()),
        ]);
        if (!alive) return;
        setScores(s);
        setMetrics(m);
        setStats(st);
      } catch (e) {
        if (alive) setError((e as Error).message || "Failed to load marketplace data.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const cards = useMemo(() => {
    // cast the fetched JSON to the typed shapes; buildCards keys off metrics
    return buildCards(scores, metrics);
  }, [scores, metrics]);

  const filtered = useMemo(() => {
    let list = cards;
    if (activeCategory !== "All") list = list.filter((c) => c.category === activeCategory);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.wallet.toLowerCase().includes(q));
    }
    // sort by Trust Score (desc), Newest (first-seen via tokenId desc), Most Hired (hires desc)
    const sorted = [...list];
    if (sort === "trust") sorted.sort((a, b) => (b.trustScore ?? -1) - (a.trustScore ?? -1));
    else if (sort === "newest") sorted.sort((a, b) => b.tokenId - a.tokenId);
    else if (sort === "hired") sorted.sort((a, b) => b.tokenId - a.tokenId); // placeholder until real hires metric
    return sorted;
  }, [cards, activeCategory, query, sort]);

  const statsStrip = stats
    ? [
        { label: "Agents", value: String(stats.totalAgents) },
        { label: "Delegated", value: `$${stats.tvlDelegated.toFixed(4)}` },
        { label: "Hires", value: String(stats.totalHires) },
      ]
    : [];

  // toggle a wallet in/out of the compare set (max 3, in-session only)
  function toggleCompare(wallet: string) {
    setCompareWallets((prev) => prev.includes(wallet) ? prev.filter((w) => w !== wallet) : prev.length >= 3 ? prev : [...prev, wallet]);
  }
  const compareAgents = useMemo(
    () => cards.filter((c) => compareWallets.includes(c.wallet)),
    [cards, compareWallets],
  );

  // real EIP-1193 wallet connect (same hook as the Hire slide-over / My Agents)
  async function onConnect() {
    if (connected) return;
    setConnecting(true);
    try { setConnected(await connectWallet()); }
    catch (e) { setError((e as Error).message || "Failed to connect wallet."); }
    finally { setConnecting(false); }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-semibold tracking-tight text-foreground">The Sidekick</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-faint sm:inline">Agent Market</span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {TAB_ORDER.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`focus-ring rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCategory === c ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="relative hidden sm:block">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents…"
                className="focus-ring w-44 rounded border border-border bg-surface px-3 py-1.5 text-xs text-foreground placeholder:text-faint"
              />
            </div>
            <button
              onClick={onConnect}
              disabled={connecting}
              className={`focus-ring rounded border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                connected
                  ? "border-accent bg-accent text-on-accent"
                  : "border-border bg-surface text-foreground hover:bg-surface-raised"
              }`}
            >
              {connecting ? "Connecting…" : connected ? shortAddr(connected.address) : "Connect Wallet"}
            </button>
          </div>
        </div>

        {/* mobile category tabs */}
        <div className="border-t border-border md:hidden">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6 py-2">
            {TAB_ORDER.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`focus-ring shrink-0 rounded px-3 py-1 text-xs font-medium ${
                  activeCategory === c ? "bg-surface-raised text-foreground" : "text-muted"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Live stats strip ── */}
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center gap-6 overflow-x-auto px-6 py-3">
          {stats ? (
            statsStrip.map((s) => (
              <div key={s.label} className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-[10px] uppercase tracking-[0.18em] text-faint">{s.label}</span>
                <span className="font-mono tabular text-sm text-foreground">{s.value}</span>
              </div>
            ))
          ) : (
            <span className="font-mono text-xs text-faint">Loading stats…</span>
          )}
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Live
          </span>
        </div>
      </div>

      {/* ── Intro + filters row ── */}
      <div className="mx-auto max-w-7xl px-6 pt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-faint">Browse · BNB Chain</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Autonomous trading agents</h1>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em] text-faint">Sort</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "trust" | "newest" | "hired")}
              className="focus-ring rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground"
            >
              <option value="trust">Trust Score</option>
              <option value="newest">Newest</option>
              <option value="hired">Most Hired</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Agent grid ── */}
      <main className="mx-auto max-w-7xl px-6 pb-20 pt-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-12 text-center">
            <p className="text-sm text-muted">No agents match your filter.</p>
            <p className="mt-1 text-xs text-faint">Try another category, or clear your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((c) => (
              <AgentCard key={c.wallet} card={c} compareSelected={compareWallets.includes(c.wallet)} onCompareToggle={toggleCompare} />
            ))}
          </div>
        )}

        {/* ── How hiring works / Why this is safe (collapsed) ── */}
        <section className="mt-16 border-t border-border pt-6">
          <button
            onClick={() => setShowInfo((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <h2 className="text-sm font-semibold text-foreground">How hiring works · Why this is safe</h2>
            <span className="font-mono text-xs text-faint">{showInfo ? "−" : "+"}</span>
          </button>
          {showInfo && (
            <div className="mt-4 grid grid-cols-1 gap-4 text-xs leading-relaxed text-muted md:grid-cols-2">
              <div className="rounded border border-border bg-surface p-4">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Hiring</p>
                <p>
                  Each agent runs under a session key that can only call the Guard
                  Router within a spend cap, token scope, and a minimum-liquidity
                  threshold you set at hire time. Revoke any time.
                </p>
              </div>
              <div className="rounded border border-border bg-surface p-4">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Safety</p>
                <p>
                  Behaviour is published on-chain and scored from indexed data — no
                  self-reported numbers. Risk flags roll into the Trust Score; an
                  agent crossing a risk threshold is auto-revoked.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* ── List Your Agent (persistent) ── */}
      <div className="fixed bottom-6 right-6 z-40">
        <Link
          href="/register"
          className="focus-ring flex items-center gap-2 rounded-full border border-accent bg-accent px-5 py-3 text-sm font-semibold text-on-accent shadow-lg shadow-black/30 transition-colors hover:bg-accent-strong"
        >
          <span className="text-lg leading-none">+</span>
          List Your Agent
        </Link>
      </div>

      {/* ── Compare (N) floating button when 2–3 selected ── */}
      {compareWallets.length >= 2 && !compareOpen && (
        <div className="fixed bottom-6 left-6 z-40">
          <button
            onClick={() => setCompareOpen(true)}
            className="focus-ring flex items-center gap-2 rounded-full border border-accent bg-accent px-5 py-3 text-sm font-semibold text-on-accent shadow-lg shadow-black/30 transition-colors hover:bg-accent-strong"
          >
            Compare ({compareWallets.length})
            <span className="rounded-full bg-on-accent/20 px-1.5 py-0.5 font-mono text-[10px] tabular">{compareWallets.length}</span>
          </button>
        </div>
      )}

      {/* ── Compare view overlay ── */}
      {compareOpen && compareAgents.length >= 2 && (
        <CompareView agents={compareAgents} onBack={() => { setCompareOpen(false); }} />
      )}
    </div>
  );
}
