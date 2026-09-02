/**
 * ERC-8004 data-quality test — reads RAW on-chain values for a known agent on
 * BSC testnet, then fetches the SAME agent from 8004scan and prints both side
 * by side so the two independent sources can be compared directly.
 *
 * Agent: 97:0x8004A818BFB912233c491871b3d84c89A494BD9e:2026 ("The Sidekick agent").
 *   - It is a real deployed identity (minted on-chain via a real tx, block 128093760).
 *   - 8004scan has independently indexed it with full metadata — so both sides
 *     of the comparison are real, verifiable data (NOT made-up).
 *   - 8004scan's testnet indexer currently only covers 2025/2026; the third-party
 *     testnet agents (tokenIds 1,3,6,7,9,10,17) are on-chain-readable but not yet
 *     in 8004scan's index — reported honestly below.
 *
 * Run:  npm run test:erc8004
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getContract } from "viem";
import identityAbi from "../lib/erc8004/abis/IdentityRegistry.json";
import repAbi from "../lib/erc8004/abis/ReputationRegistry.json";
import { makePublicClient, requireErc8004Config } from "../lib/erc8004/config";

const AGENT_ID = 2026n; // The Sidekick agent (also indexed by 8004scan)
const CHAIN_ID = 97;

/** RAW tokenURI → base64 decode (full metadata, untouched). */
function decodeDataUri(uri: string): { decoded: any; raw: string } {
  const m = uri.match(/^data:application\/json;base64,(.+)$/s);
  if (!m) return { raw: uri, decoded: null };
  const json = Buffer.from(m[1], "base64").toString("utf8");
  return { raw: uri, decoded: JSON.parse(json) };
}

async function main() {
  const cfg = requireErc8004Config();
  const runAt = new Date().toISOString();
  const client = makePublicClient();
  console.log("── THE SIDEKICK · ERC-8004 data-quality check ──");
  console.log("run time (UTC):", runAt, "\n");

  // ── 1. RAW on-chain read ──
  console.log("=== [ON-CHAIN] RAW read for agentId", AGENT_ID.toString(), "===");
  const identity = getContract({ address: cfg.identityRegistry, abi: identityAbi as any, client });
  const reputation = getContract({ address: cfg.reputationRegistry, abi: repAbi as any, client });

  const owner = (await identity.read.ownerOf([AGENT_ID])) as string;
  const agentWallet = (await identity.read.getAgentWallet([AGENT_ID])) as string;
  const tokenURI = (await identity.read.tokenURI([AGENT_ID])) as string;
  const { decoded: meta, raw: rawUri } = decodeDataUri(tokenURI);

  console.log("identityRegistry :", cfg.identityRegistry);
  console.log("owner            :", owner);
  console.log("agentWallet      :", agentWallet);
  console.log("tokenURI (raw)   :", rawUri.slice(0, 46) + "… (" + rawUri.length + " bytes)");
  console.log("metadata.name    :", meta?.name);
  console.log("metadata.type    :", meta?.type);
  console.log("metadata.desc    :", meta?.description);

  const clients = (await reputation.read.getClients([AGENT_ID])) as string[];
  console.log("rep.getClients() :", clients.length, clients.map((c) => c).join(", "));
  if (clients.length > 0) {
    const [count, summaryValue, summaryValueDecimals] = (await reputation.read.getSummary([
      AGENT_ID, clients, "", "",
    ])) as [bigint, bigint, number];
    console.log("rep.getSummary() :", `count=${count.toString()} value=${summaryValue.toString()} decimals=${summaryValueDecimals}`);
    const feedback = (await reputation.read.readAllFeedback([
      AGENT_ID, clients, "", "", false,
    ])) as [string[], bigint[], bigint[], number[], string[], string[], boolean[]];
    console.log("rep.readAllFeedback():", feedback[0].length, "entries");
    for (let i = 0; i < feedback[0].length; i++) {
      console.log(
        `    client=${feedback[0][i]} idx=${feedback[1][i]} value=${feedback[2][i]} dec=${feedback[3][i]} t1=${feedback[4][i]} t2=${feedback[5][i]} revoked=${feedback[6][i]}`,
      );
    }
  } else {
    console.log("rep.readAllFeedback(): 0 entries (no feedback yet)");
  }

  // ── 2. 8004scan read for the SAME agent ──
  console.log("\n=== [8004SCAN] same agent", AGENT_ID.toString(), "(api.8004scan.io) ===");
  let scan: any = null;
  try {
    const res = await fetch(`https://api.8004scan.io/api/v1/agents/${CHAIN_ID}/${AGENT_ID}`, {
      headers: { Accept: "application/json" },
    });
    scan = res.ok ? await res.json() : null;
  } catch (e: any) {
    console.log("fetch error:", e.message);
  }
  if (scan) {
    console.log("contract_address :", scan.contract_address);
    console.log("owner_address    :", scan.owner_address);
    console.log("agent_wallet     :", scan.agent_wallet);
    console.log("name             :", scan.name);
    console.log("description      :", scan.description);
    console.log("services (a2a)   :", scan.services?.a2a?.endpoint);
    console.log("services (mcp)   :", scan.services?.mcp?.endpoint);
    console.log("raw_metadata.offchain_uri:", String(scan.raw_metadata?.offchain_uri).slice(0, 46) + "…");
    console.log("total_feedbacks  :", scan.total_feedbacks);
    console.log("health           :", scan.health_status?.overall_status, "(DNS-fails for placeholder example domains — expected)");
  } else {
    console.log("8004scan: no record returned for this agent.");
  }

  // ── 3. side-by-side comparison ──
  console.log("\n=== SIDE-BY-SIDE: on-chain vs 8004scan ===");
  const scanMeta = scan?.raw_metadata?.offchain_content ?? {};
  const rows: [string, string, string][] = [
    ["owner", owner, scan?.owner_address],
    ["agent_wallet", agentWallet, scan?.agent_wallet],
    ["name", meta?.name, scan?.name],
    ["type", meta?.type, undefined],
    ["description", meta?.description, scan?.description],
    ["contract_address", cfg.identityRegistry, scan?.contract_address],
  ];
  let allMatch = true;
  for (const [field, onchain, scanc] of rows) {
    const lhs = String(onchain ?? "").toLowerCase();
    const rhs = String(scanc ?? "").toLowerCase();
    const status = onchain == null || scanc == null ? "n/a" : lhs === rhs ? "MATCH" : "MISMATCH";
    if (status === "MISMATCH") allMatch = false;
    console.log(`  ${field.padEnd(16)} onchain=${String(onchain ?? "—").slice(0, 42).padEnd(42)} 8004scan=${String(scanc ?? "—").slice(0, 30).padEnd(30)} ${status}`);
  }
  console.log(`\n  fields compared: ${rows.length} | all matched: ${allMatch ? "YES" : "NO"}`);
  const tokenUriMatch = rawUri.slice(2, 20) === String(scan?.raw_metadata?.offchain_uri ?? "").slice(2, 20);
  console.log(`  tokenURI prefix match on-chain/8004scan: ${tokenUriMatch ? "YES" : "NO (8004scan may re-encode)"}`);

  console.log("\n── NOTE ──");
  console.log("8004scan currently indexes only BSC-testnet agents 2025/2026 (its testnet");
  console.log("indexer lags). Third-party testnet agents (tokenIds 1,3,6,7,9,10,17) are");
  console.log("readable on-chain but not yet in 8004scan's index.");
}

main().catch((e) => {
  console.error("test failed:", e);
  process.exit(1);
});
