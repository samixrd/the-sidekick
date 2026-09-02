-- ============================================================
-- 0001_agent_wallets.sql
-- Tracked wallet addresses the indexer monitors. Configurable,
-- starts empty. The indexer reads this list each run.
-- ============================================================

create table if not exists public.agent_wallets (
  id          uuid primary key default gen_random_uuid(),
  wallet      text not null unique,
  label       text,
  -- 0x full address, lowercased for dedupe
  constraint agent_wallets_wallet_format check (wallet ~* '^0x[a-f0-9]{40}$'),
  created_at  timestamptz not null default now()
);

-- Anyone can read the list (it's public registry data); only service_role writes.
alter table public.agent_wallets enable row level security;

create policy "agent_wallets are viewable by everyone"
  on public.agent_wallets for select
  using (true);

create policy "service_role manages agent_wallets"
  on public.agent_wallets for all
  to service_role
  using (true)
  with check (true);

-- helpful index on wallet lookups
create index if not exists agent_wallets_wallet_idx on public.agent_wallets (wallet);

-- grants to Supabase-managed roles (service_role writes, anon/auth read)
grant usage on schema public to anon, authenticated, service_role;
grant all on table public.agent_wallets to service_role;
grant select on table public.agent_wallets to anon, authenticated;
