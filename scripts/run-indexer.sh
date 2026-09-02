#!/bin/bash
# THE SIDEKICK indexer — cron wrapper.
# Runs the BNB testnet indexer every 2 hours. Keeps output to a log that's
# checked for the summary. Because publicnode prunes old history, the default
# run uses a rolling window (see lib/indexer/indexer.ts DEFAULT_WINDOW_BLOCKS).
#
# Scheduled via a Hermes cron job (see the cron configured in chat) OR Windows
# Task Scheduler: schtasks /create /tn the-sidekick-indexer /tr "bash .../run-indexer.sh" /sc HOURLY /mo 2
cd "$(dirname "$0")/.." || exit 1

LOG="$PWD/.indexer-logs/indexer-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$PWD/.indexer-logs"

echo "=== indexer run $(date) ===" >> "$LOG"
npm run index:run >> "$LOG" 2>&1
echo "=== done $(date) ===" >> "$LOG"

# Keep only the last 20 logs
ls -1t "$PWD/.indexer-logs"/indexer-*.log 2>/dev/null | tail -n +21 | xargs -r rm -f

echo "run complete — log: $LOG"
tail -8 "$LOG"
