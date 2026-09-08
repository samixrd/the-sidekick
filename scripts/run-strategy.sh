#!/bin/bash
# THE SIDEKICK strategy loop — cron wrapper.
# Runs one full strategy cycle (all 4 category agents). The PRIMARY scheduler
# is the 15-min GitHub Actions cron (.github/workflows/agent-autonomy.yml);
# this wrapper is the local/Windows fallback. Every decision is appended to
# `strategy_runs`; executed txs are real on-chain transactions that the
# checkpointed indexer (same workflow) attributes to the agent wallets.
#
# Scheduled via a Hermes cron job OR Windows Task Scheduler:
#   schtasks /create /tn the-sidekick-strategy /tr "bash .../run-strategy.sh" /sc MINUTE /mo 45
cd "$(dirname "$0")/.." || exit 1

LOG="$PWD/.strategy-logs/strategy-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$PWD/.strategy-logs"

echo "=== strategy cycle $(date) ===" >> "$LOG"
npm run strategy:cycle >> "$LOG" 2>&1
echo "=== done $(date) ===" >> "$LOG"

# Keep only the last 40 logs
ls -1t "$PWD/.strategy-logs"/strategy-*.log 2>/dev/null | tail -n +41 | xargs -r rm -f

echo "strategy cycle complete — log: $LOG"
tail -10 "$LOG"
