/**
 * Fund the 4 category wallets so they can self-register + self-list on-chain.
 * Each gets 0.015 tBNB (0.01 bond + gas) from the main signer. Real txs.
 * Run:  npm run fund:categories
 */
import { createWalletClient, createPublicClient, http, parseEther } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
async function main() {
  const pub = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });
  const env = readFileSync(process.cwd() + "/.env", "utf8");
  const mk = (env.match(/^ERC8004_SIGNER_KEY="?([^"\r\n]+)/m)?.[1] ?? "").replace(/^0x/, "");
  const main = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account: privateKeyToAccount(("0x" + mk) as `0x${string}`) });
  const keys = JSON.parse(readFileSync("D:/BNB HACKATHON/the-tape/agents/.agent-wallets.json", "utf8"));
  const cats = [
    ["Grid (GRD-07)", "0x" + keys["GRD-07"].replace(/^0x/, "")],
    ["Rebalancing", "0x" + (env.match(/^CAT_REBALANCE_KEY="?([^"\r\n]+)/m)?.[1] ?? "").replace(/^0x/, "")],
    ["Yield", "0x" + (env.match(/^CAT_YIELD_KEY="?([^"\r\n]+)/m)?.[1] ?? "").replace(/^0x/, "")],
    ["Health", "0x" + (env.match(/^CAT_HEALTH_KEY="?([^"\r\n]+)/m)?.[1] ?? "").replace(/^0x/, "")],
  ];
  for (const [cat, k] of cats) {
    const a = privateKeyToAccount(k as `0x${string}`);
    const h = await main.sendTransaction({ to: a.address, value: parseEther("0.015") });
    await pub.waitForTransactionReceipt({ hash: h });
    const b = Number(await pub.getBalance({ address: a.address })) / 1e18;
    console.log(`  funded ${cat} ${a.address.slice(0,10)}… → ${b.toFixed(4)} tBNB (tx ${h.slice(0,12)}…)`);
  }
  console.log("\ndone.");
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
