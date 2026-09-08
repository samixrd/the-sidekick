-- 0011: autonomy infrastructure state — makes the strategy loop + indexer
-- fully stateless-per-run so they can execute on ephemeral CI runners
-- (GitHub Actions cron) without losing continuity. INSERT/UPDATE rows only;
-- strategy audit trail stays in strategy_runs (0009, INSERT-only).

-- Cycle state (grid anchor, yield market, cooldowns) — replaces the local
-- .strategy-state/*.json files which do not survive across runner instances.
CREATE TABLE IF NOT EXISTS strategy_state (
  key         text PRIMARY KEY,          -- e.g. 'grid.json'
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON strategy_state TO service_role;

-- Indexer high-water marks: the scan resumes from last_block+1 instead of
-- re-walking a fixed rolling window every run. Each scheduled run therefore
-- scans only the blocks mined since the last one (seconds, not minutes),
-- while the 40k-window floor bounds a cold/backfilled start.
CREATE TABLE IF NOT EXISTS indexer_checkpoints (
  wallet      text PRIMARY KEY,          -- agent wallet, or '_guard' / '_global'
  last_block  bigint NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON indexer_checkpoints TO service_role;
