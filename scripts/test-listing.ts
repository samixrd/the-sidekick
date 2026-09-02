/**
 * End-to-end listing test — REAL transactions.
 * 1. List ERC-8004 token 2026 ("The Sidekick agent") via listAgent with the bond.
 * 2. Query back the on-chain listing (getListing) — raw values.
 * 3. Persist to Supabase (agent_listings) + add wallet to agent_wallets.
 * 4. Verify Supabase record + wallet tracking.
 * Run:  npm run test:listing
 */
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listAgent, getListing, isAgentListed, type Category } from "../lib/marketplace/listing";
import { persistListing } from "../lib/marketplace/listing-store";
import { createAdminSupabaseClient } from "../lib/supabase/admin";
import { requireErc8004Config } from "../lib/erc8004";

for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
}

const TOKEN_ID = 2026n; // The Sidekick agent (real registered identity)
const CATEGORY: Category = "Grid Trading";
const METADATA_URI = "https://sidekick.example/listings/token-2026.json";

async function main() {
  const cfg = requireErc8004Config();
  const rawKey = process.env.ERC8004_SIGNER_KEY ?? "";
  const signer = (rawKey.startsWith("0x") ? rawKey : "0x" + rawKey) as `0x${string}`;
  const signerAddr = privateKeyToAccount(signer).address;

  console.log("── THE SIDEKICK · listing end-to-end test ──");
  console.log("contract :", cfg.agentListing);
  console.log("signer   :", signerAddr);
  console.log("tokenId  :", TOKEN_ID.toString(), "(" + CATEGORY + ")\n");

  // ── 1. real listing (bond-backed, signed tx) ──
  console.log("[1] listAgent — sending real tx with 0.01 tBNB bond…");
  const already = await isAgentListed(TOKEN_ID);
  let txHash: `0x${string}`;
  if (already) {
    console.log("    token already listed — reading existing listing instead of re-listing.");
    const existing = await getListing(TOKEN_ID);
    txHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
    console.log("    existing bond:", existing.bond.toString(), "category:", existing.category);
  } else {
    txHash = await listAgent(signer, {
      erc8004TokenId: TOKEN_ID,
      category: CATEGORY,
      metadataURI: METADATA_URI,
      agentWallet: signerAddr as `0x${string}`,
      bondWei: 10000000000000000n, // 0.01 tBNB
    });
    console.log("    ✅ tx hash:", txHash);
  }

  // ── 2. on-chain read-back (raw) ──
  console.log("\n[2] on-chain getListing(" + TOKEN_ID.toString() + ") — raw:");
  const listing = await getListing(TOKEN_ID);
  console.log("    lister     :", listing.lister);
  console.log("    agentWallet:", listing.agentWallet);
  console.log("    category   :", listing.category, "(0=Rebalancing 1=GridTrading 2=Yield 3=HealthFactor)");
  console.log("    metadataURI:", listing.metadataURI);
  console.log("    bond (wei) :", listing.bond.toString(), "=", Number(listing.bond) / 1e18, "tBNB");
  console.log("    listedAt   :", listing.listedAt.toString());
  console.log("    updateCount:", listing.updateCount.toString());

  // ── 3. persist to Supabase + add wallet ──
  console.log("\n[3] persist listing to Supabase + add wallet to agent_wallets…");
  const record = await persistListing({
    erc8004TokenId: TOKEN_ID,
    lister: signerAddr,
    agentWallet: signerAddr,
    category: CATEGORY,
    metadataURI: METADATA_URI,
    bondWei: listing.bond,
    txHash,
    listingContract: cfg.agentListing,
  });
  console.log("    ✅ persisted agent_listings id:", record.id, "tx:", txHash.slice(0, 18) + "…");

  // ── 4. query back Supabase ──
  console.log("\n[4] query back Supabase:");
  const admin = createAdminSupabaseClient();
  const { data: lb, error: le } = await admin.from("agent_listings").select("*").eq("erc8004_token_id", Number(TOKEN_ID));
  console.log("    agent_listings:", le ? le.message : JSON.stringify(lb, null, 2));
  const { data: wl, error: we } = await admin.from("agent_wallets").select("wallet,label").eq("wallet", signerAddr.toLowerCase());
  console.log("    agent_wallets:", we ? we.message : JSON.stringify(wl));
}

main().catch((e) => { console.error("test failed:", e.shortMessage || e.message || e); process.exit(1); });
