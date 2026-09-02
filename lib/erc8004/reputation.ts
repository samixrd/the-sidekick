/**
 * ERC-8004 Reputation Registry — feedback signals for registered agents.
 * Read: getClients / getSummary / readAllFeedback (aggregate reputation).
 * Write: giveFeedback() posts a reputation entry.
 */
import { getContract } from "viem";
import reputationAbi from "./abis/ReputationRegistry.json";
import { makePublicClient, makeWalletClient, requireErc8004Config } from "./config";
import type { Address } from "viem";

export interface ReputationSummary {
  count: bigint;
  summaryValue: bigint;
  summaryValueDecimals: number;
}

export interface ReputationFeedback {
  client: Address;
  feedbackIndex: bigint;
  value: bigint;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  isRevoked: boolean;
}

export interface GiveFeedbackInput {
  agentId: bigint;
  value: bigint; // fixed-point int128
  valueDecimals: number; // 0–18
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: `0x${string}`;
}

/** Aggregate summary for an agent across the given clientAddresses (tag filters optional). */
export async function getReputationSummary(
  agentId: bigint,
  clientAddresses: Address[],
  tag1 = "",
  tag2 = "",
): Promise<ReputationSummary> {
  const { reputationRegistry } = requireErc8004Config();
  const contract = getContract({ address: reputationRegistry, abi: reputationAbi as any, client: makePublicClient() });
  const [count, summaryValue, summaryValueDecimals] = (await contract.read.getSummary([
    agentId, clientAddresses, tag1, tag2,
  ])) as [bigint, bigint, number];
  return { count, summaryValue, summaryValueDecimals };
}

/** List the client addresses that ever gave feedback to an agent. */
export async function getReputationClients(agentId: bigint): Promise<Address[]> {
  const { reputationRegistry } = requireErc8004Config();
  const contract = getContract({ address: reputationRegistry, abi: reputationAbi as any, client: makePublicClient() });
  return (await contract.read.getClients([agentId])) as Address[];
}

/** Read all feedback for an agent (aggregated + per-entry). */
export async function getReputationFeedback(
  agentId: bigint,
  clientAddresses: Address[],
  tag1 = "",
  tag2 = "",
  includeRevoked = false,
): Promise<ReputationFeedback[]> {
  const { reputationRegistry } = requireErc8004Config();
  const contract = getContract({ address: reputationRegistry, abi: reputationAbi as any, client: makePublicClient() });
  const [clients, idx, values, decimals, tag1s, tag2s, revoked] = (await contract.read.readAllFeedback([
    agentId, clientAddresses, tag1, tag2, includeRevoked,
  ])) as [Address[], bigint[], bigint[], number[], string[], string[], boolean[]];
  return clients.map((client, i) => ({
    client,
    feedbackIndex: idx[i],
    value: values[i],
    valueDecimals: Number(decimals[i]),
    tag1: tag1s[i],
    tag2: tag2s[i],
    isRevoked: revoked[i],
  }));
}

/**
 * Post a reputation feedback entry for an agent.
 * The call MUST come from a clientAddress that is NOT the agent owner/operator.
 * value is a fixed-point int128; valueDecimals 0–18.
 * @returns the tx hash.
 */
export async function giveFeedback(
  signerPrivateKey: `0x${string}`,
  input: GiveFeedbackInput,
): Promise<`0x${string}`> {
  const { reputationRegistry } = requireErc8004Config();
  const walletClient = makeWalletClient(signerPrivateKey);
  const publicClient = makePublicClient();
  const contract = getContract({ address: reputationRegistry, abi: reputationAbi as any, client: walletClient });

  const hash = await contract.write.giveFeedback([
    input.agentId,
    input.value,
    input.valueDecimals,
    input.tag1 ?? "",
    input.tag2 ?? "",
    input.endpoint ?? "",
    input.feedbackURI ?? "",
    input.feedbackHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
  ]);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
