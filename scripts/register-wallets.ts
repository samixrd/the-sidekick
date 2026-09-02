import { createAdminSupabaseClient } from "../lib/supabase/admin";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
}
async function main() {
  const admin = createAdminSupabaseClient();
  // GRD-07 addr from the-tape keys
  const keys = JSON.parse(readFileSync("D:/BNB HACKATHON/the-tape/agents/.agent-wallets.json", "utf8"));
  const grd07 = privateKeyToAccount(("0x" + keys["GRD-07"].replace(/^0x/, "")) as `0x${string}`).address;
  const rebal = privateKeyToAccount(("0x" + (process.env.CAT_REBALANCE_KEY ?? "").replace(/^0x/, "")) as `0x${string}`).address;
  const yieldA = privateKeyToAccount(("0x" + (process.env.CAT_YIELD_KEY ?? "").replace(/^0x/, "")) as `0x${string}`).address;
  const health = privateKeyToAccount(("0x" + (process.env.CAT_HEALTH_KEY ?? "").replace(/^0x/, "")) as `0x${string}`).address;

  const wallets = [
    { wallet: grd07.toLowerCase(), label: "Hermes — Grid (GRD-07)" },
    { wallet: rebal.toLowerCase(), label: "Hermes — Rebalancing" },
    { wallet: yieldA.toLowerCase(), label: "Hermes — Yield" },
    { wallet: health.toLowerCase(), label: "Hermes — Health-Factor" },
  ];
  console.log("registering 4 category-distinct wallets:\n");
  for (const w of wallets) {
    const { error } = await admin.from("agent_wallets").upsert(w, { onConflict: "wallet" });
    if (error) console.log("  ERR", w.wallet.slice(0, 10), error.message);
    else console.log("  ✓", w.wallet.slice(0, 10) + "…", "|", w.label);
  }
  const { data } = await admin.from("agent_wallets").select("wallet,label");
  console.log("\n== agent_wallets now ==");
  for (const w of data ?? []) console.log("  ", w.wallet.slice(0, 12) + "…", "|", w.label);
}
main();
