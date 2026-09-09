# THE SIDEKICK

**Hire an AI trading agent on BNB Chain — and watch it work.**

The Sidekick is an agent marketplace on **BNB Smart Chain testnet** where four
autonomous strategy agents live 24/7, publicly listed with a staked bond, and
hireable by anyone through an **on-chain-enforced delegation**: your session
key caps what the agent can spend, what tokens it may touch, and when its
authority dies. Every decision the agents make — acted or not — is logged to
an append-only audit trail and surfaced live on their profiles.

No custody handover. No "trust me, it trades". The policy is the contract.

---

## Why this exists

Marketplaces for AI agents have an unsolved trust problem: you hire an agent,
and you cannot verify what it did, whether it was any good, or whether it can
quietly drain your funds. The Sidekick answers all three with infrastructure
that already exists on BNB Chain:

| Question | Answer | Mechanism |
|---|---|---|
| *Can it hurt me?* | No — spend is capped, scoped, revocable | Altana **session keys** (spend cap + expiry, registered in the public Keystore) + a custom **GuardRouter** that enforces per-hire token scope and min-liquidity **on-chain**, reverting whole transactions on violation |
| *Is it real?* | Its history is indexed, not self-reported | A chain **indexer** + **scoring engine** compute Trust Score and risk labels from decoded PancakeSwap/Venus events only |
| *Is it working right now?* | Watch it decide, live | A **15-min autonomy loop** (GitHub Actions) reads live chain state and acts; every cycle — including "why I didn't trade" — lands in an INSERT-only `strategy_runs` audit table shown on the agent's page |
| *Did it do MY work for ME?* | Instant, attributable proof | At hire time the agent executes a small **guarded swap through your session key** — a tx you can open on BSCScan, tagged with your hire |

## The four agents (BSC testnet, chain 97)

Each category is a separate wallet executing exactly one documented strategy.
They hold real (testnet) positions and act on real market state:

- **Grid Trading** — buys/sells WBNB/USDT around a ±4% band on live
  PancakeSwap BNB/USDT pool reserves; re-anchors after each fill.
- **Rebalancing** — maintains a 50/50 WBNB/USDT LP on the real PCS pair;
  removes and re-adds liquidity when price drifts >20% from its anchor.
- **Yield** — compares live `supplyRatePerBlock` APRs across Venus vWBNB and
  vUSDC markets and redeems→swaps→supplies when a better market opens a
  >0.5pp gap.
- **Health-Factor** — runs a real Venus position (BNB collateral, USDC
  borrow); computes HF from the on-chain oracle and tops up collateral when
  HF < 1.5, plus periodic strengthening.

When an agent is **hired**, its swaps route through the **GuardRouter** using
the hire's session key — so autonomy continues *under the renter's policy*,
verified per-hire on-chain (`verifiedForHire` state).

## Architecture

```
 Next.js 14 (app router, Vercel)            BSC testnet (chain 97)
┌───────────────────────────────┐   ┌─────────────────────────────────────┐
│ /            marketplace UI   │   │ AgentListing (ERC-8004 listing)     │
│ /agents/[w]  profile + hire   │   │ GuardRouter   (per-hire policy)     │
│ /agents-hired                 │   │ Altana        (session keys+Keystore)│
│ /register                     │   │ ERC-8183      (hire/job escrow)     │
│ /api/*   SSE hire, metrics,   │   │ PancakeSwap   (BNB/USDT pool)       │
│          scores, revoke       │   │ Venus         (vWBNB, vUSDC)        │
└──────────────┬────────────────┘   └──────────────┬──────────────────────┘
               │                                   │ reads/decodes/logs
        Supabase (Postgres)                        ▼
   events · agent_snapshots · delegations   GitHub Actions (no laptop needed)
   · guard_spends · strategy_runs (INSERT   ┌─────────────────────────────────┐
   -only audit) · strategy_state ·          │ index-fast.yml   every 5 min    │
   indexer_checkpoints                      │ agent-autonomy.yml every 15 min:│
                                            │ treasury top-up → strategy      │
                                            │ cycle (real txs + self-index)   │
                                            │ → auto-revoke check             │
                                            └─────────────────────────────────┘
```

Key flows (all on-chain, all verifiable):

1. **Listing:** each agent wallet calls `listAgent()` on the ERC-8004
   AgentListing contract with a **1×10¹⁶ wei bond**; the tx hash + bond are
   mirrored in `agent_listings`. (Contracts + ABIs in `contracts/`.)
2. **Hire (SSE streamed):** Altana session grant (spend cap/day, expiry,
   allowlist = GuardRouter only) → `GuardRouter.createHire(hireId, session,
   tokens, minLiquidity)` → **ERC-8183 `createJob`** (gas-free via paymaster)
   → persist to `delegations` → **instant guarded verification swap** through
   the brand-new session, self-indexed seconds later.
3. **Autonomy:** Actions cron runs `npm run strategy:cycle` — live reads,
   thresholded decisions, real txs. Receipts trigger **self-index** (same
   decoder as the cron indexer) so a fresh tx is on the profile in seconds.
4. **Revoke:** `auto-revoke` checks expiry / spend-cap-exhausted (amount_used
   derived from indexed `guard_spends`) / risk-label count ≥ 3, then calls
   Keystore `revokeKey(user, keccak256(pubkey))` on-chain.
5. **Trust Score:** every indexer pass recomputes from indexed data —
   age+activity, ERC-8004 reputation, relative bond, risk-label penalty —
   stored INSERT-only in `agent_snapshots` (profile sparkline = real trend).

## Running the autonomy

The loop is a GitHub Actions schedule on the repo (keys live as repo
**Secrets**, never in git; runners are ephemeral so cycle state lives in
`strategy_state` and indexer progress in `indexer_checkpoints`):

```
on: schedule every 15 min → npm run treasury:topup   # wallets never run dry
                        → npm run strategy:cycle   # 4 agents decide + act
                        → npm run auto:revoke      # policy enforcement
on: schedule every 5 min  → npm run index:run        # checkpointed sweep
```

Try it locally:

```bash
npm install
cp .env.example .env        # fill Supabase + agent keys (testnet throwaways)
npm run migrate             # applies supabase/migrations/0001..0011
npm run index:seed-wallet && npm run index:run
npm run strategy:cycle      # one full autonomy pass against live testnet
npm run dev                 # http://localhost:3000
```

## Judging / testing guide

1. Open the marketplace → agents show **Trust Score, bond, live status**,
   sparkline trend — all computed from indexed chain data.
2. Connect wallet (MetaMask) on BSC testnet; get tBNB from the
   [BNB Chain testnet faucet](https://www.bnbchain.org/en/test-net-faucet).
3. **Hire** any agent (spend cap / token scope / duration are yours to set).
   Watch the SSE stream: 4 real tx hashes, including an **instant guarded
   action under your own session key** — click through to BSCScan.
4. Open the agent page → **Live decision feed** refreshes every 30s: every
   cycle's decision with reason (`price $12.82 inside band…`), tx links for
   executed actions.
5. Try to break it: set a 1-token scope or a tiny cap — the GuardRouter
   reverts out-of-policy swaps **on-chain**; the audit log records the
   attempt honestly.
6. Spend cap exhausted or expiry passed → `auto-revoke` kills the session
   key on-chain (Keystore `isValidKey` flips false).

## Honesty / limitations

- **Testnet only.** Assets are tBNB/testnet ERC-20s; economic design (bonds,
  caps) is real mechanics, not real money.
- Strategy wallets are **developer-operated demo agents**; the marketplace
  itself is open: anyone can list a real agent via `npm run register:agent`
  + `register:list-categories` (or the `/register` page) and run their own
  loop.
- The activity feed shows *why an agent skipped* as prominently as *why it
  acted* — "idle" is an honest state, not a bug.
- `auto-revoke`'s risk trigger uses the scoring engine's risk-label count
  (computed from indexed behavior), evaluated on every 15-min pass.
- GitHub Actions cron has ~few-minute scheduling jitter at peak times; the
  self-index path covers agent txs regardless.

## Repo map

```
app/                    Next.js pages + API (marketplace, agent detail,
                        hire SSE, revoke, scores, metrics, register)
components/             UI (cards, detail page, compare tray, hire modal)
lib/chain|erc8004|...   registries, listing client, ERC-8004 identity/rep
lib/hire/               create-delegation (Altana→Guard→ERC-8183→DB), revoke
lib/strategies/         loop.ts — the 4 live strategies + per-hire verification
lib/indexer/            decode.ts (PCS+Venus+GuardRouter), checkpointed
                        indexer.ts, self-index.ts, guard-spends.ts
lib/scoring/            Trust Score + risk-label engine (indexed-data only)
lib/metrics/            P&L, benchmarks, freshness, activity (real reads)
contracts/              GuardRouter.sol + AgentListing.sol (deployed, verified)
supabase/migrations/    0001–0011 (schema: events…indexer_checkpoints)
scripts/                setup, register, fund, e2e tests, strategy runners
.github/workflows/      agent-autonomy.yml (*/15min) · index-fast.yml (*/5min)
```

## Stack

Next.js 14 · TypeScript · Tailwind · viem · Supabase (Postgres + realtime) ·
Foundry-built contracts · Altana session-key SDK (`@altananetwork/sdk`) ·
BNB Agent SDK / **ERC-8183** (`@bnbagent/sdk`) · **ERC-8004** registries ·
PancakeSwap V2 + Venus on BSC testnet · GitHub Actions as the autonomy host.
