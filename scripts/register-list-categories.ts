/**
 * Register + list the 4 Hermes category agents on-chain (self-listing path).
 * For each category wallet:
 *   1. Register an ERC-8004 identity ("Hermes — <Category>", real description,
 *      owner = agentWallet = the wallet) — real register() tx.
 *   2. List it via AgentListing with the correct category enum + real bond —
 *      real listAgent() tx, paid by the same wallet (callable by ANY wallet).
 *   3. Persist to Supabase agent_listings (bond + tx hash).
 * Run:  npm run register:list-categories
 */
import { privateKeyToAccount } from "viem/accounts";
import { parseEther } from "viem";
import { readFileSync } from "node:fs";
import { registerAgentIdentity, makeRegistrationFile } from "../lib/erc8004/identity";
import { listAgent, isAgentListed, getListing, type Category } from "../lib/marketplace/listing";
import { persistListing } from "../lib/marketplace/listing-store";
import { requireErc8004Config } from "../lib/erc8004";
import type { Address } from "viem";

const env = readFileSync(process.cwd() + "/.env", "utf8");
const keys = JSON.parse(readFileSync("D:/BNB HACKATHON/the-tape/agents/.agent-wallets.json", "utf8"));

function walletKey(catEnv: string): `0x${string}` {
  const raw = catEnv
    ? ((env.match(new RegExp(`^${catEnv}="?([^"\\r\\n]+)`, "m"))?.[1] ?? "").replace(/^0x/, ""))
    : keys["GRD-07"].replace(/^0x/, "");
  return ("0x" + raw) as `0x${string}`;
}

const AGENTS = [
  {
    name: "Hermes — Grid", category: "Grid Trading", catEnum: 1,
    description: "Grid trading agent executing BNB/USDT range trades on PancakeSwap, indexed from real swap activity.",
    key: walletKey(""),
    wallet: privateKeyToAccount(walletKey("")).address.toLowerCase(),
  },
  {
    name: "Hermes — Rebalancing", category: "Rebalancing", catEnum: 0,
    description: "Provides BNB/USDT liquidity to PancakeSwap and re-centers the position when the price moves it out of range.",
    key: walletKey("CAT_REBALANCE_KEY"),
    wallet: privateKeyToAccount(walletKey("CAT_REBALANCE_KEY")).address.toLowerCase(),
  },
  {
    name: "Hermes — Yield", category: "Yield", catEnum: 2,
    description: "Compares Venus supply yield vs LP yield and moves funds toward the higher-yielding option.",
    key: walletKey("CAT_YIELD_KEY"),
    wallet: privateKeyToAccount(walletKey("CAT_YIELD_KEY")).address.toLowerCase(),
  },
  {
    name: "Hermes — Health-Factor", category: "Health-Factor", catEnum: 3,
    description: "Supplies WBNB collateral and borrows USDC on Venus, monitoring health factor and taking real protective action when it drops.",
    key: walletKey("CAT_HEALTH_KEY"),
    wallet: privateKeyToAccount(walletKey("CAT_HEALTH_KEY")).address.toLowerCase(),
  },
];

const BOND = parseEther("0.01");
const RECORDS: any[] = [];

async function main() {
  const cfg = requireErc8004Config();
  console.log("── register + list 4 Hermes category agents (BSC testnet) ──\n");
  console.log("listing contract:", cfg.agentListing);

  for (const agent of AGENTS) {
    console.log(`\n===== ${agent.name} (${agent.wallet.slice(0, 12)}…) =====`);

    // ── 1) register ERC-8004 identity (self-registering wallet) ──
    const regFile = makeRegistrationFile({
      name: agent.name,
      description: agent.description,
      services: [{ name: "A2A", endpoint: "https://sidekick.example/.well-known/agent-card.json", version: "0.3.0" }],
      supportedTrust: ["reputation", "crypto-economic"],
    });
    const dataUri = "data:application/json;base64," + Buffer.from(JSON.stringify(regFile)).toString("base64");
    let tokenId: bigint;
    try {
      tokenId = await registerAgentIdentity(agent.key, dataUri);
    } catch (e: any) {
      console.log("  register FAILED:", (e.shortMessage || e.message).slice(0, 80));
      continue;
    }
    console.log("  ✅ registered ERC-8004 identity → agentId", tokenId.toString());

    // ── 2) list via AgentListing (correct category enum + real bond) ──
    const already = await isAgentListed(tokenId);
    let listTx: `0x${string}`;
    if (already) {
      console.log("  already listed — reading existing.");
      listTx = "0x0000000000000000000000000000000000000000000000000000000000000000";
    } else {
      try {
        listTx = await listAgent(agent.key, {
          erc8004TokenId: tokenId,
          category: agent.category as Category,
          metadataURI: dataUri,
          agentWallet: agent.wallet as Address,
          bondWei: BOND,
        });
        console.log("  ✅ listed via AgentListing → tx", listTx);
      } catch (e: any) {
        console.log("  list FAILED:", (e.shortMessage || e.message).slice(0, 80));
        continue;
      }
    }

    // ── 3) persist to Supabase agent_listings ──
    const listing = await getListing(tokenId);
    const record = await persistListing({
      erc8004TokenId: tokenId,
      lister: agent.wallet,
      agentWallet: agent.wallet,
      category: agent.category,
      metadataURI: dataUri,
      bondWei: listing.bond,
      txHash: listTx,
      listingContract: cfg.agentListing,
    });
    RECORDS.push({ name: agent.name, tokenId: tokenId.toString(), category: agent.category, wallet: agent.wallet, bond: listing.bond.toString(), tx: listTx, record_id: record.id });
    console.log("  ✅ persisted agent_listings id:", record.id, "| bond", listing.bond.toString(), "| tx", listTx.slice(0, 14) + "…");
  }

  console.log("\n── ALL DONE ──");
  for (const r of RECORDS) console.log(`  ${r.name}: tokenId=${r.tokenId} cat=${r.category} wallet=${r.wallet.slice(0,10)}… bond=${r.bond} tx=${r.tx.slice(0,14)}…`);
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
