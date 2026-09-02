import { computeAllMetrics } from "../lib/metrics";
async function main() {
  const results = await computeAllMetrics();
  console.log("═ METRICS — all wallets (derived purely from indexed data) ═\n");
  for (const r of results) {
    console.log(`[${r.wallet.slice(0,10)}…] ${r.category}`);
    console.log(`  freshness: ${r.freshness.lastActionAgoMin === null ? "no action" : `last ${r.freshness.lastActionAgoMin} min ago`} (${r.freshness.cadenceNote})`);
    console.log(`  P&L: realizedLife=${r.pnl.realizedLifetime} realized7d=${r.pnl.realized7d} mtm=${r.pnl.markToMarket} totalLife=${r.pnl.totalLifetime} total7d=${r.pnl.total7d} | in=${r.pnl.inQuoteUsd}$ out=${r.pnl.outQuoteUsd}$`);
    console.log(`  skill/luck: label=${r.skillLuck.label} alpha=${r.skillLuck.alphaVsHold} bestConc=${r.skillLuck.bestTradeConcentration}`);
    console.log(`  risk: winRate=${r.risk.winRate} wins=${r.risk.wins} trades=${r.risk.trades} mdd=${r.risk.maxDrawdownPct}% posVsCap=${r.risk.avgPosVsCap === null ? "n/a" : (r.risk.avgPosVsCap*100).toFixed(1)+"%"}`);
    console.log(`  strategy: consistent=${r.strategy.consistent} | ${r.strategy.detail}`);
    console.log(`  benchmark: own=${r.benchmark.ownReturn} catAvg=${r.benchmark.categoryAvg} peers=${r.benchmark.peers}`);
    console.log(`  12h: ${r.recent12h.txCount} tx ${JSON.stringify(r.recent12h.byType)}`);
    console.log(`  notes: P&L="${r.pnl.note}" | risk="${r.risk.note}" | strategy="${r.strategy.note}" | bench="${r.benchmark.note}"\n`);
  }
}
main().catch((e) => { console.error("ERR:", e.message || e); process.exit(1); });
