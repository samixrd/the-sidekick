/**
 * AgentListing contract wrapper — on-chain listing operations.
 *
 * listAgent(): bond-backed FIRST-time listing. Callable by ANY wallet (human
 *   owner or agent's own wallet — identical path, no caller special-casing).
 *   The bond is carried in msg.value and can only be set by a SIGNED tx, so
 *   there is no autonomous path to this spend.
 * updateAgentMetadata(): post-listing autonomous metadata update — NO bond,
 *   NO re-confirmation. Lister-only.
 *
 * Category enum order (matches contract): Rebalancing=0, GridTrading=1,
 *   Yield=2, HealthFactor=3.
 */
import { getContract } from "viem";
import listingAbi from "./abis/AgentListing.json";
import { makePublicClient, makeWalletClient, requireErc8004Config } from "../erc8004/config";

export const CATEGORIES = ["Rebalancing", "Grid Trading", "Yield", "Health-Factor"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Map a human category string to the contract's uint8 enum. */
export function categoryToEnum(category: string): number {
  const idx = CATEGORIES.findIndex((c) => c.toLowerCase() === category.toLowerCase());
  if (idx === -1) throw new Error(`Invalid category '${category}'. Must be one of: ${CATEGORIES.join(", ")}`);
  return idx;
}

export interface ListAgentInput {
  erc8004TokenId: bigint;
  category: Category;
  metadataURI: string;
  agentWallet: `0x${string}`;
  bondWei: bigint;
}

export interface ListingRecord {
  erc8004TokenId: bigint;
  lister: `0x${string}`;
  agentWallet: `0x${string}`;
  category: number;
  metadataURI: string;
  bond: bigint;
  listedAt: bigint;
  updateCount: bigint;
}

/**
 * listAgent — first-time bond-backed listing. SIGNED transaction; the bond is
 * sent with the call. Any wallet (owner's EOA or agent's own) can call this.
 * @returns the tx hash.
 */
export async function listAgent(
  signerPrivateKey: `0x${string}`,
  input: ListAgentInput,
): Promise<`0x${string}`> {
  const { agentListing } = requireErc8004Config();
  const walletClient = makeWalletClient(signerPrivateKey);
  const publicClient = makePublicClient();
  const contract = getContract({ address: agentListing, abi: listingAbi as any, client: walletClient });

  const hash = await contract.write.listAgent(
    [input.erc8004TokenId, categoryToEnum(input.category), input.metadataURI, input.agentWallet],
    { value: input.bondWei },
  );
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * updateAgentMetadata — autonomous post-listing metadata update. NO bond,
 * NO re-confirmation. Only the original lister may call.
 * @returns the tx hash.
 */
export async function updateAgentMetadata(
  signerPrivateKey: `0x${string}`,
  erc8004TokenId: bigint,
  newMetadataURI: string,
): Promise<`0x${string}`> {
  const { agentListing } = requireErc8004Config();
  const walletClient = makeWalletClient(signerPrivateKey);
  const publicClient = makePublicClient();
  const contract = getContract({ address: agentListing, abi: listingAbi as any, client: walletClient });

  const hash = await contract.write.updateAgentMetadata([erc8004TokenId, newMetadataURI]);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Read a listing for a tokenId (0 fields bond=0 if not listed). */
export async function getListing(erc8004TokenId: bigint): Promise<ListingRecord> {
  const { agentListing } = requireErc8004Config();
  const contract = getContract({ address: agentListing, abi: listingAbi as any, client: makePublicClient() });
  const r = (await contract.read.getListing([erc8004TokenId])) as {
    erc8004TokenId: bigint;
    lister: `0x${string}`;
    agentWallet: `0x${string}`;
    category: number;
    metadataURI: string;
    bond: bigint;
    listedAt: bigint;
    updateCount: bigint;
  };
  return {
    erc8004TokenId: r.erc8004TokenId,
    lister: r.lister,
    agentWallet: r.agentWallet,
    category: r.category,
    metadataURI: r.metadataURI,
    bond: r.bond,
    listedAt: r.listedAt,
    updateCount: r.updateCount,
  };
}

/** Whether a tokenId is listed. */
export async function isAgentListed(erc8004TokenId: bigint): Promise<boolean> {
  const { agentListing } = requireErc8004Config();
  const contract = getContract({ address: agentListing, abi: listingAbi as any, client: makePublicClient() });
  return (await contract.read.isAgentListed([erc8004TokenId])) as boolean;
}
