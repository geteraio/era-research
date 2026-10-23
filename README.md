# Era Research

The benchmarks, harness and results behind the Era Brain technical report:

**Era Brain: Evaluating a Permission-Aware Business Memory on Retrieval, Multi-hop Records and Access Control** (Era Research, report ERA-TR-2026-01, October 2026)

- Report: [English PDF](report/era-brain-report-en.pdf) · [Turkish PDF](report/era-brain-report-tr.pdf) · also at [getera.io/en/research/era-brain](https://getera.io/en/research/era-brain)
- Every number in the report, with the file and row it came from: [`report/data.json`](report/data.json)
- The lab notebook of the runs (before/after, ablations, bugs found and fixed): [`RESULTS.md`](RESULTS.md)

## Headline results

| Benchmark | Metric | Era Brain |
| --- | --- | --- |
| LoCoMo-10 (1,540 questions, category 5 excluded) | LLM-judge accuracy J, Mem0's prompts, `claude-haiku-5-5` reader and judge | **76.1%** (full context: 87.3%), 2,009 context tokens p50 |
| LongMemEval-S cleaned (stratified sample of 100, seed 46) | Official prompts, `claude-haiku-5-5` | **75.0%** (full haystack: 92.0%) |
| LongMemEval-S cleaned (470 questions) | Evidence session recall@10 (any) / evidence round recall@10 (any) | **98.3% / 95.1%**, 35 ms p50 |
| LoCoMo-10 | Evidence turn recall@10 (any / all) | **72.4% / 58.7%**, 596 tokens, 29 ms p50 |
| Synthetic business graph (20k entities, 40k memories, 40k typed edges) | Answer in context, 2- and 3-hop questions | **100 / 100** (plain vector top-10: 1 / 100) |
| Turkish structured business set (records + conversations through the product's write paths) | Answer in context, 325 functional questions | **88.9%** |
| Access control (members without finance/HR read) | Leaked secrets in the context | **0 of 12,560** answers |

Answer and judge models, prompts, sample sizes and the vendor-reported numbers we compare against (Mem0, Zep, Supermemory) are in the report; vendor numbers were not re-run here and use different models.

## What is in this repository

```text
report/        the report (PDF, EN + TR), data.json (every number, with its source), report.html + build scripts
RESULTS.md     run-by-run notes: R42 retrieval baseline, R45 fixes, R46 end-to-end QA, R51 final runs
results/       per-question result rows (JSON) of the final and baseline runs
state/         the generated synthetic datasets: tenants, questions, answers, planted secrets
llm-cache/     every LLM call of the QA runs (prompt hash → answer), so they replay at no cost
harness/
  lib/         shared helpers: test-database guard, statistics, token counts, tenant fixtures, recall methods, LLM client
  datasets/    generators (biz100k, trbiz*, bizA) and loaders/runners for LoCoMo and LongMemEval
  mem0ref/     the answer and judge prompts used verbatim from Mem0 and LongMemEval
  *.ts, *.sh   run, report, permission-gap checks, ablations, the final run scripts
scripts/fetch-data.sh   downloads LoCoMo-10 and LongMemEval-S cleaned into data/
```

Left out on purpose: the public datasets themselves (download them with `scripts/fetch-data.sh`), their cached embeddings (about 400 MB, recomputed on the first run), development iterations superseded by the final runs, and logs.

## Reproduce

The harness measures Era Brain's own code, not a re-implementation: it imports the recall, graph and write paths from an Era checkout and runs them against a throwaway PostgreSQL database with Era's schema, under the same database role and row-level security the product uses. Era's application code is not public, so a full re-run needs an Era checkout. Everything else is here: the generators, the questions and answers, the prompts, the per-question results and the LLM cache.

**Check a number without running anything.** Every entry in `report/data.json` names the result file and row it was computed from; the result files are in `results/`.

**Re-run** (with an Era checkout):

```bash
bun install                                         # postgres, js-tiktoken
bash scripts/fetch-data.sh                          # data/locomo10.json, data/longmemeval_s_cleaned.json
export ERA_REPO=/path/to/era                        # an Era checkout, with Era's .env.test pointing at the test database
export ERA_TEST_DB=era_test                         # the harness refuses to write to any other database
cd harness
bun run datasets/trbizA-gen.ts                      # a Turkish business tenant → state/trbizA.json (also trbizH, trbizH2, biz100k)
bun run runA-full.ts trbizA r51 --sweep             # every recall method on it → results/trbizA-r51.json
bun run check-gaps.ts trbizA                        # permission gaps: every member read path, planted secrets
bun run datasets/memeval-r45.ts locomo r45          # LoCoMo retrieval → results/locomo-r45.json
bun run datasets/memeval-r45.ts lme r45             # LongMemEval retrieval → results/lme-r45.json
bun run datasets/r51f-ingest.ts                     # LoCoMo through the product's extraction write path → state/r51f-locomo.json
R46_CONCURRENCY=2 bun run datasets/r51-qa.ts all --tag=final4 --state=r51f-locomo --ctx=product   # recall → answer → judge
R46_CONCURRENCY=2 bun run datasets/r51-lme.ts all --tag=final3 --par=2                             # LongMemEval QA sample
bun run cleanup.ts                                  # drop every benchmark tenant
```

`r51-final.sh` and `r45-final.sh` are the exact sequences of the final runs. The QA steps call `claude -p` with no tools, no settings and no API key in the environment (`harness/lib/llm.ts`, `CLAUDE_BIN` to point at another binary); with the cache in `llm-cache/`, identical prompts are answered from the cache. Rebuild the report with `node report/build.cjs` (HTML) and `bash report/build.sh` (PDF, needs Chrome; `CHROME`, `OUT`).

**Rules the harness follows.** It writes only to the database named by `ERA_TEST_DB` and checks that before every write batch; each run creates its own tenants and drops them afterwards; the QA models run through a subscription CLI with every API key stripped from its environment.

## Data and licenses

The code in this repository is [MIT](LICENSE). The datasets keep their own licenses: LoCoMo is CC BY-NC 4.0 (used here for evaluation only; the result rows and cache entries that quote it are covered by that license) and LongMemEval-cleaned is MIT. The Mem0 and LongMemEval prompts in `harness/mem0ref/` are used verbatim under their licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [NOTICE](NOTICE).

All business data in `state/` and `results/` is synthetic: generated names, companies, orders, invoices and conversations. No customer or user data was used.

## Citation

```bibtex
@techreport{era2026brain,
  title       = {Era Brain: Evaluating a Permission-Aware Business Memory on Retrieval, Multi-hop Records and Access Control},
  author      = {{Era Research}},
  institution = {Era},
  number      = {ERA-TR-2026-01},
  year        = {2026},
  month       = oct,
  url         = {https://github.com/geteraio/era-research}
}
```

## Related

- Use Era Brain: [`@getera/brain`](https://www.npmjs.com/package/@getera/brain) · [Claude Code / Codex plugin](https://github.com/geteraio/era-brain-plugin) · [docs](https://docs.getera.io/en/brain)
- Security issues: see [SECURITY.md](SECURITY.md)
