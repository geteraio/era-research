#!/bin/sh
# R51 lane A — no-regression runs on the final code, strictly sequential (one heavy job, under heavy.lock via r51-heavy.sh).
cd "$(dirname "$0")"
M=recallMemories,recallGraph,graphPlusMemories,recallContext,studioRecall,eraBrainSearch,eraBrainGraph,eraTurn,brainContext
echo "start $(date +%H:%M)"
bun run r51a-check.ts > logs-R51-check-a.log 2>&1; echo "r51a-check $(date +%H:%M) $?"
bun run datasets/trbizH-gen.ts > logs-R51-trbizH-gen.log 2>&1; echo "trbizH gen $(date +%H:%M) $?"
bun run runA-full.ts trbizH r51 --sweep --methods=$M > logs-R51-final-trbizH.log 2>&1; echo "trbizH $(date +%H:%M) $?"
bun run datasets/trbizH2-gen.ts > logs-R51-trbizH2-gen.log 2>&1; echo "trbizH2 gen $(date +%H:%M) $?"
bun run runA-full.ts trbizH2 r51 --methods=recallMemories,recallGraph,recallContext,eraTurn > logs-R51-final-trbizH2.log 2>&1; echo "trbizH2 $(date +%H:%M) $?"
bun run datasets/trbizA-gen.ts > logs-R51-trbizA-gen.log 2>&1; echo "trbizA gen $(date +%H:%M) $?"
bun run runA-full.ts trbizA r51 --sweep --methods=$M > logs-R51-final-trbizA.log 2>&1; echo "trbizA $(date +%H:%M) $?"
bun run check-gaps.ts trbizA > logs-R51-final-gaps.log 2>&1; echo "gaps $(date +%H:%M) $?"
bun run datasets/biz100k-gen.ts > logs-R51-biz100k-gen.log 2>&1; echo "biz100k gen $(date +%H:%M) $?"
bun run runA-full.ts biz100k r51 --methods=recallMemories,recallGraph,recallContext > logs-R51-final-biz100k.log 2>&1; echo "biz100k $(date +%H:%M) $?"
echo "done $(date +%H:%M)"
