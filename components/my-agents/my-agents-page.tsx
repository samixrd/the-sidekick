"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { connectWallet, shortAddr } from "@/components/agent-detail/wallet";

interface Hire {
  id: string;
  agentId: string;
  agentWallet: string;
  agentName: string;
  category: string | null;
  status: string;
  spendCap: number;
  amountUsed: number;
  expiry: number | null;
  expired: boolean;
  sessionKey: string;
  guardRouter: string;
  jobId: string | null;
  jobTx: string | null;
  sessionTx: string | null;
  revokedTx: string | null;
  sessionPublicKey: string | null;
  createdAt: string | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "border-accent/40 bg-accent-faint text-accent" },
  revoked: { label: "Revoked", cls: "border-border bg-surface-raised text-muted" },
  expired: { label: "Expired", cls: "border-border bg-surface-raised text-faint" },
};

function shortHash(h: string | null): string {
  return h ? h.slice(0, 10) + "…" + h.slice(-6) : "—";
}
function bscscanTx(h: string | null): string {
  return h ? `https://testnet.bscscan.com/tx/${h}` : "https://testnet.bscscan.com";
}

function spendPct(used: number, cap: number): number {
  if (!cap) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

export function MyAgentsPage() {
  const router = useRouter();
  const [addr, setAddr] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hires, setHires] = useState<Hire[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  // live countdown tick
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 30000); return () => clearInterval(t); }, []);

  async function load(wallet: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/hires?wallet=${wallet}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setHires(j.hires ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    setConnecting(true); setConnectErr(null);
    try {
      const w = await connectWallet();
      if (w) { setAddr(w.address); setNeedsConnect(false); load(w.address); }
    } catch (e) {
      setConnectErr((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    // auto-detect an already-connected wallet (eth_accounts is non-prompting)
    (async () => {
      try {
        const ethereum = (window as any).ethereum;
        if (ethereum) {
          const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
          if (accounts[0]) { setAddr(accounts[0]); load(accounts[0]); return; }
        }
        setNeedsConnect(true);
      } catch {
        setNeedsConnect(true);
      }
    })();
  }, []);

  async function revoke(id: string) {
    if (!addr) return;
    setRevoking(id); setError(null);
    try {
      const r = await fetch(`/api/hires/${id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: addr }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      // optimistic UI update WITHOUT page reload
      setHires((prev) => prev.map((h) => (h.id === id ? { ...h, status: "revoked", revokedTx: j.tx } : h)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          <button onClick={() => router.push("/")} className="text-xs text-muted hover:text-foreground">← Back</button>
          <Link href="/" className="font-mono text-sm font-semibold text-foreground">The Sidekick</Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-faint">My Agents</span>
          <div className="ml-auto flex items-center gap-3">
            {addr && <span className="font-mono text-[11px] text-faint">{shortAddr(addr)}</span>}
            <button
              onClick={handleConnect}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-strong"
            >
              {addr ? shortAddr(addr) : connecting ? "Connecting…" : "Connect Wallet"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-faint">Your hires</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">My Agents</h1>
          </div>
          <Link href="/" className="text-xs text-muted hover:text-foreground">Browse agents →</Link>
        </div>

        {connectErr && <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-200">{connectErr}</div>}
        {error && <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-200">{error}</div>}

        {needsConnect && !addr ? (
          <div className="mt-16 rounded-lg border border-dashed border-border bg-surface p-12 text-center">
            <p className="text-sm text-foreground">Connect your wallet to see your hired agents.</p>
            <p className="mt-1 text-xs text-faint">This page is personal — it shows only the delegations you own.</p>
            <button
              onClick={handleConnect}
              className="mt-6 rounded border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-strong"
            >
              {connecting ? "Connecting…" : "Connect Wallet"}
            </button>
          </div>
        ) : loading ? (
          <div className="mt-6 grid gap-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-surface" />)}</div>
        ) : hires.length === 0 ? (
          <div className="mt-16 rounded-lg border border-dashed border-border bg-surface p-12 text-center">
            <p className="text-sm text-foreground">Nothing hired yet</p>
            <p className="mt-1 text-xs text-faint">Browse the marketplace and hire your first agent.</p>
            <Link href="/" className="mt-6 inline-block rounded border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-strong">Back to Home</Link>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="text-[11px] text-faint">{hires.length} hire(s) · {hires.filter((h) => h.status === "active").length} active</div>
            {hires.map((h) => {
              const pct = spendPct(Number(h.amountUsed), Number(h.spendCap));
              const daysLeft = h.expiry ? Math.max(0, Math.ceil((h.expiry * 1000 - nowMs) / 86400000)) : null;
              const st = STATUS_LABEL[h.status] ?? STATUS_LABEL.active;
              const actualStatus = h.expired && h.status === "active" ? "expired" : h.status;
              const stOk = STATUS_LABEL[actualStatus] ?? st;
              return (
                <div key={h.id} className="rounded-lg border border-border bg-surface p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold">{h.agentName}</h2>
                        <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${stOk.cls}`}>{stOk.label}</span>
                      </div>
                      {h.category && <p className="mt-0.5 font-mono text-[11px] text-faint">{h.category}</p>}
                    </div>
                    <Link href={`/agents/${h.agentWallet}`} className="shrink-0 text-xs text-muted hover:text-foreground">View agent →</Link>
                  </div>

                  {/* spend bar */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-faint">Spend</span>
                      <span className="font-mono tabular text-muted">{Number(h.amountUsed).toFixed(4)} / {Number(h.spendCap).toFixed(4)} tBNB <span className="text-faint">({pct}%)</span></span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-surface-raised">
                      <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : "bg-accent"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-faint">
                    <span>Expiry: {daysLeft !== null ? `${daysLeft}d ${actualStatus === "expired" ? "(expired)" : ""}` : "—"}</span>
                    {h.jobId && <a href={bscscanTx(h.jobTx)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">job #{h.jobId}</a>}
                    {h.jobTx && <a href={bscscanTx(h.jobTx)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">{shortHash(h.jobTx)}</a>}
                    {h.revokedTx && <span className="text-muted">revoked {shortHash(h.revokedTx)}</span>}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="font-mono text-[10px] text-faint">{h.id}</span>
                    {h.status === "active" && (
                      <button
                        onClick={() => revoke(h.id)}
                        disabled={revoking === h.id}
                        className="rounded border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        {revoking === h.id ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
