-- 0009: strategy_runs — INSERT-only audit log of the scheduled strategy loop.
-- One row per agent decision per cycle (acted / skipped / error), plus the tx
-- hash when the loop executed a real transaction. Powers honest Active/Idle
-- reporting alongside indexed on-chain activity.
CREATE TABLE IF NOT EXISTS strategy_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_wallet  text NOT NULL,
  category      text NOT NULL,
  action        text NOT NULL,          -- buy | sell | hold | recenter | establish | supply | move | monitor | protect | anchor | compare | cycle
  status        text NOT NULL,          -- executed | skipped | error
  reason        text NOT NULL,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  tx_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategy_runs_wallet_created_idx
  ON strategy_runs (agent_wallet, created_at DESC);

-- INSERT-only: no UPDATE/DELETE on the audit trail.
CREATE OR REPLACE FUNCTION strategy_runs_no_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'strategy_runs is INSERT-only (audit trail)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS strategy_runs_insert_only ON strategy_runs;
CREATE TRIGGER strategy_runs_insert_only
  BEFORE UPDATE OR DELETE ON strategy_runs
  FOR EACH ROW EXECUTE FUNCTION strategy_runs_no_update();

-- 0009b: Supabase role grants (service role writes from the loop; anon/authed
-- read via the API for honest status display). Applied out-of-band because the
-- initial run created the table without Supabase's default grant wiring.
GRANT SELECT, INSERT ON strategy_runs TO service_role;
GRANT SELECT ON strategy_runs TO anon, authenticated;
