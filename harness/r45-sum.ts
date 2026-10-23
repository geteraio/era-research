// R45 summary of a runA-full result: functional answer-in-context per method (+2/3-hop, join, latest-first),
// leak queries over every row (permission + sweep), errors, tokens/ms p50.
// Usage: bun run r45-sum.ts <result file name without .json>...
import { loadJson, RESULTS_DIR, stats } from './lib/common.ts'
for (const name of process.argv.slice(2)) {
  const r = loadJson<any>(`${RESULTS_DIR}/${name}.json`)!
  console.log(`\n== ${name} (${r.rows.length} rows)`)
  for (const m of r.methods) {
    const rs = r.rows.filter((x: any) => x.method === m)
    const fn = rs.filter((x: any) => !x.cat.startsWith('perm') && !x.cat.startsWith('sweep'))
    const c = (cat: string) => { const xs = fn.filter((x: any) => x.cat === cat); return xs.length ? `${xs.filter((x: any) => x.hit).length}/${xs.length}` : '-' }
    const lf = fn.filter((x: any) => x.cat === 'update_conversation')
    const leaks = rs.filter((x: any) => x.leaks.length).length
    const errs = rs.filter((x: any) => x.extra?.error).length
    console.log(`${m.padEnd(18)} func ${fn.filter((x: any) => x.hit).length}/${fn.length}  join ${c('join')}  2hop ${c('multihop2')}  3hop ${c('multihop3')}  updconv-first ${lf.filter((x: any) => x.latestFirst).length}/${lf.length}  leakQ ${leaks}/${rs.length}  err ${errs}  tok p50 ${stats(fn.map((x: any) => x.tokens)).p50}  ms p50 ${stats(fn.map((x: any) => x.ms)).p50.toFixed(1)}`)
  }
}
process.exit(0)
