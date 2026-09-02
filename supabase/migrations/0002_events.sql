-- ============================================================
-- 0002_events.sql
-- Decoded on-chain activity, one row per swap / lend action.
-- Deduplicated on (tx_hash, wallet, event_type, token_in) so
-- re-running the indexer never double-inserts.
-- ============================================================

create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  wallet          text not null,
  -- 'pancakeswap_swap' | 'venus_supply' | 'venus_borrow' | 'venus_repay' | 'venus_withdraw'
  event_type      text not null,
  -- token addresses (0x…) for the two legs of a swap / the underlying for lend
  token_in        text,
  token_out       text,
  -- raw amounts (string, wei / smallest unit)
  amount_in       text,
  amount_out      text,
  tx_hash         text not null,
  block_number    bigint,
  block_timestamp timestamptz not null,
  -- who sent / received (distinct from wallet for attributed activity)
  counterparty    text,
  created_at      timestamptz not null default now(),

  -- dedupe: same wallet+tx+type = already indexed (one action per tx per type).
  -- NOTE: we deliberately EXCLUDE token_in (nullable) from the key — Postgres
  -- treats NULL != NULL, so a NULL token leg would never be caught by ON CONFLICT
  -- and would create duplicates across runs. One (tx,wallet,type) is one action.
  constraint events_dedupe unique (tx_hash, wallet, event_type)
);

alter table public.events enable row level security;

create policy "events readable by everyone"
  on public.events for select
  using (true);

create policy "service_role writes events"
  on public.events for insert
  to service_role
  with check (true);

-- timestamp index for range / snapshot queries
create index if not exists events_wallet_ts_idx on public.events (wallet, block_timestamp desc);
create index if not exists events_tx_hash_idx on public.events (tx_hash);

-- grants to Supabase-managed roles (service_role writes, anon/auth read)
grant all on table public.events to service_role;
grant select on table public.events to anon, authenticated;
