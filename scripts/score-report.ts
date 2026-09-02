import { scoreAllWallets } from "../lib/scoring/engine";
async function main() {
  const results = await scoreAllWallets();
  console.log("═ TRUST SCORE + RISK LABELS — all listed wallets ═\n");
  for (const r of results) {
    console.log(`[${r.wallet.slice(0,10)}…] ${r.category} (token ${r.tokenId})`);
    console.log(`  trust   : ${r.trustScore} / 100   [verified=${r.verified}]`);
    console.log(`   40% age/activity : ${r.ageActivity}   (age=${r.ageDays.toFixed(2)}d, tx=${r.txCount}, consistent=${r.behaviorConsistent})`);
    console.log(`   30% reputation   : ${r.reputation}`);
    console.log(`   30% bond relative: ${r.bondRelative}`);
    console.log(`   − risk penalty   : ${r.riskPenalty}`);
    console.log(`  risk flags: ${r.riskLabelCount} | ${r.riskLabels.length ? r.riskLabels.slice(0,4).map((x)=>`${x.label}(${x.confidence}%)`).join(", ") : "none"}`);
    console.log(`  data confidence: ${r.dataConfidence} | firstTx: ${r.firstTxTimestamp ?? "n/a"}\n`);
  }
}
main().catch((e) => { console.error("ERR:", e.message || e); process.exit(1); });
