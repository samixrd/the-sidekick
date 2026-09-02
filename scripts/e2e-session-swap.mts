/**
 * Decisive E2E: execute a REAL swap THROUGH an Altana session key -> GuardRouter
 * -> PancakeSwap, then decode SwapForwarded to see the exact caller/hireId.
 * Run:  npm run e2e:session-swap
 */
import { createClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { createPublicClient, http, decodeEventLog, parseAbi, parseUnits, encodeFunctionData } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const env = readFileSync(".env", "utf8");
const GUARD = (env.match(/^GUARD_ROUTER="?([^"\r\n]+)/m)?.[1] ?? "") as `0x${string}`;
const KEYSTORE = "0x6b8361C29d05D498b1a12B54A37310f94171E94A".toLowerCase();
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd".toLowerCase();
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34DdD".toLowerCase();
const guardAbi = JSON.parse(readFileSync("contracts/build/contracts_GuardRouter_sol_GuardRouter.abi", "utf8"));
const erc20Abi = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
] as const;
const KABI = [{ name: "isValidKey", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ type: "bool" }] }] as const;

async function main() {
  const pub = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });
  const key = (env.match(/^CAT_REBALANCE_KEY="?([^"\r\n]+)/m)?.[1] ?? "").replace(/^0x/, "");
  const agent = privateKeyToAccount(("0x" + key) as `0x${string}`);
  const client = createClient({ chains: [BNB_TESTNET] });
  const signer = signerFromPrivateKey(("0x" + key) as `0x${string}`);
  const wallet = await client.createWallet({ signer });

  // grant session allowlisting the GuardRouter
  const session = await client.grantSession({
    wallet, signer, chainId: 97,
    permissions: { calls: [{ to: GUARD }], spend: [{ limit: 100_000_000_000_000n, period: "day" }] }, // 0.0001 tBNB
    expiry: Math.floor(Date.now() / 1000) + 2 * 86400,
  });
  const sessionKey = (session.signer as any)?.address;
  const pk = (session.publicKey ?? (session.signer as any)?.publicKey) as `0x${string}`;
  console.log("session granted → key:", sessionKey, "| wallet (relay acct):", wallet.address);

  // GuardRouter.createHire — sessionKey param = the ACCOUNT that executes the
  // userOp (wallet.address = Porto account), not the session sub-key. The
  // session key signs the userOp; the account is msg.sender at the target.
  const { createWalletClient } = await import("viem");
  const agentClient = createWalletClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com"), account: agent });
  const hireId = "0x" + Buffer.from(sessionKey).toString("hex").padEnd(64, "0").slice(0, 64);
  const tokenScope = [USDT, WBNB];
  const hireTx = await agentClient.writeContract({ address: GUARD, abi: guardAbi, functionName: "createHire", args: [hireId as `0x${string}`, wallet.address, tokenScope as any, 1_000_000_000_000_000_000n] });
  await pub.waitForTransactionReceipt({ hash: hireTx });
  console.log("createHire tx:", hireTx, "| hireId:", hireId, "| sessionKey(account):", wallet.address);

  // approve GuardRouter to pull USDT (from the agent EOA directly)
  const appr = await agentClient.writeContract({ address: USDT as `0x${string}`, abi: erc20Abi, functionName: "approve", args: [GUARD, parseUnits("0.001", 18)] });
  await pub.waitForTransactionReceipt({ hash: appr });
  console.log("approved GuardRouter for USDT:", appr);

  // execute the swap THROUGH the session key via Altana execute
  const calls = [{ to: GUARD, value: 0n, data: encodeSwapData(GUARD, hireId, parseUnits("0.001", 18), [USDT, WBNB], wallet.address) }];
  console.log("executing swap through session key...");
  const res = await client.execute({ session, chainId: 97, calls: calls as any });
  console.log("execute result:", JSON.stringify(res, (k, v) => typeof v === "bigint" ? String(v) : v).slice(0, 400));
  const execTx = (res as any).transactionHash ?? (res as any).hash ?? "";
  console.log("execute tx:", execTx);

  // decode the GuardRouter SwapForwarded from the execution receipt
  if (execTx) {
    const rec = await pub.waitForTransactionReceipt({ hash: execTx as `0x${string}` });
    const ev = parseAbi(["event SwapForwarded(bytes32 indexed hireId, address indexed caller, address[] path, uint256 amountIn, uint256 amountOut)"]);
    for (const l of rec.logs) {
      if (l.address.toLowerCase() !== GUARD.toLowerCase()) continue;
      try {
        const p = decodeEventLog({ abi: ev, data: l.data, topics: l.topics } as any);
        console.log("  SwapForwarded → hireId:", (p.args as any).hireId, "| caller:", (p.args as any).caller, "| amountIn:", (p.args as any).amountIn.toString(), "| amountOut:", (p.args as any).amountOut.toString());
      } catch {}
    }
  }
}

function encodeSwapData(guard: `0x${string}`, hireId: `0x${string}`, amountIn: bigint, path: `0x${string}`[], to: `0x${string}`) {
  return encodeFunctionData({
    abi: [{ inputs: [{ name: "hireId", type: "bytes32" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], name: "swapExactTokensForTokensGuarded", outputs: [{ type: "uint256[]" }], stateMutability: "nonpayable", type: "function" }],
    functionName: "swapExactTokensForTokensGuarded",
    args: [hireId, amountIn, 0n, path, to, BigInt(Math.floor(Date.now() / 1000) + 600)],
  }) as `0x${string}`;
}
main().catch((e) => { console.error("ERR:", (e as Error).message?.slice(0, 300) || String(e)); process.exit(1); });
