"use client";

/** Minimal SVG trust-score sparkline from agent_snapshots trend. */
export function Sparkline({ points }: { points: { at: string; trust: number }[] }) {
  if (!points || points.length < 2) {
    return <div className="flex h-12 items-center text-[11px] text-faint">Trend needs ≥2 snapshots</div>;
  }
  const W = 240, H = 44, PAD = 2;
  const vals = points.map((p) => p.trust);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 100);
  const range = Math.max(1, max - min);
  const path = points
    .map((p, i) => {
      const x = points.length === 1 ? 0 : (i / (points.length - 1)) * W;
      const y = H - PAD - ((p.trust - min) / range) * (H - PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-12 w-full" aria-label="Trust score trend">
      <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle
        cx={W}
        cy={H - PAD - ((points[points.length - 1].trust - min) / range) * (H - PAD * 2)}
        r="2.5"
        fill="var(--color-accent)"
      />
    </svg>
  );
}
