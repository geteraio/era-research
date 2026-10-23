// R51 — Turkish business sets + 100k: R45 final vs R51 final, answer-in-context % per method (all questions), leaks, tokens p50.
import { loadJson, RESULTS_DIR } from './lib/common.ts'
const sets = ['trbizH', 'trbizH2', 'trbizA', 'biz100k']
for (const d of sets) {
  const a = loadJson<any>(`${RESULTS_DIR}/${d}-r45.json`), b = loadJson<any>(`${RESULTS_DIR}/${d}-r51.json`)
  const rows = (x: any) => (x?.rows ?? x ?? []) as any[]
  const methods = [...new Set(rows(b).map((r) => r.method))]
  for (const m of methods) {
    const f = (x: any) => rows(x).filter((r) => r.method === m && r.asker !== undefined)
    const s = (rs: any[]) => {
      if (!rs.length) return '—'
      const own = rs.filter((r) => !String(r.cat).startsWith('permission') || r.cat === 'permission_owner')
      const hit = (100 * own.filter((r) => r.hit).length) / own.length
      const leaks = rs.reduce((n, r) => n + (r.leaks?.length ?? 0), 0)
      const tok = rs.map((r) => r.tokens).sort((p, q) => p - q)[rs.length >> 1]
      const mh = rs.filter((r) => /multihop|join/.test(r.cat))
      return `ans ${hit.toFixed(1)}% (multi-hop+join ${mh.length ? ((100 * mh.filter((r) => r.hit).length) / mh.length).toFixed(1) : '—'}%) leaks ${leaks} tok ${tok}`
    }
    console.log(d.padEnd(8), m.padEnd(18), 'R45', s(f(a)).padEnd(60), '| R51', s(f(b)))
  }
}
