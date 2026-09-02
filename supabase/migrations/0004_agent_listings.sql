-- ============================================================
-- 0004_agent_listings.sql
-- On-chain marketplace listing, mirrored off the AgentListing
-- contract (BSC testnet, 0xd2e732ca87f65f046835608b3d940273a2a172c4).
-- The bond amount + tx hash are stored here for auditability.
-- ============================================================

create table if not exists public.agent_listings (
  id              uuid primary key default gen_random_uuid(),
  erc8004_token_id bigint not null,
  lister          text not null,            -- who called listAgent
  agent_wallet    text,
  category        text not null,            -- Rebalancing | Grid Trading | Yield | Health-Factor
  metadata_uri    text,
  bond_wei        numeric not null,         -- BNB bond paid (wei)
  tx_hash         text not null unique,     -- the signed listAgent transaction
  listing_contract text not null,           -- AgentListing address it hit
  listed_at       timestamptz not null default now(),
  constraint agent_listings_token_unique unique (erc8004_token_id)
);

alter table public.agent_listings enable row level security;

create policy "listings readable by everyone"
  on public.agent_listings for select
  using (true);

create policy "service_role writes listings"
  on public.agent_listings for insert
  to service_role
  with check (true);

create index if not exists agent_listings_token_idx on public.agent_listings (erc8004_token_id);
create index if not exists agent_listings_tx_idx on public.agent_listings (tx_hash);

-- grants to Supabase-managed roles
grant all on table public.agent_listings to service_role;
grant select on table public.agent_listings to anon, authenticated;
