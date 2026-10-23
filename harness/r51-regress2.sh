#!/bin/sh
# R51 lane A — second no-regression pass on the final code (adaptive graph block, relation groups without "teslim").
cd "$(dirname "$0")"
M=recallMemories,recallGraph,graphPlusMemories,recallContext,studioRecall,eraBrainSearch,eraBrainGraph,eraTurn,brainContext
echo "start $(date +%H:%M)"
bun run datasets/r51-retr.ts p > logs-R51-retr-final.log 2>&1; echo "retr dev $(date +%H:%M) $?"
bun run r51a-check.ts > logs-R51-check-a.log 2>&1; echo "r51a-check $(date +%H:%M) $?"
bun run runA-full.ts trbizH r51 --sweep --methods=$M > logs-R51-final-trbizH.log 2>&1; echo "trbizH $(date +%H:%M) $?"
bun run runA-full.ts trbizH2 r51 --methods=recallMemories,recallGraph,recallContext,eraTurn > logs-R51-final-trbizH2.log 2>&1; echo "trbizH2 $(date +%H:%M) $?"
bun run runA-full.ts trbizA r51 --sweep --methods=$M > logs-R51-final-trbizA.log 2>&1; echo "trbizA $(date +%H:%M) $?"
bun run check-gaps.ts trbizA > logs-R51-final-gaps.log 2>&1; echo "gaps $(date +%H:%M) $?"
bun run runA-full.ts biz100k r51 --methods=recallMemories,recallGraph,recallContext > logs-R51-final-biz100k.log 2>&1; echo "biz100k $(date +%H:%M) $?"
echo "done $(date +%H:%M)"
