"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { connectWallet, sendTransaction, shortAddr } from "@/components/agent-detail/wallet";

type Category = "Rebalancing" | "Grid Trading" | "Yield" | "Health-Factor";
const CATEGORIES: Category[] = ["Rebalancing", "Grid Trading", "Yield", "Health-Factor"];

interface Step { key: string; label: string; status: "idle" | "active" | "done" | "error"; txHash?: string; note?: string; }

const BSCSCAN = "https://testnet.bscscan.com/tx/";

export function ListAgentForm() {
  const router = useRouter();
  const [category, setCategory] = useState<Category>("Grid Trading");
  const [agentWallet, setAgentWallet] = useState("");
  const [description, setDescription] = useState("");
  const [connected, setConnected] = useState<{ address: string; chainId: number } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [finalTx, setFinalTx] = useState<string | null>(null);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onConnect() {
    setConnecting(true); setError(null);
    try { setConnected(await connectWallet()); } catch (e) { setError((e as Error).message); } finally { setConnecting(false); }
  }

  function setStep(key: string, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!connected) { setError("Connect your wallet first — it signs the bond transaction."); return; }
    if (!/^0x[a-fA-F0-9]{40}$/.test(agentWallet)) { setError("Agent wallet must be a 0x address."); return; }
    if (description.trim().length < 5) { setError("Description must be at least 5 characters."); return; }

    setRunning(true);
    setSteps([
      { key: "prepare", label: "Prepare (register identity if needed)", status: "active" },
      { key: "sign", label: "Sign + send bond tx (your wallet)", status: "idle" },
      { key: "finalize", label: "Confirm + persist listing", status: "idle" },
    ]);

    let tok: string;
    try {
      // ── PHASE A: prepare (server registers identity if needed, returns calldata) ──
      const prepRes = await fetch("/api/agents/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentWallet, category, description, lister: connected.address }) });
      const prep = await prepRes.json();
      if (!prepRes.ok || !prep.ok) throw new Error(prep.error || `prepare HTTP ${prepRes.status}`);
      tok = prep.tokenId;
      setTokenId(tok);
      setStep("prepare", { status: "done", note: `identity ready (tokenId #${tok})` });

      // ── PHASE B: connected wallet signs + sends the bond tx ──
      setStep("sign", { status: "active", label: "Sign + send bond tx (0.01 tBNB)" });
      const txHash = await sendTransaction({ to: prep.listTx.to, data: prep.listTx.data, value: prep.listTx.value });
      setStep("sign", { status: "done", txHash });

      // ── PHASE C: finalize (server verifies on-chain + persists) ──
      setStep("finalize", { status: "active" });
      const finRes = await fetch("/api/agents/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokenId: tok, listTxHash: txHash, agentWallet, category, description, lister: connected.address }) });
      const fin = await finRes.json();
      if (!finRes.ok || !fin.ok) throw new Error(fin.error || `finalize HTTP ${finRes.status}`);
      setStep("finalize", { status: "done", txHash });
      setFinalTx(txHash);
      setAgentWallet(""); setDescription("");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      // mark the active step as error
      setSteps((prev) => prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s)));
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-border bg-surface p-6">
      <div>
        <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-faint">Category</label>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)}
              className={`rounded border px-3 py-2 text-xs font-medium transition-colors ${category === c ? "border-accent bg-accent text-on-accent" : "border-border bg-background text-muted hover:border-border-strong"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-faint">Agent wallet (0x address of the agent being listed)</label>
        <input value={agentWallet} onChange={(e) => setAgentWallet(e.target.value)} placeholder="0x…"
          className="focus-ring w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-faint" required />
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-faint">Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
          placeholder="What does this agent do? (used as the ERC-8004 registration file)"
          className="focus-ring w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint" required />
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={onConnect} disabled={connecting}
          className="focus-ring rounded border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50">
          {connecting ? "Connecting…" : connected ? shortAddr(connected.address) : "Connect Wallet"}
        </button>
        <button type="submit" disabled={running || !connected || !agentWallet || description.trim().length < 5}
          className="focus-ring rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50">
          {running ? "Listing…" : "List Agent (0.01 tBNB bond)"}
        </button>
      </div>
      {!connected && <p className="text-[11px] text-faint">Connect your wallet to sign the bond transaction — the server never holds your key.</p>}

      {error && <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>}

      {steps.length > 0 && (
        <div className="space-y-2 rounded border border-border bg-background p-4">
          {steps.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <span className={`h-2 w-2 rounded-full ${s.status === "done" ? "bg-accent" : s.status === "error" ? "bg-red-500" : s.status === "active" ? "animate-pulse bg-accent" : "bg-border"}`} />
              <span className={s.status === "error" ? "text-red-200" : s.status === "active" ? "text-foreground" : "text-muted"}>{s.label}</span>
              {s.status === "done" && s.txHash && <a href={BSCSCAN + s.txHash} target="_blank" rel="noreferrer" className="ml-auto font-mono text-[10px] text-accent underline-offset-2 hover:underline">{s.txHash.slice(0, 10)}…{s.txHash.slice(-6)}</a>}
              {s.status === "done" && s.note && <span className="ml-auto text-[10px] text-faint">{s.note}</span>}
            </div>
          ))}
        </div>
      )}

      {finalTx && connected && (
        <div className="rounded border border-accent/40 bg-accent-faint p-3 text-xs">
          ✅ Listed agent <span className="font-mono">#{tokenId}</span>.
          Bond tx: <a href={BSCSCAN + finalTx} target="_blank" rel="noreferrer" className="font-mono text-accent underline-offset-2 hover:underline">{finalTx.slice(0, 12)}…{finalTx.slice(-8)}</a>.
          <button onClick={() => router.push("/")} className="ml-2 text-muted underline-offset-2 hover:text-foreground hover:underline">View on Home</button>
        </div>
      )}
    </form>
  );
}
