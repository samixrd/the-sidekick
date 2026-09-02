/**
 * ERC-8004 (Trustless Agents) — chain + contract config.
 * Addresses come from .env (never hardcoded inline). The deployments are the
 * official erc-8004/erc-8004-contracts registries, verified live on BSC testnet
 * (ReputationRegistry.getIdentityRegistry() links back to IdentityRegistry).
 *
 * ── ADDRESS PROVENANCE ──
 * Official deployments repo: https://github.com/erc-8004/erc-8004-contracts
 * BSC Testnet section of README.md (lines 51-53) declares:
 *   Identity Registry   https://testnet.bscscan.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e
 *   Reputation Registry https://testnet.bscscan.com/address/0x8004B663056A597Dffe9eCcC1965A193B7388713
 * The same addresses are in scripts/addresses.ts (TESTNET_ADDRESSES, chainId 97).
 * Cross-checked live on-chain: both have code; ReputationRegistry.getIdentityRegistry()
 * returns the IdentityRegistry address, proving they are the deployed pair.
 * Also confirmed by 8004scan.io (api.8004scan.io) which indexes BSC testnet with
 * contract_address === 0x8004A818BFB912233c491871b3d84c89A494BD9e.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, createWalletClient, fallback } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

// Self-load .env deterministically (config is evaluated at import time).
try {
  for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
    if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
  }
} catch {
  /* rely on ambient */
}

export const erc8004 = {
  chainId: Number(process.env.ERC8004_CHAIN_ID ?? "97"),
  identityRegistry: (process.env.ERC8004_IDENTITY_REGISTRY ?? "") as Address,
  reputationRegistry: (process.env.ERC8004_REPUTATION_REGISTRY ?? "") as Address,
  agentListing: (process.env.AGENT_LISTING_CONTRACT ?? "") as Address,
  rpcUrl: process.env.BSC_TESTNET_RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com",
} as const;

/** Fail fast if env is misconfigured. */
export function requireErc8004Config() {
  if (!erc8004.identityRegistry || !/^0x[a-fA-F0-9]{40}$/.test(erc8004.identityRegistry)) {
    throw new Error("ERC8004_IDENTITY_REGISTRY is not a valid 0x address in .env");
  }
  if (!erc8004.reputationRegistry || !/^0x[a-fA-F0-9]{40}$/.test(erc8004.reputationRegistry)) {
    throw new Error("ERC8004_REPUTATION_REGISTRY is not a valid 0x address in .env");
  }
  if (!erc8004.agentListing || !/^0x[a-fA-F0-9]{40}$/.test(erc8004.agentListing)) {
    throw new Error("AGENT_LISTING_CONTRACT is not a valid 0x address in .env");
  }
  return erc8004;
}

/** Read-only public client for BSC testnet (identity + reputation reads). */
export function makePublicClient() {
  return createPublicClient({ chain: bscTestnet, transport: http(erc8004.rpcUrl) });
}

/** Signing wallet client for BSC testnet. Requires a private key in env/param. */
export function makeWalletClient(privateKey: `0x${string}`) {
  const useFallback = process.env.ERC8004_RPC_FALLBACKS;
  const transport = useFallback
    ? fallback(useFallback.split(",").map((u) => http(u.trim())), { rank: false })
    : http(erc8004.rpcUrl);
  return createWalletClient({
    chain: bscTestnet,
    transport,
    account: privateKeyToAccount(privateKey),
  });
}

// Verified, confirmed addresses (read from env above) are surfaced here for the
// registry string format:  eip155:{chainId}:{identityRegistry}
export function agentRegistryString(): string {
  return `eip155:${erc8004.chainId}:${erc8004.identityRegistry}`;
}
