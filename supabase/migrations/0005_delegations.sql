-- ============================================================
-- 0005_delegations.sql
-- Active hire/session-key delegations per (user, agent) pair, backed by a real
-- Altana session key (Keystore-registered) + an ERC-8183 job record.
-- v2 adds: session_public_key (needed to auto-revoke via Altana) and
-- risk_flag_count (placeholder for Step 7 risk-label scoring).
-- ============================================================

create table if not exists public.delegations (
  id               text primary key,             -- KS-<id> (mirrors Altana session id)
  user_id          text not null,                 -- caller/owner
  agent_id         text not null,                 -- the hired agent
  agent_wallet     text not null,                 -- agent's category wallet (provider)
  session_key      text not null,                 -- Altana session key address
  session_public_key text,                        -- session public key (for auto-revoke)
  guard_router     text not null,                 -- allowlist target (GuardRouter)
  token_scope      text not null default '[]',    -- json array of approved tokens
  min_liquidity    numeric not null default 0,    -- min pool liquidity threshold
  spend_cap        numeric not null default 0,    -- tBNB per period
  amount_used      numeric not null default 0,    -- derived from indexed events
  risk_flag_count  integer not null default 0,    -- placeholder (Step 7 risk scoring)
  expiry           bigint not null,               -- unix seconds
  tx_hash          text,                          -- session grant tx
  erc8183_job_id   text,                          -- ERC-8183 job id
  erc8183_tx_hash  text,                          -- job-creation tx
  status           text not null default 'active',-- active | revoked | expired
  revoked_tx       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (agent_id)
);

alter table public.delegations enable row level security;
grant select on public.delegations to anon, authenticated, service_role;
grant insert, update on public.delegations to service_role;
