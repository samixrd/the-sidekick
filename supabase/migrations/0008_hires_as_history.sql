-- ============================================================
-- 0008_hires_as_history.sql
-- A marketplace agent may be HIRED MULTIPLE TIMES over time. The prior
-- `unique (agent_id)` constraint (Step 6) limited one delegation per agent,
-- which broke re-hiring. Each hire is now an independent history row
-- (id is the PK; agent_id is just a filter), so the CREATE-delegation flow
-- can insert a fresh record per hire.
-- ============================================================

alter table public.delegations drop constraint if exists delegations_agent_id_key;
