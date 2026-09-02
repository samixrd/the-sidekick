import { createAdminSupabaseClient } from "../supabase/admin";

/**
 * Persist a listing to Supabase: record bond + tx hash against the agent, and
 * add the listing wallet to the indexer's tracked-wallet table. Returns the
 * persisted record.
 */
export async function persistListing(input: {
  erc8004TokenId: bigint;
  lister: string;
  agentWallet: string;
  category: string;
  metadataURI: string;
  bondWei: bigint;
  txHash: string;
  listingContract: string;
}) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("agent_listings")
    .upsert(
      {
        erc8004_token_id: Number(input.erc8004TokenId),
        lister: input.lister.toLowerCase(),
        agent_wallet: input.agentWallet.toLowerCase(),
        category: input.category,
        metadata_uri: input.metadataURI,
        bond_wei: input.bondWei.toString(),
        tx_hash: input.txHash.toLowerCase(),
        listing_contract: input.listingContract.toLowerCase(),
      },
      { onConflict: "erc8004_token_id" },
    )
    .select()
    .single();

  if (error) throw new Error(`persist listing failed: ${error.message}`);

  // auto-add the wallet to the indexer's tracked list (idempotent)
  const { error: walletErr } = await admin
    .from("agent_wallets")
    .upsert({ wallet: input.agentWallet.toLowerCase(), label: `listed-erc8004-${Number(input.erc8004TokenId)}` }, { onConflict: "wallet" });
  if (walletErr) throw new Error(`add wallet to agent_wallets failed: ${walletErr.message}`);

  return data;
}
