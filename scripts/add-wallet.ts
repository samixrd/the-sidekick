/**
 * Add a tracked wallet to agent_wallets.
 * Usage: npm run index:add-wallet -- 0xADDRESS [label]
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const envPath = resolve(process.cwd(), ".env");
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
}

const wallet = process.argv[2] ?? "";
const label = process.argv[3] ?? null;

if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  console.error("usage: npm run index:add-wallet -- 0xADDRESS [label]");
  process.exit(1);
}

async function main() {
  const admin = createAdminSupabaseClient();
  const w = wallet.toLowerCase();
  const { data, error } = await admin.from("agent_wallets").upsert(
    { wallet: w, label },
    { onConflict: "wallet" },
  );
  if (error) {
    console.error("add wallet failed:", error.message);
    process.exit(1);
  }
  console.log(`tracked wallet ${w} ${label ? `(${label})` : ""}`);
}

main();
