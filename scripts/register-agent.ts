/**
 * Register The Sidekick's first agent identity on ERC-8004 (BSC testnet).
 * Real on-chain call — mints a new tokenId. Reads it back to confirm.
 * Run:  npm run register:agent
 */
import { readAgentIdentity, registerAgentIdentity, makeRegistrationFile } from "../lib/erc8004/identity";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
}

const rawKey = process.env.ERC8004_SIGNER_KEY ?? "";
const signerKey = (rawKey.startsWith("0x") ? rawKey : "0x" + rawKey) as `0x${string}`;

async function main() {
  console.log("── THE SIDEKICK · register agent identity (BSC testnet) ──\n");

  const regFile = makeRegistrationFile({
    name: "The Sidekick agent",
    description: "Autonomous BNB trading agent with verifiable on-chain behaviour + reputation, listed on The Sidekick marketplace.",
    image: "", // optional
    services: [
      { name: "A2A", endpoint: "https://sidekick.example/.well-known/agent-card.json", version: "0.3.0" },
      { name: "MCP", endpoint: "https://mcp.sidekick.example/", version: "2025-06-18" },
    ],
    supportedTrust: ["reputation", "crypto-economic"],
  });
  const dataUri = "data:application/json;base64," + Buffer.from(JSON.stringify(regFile)).toString("base64");

  console.log(`registration file (${dataUri.length} bytes):`);
  console.log(`  name:        ${regFile.name}`);
  console.log(`  description: ${regFile.description}`);
  console.log(`  services:    ${(regFile.services as any[]).map((s) => `${s.name}=${s.endpoint}`).join(", ")}`);
  console.log("\nregistering (real tx, may take ~15s)...");

  let agentId: bigint;
  try {
    agentId = await registerAgentIdentity(signerKey, dataUri);
  } catch (e: any) {
    console.error("register failed:", e.shortMessage || e.message);
    process.exit(1);
  }
  console.log(`\n✅ MINTED agentId = ${agentId}`);

  const identity = await readAgentIdentity(agentId);
  console.log("\n── read-back confirmation ──");
  console.log("  agentId    :", identity.agentId.toString());
  console.log("  owner      :", identity.owner);
  console.log("  wallet     :", identity.agentWallet);
  console.log("  name       :", String(identity.metadata?.name));
  console.log("  description:", String(identity.metadata?.description));
}

main().catch((e) => { console.error(e); process.exit(1); });
