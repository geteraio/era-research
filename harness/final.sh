#!/bin/sh
# Final measured runs, strictly sequential (no other bench load). before = pristine HEAD export, after = working tree (P + T).
cd "$(dirname "$0")"
H="$PWD/head"
echo "start $(date +%H:%M)"
git -C ${ERA_REPO:?set ERA_REPO to an Era checkout} status --porcelain -- apps/brain-agent/src/brain apps/studio/lib/brain packages/db packages/os-kernel/sql > logs-final-tree.txt
BB2_CODE="$H" bun run run.ts trbiz before --sweep > logs-final-trbiz-before.log 2>&1; echo "trbiz before $(date +%H:%M)"
bun run run.ts trbiz after --sweep > logs-final-trbiz-after.log 2>&1; echo "trbiz after $(date +%H:%M)"
BB2_CODE="$H" bun run run.ts biz100k before --methods=recallMemories,recallGraph,graphPlusMemories,vectorTop10 > logs-final-biz-before.log 2>&1; echo "biz before $(date +%H:%M)"
bun run run.ts biz100k after --methods=recallMemories,recallGraph,graphPlusMemories,vectorTop10 > logs-final-biz-after.log 2>&1; echo "biz after $(date +%H:%M)"
BB2_CODE="$H" bun run datasets/memeval.ts locomo before > logs-final-locomo-before.log 2>&1; echo "locomo before $(date +%H:%M)"
bun run datasets/memeval.ts locomo after > logs-final-locomo-after.log 2>&1; echo "locomo after $(date +%H:%M)"
BB2_CODE="$H" bun run datasets/memeval.ts lme before > logs-final-lme-before.log 2>&1; echo "lme before $(date +%H:%M)"
bun run datasets/memeval.ts lme after > logs-final-lme-after.log 2>&1; echo "lme after $(date +%H:%M)"
echo "done $(date +%H:%M)"
