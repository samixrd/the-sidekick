/**
 * Generate 4 category-distinct wallets (Grid, Rebalancing, Yield, Health) +
 * fund them from the treasury signer. Keys are written to .env (gitignored,
 * private). Idempotent: existing keys are kept. Prints only addresses.
 * Run:  npm run setup:wallets
 */
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, createPublicClient, http, parseEther } from "viem";
import { bscTestnet } from "viem/chains";
import { randomBytes } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
}
const RPC = "https://bsc-testnet-rpc.publicnode.com";

const CATS = [
  { envKey: "CAT_GRID_KEY", label: "grid" },
  { envKey: "CAT_REBALANCE_KEY", label: "rebalancing" },
  { envKey: "CAT_YIELD_KEY", label: "yield" },
  { envKey: "CAT_HEALTH_KEY", label: "health" },
];

function genKey(): `0x${string}` {
  return ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;
}

async function main() {
  const mainKey = (process.env.ERC8004_SIGNER_KEY ?? "").replace(/^0x/, "") as `0x${string}`;
  const mainWallet = createWalletClient({ chain: bscTestnet, transport: http(RPC), account: privateKeyToAccount("0x" + mainKey as `0x${string}`) });
  const pub = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
  const mainAddr = privateKeyToAccount("0x" + mainKey as `0x${string}`).address;
  const mainBal = Number(await pub.getBalance({ address: mainAddr })) / 1e18;
  console.log("main wallet :", mainAddr, "| tBNB:", mainBal.toFixed(4));

  let env = readFileSync(envPath, "utf8");
  for (const cat of CATS) {
    // keep existing key if already set (idempotent)
    if (new RegExp(`^${cat.envKey}=`).test(env)) {
      const k = (env.match(new RegExp(`^${cat.envKey}="?([^"\\r\\n]+)"?`, "m"))?.[1] ?? "").replace(/^0x/, "");
      const a = privateKeyToAccount(("0x" + k) as `0x${string}`).address;
      const b = Number(await pub.getBalance({ address: a })) / 1e18;
      console.log(`  ${cat.label}: (existing) ${a} | tBNB ${b.toFixed(4)}`);
      continue;
    }
    const key = genKey();
    const acct = privateKeyToAccount(key);
    // fund with 0.012 tBNB (gas + strategy headroom)
    const amount = parseEther("0.012");
    const hash = await mainWallet.sendTransaction({ to: acct.address, value: amount });
    await pub.waitForTransactionReceipt({ hash });
    const bal = Number(await pub.getBalance({ address: acct.address })) / 1e18;
    env += `\n# ${cat.label} agent wallet (private — do not expose)\n${cat.envKey}="${key.replace(/^0x/, "")}"\n`;
    console.log(`  ${cat.label}: ${acct.address} | funded ${Number(amount)/1e18} tBNB (bal ${bal.toFixed(4)}) | tx ${hash.slice(0,12)}…`);
  }
  writeFileSync(envPath, env);
  console.log("\nwrote category wallet keys to .env");
}
main().catch((e) => { console.error("err:", e.shortMessage || e.message || e); process.exit(1); });
