/**
 * STRATEGY CYCLE runner — one full loop across all 4 category agents.
 * Run:  npm run strategy:cycle
 * (The 45-min cron calls this via scripts/run-strategy.sh.)
 */
import { runCycle } from "../lib/strategies/loop";

async function main() {
  const t0 = Date.now();
  console.log(`=== strategy cycle ${new Date().toISOString()} ===`);
  const results = await runCycle();
  for (const r of results) {
    const tag = r.error ? "ERROR" : r.acted ? "ACTED" : "idle ";
    const tx = r.txHash ? ` tx=${r.txHash.slice(0, 14)}…` : "";
    const err = r.error ? ` — ${r.error.slice(0, 160)}` : "";
    console.log(`  [${tag}] ${r.category.padEnd(14)} hire=${r.hireLinked ? "yes" : "no "} ${r.reason}${tx}${err}`);
  }
  const acted = results.filter((r) => r.acted).length;
  const errors = results.filter((r) => r.error).length;
  console.log(`=== cycle done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${acted} acted, ${errors} errors, ${results.length} agents ===`);
  if (errors > 0) process.exit(2); // cron-visible failure, but never throws mid-cycle
}

main().catch((e) => { console.error("cycle failed:", e?.message ?? e); process.exit(1); });
