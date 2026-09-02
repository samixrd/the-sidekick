"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentDetail } from "./data";
import { connectWallet, readHireStream, shortAddr, switchToBscTestnet } from "./wallet";
import {
  fmtUsd, fmtAgoMin, eventAction, shortToken, shortHash,
  tokenScopeList, bscscanTxUrl, bscscanAddressUrl,
} from "./data";
import { Sparkline } from "./sparkline";

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-surface p-5 ${className}`}>
      <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

function NullNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] italic text-faint">{children}</p>;
}

function StatCell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-faint">{label}</div>
      <div className="mt-1 font-mono tabular text-lg text-foreground">{value}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

export function AgentDetailPage({ wallet }: { wallet: string }) {
  const router = useRouter();
  const [data, setData] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hireOpen, setHireOpen] = useState(false);
  const [connectedAddr, setConnectedAddr] = useState<string | null>(null);
  const [connectedChainId, setConnectedChainId] = useState<number | null>(null);
  const [customize, setCustomize] = useState(false);
  // hire flow state
  const [flow, setFlow] = useState<{ running: boolean; steps: Record<string, { label: string; status: "pending" | "active" | "done" | "error"; txHash?: string; jobId?: string }>; error: string | null; result: any | null }>({
    running: false,
    steps: {
      "session-grant": { label: "Session grant", status: "pending" },
      "create-hire": { label: "GuardRouter createHire", status: "pending" },
      "erc8183-job": { label: "ERC-8183 job", status: "pending" },
      "persist": { label: "Persist", status: "pending" },
    },
    error: null,
    result: null,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/agents/${wallet}`);
        const j = await r.json();
        if (!alive) return;
        setData(j);
      } catch (e) {
        if (alive) setError((e as Error).message || "Failed to load agent.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [wallet]);

  const metric = data?.metric ?? null;
  const score = useMemo(() => data?.score ?? null, [data]);

  async function handleConnect() {
    try {
      const w = await connectWallet();
      if (w) { setConnectedAddr(w.address); setConnectedChainId(w.chainId); setCustomize(false); }
    } catch (e) {
      setFlow((f) => ({ ...f, error: (e as Error).message }));
    }
  }

  async function handleSwitchChain() {
    try {
      const cid = await switchToBscTestnet();
      setConnectedChainId(cid);
    } catch (e) {
      setFlow((f) => ({ ...f, error: (e as Error).message }));
    }
  }

  async function requestHire() {
    if (!connectedAddr || !data) return;
    setFlow({ running: true, steps: {
      "session-grant": { label: "Session grant", status: "active" },
      "create-hire": { label: "GuardRouter createHire", status: "pending" },
      "erc8183-job": { label: "ERC-8183 job", status: "pending" },
      "persist": { label: "Persist", status: "pending" },
    }, error: null, result: null });

    try {
      // build the hire payload from the slide-over values (falling back to sensible defaults)
      const existingScope = tokenScopeList(data.hires?.[0]?.token_scope ?? null);
      const tokenScope = existingScope.length
        ? existingScope
        : ["0xae13d989dac2f0debff460ac112a837c89baa7cd", "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd"];
      const body = {
        user: connectedAddr,
        spendCapTbnb: 0.01,
        tokenScope,
        minLiquidity: 1,
        days: 7,
        agentId: data.listing ? `Hermes-${data.listing.category}` : wallet,
        agentName: name,
      };
      const res = await fetch(`/api/agents/${wallet}/hire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Request failed (HTTP ${res.status})`);
      }
      await readHireStream(res, (ev) => {
        const step = String(ev.step ?? "");
        if (step === "done") {
          setFlow((f) => ({ ...f, running: false, result: ev.result ?? null }));
        } else if (step === "error") {
          setFlow((f) => ({ ...f, running: false, error: String(ev.error ?? "Unknown error") }));
        } else {
          setFlow((f) => {
            const status = ev.error ? "error" : "done";
            return { ...f, steps: { ...f.steps, [step]: { ...f.steps[step], status, txHash: (ev.txHash as string) ?? undefined, jobId: (ev.jobId as string) ?? undefined } } };
          });
        }
      });
    } catch (e) {
      setFlow((f) => ({ ...f, running: false, error: (e as Error).message }));
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl animate-pulse px-6 py-16">
        <div className="h-8 w-1/3 rounded bg-surface-raised" />
        <div className="mt-4 h-28 rounded bg-surface-raised" />
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="h-48 rounded bg-surface-raised" /><div className="h-48 rounded bg-surface-raised" /><div className="h-48 rounded bg-surface-raised" />
        </div>
      </div>
    );
  }
  if (error) return <div className="mx-auto max-w-6xl px-6 py-16 text-sm text-muted">{error}</div>;
  if (!data) return <div className="mx-auto max-w-6xl px-6 py-16 text-sm text-muted">Agent not found.</div>;

  const name = `Hermes — ${data.listing?.category ?? "Agent"}`;
  const category = data.listing?.category ?? "—";
  const trustScore = score?.trust_score ?? null;
  const firstTx = score?.first_tx_timestamp ?? null;
  const ageDaysFromFirst = firstTx ? Math.max(0, (Date.now() - Date.parse(firstTx)) / 86400000) : null;
  const peers = metric?.benchmark.peers ?? 0;
  const catAvg = metric?.benchmark.categoryAvg ?? null;
  const ownReturn = metric?.benchmark.ownReturn ?? null;

  const pnl = metric?.pnl ?? null;
  const skill = metric?.skillLuck ?? null;
  const risk = metric?.risk ?? null;
  const recent12h = metric?.recent12h ?? null;
  const ageActivity = score?.trust_age_activity ?? null;
  const reputation = score?.trust_reputation ?? null;
  const bond = score?.trust_bond ?? null;
  const verified = score?.trust_verified ?? false;

  const trend = data.trend ?? [];
  const events = data.events ?? [];
  const hires = data.hires ?? [];
  const tokenScope = tokenScopeList(data.hires?.[0]?.token_scope ?? null);
  const expiry = data.hires?.[0]?.expiry ?? null;
  const expiryDate = expiry ? new Date(expiry * 1000).toISOString().slice(0, 10) : null;

  const actionTags = recent12h?.byType ?? {};

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* back bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <button onClick={() => router.push("/")} className="text-xs text-muted hover:text-foreground">← Back</button>
          <span className="font-mono text-xs text-faint">{shortHash(wallet)}</span>
          <div className="ml-auto flex items-center gap-3">
            <a href={bscscanAddressUrl(wallet)} target="_blank" rel="noreferrer" className="text-xs text-faint hover:text-foreground">BscScan</a>
            <button
              onClick={() => (connectedAddr ? setHireOpen(true) : handleConnect())}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-strong"
            >
              {connectedAddr ? "Hire" : "Connect Wallet"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        {/* Title */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-faint">{category}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">{category}</span>
              {verified ? (
                <span className="rounded border border-accent/40 bg-accent-faint px-1.5 py-0.5 font-mono text-[10px] uppercase text-accent">Verified</span>
              ) : (
                <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">New</span>
              )}
              {metric?.txCount !== undefined && <span className="font-mono text-[11px] text-faint">{metric.txCount} tx</span>}
            </div>
          </div>
          <button onClick={() => setHireOpen(true)} className="rounded border border-accent bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong">Hire</button>
        </div>

        {/* Stats block */}
        <div className="mt-8 grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-4">
          <StatCell label="Age" value={ageDaysFromFirst !== null ? `${ageDaysFromFirst.toFixed(1)}d` : "—"} sub="since first indexed tx" />
          <StatCell label="Total tx" value={metric?.txCount ?? 0} sub="all events" />
          <StatCell label="Category benchmark" value={peers === 0 ? "—" : fmtUsd(ownReturn)} sub={peers === 0 ? "only agent in this category — nothing to benchmark yet" : `vs ${peers} peer(s): ${fmtUsd(catAvg)}`} />
          <StatCell label="Freshness" value={fmtAgoMin(metric?.freshness.lastActionAgoMin)} sub="indexer updates every 2h" />
        </div>

        {/* P&L headline + skill + risk */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Realized P&L" className="lg:col-span-2">
            {pnl?.realizedLifetime === null && pnl?.markToMarket === 0 ? (
              <>
                <p className="text-2xl font-semibold text-muted">Insufficient data</p>
                <NullNote>Only a single tx — no realized P&L can be computed yet.</NullNote>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-faint">7-day realized</div>
                    <div className="font-mono tabular text-xl text-foreground">{fmtUsd(pnl?.realized7d)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-faint">Lifetime realized</div>
                    <div className="font-mono tabular text-xl text-foreground">{fmtUsd(pnl?.realizedLifetime)}</div>
                  </div>
                </div>
                {pnl?.note && <p className="mt-3 text-[11px] text-faint">{pnl.note}</p>}
              </>
            )}
            <div className="mt-4 border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.16em] text-faint">Skill vs Luck</span>
                <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-foreground">{skill?.label ?? "n/a"}</span>
              </div>
              {skill?.note && <p className="mt-2 text-[11px] text-faint">{skill.note}</p>}
            </div>
          </Panel>

          <Panel title="Risk">
            <div className="space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-faint">Win rate</div>
                <div className="font-mono tabular text-xl text-foreground">{risk?.winRate === null || risk === null ? "—" : `${(risk.winRate * 100).toFixed(0)}%`}</div>
                {risk?.wins !== undefined && <div className="text-[10px] text-faint">{risk.wins} of {risk.trades} closed trades</div>}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-faint">Max drawdown</div>
                <div className="font-mono tabular text-xl text-foreground">{risk?.maxDrawdownPct === null || risk === null ? "—" : `${risk.maxDrawdownPct}%`}</div>
              </div>
              {risk?.note && <p className="text-[11px] italic text-faint">{risk.note}</p>}
            </div>
          </Panel>
        </div>

        {/* Trust Score panel + sparkline */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Trust Score" className="lg:col-span-2">
            <div className="flex items-baseline gap-3">
              <span className="font-mono tabular text-4xl text-accent">{trustScore !== null ? Math.round(trustScore) : "—"}</span>
              <span className="text-xs text-faint">/ 100</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div><div className="text-[10px] uppercase tracking-[0.16em] text-faint">Age / activity</div><div className="font-mono tabular text-lg text-foreground">{ageActivity ?? "—"}</div></div>
              <div><div className="text-[10px] uppercase tracking-[0.16em] text-faint">Reputation</div><div className="font-mono tabular text-lg text-foreground">{reputation ?? "—"}</div></div>
              <div><div className="text-[10px] uppercase tracking-[0.16em] text-faint">Stake bond</div><div className="font-mono tabular text-lg text-foreground">{bond ?? "—"}</div></div>
            </div>
            <div className="mt-4">
              <Sparkline points={trend} />
              <div className="mt-1 text-[10px] text-faint">Trend from {trend.length} snapshot(s)</div>
            </div>
          </Panel>

          {/* 12h recent activity */}
          <Panel title="Last 12 hours">
            {recent12h && recent12h.txCount > 0 ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(actionTags).map(([k, v]) => (
                  <span key={k} className="rounded border border-border bg-surface-raised px-2 py-1 font-mono text-[11px] text-foreground">{k} <span className="tabular text-faint">{v}</span></span>
                ))}
                <div className="w-full text-[11px] text-faint">Type-tagged activity in the window.</div>
              </div>
            ) : (
              <p className="text-[11px] italic text-faint">No activity in the last 12 hours.</p>
            )}
          </Panel>
        </div>

        {/* Full activity feed */}
        <Panel title="Activity feed" className="mt-4">
          {events.length === 0 ? (
            <p className="text-[11px] italic text-faint">No indexed transactions yet.</p>
          ) : (
            <ul className="divide-y divide-border text-xs">
              {events.map((e) => {
                const hasFlag = score?.risk_label_count && score.risk_label_count > 0;
                return (
                  <li key={e.tx_hash} className="flex items-center gap-3 py-2">
                    <span className="w-14 shrink-0 font-mono text-[10px] text-faint">{String(e.block_timestamp ?? "").slice(11, 19)}</span>
                    <span className="w-14 shrink-0 rounded border border-border bg-surface-raised px-1 py-0.5 text-center font-mono text-[10px] text-foreground">{eventAction(e)}</span>
                    <span className="w-40 truncate font-mono text-[10px] text-faint">{shortToken(e.token_in)} → {shortToken(e.token_out)}</span>
                    <span className="tabular font-mono text-[10px] text-muted">{e.amount_in !== null ? Number(e.amount_in).toLocaleString() : "—"}</span>
                    <a href={bscscanTxUrl(e.tx_hash)} target="_blank" rel="noreferrer" className="ml-auto font-mono text-[10px] text-faint underline-offset-2 hover:text-foreground hover:underline">{shortHash(e.tx_hash)}</a>
                    {hasFlag && (
                      <span className="rounded border border-accent/40 bg-accent-faint px-1 py-0.5 font-mono text-[9px] text-accent">flagged</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-faint">{score?.risk_label_count === 0 ? "No risk flags on any indexed tx." : `${score?.risk_label_count ?? 0} risk flag(s).`}</p>
        </Panel>

        {/* ERC-8183 job history */}
        <Panel title="Hire / ERC-8183 job history" className="mt-4">
          {hires.length === 0 ? (
            <p className="text-[11px] italic text-faint">No hire records yet — this agent has not been hired.</p>
          ) : (
            <ul className="divide-y divide-border text-xs">
              {hires.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] uppercase text-foreground">{h.status}</span>
                  <span className="font-mono text-[10px] text-faint">{h.erc8183_job_id ? `job #${h.erc8183_job_id}` : "no job"}</span>
                  <span className="font-mono text-[10px] text-faint">cap {fmtUsd(h.spend_cap)}</span>
                  <span className="font-mono text-[10px] text-faint">used {fmtUsd(h.amount_used)}</span>
                  <a href={bscscanTxUrl(h.erc8183_tx_hash)} target="_blank" rel="noreferrer" className="ml-auto font-mono text-[10px] text-faint underline-offset-2 hover:text-foreground hover:underline">{shortHash(h.erc8183_tx_hash)}</a>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="mt-8 text-center text-[11px] text-faint">Behavior is published on-chain and scored from indexed data — no self-reported figures.</div>
      </main>

      {/* Hire slide-over */}
      {hireOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setHireOpen(false)} />
          <div className="relative ml-auto flex h-full w-full max-w-md flex-col border-l border-border bg-surface p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Hire {name}</h2>
              <button onClick={() => setHireOpen(false)} className="text-faint hover:text-foreground">✕</button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div><span className="text-faint">Spend cap</span><div className="font-mono tabular text-lg">{fmtUsd(0.01)}</div></div>
              <div><span className="text-faint">Token scope</span><div className="mt-1 flex flex-wrap gap-1.5">{tokenScope.length ? tokenScope.map((t) => <span key={t} className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">{shortToken(t)}</span>) : <span className="text-[11px] italic text-faint">WBNB + USDT (default)</span>}</div></div>
              <div><span className="text-faint">Min liquidity</span><div className="font-mono tabular text-lg">{data.hires?.[0]?.min_liquidity ?? 1}</div></div>
              <div><span className="text-faint">Expiry</span><div className="font-mono tabular text-lg">{expiryDate ?? "7 days"}</div></div>
            </div>

            {customize && (
              <div className="mt-4 rounded border border-border bg-background/40 p-3 space-y-2">
                <p className="text-[11px] text-faint">Customize the spend cap, token scope, min-liquidity threshold, and expiry here.</p>
                {(["Spend cap", "Token scope", "Min liquidity", "Expiry"] as const).map((f) => (
                  <input key={f} placeholder={f} className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-foreground placeholder:text-faint" />
                ))}
              </div>
            )}

            {/* Connected wallet chip */}
            {connectedAddr && (
              <div className="mt-4 rounded border border-border bg-background/40 px-3 py-2 text-[11px]">
                <span className="text-faint">Delegating from </span>
                <span className="font-mono text-foreground">{shortAddr(connectedAddr)}</span>
                <span className="ml-2 text-faint">· chain {connectedChainId}</span>
              </div>
            )}

            {/* Wrong-network warning (BNB testnet = chain 97) */}
            {connectedAddr && connectedChainId !== null && connectedChainId !== 97 && (
              <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-200">
                Your wallet is on <span className="font-mono">chain {connectedChainId}</span>, but this network
                runs on <span className="font-mono">BNB Smart Chain Testnet (97)</span>. Transactions will fail
                until you switch.
                <button
                  onClick={handleSwitchChain}
                  className="mt-2 w-full rounded border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-strong"
                >
                  Switch to BNB Testnet
                </button>
              </div>
            )}

            {/* Per-step progress */}
            {flow.running || flow.result || flow.error ? (
              <div className="mt-5 space-y-2.5">
                {Object.entries(flow.steps).map(([key, s]) => (
                  <div key={key} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 inline-block h-2 w-2 rounded-full ${s.status === "done" ? "bg-accent" : s.status === "active" ? "animate-pulse bg-accent" : s.status === "error" ? "bg-red-500" : "bg-faint/30"}`} />
                    <div className="min-w-0">
                      <div className="text-foreground">{s.label}</div>
                      {s.txHash && (
                        <a href={bscscanTxUrl(s.txHash)} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-faint underline-offset-2 hover:text-foreground hover:underline">{shortHash(s.txHash)}</a>
                      )}
                      {key === "erc8183-job" && s.jobId && <div className="font-mono text-[10px] text-faint">job #{s.jobId}</div>}
                    </div>
                  </div>
                ))}
                {flow.error && (
                  <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-200">
                    Failed: {flow.error}
                  </div>
                )}
                {flow.running && <div className="text-[11px] italic text-faint">Waiting for the next on-chain step…</div>}
              </div>
            ) : (
              <div className="mt-auto space-y-3 pt-6">
                {!connectedAddr ? (
                  <button onClick={handleConnect} className="w-full rounded border border-accent bg-accent py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-strong">Connect Wallet</button>
                ) : (
                  <>
                    <button onClick={() => setCustomize((v) => !v)} className="w-full rounded border border-border py-2 text-sm text-muted hover:bg-surface-raised">{customize ? "Hide customize" : "Customize"}</button>
                    <button onClick={requestHire} className="w-full rounded border border-accent bg-accent py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-strong">Confirm hire</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
