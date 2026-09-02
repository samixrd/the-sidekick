/**
 * Seed a single real BNB testnet agent wallet into agent_wallets for the
 * manual-run demo. GRD-07 — one of the funded agent wallets, has real
 * PancakeSwap swap activity on the BNB/USDT pool (verified).
 * Run:  npm run index:seed-wallet
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const envPath = resolve(process.cwd(), ".env");
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
}

const WALLET = "0x76675949d6671786f240bb072e98012fc4bba811"; // GRD-07 agent wallet
const LABEL = "GRD-07 (real testnet agent wallet)";

async function main() {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("agent_wallets").upsert(
    { wallet: WALLET, label: LABEL },
    { onConflict: "wallet" },
  );
  if (error) {
    console.error("seed failed:", error.message);
    process.exit(1);
  }
  console.log(`seeded agent_wallets -> ${WALLET} (${LABEL})`);
}

main();
