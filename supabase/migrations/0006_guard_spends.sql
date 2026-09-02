-- ============================================================
-- 0006_guard_spends.sql
-- Guard Router SwapForwarded events, decoded by the indexer. Used to derive a
-- delegation's amount_used from spend that was routed THROUGH the Guard Router
-- under that specific hire (hire_id), not any random wallet activity.
-- Also adds delegations.hire_id to link delegation -> GuardRouter hire.
-- ============================================================

create table if not exists public.guard_spends (
  id            bigint generated always as identity primary key,
  hire_id       text not null,             -- GuardRouter hireId (bytes32 hex)
  caller        text not null,             -- account that executed (session's account)
  amount_in     numeric not null default 0,-- token units (18-dec)
  amount_out    numeric not null default 0,
  tx_hash       text not null,
  block_number  bigint not null,
  block_timestamp text,
  created_at    timestamptz not null default now(),
  unique (tx_hash, hire_id)
);

alter table public.guard_spends enable row level security;
grant select on public.guard_spends to anon, authenticated, service_role;
grant insert on public.guard_spends to service_role;

alter table public.delegations add column if not exists hire_id text;
