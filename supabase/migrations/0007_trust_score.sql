-- ============================================================
-- 0007_trust_score.sql
-- Adds Trust Score + Risk Label columns to agent_snapshots (INSERT-only trend).
-- ============================================================

alter table public.agent_snapshots add column if not exists trust_score numeric;        -- composite 0..100
alter table public.agent_snapshots add column if not exists trust_age_activity numeric;  -- 40% sub-score
alter table public.agent_snapshots add column if not exists trust_reputation numeric;    -- 30% sub-score
alter table public.agent_snapshots add column if not exists trust_bond numeric;          -- 30% sub-score
alter table public.agent_snapshots add column if not exists trust_risk_penalty numeric;  -- negative modifier
alter table public.agent_snapshots add column if not exists trust_verified boolean default false; -- computed badge
alter table public.agent_snapshots add column if not exists risk_label_count integer default 0;    -- per-wallet rolling flag count
alter table public.agent_snapshots add column if not exists risk_labels text default '[]';         -- json list of RiskLabel
alter table public.agent_snapshots add column if not exists data_confidence text default 'low';
alter table public.agent_snapshots add column if not exists first_tx_timestamp text;               -- for verified badge
