/**
 * BNB Chain utilities — addresses, wei math, chain config.
 */

export const BSC_TESTNET_RPC = process.env.BSC_TESTNET_RPC_URL ?? "";
export const BSC_TESTNET_CHAIN_ID = 97;
export const BNB_DECIMALS = 18;

/** Truncate an EVM address for display: 0x1234…abcd */
export function shortAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

/** Convert a wei string/BigInt into a human BNB string (6 dp, tabular). */
export function weiToBnb(wei: bigint | string, decimals = BNB_DECIMALS): string {
  const value = typeof wei === "string" ? BigInt(wei) : wei;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").slice(0, 6);
  return `${whole}.${fraction}`;
}
