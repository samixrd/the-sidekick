/**
 * HIRE FLOW — create a delegation for a hired agent.
 *
 * Wires (all REAL on BSC testnet):
 *   1. Altana session-key grant: allowlist points at the Guard Router, spend
 *      cap + expiry. Session key is registered in the public Keystore.
 *   2. GuardRouter.createHire(hireId, sessionKey, tokens, minLiquidity) — the
 *      per-hire policy (reuses the proven Guard Router pattern).
 *   3. ERC-8183 createJob(provider=agentWallet, expiredAt=session expiry) via
 *      the @bnbagent/sdk (gas-free through the paymaster).
 *   4. Persist the delegation to Supabase `delegations`.
 *
 * Consumed by the Hire SSE route (app/api/agents/[wallet]/hire). The ESM SDKs
 * are loaded at runtime via next.config `serverComponentsExternalPackages`.
 */
import { createClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { ERC8183Client, AltanaWalletProvider } from "@bnbagent/sdk";
import { createAdminSupabaseClient } from "../supabase/admin";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { envGet } from "../env";

export interface HireStep {
  step: string;        // "session-grant" | "create-hire" | "erc8183-job" | "persist"
  label: string;
  txHash?: string;
  jobId?: string;
  error?: string;
  done: boolean;
}

export interface HireDelegationOpts {
  agentId: string;
  agentName: string;
  agentWallet: `0x${string}`;   // hired agent (provider)
  spendCapTbnb: number;
  tokenScope: `0x${string}`[];   // approved tokens
  minLiquidity: number;          // token units (18-dec)
  days: number;
  user: string;                  // delegating owner (the connected wallet)
  agentKey?: `0x${string}`;      // resolved server-side; never passed from the client
  onStep?: (s: HireStep) => void | Promise<void>;
}

export async function createDelegation(o: HireDelegationOpts) {
  const admin = createAdminSupabaseClient();
  const GUARD = envGet("GUARD_ROUTER") as `0x${string}`;
  const step = (s: HireStep) => { if (o.onStep) return o.onStep(s); };

  // ── 1) Altana session grant (allowlist → Guard Router; Keystore-registered) ──
  await step({ step: "session-grant", label: "Granting Altana session key (allowlist → Guard Router)", done: false });
  const client = createClient({ chains: [BNB_TESTNET] });
  const adminSigner = signerFromPrivateKey(o.agentKey!);
  const wallet = await client.createWallet({ signer: adminSigner });
  // Persisted session signer: we generate the session key ourselves so the
  // scheduled strategy loop can reconstruct the session later (no user present
  // at 3am). It only permits calls to the GuardRouter, capped by the spend cap.
  const sessionPkBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) sessionPkBytes[i] = Math.floor(Math.random() * 256);
  const sessionPk = ("0x" + Buffer.from(sessionPkBytes).toString("hex")) as `0x${string}`;
  const sessionSigner = signerFromPrivateKey(sessionPk);
  const session = await client.grantSession({
    wallet,
    signer: adminSigner,
    sessionSigner,
    chainId: 97,
    permissions: {
      calls: [{ to: GUARD }],                              // ONLY the Guard Router
      spend: [{ limit: BigInt(Math.floor(o.spendCapTbnb * 1e18)), period: "day" }],
    },
    expiry: Math.floor(Date.now() / 1000) + o.days * 86400,
  });
  const sessionKey = (session.signer as any)?.address ?? "see-tx";
  const accountAddr = wallet.address as `0x${string}`; // the account that executes the userOp → msg.sender at the GuardRouter
  const sessionPubKey = (session.signer as any)?.publicKey ?? "";
  const sessionTx = session.transactionHash ?? "";
  await step({ step: "session-grant", label: "Altana session key granted", txHash: sessionTx, done: true });

  // ── 2) GuardRouter.createHire (hireId = the session key id) ──
  await step({ step: "create-hire", label: "Registering per-hire policy on GuardRouter (createHire)", done: false });
  // GuardRouter.createHire sessionKey param = the ACCOUNT (msg.sender during a
  // session userOp), NOT the session sub-key. The sub-key signs the userOp; the
  // account executes it. hireId is still derived from the sub-key (matches the
  // SwapForwarded event) so guard-spends can attribute spend to this hire.
  const { tx: grantHireHash, hireId } = await createGuardHire({
    sessionKey, account: accountAddr, tokenScope: o.tokenScope, minLiquidity: o.minLiquidity,
    agentKey: o.agentKey!, guard: GUARD,
  });
  await step({ step: "create-hire", label: "GuardRouter createHire confirmed", txHash: grantHireHash, done: true });

  // ── 3) ERC-8183 createJob (provider = agent, expiry = session expiry) ──
  await step({ step: "erc8183-job", label: "Creating ERC-8183 job record", done: false });
  const provider = new AltanaWalletProvider({ network: "bnb-testnet", privateKey: o.agentKey! });
  const commerce = await ERC8183Client.create({ network: "bsc-testnet", walletProvider: provider });
  const expiryAbs = Math.floor(Date.now() / 1000) + o.days * 86400;
  const desc = `version=1;negotiated_at=${Math.floor(Date.now() / 1000)};task=Hire ${o.agentName};expiry=${expiryAbs};terms=guard_router:${GUARD}`;
  const job = await commerce.createJob({ provider: o.agentWallet, expiredAt: BigInt(expiryAbs), description: desc });
  const jobId = (job as any).id ?? String((job as any).jobId ?? "");
  const jobTx = (job as any).transactionHash ?? (job as any).txHash ?? "";
  await step({ step: "erc8183-job", label: "ERC-8183 job created", txHash: jobTx, jobId, done: true });

  // ── 4) persist delegation ──
  await step({ step: "persist", label: "Persisting delegation to Supabase", done: false });
  const id = `KS-${Date.now().toString(36).toUpperCase()}`;
  const { data, error } = await admin.from("delegations").insert({
    id,
    user_id: o.user,
    agent_id: o.agentId,
    agent_wallet: o.agentWallet.toLowerCase(),
    session_key: sessionKey.toLowerCase(),
    session_public_key: sessionPubKey || null,
    session_private_key: sessionPk,
    hire_id: hireId.toLowerCase(),
    guard_router: GUARD.toLowerCase(),
    token_scope: JSON.stringify(o.tokenScope),
    min_liquidity: String(o.minLiquidity),
    spend_cap: String(o.spendCapTbnb),
    amount_used: "0",
    expiry: expiryAbs,
    tx_hash: sessionTx,
    erc8183_job_id: jobId,
    erc8183_tx_hash: jobTx,
    status: "active",
  }).select().single();

  if (error) throw new Error("supabase persist: " + error.message);
  await step({ step: "persist", label: "Delegation persisted", done: true });
  return { delegId: id, sessionKey, sessionTx, grantHireHash, hireId, jobId, jobTx, record: data };
}

/** Resolve an agent's private key server-side (never from the client). */
export function resolveAgentKey(agentWallet: `0x${string}`): `0x${string}` | null {
  const get = (k: string) => envGet(k).replace(/^0x/, "");
  const jsonPath = "D:/BNB HACKATHON/the-tape/agents/.agent-wallets.json";
  let jsonKeys: Record<string, string> = {};
  try { jsonKeys = JSON.parse(readFileSync(jsonPath, "utf8")); } catch { /* ignore (not present on server deploys) */ }

  const candidates = [
    get("CAT_REBALANCE_KEY"), get("CAT_YIELD_KEY"), get("CAT_HEALTH_KEY"), get("CAT_GRID_KEY"),
    jsonKeys["GRD-07"], jsonKeys["RNG-01"], jsonKeys["RNG-04"], jsonKeys["RNG-07"],
    jsonKeys["YLD-02"], jsonKeys["YLD-05"], jsonKeys["YLD-08"],
    jsonKeys["HF-11"], jsonKeys["HF-13"], jsonKeys["HF-17"],
  ].filter((v) => typeof v === "string" && v.length >= 62);

  for (const k of candidates) {
    try {
      if (privateKeyToAccount(("0x" + k).replace(/^0x0x/, "0x") as `0x${string}`).address.toLowerCase() === agentWallet.toLowerCase()) {
        return ("0x" + k).replace(/^0x0x/, "0x") as `0x${string}`;
      }
    } catch { /* continue */ }
  }
  return null;
}

async function createGuardHire(args: {
  sessionKey: string; account: `0x${string}`; tokenScope: `0x${string}`[]; minLiquidity: number; agentKey: `0x${string}`; guard: `0x${string}`;
}): Promise<{ tx: string; hireId: `0x${string}` }> {
  const { createWalletClient, createPublicClient, http, parseUnits, getAddress } = await import("viem");
  const { bscTestnet } = await import("viem/chains");
  const { privateKeyToAccount } = await import("viem/accounts");
  const rpc = envGet("BSC_TESTNET_RPC_URL") || "https://bsc-testnet-rpc.publicnode.com";
  const pub = createPublicClient({ chain: bscTestnet, transport: http(rpc) });
  const signer = privateKeyToAccount(args.agentKey);
  const agent = createWalletClient({ chain: bscTestnet, transport: http(rpc), account: signer });
  // Bundled ABI (imported, so serverless file-tracing ships it — reading
  // contracts/build/ at runtime breaks on Vercel/lambda deploys).
  const abi = (await import("./abis/GuardRouter.json")).default;
  const hireId = ("0x" + Buffer.from(args.sessionKey).toString("hex").padEnd(64, "0").slice(0, 64)) as `0x${string}`;
  const min = parseUnits(String(args.minLiquidity), 18);
  // viem writeContract enforces EIP-55 checksum on address args — normalise each scope token.
  const scope = args.tokenScope.map((t) => getAddress(t as `0x${string}`) as `0x${string}`) as any;
  const tx = await agent.writeContract({ address: getAddress(args.guard), abi, functionName: "createHire", args: [hireId, getAddress(args.account), scope, min] });
  await pub.waitForTransactionReceipt({ hash: tx });
  return { tx, hireId };
}
