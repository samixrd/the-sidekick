"use client";

/** BSC testnet chain details (chainId 97). Used to auto-add/switch the network. */
const BSC_TESTNET_CHAIN = {
  chainId: "0x61", // 97
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "BNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://bsc-testnet-rpc.publicnode.com"],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
};

/**
 * Real wallet connect via EIP-1193 (window.ethereum). Returns the connected
 * wallet address + chainId, auto-switching to BSC testnet (chainId 97) if the
 * wallet is on another network — and adding the network if it isn't present.
 * Never mocks an address.
 */
export async function connectWallet(): Promise<{ address: string; chainId: number } | null> {
  const ethereum = (window as any).ethereum as {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  } | undefined;
  if (!ethereum) {
    throw new Error("No injected wallet (window.ethereum) found. Install MetaMask or another browser wallet.");
  }
  const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
  let address = accounts[0] ?? null;
  if (!address) {
    address = ((await ethereum.request({ method: "eth_requestAccounts" })) as string[])[0] ?? null;
  }
  if (!address) return null;

  // ── auto-switch to BSC testnet (chain 97) if on another network ──
  try {
    let chainId = Number(await ethereum.request({ method: "eth_chainId" }));
    if (chainId !== 97) {
      try {
        await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_TESTNET_CHAIN.chainId }] });
        chainId = 97;
      } catch (switchErr: any) {
        // 4902 = chain not added yet; add it, then switch
        if (switchErr?.code === 4902 || /chain.*not.*add/i.test(String(switchErr?.message ?? ""))) {
          await ethereum.request({ method: "wallet_addEthereumChain", params: [BSC_TESTNET_CHAIN] });
          await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_TESTNET_CHAIN.chainId }] });
          chainId = 97;
        } else {
          // user rejected the switch — keep current chain
          chainId = Number(await ethereum.request({ method: "eth_chainId" }));
        }
      }
    }
    return { address, chainId };
  } catch {
    // chain switch failed for another reason — still return the wallet on its current chain
    return { address, chainId: Number(await ethereum.request({ method: "eth_chainId" })) };
  }
}

/** Send a raw tx via the injected wallet (connected wallet signs). Returns tx hash. */
export async function sendTransaction(tx: { to: string; data: string; value?: string }): Promise<string> {
  const ethereum = (window as any).ethereum as { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } | undefined;
  if (!ethereum) throw new Error("No injected wallet (window.ethereum) found.");
  const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
  const from = accounts[0];
  if (!from) throw new Error("Wallet not connected.");
  const params = { from, to: tx.to, data: tx.data };
  if (tx.value) (params as any).value = tx.value;
  const hash = await ethereum.request({ method: "eth_sendTransaction", params: [params] });
  return String(hash);
}

/** Read an SSE stream of hire progress, invoking onEvent for each parsed object. */
export async function readHireStream(
  res: Response,
  onEvent: (data: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (line.startsWith("data: ")) {
          try { onEvent(JSON.parse(line.slice(6))); } catch { /* ignore malformed */ }
          break;
        }
      }
    }
  }
}

/** Short + full address. */
export function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

/** Explicitly switch the injected wallet to BSC testnet (chain 97). */
export async function switchToBscTestnet(): Promise<number> {
  const ethereum = (window as any).ethereum as { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } | undefined;
  if (!ethereum) throw new Error("No injected wallet (window.ethereum) found.");
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_TESTNET_CHAIN.chainId }] });
  } catch (e: any) {
    if (e?.code === 4902 || /chain.*not.*add/i.test(String(e?.message ?? ""))) {
      await ethereum.request({ method: "wallet_addEthereumChain", params: [BSC_TESTNET_CHAIN] });
      await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_TESTNET_CHAIN.chainId }] });
    } else {
      const chainId = Number(await ethereum.request({ method: "eth_chainId" }));
      return chainId;
    }
  }
  return 97;
}
