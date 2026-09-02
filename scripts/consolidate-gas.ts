/**
 * Consolidate small leftover testnet balances into the main signer so we can
 * fund a fresh "connected wallet" for the UI List-Agent test (bond 0.01 + gas).
 * Sweeps every the-tape wallet down to ~0 (keeps nothing). Run: npm run consolidate:gas
 */
import { createWalletClient, createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const env = readFileSync(process.cwd() + "/.env", "utf8");
const get = (k: string) => ("0x" + (env.match(new RegExp(`^${k}=\"?([^"\r\n]+)`, "m"))?.[1] ?? "").replace(/^0x/, ""));
const MAIN = privateKeyToAccount(get("ERC8004_SIGNER_KEY") as `0x${string}`);
const pub = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });

const json = JSON.parse(readFileSync("D:/BNB HACKATHON/the-tape/agents/.agent-wallets.json", "utf8"));
const keys = new Set<string>([
  get("CAT_REBALANCE_KEY"), get("CAT_YIELD_KEY"), get("CAT_HEALTH_KEY"),
  ...(Object.keys(json).map((k) => "0x" + String(json[k]).replace(/^0x/, ""))),
].filter((k) => /^0x[0-9a-fA-F]{64}$/.test(k)));

async function main() {
  let total = 0, moved = 0;
  for (const key of keys) {
    const act = privateKeyToAccount(key as `0x${string}`);
    if (act.address.toLowerCase() === MAIN.address.toLowerCase()) continue;
    const bal = await pub.getBalance({ address: act.address });
    // retain ~0.0001 tBNB for the transfer's own gas (a plain transfer is cheap on testnet)
    const sendValue = bal - 100_000_000_000_000n < 0n ? 0n : bal - 100_000_000_000_000n;
    if (sendValue <= 0n) continue;
    const srcWallet = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account: act });
    const tx = await srcWallet.sendTransaction({ to: MAIN.address, value: sendValue });
    await pub.waitForTransactionReceipt({ hash: tx });
    total += Number(sendValue) / 1e18;
    moved++;
    console.log(`  ${act.address.slice(0, 10)}… → main  ${(Number(sendValue)/1e18).toFixed(4)} tBNB  (tx ${tx.slice(0, 14)}…)`);
  }
  console.log(`\nswept ${moved} wallet(s) → ${total.toFixed(4)} tBNB into main`);
  console.log("main now:", (Number(await pub.getBalance({ address: MAIN.address })) / 1e18).toFixed(4), "tBNB");
}
main().catch((e) => console.error("ERR:", (e as Error).message?.slice(0, 160) || e));
