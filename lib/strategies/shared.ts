/**
 * Shared strategy helpers — BSC testnet clients, ERC-20, WBNB, PCS, Venus.
 * Each category strategy is a SEPARATE wallet strictly executing ONE strategy.
 */
import { createWalletClient, createPublicClient, http, type Address, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env deterministically (strategies run as standalone tsx).
try {
  for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
    if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
  }
} catch { /* no .env */ }

export const RPC = "https://bsc-testnet-rpc.publicnode.com";
export const CHAIN = bscTestnet;

export const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34DdD".toLowerCase() as Address;
export const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd".toLowerCase() as Address;
export const PCS_ROUTER = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1".toLowerCase() as Address;
export const PCS_FACTORY = "0x6725F303b657a9451d8BA641348b6761A6CC7a17".toLowerCase() as Address;
export const PCS_PAIR = "0x5F52Ad4bD4f519AE79999400ad8B83A3D002fD92".toLowerCase() as Address;

export const VENUS_COMPTROLLER = "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D".toLowerCase() as Address;
export const VENUS_vWBNB = "0xd9E77847ec815E56ae2B9E69596C69b6972b0B1C".toLowerCase() as Address;
export const VENUS_vBUSD = "0x08e0A5575De71037aE36AbfAfb516595fE68e5e4".toLowerCase() as Address;
export const VENUS_VAI = "0xf70C3C6b749BbAb89C081737334E74C9aFD4BE16".toLowerCase() as Address;

export function publicClient(): PublicClient {
  return createPublicClient({ chain: bscTestnet, transport: http(RPC) });
}

export function walletFromEnv(envKey: string) {
  const raw = process.env[envKey] ?? "";
  if (!raw) throw new Error(`${envKey} not set in .env`);
  const key = (raw.startsWith("0x") ? raw : "0x" + raw) as `0x${string}`;
  const account = privateKeyToAccount(key);
  const client = createWalletClient({ chain: bscTestnet, transport: http(RPC), account });
  return { account, client, address: account.address as Address };
}

export const erc20Abi = [
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], name: "transfer", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" },
] as const;

export const wbnbAbi = [
  { inputs: [], name: "deposit", outputs: [], stateMutability: "payable", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

export const pairAbi = [
  { inputs: [], name: "token0", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "token1", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "getReserves", outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint32" }], stateMutability: "view", type: "function" },
] as const;

export const pcsRouterAbi = [
  { inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], name: "swapExactTokensForTokens", outputs: [{ type: "uint256[]" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], name: "swapExactETHForTokens", outputs: [{ type: "uint256[]" }], stateMutability: "payable", type: "function" },
  { inputs: [{ name: "amountOut", type: "uint256" }, { name: "amountInMax", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], name: "swapTokensForExactETH", outputs: [{ type: "uint256[]" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "amountADesired", type: "uint256" }, { name: "amountBDesired", type: "uint256" }, { name: "amountAMin", type: "uint256" }, { name: "amountBMin", type: "uint256" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], name: "addLiquidity", outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "WETH", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
] as const;

export async function approval(client: any, pc: PublicClient, token: Address, spender: Address, holder: Address, amount: bigint) {
  const cur = await pc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [holder, spender] });
  if (cur < amount) {
    const h = await client.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
    await pc.waitForTransactionReceipt({ hash: h });
    return h;
  }
  return null;
}

export async function balance(pc: PublicClient, token: Address, holder: Address) {
  return pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] });
}

export async function logBalance(pc: PublicClient, label: string, holder: Address) {
  const bnb = Number(await pc.getBalance({ address: holder })) / 1e18;
  const usdt = Number(await pc.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [holder] })) / 1e18;
  const wbnb = Number(await pc.readContract({ address: WBNB, abi: erc20Abi, functionName: "balanceOf", args: [holder] })) / 1e18;
  console.log(`  ${label}: tBNB=${bnb.toFixed(4)} USDT=${usdt.toFixed(4)} WBNB=${wbnb.toFixed(4)}`);
}
