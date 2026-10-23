# R42 · Lane B — Brain benchmarks (brain-bench2) — 2026-10-22

**before** = pristine `git archive` export of HEAD `890e63123` (Brain + studio sources), **after** = working tree with lanes P + T
(`apps/brain-agent/src/brain/{recall,graph-query}.ts`, `apps/studio/lib/brain/{recall,graph-query,brain-context}.ts`,
`packages/db/brain-paths.ts`, `sql/898_brain_speed.sql`; files unchanged since 01:11, final runs 02:30–03:53).
Both runs use the same DB schema: **898 was already applied to the test database before any baseline was possible**, so "before" =
HEAD code on the 898 schema. The pre-898 reference for the 100k set stays `../brain-bench/RESULTS.md`.
Every call runs under `runInOrganization` (engine role + RLS), as brain-agent runs. Final runs were strictly sequential, nothing else on the box.
**No LLM anywhere ($0):** answer generation / judging is replaced by *exact answer string in the context handed to the model*
and *evidence memories in the context*; tokens = **cl100k_base** count of that context (o200k also recorded in the JSON).

## 1 · Headline (before → after)

| Dataset · method | answer in context | evidence (all) | tokens p50 | ms p50 / p95 |
|---|---|---|---|---|
| **100k synthetic** (20k entities, 40k memories, 40k typed edges) · `recallGraph` · 200 q | 9.0% → **100%** | 9.0% → 67.0% | 2,460 → **858** | 399 / 520 → **31.7 / 41.9** |
| ″ · 2-hop (60) / 3-hop (40) | 0% / 0% → **100% / 100%** | | | |
| ″ · `recallMemories` · direct@10 (100) | 80% → **100%** | | 264 → 271 | **4,031 → 23.6** (p95 4,976 → 30.3) |
| **TR structured business** (real write paths) · `recallGraph` · 310 functional q | 21.0% → **73.5%** | 18.7% → 73.5% | 3,195 → **1,043** | 225 / 291 → **36 / 46** |
| ″ · join record+conversation (80) | 7.5% → 68.8% | | | |
| ″ · 2-hop (60) / 3-hop (40) | 0% / 0% → **30.0% / 62.5%** | | | |
| ″ · `recallMemories` · 310 functional q | 33.2% → 31.9% | 30.0% → 29.4% | 560 → 661 | 610 / 971 → **25.7 / 42.8** |
| **LoCoMo-10** (1,540 q, cat 5 excluded) · `recallMemories` | — | evidence-turn@10 any 71.2% → **72.5%** · all 57.6% → 59.4% | 599 → 597 | 99 / 143 → **21 / 27** |
| **LongMemEval-S cleaned** (470 q + 30 abstention) · `recallMemories` | 47.9% → 48.3% (lenient substring) | evidence-round@10 any 94.3% → **94.9%** · all 76.8% → 79.4% · session@10 any 97.9% → **98.3%** | 5,136 → 5,186 (raw rounds) | 77 / 134 → **29 / 39** |
| Plain vector top-10 (floor, unchanged code) · 100k / TR / LoCoMo / LME | 35.0% / 31.0% / — / — | LoCoMo 62.6% · LME 93.6% | | 7 ms |

**Lane targets (measured):** P `recallMemories` p50 < 100 ms at 100k under the runtime role → **23.6 ms ✔**.
T ≥ 95% 2/3-hop → **✔ on the 100k set (100/100)**, **✘ on the TR set (2-hop 30%, 3-hop 62.5%, join 68.8%)**;
T ≤ 1,500 tokens median → **✔ (858 / 1,043)**; T p50 < 50 ms → **✔ (31.7 / 36)**. Leak rate 0 → **✘ (see §3)**.

## 2 · TR structured-business dataset (full table: `report-trbiz.md`)
Generator `datasets/trbiz-gen.ts`: Turkish org, 250 companies, 420 customers, 140 products, 12 staff; **3,885 records** through
`storeMappedRecord` (company/customer cards, 1,250 orders, 820 invoices, 620 payments, 300 bookings, 200 deals, 25 later re-syncs)
+ **915 conversation facts** through `prepareExtractedMemory → commitExtractedMemory(judged=null)` (WhatsApp, e-mail, meeting notes,
finance/HR notes; extraction OUTPUT synthetic, entities typed as the extractor would). = 4,772 memories, 4,062 entities, 6,230 typed edges.
Ingest p50 77 ms/record, 72 ms/conversation fact. **370 questions**: 30 direct · 80 join (question names an order, answer only in the
customer's WhatsApp) · 60 2-hop (customer → employer card → tax no.) · 40 3-hop (WhatsApp complaint → order → invoice → payment receipt no.) ·
50 temporal ("geçen ay", answer = September order's product, distractor = older order's) · 25 record updates (re-sync corrects tracking no.)
· 25 conversation updates (customer gives a new phone later) · 60 permission (asked by a member without finance/HR read).

| category (after) | recallGraph | recallMemories | graph+memories | vector top-10 |
|---|---|---|---|---|
| direct | 100% | 20% | 100% | 30% |
| join | 68.8% | 8.8% | 68.8% | 10% |
| 2-hop / 3-hop | 30% / 62.5% | 5% / 0% | 31.7% / 62.5% | 1.7% / 0% |
| temporal: answer / ranked above the older order | 100% / 48% | 96% / 46% | 100% / 48% | 94% / 48% |
| record update: latest in ctx / stale absent | 100% / **100%** | 44% / 0%¹ | 100% / 56% | 40% / 40% |
| conversation update: latest in ctx / latest ranked first | 100% / **4%** (was 100%) | 96% / 68% | 100% / 4% | 84% / 4% |

¹ the stale value appears unlabelled (the "(was: X)" annotation is excluded from the stale check).
**Regression (T):** conversational updates — before, graph listed the newer phone first in 25/25; after, 1/25 (old number first; `judged=null` means nothing supersedes chat facts, so order is all the model gets).

## 3 · Permissions — leak rate (must be 0)
Real tenant via `create_organization`: **owner** (all modules), **sales** (role agent: customers/crm/inbox/meetings/appointments read; **no** finance/invoices/employees — asserted via `effective_access_for_member`), **finance** (role manager: + finance/invoices, no employees).
865 secrets: 20 salaries (fact tagged `employees`), 15 credit limits (tagged `finance`), 820 invoice amounts (connector records), 10 owner-personal bonuses (`scope=personal`).
Leak = any secret the asker may not see appears in the context. Sales asked 370 questions (60 targeted + the 310 functional ones).

| path (after) | sales leak | finance-member leak | what leaks |
|---|---|---|---|
| **studio `hybridRecall` + viewer, as shipped** (Era turn context, MCP brain tools, /api/brain-graph/recall) | 0/370 | 0/60 | **nothing — it errors on 800/800 calls** (bug B2), so members get no recall at all |
| same, with the one cast fixed (harness copy) | **59/370 (15.9%)** | 0/60 | only connector finance records (bug B3); tagged HR/finance + personal: 0 |
| brain-agent `recallMemories` (personal scope) | 81/370 (21.9%) | 30/60 | no module gate at all: HR salaries, credit limits, invoices |
| brain-agent `recallGraph` | **334/370 (90.3%)** (before 236) | 34/60 | graph traversal now reaches invoice/payment records on most questions |
| plain vector (no filter) | 74/370 | 28/60 | everything incl. personal |

Owner sees the targeted secrets: recallGraph 83.3%, graph+memories 100%, fixed studio 76.7% — the gate is not "return nothing".

## 4 · Against the published memory layers (**all vendor-reported, not re-run here**)

| System | Benchmark · metric | Score | Context tokens / query | Search latency p50 | Kind |
|---|---|---|---|---|---|
| **Era Brain (after)** | LongMemEval-S · evidence-round recall@10 / session recall@10 | **94.9% / 98.3%** | 5,186 (raw rounds, no extraction) | **28.6 ms** (local, in-DB) | **retrieval-only** |
| **Era Brain (after)** | LoCoMo-10 · evidence-turn recall@10 (any / all) | **72.5% / 59.4%** | **597** | **21 ms** | **retrieval-only** |
| **Era Brain (after)** | TR business record+conversation · answer in context (graph) | 73.5% (3-hop 62.5%) | 1,043 | 36 ms | retrieval-only, permissioned |
| Supermemory | LongMemEval-S · Recall@20 (May 2026 report) | 97% | — | — | retrieval, vendor |
| Supermemory (earlier report) | LongMemEval-S · QA accuracy | 81.6% | — | — | full QA, vendor |
| Zep | LongMemEval-S · QA accuracy (gpt-4o) | 71.2% (later 72.3%) | ~1.6k | median end-to-end 2.58 s | full QA, vendor |
| Mem0 / Mem0g | LoCoMo · LLM-judge J | 66.88% / 68.44% | 1,764 / 3,616 | 148 ms / 476 ms (p95 200 / 657) | full QA, vendor (Mem0 paper) |
| Zep (as measured by Mem0) | LoCoMo · J | 65.99% | 3,911 | 513 ms | full QA, competitor-run |
| Full context (Mem0 paper) | LoCoMo · J | 72.90% | 26,031 | — | full QA |
| Letta (filesystem agent, gpt-4o-mini) | LoCoMo · accuracy | 74.0% | — | — | full QA, vendor |
| Cognee (tuned) vs Graphiti / Mem0 (default) | 24 HotPotQA multi-hop · DeepEval correctness | 0.85 vs 0.74 / 0.54 | — | — | full QA, vendor, unequal configs |

Read this honestly: our numbers are **retrieval-only** (is the evidence in what the model would read), theirs are mostly **end-to-end QA
accuracy with an LLM judge**; they are not the same metric. Retrieval recall is an upper bound on QA accuracy. Comparable columns:
**tokens** (LoCoMo 597 vs Mem0 1,764 / Zep 3,911; LME 5.2k is high because we store raw rounds — Zep's 1.6k is after LLM extraction)
and **search latency** (21–29 ms in-DB vs 148–513 ms, but ours has no network hop). None of the competitors publish a permissioned /
structured-record benchmark; ours is the only one with a leak metric. Sources: Mem0 arXiv 2504.19413 Table 2; blog.getzep.com
(state-of-the-art-agent-memory); supermemory.ai/research; letta.com/blog/benchmarking-ai-agent-memory; cognee.ai/knowledge-graph-memory-benchmarks.

## 5 · Product bugs found (not fixed — lane B has no product-code edits)
- **B1 · Date parameters in raw `sql` fail on every call.** drizzle's postgres-js driver installs pass-through serializers for timestamp OIDs (1082/1114/1184), so a JS `Date` in a raw `sql\`\`` template throws *"Received an instance of Date"*. `storeMappedRecord` step 7.5 (`brain_record_versions`, `validFrom`) therefore throws on **every connector record** — after the memory/edges are written but before the sync ledger, so a retried job re-inserts the memory. Same pattern: `recallMemories({ asOf })`. Repro: `BB2_NO_DATE_SHIM=1 bun run datasets/trbiz-gen.ts`. The harness runs with a serializer shim (`lib/dbshim.ts`) so the rest of the path can be measured.
- **B2 · Member-facing recall always errors.** `apps/studio/lib/brain/recall.ts` `recallViewerSql`: `owner_user_id = ${viewer.appUserId}::uuid` but the column is `text` → *operator does not exist: text = uuid*. `recallForTurn` (`lib/era/turn/context.ts`) swallows it (`.catch(() => null)`), so **every Era turn currently gets zero brain facts**; MCP brain tools and `/api/brain-graph/recall` fail too. Still present after P/T. Fix: `::text`.
- **B3 · Connector records are never module-gated.** `storeMappedRecord` never runs `brain_source_modules`/`brain_fact_tag`, so invoices/payments synced from finance carry `module_code = NULL` and are visible to every member — the whole remaining leak of the fixed studio path.
- **B4 · brain-agent recall has no member gate.** `recallMemories` / `recallGraph` / `exploreSubgraph` take only scope; module + private filtering exists only in studio. Any member-facing caller of brain-agent recall leaks HR/finance (21.9% / 90.3% of sales questions).
- **B5 (fixed by T)** HEAD `formatCompact` exceeded its own 2,500-token budget on Turkish text (3,195–5,280 cl100k tokens) — `estimateTokens` undercounts non-English.
- Harness note: the async access-counter update of recall can deadlock with a concurrent DELETE of the same rows (seen while wiping LME units; production deletes are rare, but it is the same fire-and-forget write P batched).

## 6 · What is synthetic / caveats
Synthetic: extraction OUTPUT for conversations (no LLM), the 100k graph's write path (bulk insert, as the original bench), all text.
Real: schema, indexes, RLS + engine role, `embedLocal` e5-small q8, `storeMappedRecord`, `prepare/commitExtractedMemory`, `effective_access_for_member`, every recall function.
LME/LoCoMo: raw rounds/turns are stored (no fact extraction), one question's (LME) / conversation's (LoCoMo) haystack per org, wiped between units;
embeddings are the product's local model computed in 6 parallel processes (same model/inputs, cached in `data/emb-*`). "Answer in context" on LME/LoCoMo is a
lenient substring check and understates (answers are paraphrased/relative dates) — use evidence recall. LoCoMo is CC BY-NC 4.0 (used for evaluation only); LongMemEval-cleaned is MIT.
Shared-table effect: other lanes' 80k-row bench orgs were present during development runs; the planner used exact scans for small orgs, so the HNSW post-filter did not starve the vector leg (final runs: 44.8k foreign rows).

## 7 · Files / how to run (`SP/brain-bench2/`)
`lib/common.ts` (env guard → the test database only, stats, tiktoken counts, `BB2_CODE` switch) · `lib/fixture.ts` (tenant + roles, `dropTenant`) ·
`lib/methods.ts` (6 recall methods, in-process `/brain/embed`, `studioRecallFixCast`) · `lib/dbshim.ts` · `datasets/trbiz-gen.ts` · `datasets/biz100k-gen.ts` ·
`datasets/memeval.ts` (lme|locomo, `--shard=i/N --embed-only`) · `run.ts` (trbiz|biz100k, `--sweep`) · `report.ts` · `cleanup.ts` · `final.sh` · `results/*.json` (per-query rows) · `report-trbiz.md`.
Before-mode needs `head/` (git archive of HEAD, kept) plus junctions to the repo's node_modules/packages — **removed after the run** (re-create with
`New-Item -ItemType Junction` for `head/node_modules`, `head/packages`, `head/apps/{brain-agent,studio}/node_modules`; remove them with `cmd /c rmdir`, never recursively).
Cleanup verified: 0 bb2 orgs, 0 bb2 users, 0 orphan brain rows in the test database.

## 8 · Left
TR multi-hop still below target (2-hop 30%, 3-hop 62.5%, join 68.8% vs ≥ 95%) — seeds from Turkish possessive forms ("Ayşe Yılmaz'ın") and order codes are the first thing to look at in `results/trbiz-after.json`.
Conversation-update ordering regression in graph recall (100% → 4%). Leak: B2 + B3 + B4. Full QA (LLM answer + judge) not run ($0).

---

# R46 · End-to-end QA (extract → recall → answer → LLM judge), LLM = owner's Claude subscription — 2026-10-22

**Models (fixed for every system):** extraction, staleness judge, relation discovery, answer and grader = `claude-haiku-5-5`
(smallest model on the owner's Claude Max subscription), called headless: `claude -p --model claude-haiku-5-5 --output-format json
--tools "" --setting-sources "" --strict-mcp-config --system-prompt-file …` from an empty folder. ANTHROPIC/OPENAI keys stripped from the
child env; `claude auth status` = claude.ai / max. $0 extra. Every response cached in `llm-cache/` (4,346 files) — a rerun costs 0 calls.
**LLM calls made: 2,057** (LoCoMo 783 · LongMemEval 1,274; + 6 smoke-test calls). Concurrency ≤ 3, 0 retries, 0 failures; 2 unusable
extraction outputs were re-asked (moved to `llm-cache/rejected/`), as the product's job retry would.

**Write path (real product code, no product change):** `extractMemoriesBatch` (via = CLI) → `prepareExtractedMemory` → `judgeRelations`
(product: one router call per new fact; bench coalesces ≤ 25 of them into one CLI call, per-item cache) → `commitExtractedMemory` →
`discoverRelationships` rounds (typed entity edges). judgeRelations / discoverRelationships reach the LLM through era-brains'
`routeBackgroundText` → `POST {STUDIO_INTERNAL_URL}/api/internal/ai/run`; the bench points that URL at an unroutable host and answers it
in-process (`lib/r46-router.ts`, fetch intercept; every other studio request throws). Bench-only placement after commit: created_at /
valid_from = session date, cloud_workspace_id = the bench workspace, a `temporary:` decay shifted by the same offset.
**Read path:** brain-agent `recallGraph` (default 1,200-token budget) + `recallMemories` (limit 10) as the owner, untouched.

## LoCoMo-10 (1,540 q, cat 1–4) — 10 conversations, 735 eight-turn windows → 2,149 memories, 402 entities, 742 typed entity edges, 2,348 memory edges (updates/extends)
Answer prompt = Mem0 `evaluation/prompts.py` ANSWER_PROMPT_ZEP, judge = Mem0 `metrics/llm_judge.py` ACCURACY_PROMPT (fetched, mem0 @ aae5989),
both verbatim + a JSON batch wrapper (12–20 q per answer call, 30 per judge call). 1 judge run (Mem0 averages 10).

| J (LLM judge) | multi-hop (282) | temporal (321) | open-domain (96) | single-hop (841) | **overall** | context tokens p50 |
|---|---|---|---|---|---|---|
| **Era Brain** (extraction on, graph + memories) | 65.2 | 75.4 | 47.9 | 72.4 | **70.2** | **1,365** (graph 696 + memories 672) |
| Full conversation, same model | 83.0 | 85.7 | 57.3 | 92.9 | **87.3** | 22,247 |
| Mem0 / Mem0g (paper, gpt-4o-mini) — vendor | 51.2 / 47.2 | 55.5 / 58.1 | 72.9 / 75.7 | 67.1 / 65.7 | 66.9 / 68.4 | 1,764 / 3,616 |
| Zep as run by Mem0 / Zep self-reported — vendor | 66.0 / — | 79.8 / — | 67.7 / — | 74.1 / — | 66.0 / 75.1 | 3,911 |
| Full context (Mem0 paper, gpt-4o-mini) | | | | | 72.9 | 26,031 |
| Letta filesystem (gpt-4o-mini) — vendor | | | | | 74.0 | |
Vendor rows: different answer/judge model (gpt-4o-mini), own harness — not comparable point for point; Mem0's category labels are as published.
Search latency (in-DB, graph ∥ memories): **p50 48.7 ms, p95 60.2 ms** (memories alone 28 ms). Same-model gap Era → full context: −17.1 pts at 6 % of the tokens.
J is 75.1 % when an evidence window reached the context (1,394 q) and 23.3 % when it did not (146 q).

**Retrieval with extraction on (window level — an extracted memory can only be traced to its 8-turn source window):**
evidence in context any **90.5 %** / all 80.4 % (memories only: 89.1 / 78.6). Raw-text run (R45 code, `datasets/r46-raw-window.ts`), same
window mapping: any 89.4 % / all 77.5 % (turn level, as R45: 72.1 % / 59.5 %). Lenient answer-string-in-context 29.8 % (raw 28.6 %).

## LongMemEval-S cleaned — stratified sample of 100 (seed 46, proportional by type)
Per question: its own org, the haystack's USER messages only (product default: ERA_LEARN_ASSISTANT off) as one chat source per session
(≤ 6,000 chars), batches of ≤ 8 sources / 24k chars → ~113 memories, ~96 entities, ~34 typed edges per question; org dropped after recall.
Answer = LongMemEval `run_generation.py` CoN templates (facts / history chats), judge = `evaluate_qa.py get_anscheck_prompt` verbatim (per type).

| accuracy | ku (15) | multi-sess (24) | ss-assistant (11) | ss-pref (6) | ss-user (13) | temporal (25) | abstention (6) | **overall** | tokens p50 |
|---|---|---|---|---|---|---|---|---|---|
| **Era Brain** | 86.7 | 54.2 | **0.0**¹ | 83.3 | 84.6 | 52.0 | 100 | **61.0** (excl. ss-assistant 68.5) | **738** |
| Full haystack, same model | 86.7 | 95.8 | 100 | 100 | 76.9 | 92.0 | 100 | **92.0** | 112,361 |
| Zep (gpt-4o) / full context gpt-4o (Zep paper) — vendor | | | | | | | | 71.2 / 60.2 | ~1.6k / 115k |
¹ by construction: the product does not learn assistant turns. Search p50 64 ms / p95 95 ms. Evidence user-turn window in context 81/84, answer session 87/94.

Files: `lib/llm.ts`, `lib/r46-router.ts`, `datasets/r46-ingest.ts`, `datasets/r46-qa.ts`, `datasets/r46-lme.ts`, `datasets/r46-raw-window.ts`,
`results/r46-*.json`, `state/r46-locomo.json`, `llm-calls.log`, `logs-R46-*`, `mem0ref/` (fetched prompts). Cleanup: 0 bb2 orgs, 0 bb2 users, 0 orphan brain rows.

# R51 · Lane A — answer accuracy (same harness and models as R46: claude-haiku-5-5 via the owner's subscription CLI) — 2026-10-22/23

Anti-overfitting: tuned only on LoCoMo conv-26/30/41/42/43 (dev); conv-44/47/48/49/50 (test) and the LME-100 sample were not looked at
until the final runs. Final = fresh re-ingest of all 10 conversations after R51-B-DONE, final code.

| LoCoMo J (1,540) | dev (762) | test (778) | all | multi-hop | temporal | open-dom. | single-hop | ctx tokens p50/p95 | search p50/p95 |
|---|---|---|---|---|---|---|---|---|---|
| R46 Era | 68.8 | 71.6 | 70.2 | 65.2 | 75.4 | 47.9 | 72.4 | 1,365 / 1,639 | 48.7 / 60.2 ms |
| **R51 Era (final4)** | **77.3** | **74.9** | **76.1** | 73.0 | 78.2 | 49.0 | 79.4 | **2,009 / 2,970** | 60 / 75 ms |
| full conversation | 87.4 | 87.3 | 87.3 | 83.0 | 85.7 | 57.3 | 92.9 | 22,247 | — |
Three full final runs (code changed only in the graph-block rule between them): all 76.7 / 76.4 / 76.1, test 76.7 / 76.1 / 74.9 → ±1 pt run noise.
Evidence window in context: any 92.4 % (R46 90.5), all 84.3 % (80.4).

| LME-100 | ku | multi | ss-asst | ss-pref | ss-user | temporal | abst | **all** | excl ss-asst | tokens p50 |
|---|---|---|---|---|---|---|---|---|---|---|
| R46 | 86.7 | 54.2 | 0 | 83.3 | 84.6 | 52.0 | 100 | 61.0 | 68.5 | 738 |
| **R51 (final3)** | 86.7 | 87.5 | 0 | 100 | 84.6 | 72.0 | 100 | **75.0** (runs 77/77/75) | 84.3 | 1,985 |

Causes of wrong answers (LLM-classified, `results/r51-classify-*.json`): LoCoMo R46 459 wrong = missing 225 · answerer 97 · buried 59 ·
gold 51 · date 22 · multihop 4 · judge 1 → R51 368 = missing 121 · answerer 91 · buried 63 · gold 62 · date 16 · multihop 8 · judge 7.
Gold-memory labels on dev (`r51-label.ts`): of the remaining wrong answers ~2/3 are extraction-limited (the fact or its detail was never
stored), ~10 % retrieval-limited. LME 39 → 25 wrong (11 = single-session-assistant, assistant turns not learned by default).

What changed (product): one composed memory context (brain-paths `composeRecallContext`, brain-agent `recallContext`, studio
`memoryForTurn`): 30/50 facts (count/list questions) deduped against the graph block, `[date]` first, graph block 500 tokens or 1,200
when the walk holds record/company answer paths; source passage (`provenance.excerpt`, ≤1,200 chars, stored at write) under the top 3
facts, shown only if the viewer may read every fact of that source; belief corrections shown as "(this corrects an earlier note: …)";
stable related-fact pick; R48 relation word groups (without "teslim"); "Era's answers" brain switch (off by default).
Turkish sets (answer-in-context, leaks): eraTurn trbizH 85.9→91.3, trbizH2 85.2→91.0, trbizA 93.8→94.0; recallGraph 90.9→89.9 /
88.2→89.3 / 92.5→92.8; 0 leaks on every method. 100k: recallGraph 100 %, tokens 1,026→1,019. Permission rerun (check-gaps) 111/111
0 leaks / 0 errors; `r51a-check.ts` 16/16. LLM calls this round: 3,521 (0 retries, 0 failures). Cleanup: 0 bb2 orgs.
