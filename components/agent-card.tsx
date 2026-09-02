import type { MarketplaceAgent } from "@/lib/marketplace/listings";
import { shortAddress } from "@/lib/chain";

function formatReputation(value: bigint, decimals: number): string {
  // value is fixed-point int128; decimals tells where the point sits
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const s = abs.toString().padStart(decimals + 1, "0");
  const frac = decimals > 0 ? s.slice(s.length - decimals) : "";
  const whole = decimals > 0 ? s.slice(0, s.length - decimals) : s;
  return `${sign}${whole}${decimals > 0 ? "." + frac : ""}`;
}

export function AgentCard({ agent }: { agent: MarketplaceAgent }) {
  const hasIndexed = !!agent.indexed;
  const trustScore = agent.indexed
    ? Math.max(0, Math.min(100, 100 - agent.indexed.snapshotFlags * 15))
    : null;
  // synthetic indexed-only agents (no ERC-8004 identity) have agentId 0
  const hasIdentity = agent.agentId !== 0n;
  const badge = hasIdentity ? `#${agent.agentId.toString()}` : "#behaviour";

  return (
    <article className="rounded border border-border bg-surface transition-colors hover:border-border-strong">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">{agent.name}</h2>
          <span className="font-mono text-xs tabular text-faint">{badge}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{agent.description || "No description"}</p>
      </div>

      <div className="space-y-0 px-6 py-4">
        <Row label="owner" value={shortAddress(agent.owner)} mono />
        <Row label="agent wallet" value={shortAddress(agent.agentWallet)} mono />
        {hasIndexed ? (
          <>
            <Row label="trust score" value={trustScore !== null ? `${trustScore}` : "—"} accent mono />
            <Row label="tx count" value={`${agent.indexed!.snapshotTxCount}`} mono />
            <Row label="swaps / lends" value={`${agent.indexed!.snapshotSwapCount} / ${agent.indexed!.snapshotLendCount}`} mono />
          </>
        ) : (
          <Row label="behaviour" value="no indexed data" />
        )}
        {hasIdentity && (
          <Row
            label="reputation"
            value={`${agent.reputationCount} feedback · ${formatReputation(agent.reputationValue, agent.reputationDecimals)}`}
            accent
          />
        )}
      </div>

      {(agent.services.length > 0 || agent.supportedTrust.length > 0) && (
        <div className="flex flex-wrap gap-2 border-t border-border px-6 py-3">
          {agent.services.slice(0, 3).map((s) => (
            <Tag key={s.name}>{s.name}</Tag>
          ))}
          {agent.supportedTrust.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}
    </article>
  );
}

function Row({
  label,
  value,
  mono = false,
  accent = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-xs uppercase tracking-[0.18em] text-faint">{label}</span>
      <span className={`text-sm ${mono ? "font-mono tabular" : ""} ${accent ? "text-accent" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-muted">
      {children}
    </span>
  );
}
