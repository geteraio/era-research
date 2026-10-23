#!/bin/sh
# R45 final runs, strictly sequential.
cd "$(dirname "$0")"
M=recallMemories,recallGraph,graphPlusMemories,studioRecall,eraBrainSearch,eraBrainGraph,eraTurn,brainContext
echo "start $(date +%H:%M)"
bun run runA-full.ts trbizH r45 --sweep --methods=$M > logs-R45-final-trbizH.log 2>&1; echo "trbizH $(date +%H:%M) $?"
bun run runA-full.ts trbizH2 r45 --methods=recallMemories,recallGraph,eraTurn > logs-R45-final-trbizH2.log 2>&1; echo "trbizH2 $(date +%H:%M) $?"
bun run runA-full.ts trbizA r45 --sweep --methods=$M > logs-R45-final-trbizA.log 2>&1; echo "trbizA $(date +%H:%M) $?"
bun run runA-full.ts biz100k r45 --methods=recallMemories,recallGraph > logs-R45-final-biz100k.log 2>&1; echo "biz100k $(date +%H:%M) $?"
bun run datasets/memeval-r45.ts locomo r45 --methods=recallMemories --drop > logs-R45-final-locomo.log 2>&1; echo "locomo $(date +%H:%M) $?"
bun run datasets/memeval-r45.ts lme r45 --methods=recallMemories --drop > logs-R45-final-lme.log 2>&1; echo "lme $(date +%H:%M) $?"
bun run check-gaps.ts trbizA > logs-R45-final-gaps.log 2>&1; echo "gaps $(date +%H:%M) $?"
echo "done $(date +%H:%M)"
