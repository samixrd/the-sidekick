-- ============================================================
-- 0003_agent_snapshots.sql
-- Append-only scoring snapshot, one row per wallet per indexer run.
-- INSERT-only by design: NO UPDATE, NO DELETE — enforced by trigger,
-- so cross-run trend history is preserved and verifiable.
-- ============================================================

create table if not exists public.agent_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  wallet               text not null,
  snapshot_timestamp   timestamptz not null default now(),
  age_days             numeric,          -- wallet age at snapshot time (from first observed event)
  tx_count             integer not null default 0,
  -- computed behavior flags at this point in time
  flag_count           integer not null default 0,
  behavior_consistent  boolean not null default false,
  behavior_detail      text,
  swap_count           integer not null default 0,
  lend_count           integer not null default 0
);

alter table public.agent_snapshots enable row level security;

create policy "snapshots readable by everyone"
  on public.agent_snapshots for select
  using (true);

create policy "service_role inserts snapshots"
  on public.agent_snapshots for insert
  to service_role
  with check (true);

create index if not exists agent_snapshots_wallet_ts_idx
  on public.agent_snapshots (wallet, snapshot_timestamp desc);

-- ────────────────────────────────────────────────────────────
-- INSERT-ONLY ENFORCEMENT
-- Block UPDATE and DELETE at the database level. RLS alone is not
-- enough (service_role can still mutate) — this trigger makes the
-- immutability absolute.
-- ────────────────────────────────────────────────────────────
create or replace function public.prevent_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'agent_snapshots is INSERT-only: updates and deletes are forbidden';
end;
$$;

drop trigger if exists agent_snapshots_no_update on public.agent_snapshots;
create trigger agent_snapshots_no_update
  before update or delete on public.agent_snapshots
  for each row execute function public.prevent_snapshot_mutation();

revoke update, delete on public.agent_snapshots from anon, authenticated, service_role;

-- grants to Supabase-managed roles. Note: we grant all then REVOKE update/delete
-- above so the INSERT-only guarantee holds even for service_role.
grant insert, select on public.agent_snapshots to service_role;
grant select on public.agent_snapshots to anon, authenticated;
