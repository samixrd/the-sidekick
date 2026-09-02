/**
 * ERC-8004 Identity Registry — agent identity registration.
 * Read: resolve a tokenId to owner + agentURI (registration file).
 * Write: register() a new agent identity.
 */
import { getContract } from "viem";
import identityAbi from "./abis/IdentityRegistry.json";
import { makePublicClient, makeWalletClient, requireErc8004Config, agentRegistryString } from "./config";
import type { Address } from "viem";

export interface AgentRegistration {
  agentId: bigint;
  owner: Address;
  agentWallet: Address;
  agentURI: string;
  /** parsed registration file if the URI is a JSON (data: or fetched). */
  metadata?: Record<string, unknown>;
}

export interface RegisterInput {
  agentURI: string;
  metadata?: { metadataKey: string; metadataValue: `0x${string}` }[];
}

/** Decode a JSON payload from a data: URI (fully on-chain metadata). */
export function decodeDataUri(uri: string): Record<string, unknown> | null {
  const m = uri.match(/^data:application\/json;base64,(.+)$/s);
  if (!m) return null;
  try {
    const json = Buffer.from(m[1], "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Resolve a tokenId to its on-chain identity registration. */
export async function readAgentIdentity(agentId: bigint): Promise<AgentRegistration> {
  const { identityRegistry } = requireErc8004Config();
  const client = makePublicClient();
  const contract = getContract({ address: identityRegistry, abi: identityAbi as any, client });

  const owner = (await contract.read.ownerOf([agentId])) as Address;
  const agentWallet = ((await contract.read.getAgentWallet([agentId]).catch(() => null)) ??
    "0x0000000000000000000000000000000000000000") as Address;
  const tokenURI = (await contract.read.tokenURI([agentId])) as string;

  return { agentId, owner, agentWallet, agentURI: tokenURI, metadata: decodeDataUri(tokenURI) ?? undefined };
}

/**
 * Register a new agent identity on-chain.
 * @param signerPrivateKey private key of the registering owner (EOA).
 * @param agentURI the agent registration file URI (https, ipfs or data:).
 * @param metadata optional on-chain MetadataEntry[] (e.g. extra keys).
 * @returns the minted agentId.
 */
export async function registerAgentIdentity(
  signerPrivateKey: `0x${string}`,
  agentURI: string,
  metadata: RegisterInput["metadata"] = [],
): Promise<bigint> {
  const { identityRegistry } = requireErc8004Config();
  const walletClient = makeWalletClient(signerPrivateKey);
  const publicClient = makePublicClient();
  const contract = getContract({ address: identityRegistry, abi: identityAbi as any, client: walletClient });

  const hash = await contract.write.register(metadata.length ? [agentURI, metadata] : [agentURI]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  // New mint emits Transfer(0x0 → owner, tokenId) with selector 0xddf252ad.
  // ERC-721 Transfer has 3 indexed params → tokenId is topics[3].
  const transfer = receipt.logs.find((l) => l.topics[0]?.startsWith("0xddf252ad"));
  const agentId = BigInt(transfer?.topics[3] ?? "0x0");
  if (agentId === 0n) {
    throw new Error("register succeeded but tokenId not found in receipt logs");
  }
  return agentId;
}

/** Convenience: the canonical registration-file template (ERC-8004 v1). */
export function makeRegistrationFile(input: {
  name: string;
  description: string;
  image?: string;
  services?: { name: string; endpoint: string; version?: string }[];
  supportedTrust?: string[];
}): Record<string, unknown> {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: input.name,
    description: input.description,
    image: input.image ?? "",
    services: input.services ?? [],
    x402Support: false,
    active: true,
    registrations: [{ agentId: 0, agentRegistry: agentRegistryString() }],
    supportedTrust: input.supportedTrust ?? ["reputation"],
  };
}
