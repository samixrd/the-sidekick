# Contracts

Solidity for The Sidekick. Currently scaffold only — no contracts written yet.

Target tooling: Hardhat (or Foundry — pick one before the first contract).

Suggested shape:

```
contracts/
  AgentMarketplace.sol   # registry that lists verified agents + their code hash
  AgentSession.sol       # per-agent spend-capped session / keystore gate (Altana-style)
  interfaces/
  test/
  hardhat.config.ts
```

Trigger "build the contracts" to scaffold the chosen toolchain.
