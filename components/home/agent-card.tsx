"use client";

import Link from "next/link";
import { shortAddress } from "@/lib/chain";
import type { AgentCardData } from "./data";

function TrustBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="rounded border border-border bg-surface px-2 py-0.5 font-mono text-xs text-faint">—</span>;
  }
  const pct = Math.max(0, Math.min(100, score));
  const tone = pct >= 60 ? "text-accent" : pct >= 35 ? "text-foreground" : "text-muted";
  return <span className={`font-mono tabular text-lg ${tone}`}>{Math.round(pct)}</span>;
}

function StatusTag({ status }: { status: AgentCardData["status"] }) {
  const map = {
    verified: { label: "Verified", cls: "border-accent/40 bg-accent-faint text-accent" },
    new: { label: "New", cls: "border-border bg-surface-raised text-muted" },
    limited: { label: "Limited history", cls: "border-border bg-surface-raised text-faint" },
  } as const;
  const t = map[status];
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${t.cls}`}>
      {t.label}
    </span>
  );
}

export function AgentCard({ card, compareSelected = false, onCompareToggle }: { card: AgentCardData; compareSelected?: boolean; onCompareToggle?: (wallet: string) => void }) {
  const live = card.lastActionAgoMin !== null && card.lastActionAgoMin <= 120;
  const liveLabel = live ? `${card.lastActionAgoMin} min ago` : card.lastActionAgoMin !== null ? `${card.lastActionAgoMin} min ago` : "No activity";
  const strategyOk = card.strategyConsistent === true;

  return (
    <div className="animate-fade-up rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/agents/${card.wallet}`} className="block">
            <h3 className="truncate text-sm font-semibold text-foreground hover:text-accent">{card.name}</h3>
            <p className="mt-0.5 font-mono text-[11px] text-faint">{shortAddress(card.wallet)}</p>
          </Link>
        </div>
        <TrustBadge score={card.trustScore} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">{card.category}</span>
        <StatusTag status={card.status} />
        {strategyOk && <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">✓ consistent</span>}
      </div>

      <p className="mt-3 min-h-[2.5rem] text-xs leading-relaxed text-muted">
        <span className="clamp-2">{card.description}</span>
      </p>

      <div className="mt-4 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-accent" : "bg-faint/40"}`} />
          <span className="tabular">{card.txCount} tx</span>
          <span className="text-faint/60">·</span>
          <span>{liveLabel}</span>
        </span>
        <Link href={`/agents/${card.wallet}`} className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-strong">
          Hire
        </Link>
      </div>

      {onCompareToggle && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCompareToggle(card.wallet); }}
          className={`mt-3 flex w-full items-center gap-2 rounded border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${compareSelected ? "border-accent bg-accent-faint text-accent" : "border-border bg-background text-muted hover:border-border-strong"}`}
          aria-pressed={compareSelected}
        >
          <span className={`inline-block h-3 w-3 rounded border ${compareSelected ? "border-accent bg-accent" : "border-border"}`} />
          {compareSelected ? "Selected for compare" : "Add to compare"}
        </button>
      )}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-surface p-5">
      <div className="h-4 w-1/2 rounded bg-surface-raised" />
      <div className="mt-2 h-3 w-1/3 rounded bg-surface-raised" />
      <div className="mt-3 h-2.5 w-full rounded bg-surface-raised" />
      <div className="mt-3 h-2.5 w-3/4 rounded bg-surface-raised" />
      <div className="mt-5 flex justify-between">
        <div className="h-3 w-24 rounded bg-surface-raised" />
        <div className="h-7 w-14 rounded bg-surface-raised" />
      </div>
    </div>
  );
}
