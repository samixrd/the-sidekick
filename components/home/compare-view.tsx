"use client";

import Link from "next/link";
import type { AgentCardData } from "./data";

/** A single comparison row value — carries the honest "insufficient data" note. */
type Cell = { value: string; tone?: "accent" | "muted" | "faint"; note?: string };

function pctCell(v: number | null, note?: string): Cell {
  if (v === null || Number.isNaN(v)) return { value: "Insufficient data", tone: "faint", note };
  return { value: `${(v * 100).toFixed(0)}%` };
}
function usdCell(v: number | null, note?: string): Cell {
  if (v === null || Number.isNaN(v)) return { value: "Insufficient data", tone: "faint", note };
  return { value: `$${v.toFixed(3)}` };
}
function numCell(v: number | null, suffix: string, note?: string): Cell {
  if (v === null || Number.isNaN(v)) return { value: "Insufficient data", tone: "faint", note };
  return { value: `${v.toFixed(1)}${suffix}` };
}

export function CompareView({ agents, onBack }: { agents: AgentCardData[]; onBack: () => void }) {
  const rows: { label: string; cell: (a: AgentCardData) => Cell; sub?: boolean }[] = [
    { label: "Category", cell: (a) => ({ value: a.category }) },
    { label: "Trust Score", cell: (a) => (a.trustScore === null ? { value: "Insufficient data", tone: "faint" } : { value: `${Math.round(a.trustScore)}`, tone: a.trustScore >= 60 ? "accent" : "muted" }) },
    { label: "Verified status", cell: (a) => ({ value: a.verified ? "Verified" : a.status === "limited" ? "Limited history" : "New", tone: a.verified ? "accent" : "muted" }) },
    { label: "Win rate", cell: (a) => pctCell(a.winRate, a.riskNote) },
    { label: "Realized P&L (7d)", cell: (a) => usdCell(a.realized7d, a.pnlNote) },
    { label: "Realized P&L (lifetime)", cell: (a) => usdCell(a.realizedLifetime, a.pnlNote) },
    { label: "Max drawdown", cell: (a) => numCell(a.maxDrawdownPct, "%", a.riskNote) },
    { label: "Skill vs. luck", cell: (a) => ({ value: a.skillLucky, tone: a.skillLucky === "Skill-driven" ? "accent" : "muted" }) },
    { label: "Recent 12h (tx)", cell: (a) => ({ value: `${a.recent12h.txCount} tx` }) },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8">
      <div className="w-full max-w-4xl rounded-xl border border-border bg-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Compare agents</h2>
          <button onClick={onBack} className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground">Close</button>
        </div>
        <p className="mt-1 text-xs text-faint">Live data from /api/metrics + /api/scores — not a cached snapshot.</p>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-44 border-b border-border pb-2 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Metric</th>
                {agents.map((a) => (
                  <th key={a.tokenId} className="border-b border-border px-3 pb-2 text-left align-top">
                    <Link href={`/agents/${a.wallet}`} className="font-semibold text-foreground hover:text-accent">{a.name}</Link>
                    <div className="mt-0.5 font-mono text-[10px] text-faint">#{a.tokenId}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="border-b border-border/60 py-2.5 pr-4 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">{r.label}</td>
                  {agents.map((a) => {
                    const c = r.cell(a);
                    return (
                      <td key={a.tokenId} className="border-b border-border/60 px-3 py-2.5">
                        <span className={`tabular ${c.tone === "accent" ? "font-semibold text-accent" : c.tone === "muted" ? "text-foreground" : "text-faint"}`}>{c.value}</span>
                        {c.note && r.label.startsWith("Win rate") && <div className="mt-1 max-w-[16rem] text-[10px] leading-snug text-faint">{c.note}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <span className="text-[11px] text-faint">Select 2–3 agents to compare. Grid = rich data, Yield = limited history.</span>
          <button onClick={onBack} className="rounded border border-accent bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong">Done</button>
        </div>
      </div>
    </div>
  );
}
