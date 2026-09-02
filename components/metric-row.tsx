import { cn } from "@/lib/cn";

/**
 * MetricRow — shared presentational component for numeric data.
 * Uses tabular numerals + the accent token for the value. Reused across
 * agent cards, scoreboards, and the marketplace listing.
 */
export function MetricRow({
  label,
  value,
  accent = false,
  className,
}: {
  label: string;
  value: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 border-b border-border py-2",
        className,
      )}
    >
      <span className="text-xs uppercase tracking-[0.18em] text-faint">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-sm tabular",
          accent ? "text-accent" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
