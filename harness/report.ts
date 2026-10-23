// Prints markdown tables from results/*.json. Usage: bun run report.ts <dataset> <labelA> [labelB ...]
import { loadJson, RESULTS_DIR, pct, fmt } from './lib/common.ts'
const [dataset, ...labels] = process.argv.slice(2)
const runs = labels.map((l) => ({ l, r: loadJson<any>(`${RESULTS_DIR}/${dataset}-${l}.json`) })).filter((x) => x.r)
for (const { l, r } of runs) console.log(`- **${l}**: code ${r.code?.code ?? ''} @${r.code?.head} (${r.code?.dirty?.length ?? 0} dirty brain files), ${r.at}${r.env ? `, table rows ${r.env.total} (${r.env.foreign_rows} foreign)` : ''}`)
const memeval = dataset === 'lme' || dataset === 'locomo'
const key = memeval ? 'type' : 'cat'
const cats = [...new Set(runs.flatMap(({ r }) => r.summary.map((s: any) => s[key])))]
const methods = [...new Set(runs.flatMap(({ r }) => r.summary.map((s: any) => s.method)))]
const head = memeval
  ? '| method | type | run | n | evidence@k any | evidence@k all | evidence@5 any | session@k any | answer in ctx | tokens p50 | ms p50 | ms p95 |'
  : '| category | method | run | n | answer in ctx | evidence all | latest-wins strict | latest first | leak q | tokens p50 | ms p50 | ms p95 |'
console.log('\n' + head + '\n' + head.replace(/[^|]+/g, '---'))
for (const c of cats) for (const m of methods) for (const { l, r } of runs) {
  const s = r.summary.find((x: any) => x[key] === c && x.method === m)
  if (!s) continue
  if (memeval) console.log(`| ${m} | ${c} | ${l} | ${s.n} | ${pct(s.evidenceAny, s.n)} | ${pct(s.evidenceAll, s.n)} | ${pct(s.evidenceAny5, s.n)} | ${s.sessionAny == null ? '—' : pct(s.sessionAny, s.n)} | ${pct(s.answerInContext, s.n)} | ${fmt(s.tokens.p50)} | ${fmt(s.ms.p50)} | ${fmt(s.ms.p95)} |`)
  else console.log(`| ${c} | ${m} | ${l} | ${s.n} | ${pct(s.answerInContext, s.n)} | ${pct(s.evidenceAll, s.n)} | ${s.latestWinsStrict == null ? '—' : pct(s.latestWinsStrict, s.n)} | ${s.latestFirst == null ? '—' : pct(s.latestFirst, s.n)} | ${s.leakQueries}${Object.keys(s.leakByClass).length ? ' ' + JSON.stringify(s.leakByClass) : ''} | ${fmt(s.tokens.p50)} | ${fmt(s.ms.p50)} | ${fmt(s.ms.p95)} |`)
}
// overall per method (functional categories only, owner)
if (!memeval) {
  console.log('\n| method | run | functional n | answer in ctx | evidence all | tokens p50 | tokens p95 | ms p50 | ms p95 | leak q (sales) |\n|---|---|---|---|---|---|---|---|---|---|')
  for (const m of methods) for (const { l, r } of runs) {
    const rows = r.rows.filter((x: any) => x.method === m && x.asker === 'owner' && !x.cat.startsWith('permission'))
    const leakRows = r.rows.filter((x: any) => x.method === m && x.asker === 'sales')
    if (!rows.length) continue
    const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] }
    console.log(`| ${m} | ${l} | ${rows.length} | ${pct(rows.filter((x: any) => x.hit).length, rows.length)} | ${pct(rows.filter((x: any) => x.evAll).length, rows.length)} | ${fmt(q(rows.map((x: any) => x.tokens), 0.5))} | ${fmt(q(rows.map((x: any) => x.tokens), 0.95))} | ${fmt(q(rows.map((x: any) => x.ms), 0.5))} | ${fmt(q(rows.map((x: any) => x.ms), 0.95))} | ${leakRows.length ? `${leakRows.filter((x: any) => x.leaks.length).length}/${leakRows.length}` : '—'} |`)
  }
}
