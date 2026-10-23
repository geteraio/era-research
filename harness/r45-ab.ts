// R45 A/B: the ORIGINAL path engine (pre-R44 copy, laneA-orig/bp-orig.ts) vs the CURRENT packages/db/brain-paths.ts,
// alternating per question in one process, as the member who asks (owner). Grouped by cat and by kind.
// Usage: bun run r45-ab.ts <dataset> <label> [cats]   → results/r45-ab-<dataset>-<label>.json
import { loadJson, saveJson, STATE_DIR, RESULTS_DIR, REPO, stats, has, tokens, loadTestEnv } from './lib/common.ts'
loadTestEnv()
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { embedText, embeddingColumn } = await import(`${REPO}/apps/brain-agent/src/brain/embeddings.ts`)
const NEW = await import(`${REPO}/packages/db/brain-paths.ts`)
const OLD = await import(`${process.env.BB2_ORIG}/bp-orig.ts`)
const deps = { embedQuery: (orgId: string, text: string) => embedText(text, { organizationId: orgId, scope: 'org' }, 'query'), embeddingColumn, warn: () => {} }
const E: any = { old: { ...OLD.createBrainPaths(deps), fmt: OLD.formatPaths }, new: { ...NEW.createBrainPaths(deps), fmt: NEW.formatPaths } }
const [ds, label = 'adhoc', catsArg] = process.argv.slice(2)
const st = loadJson<any>(`${STATE_DIR}/${ds}.json`)!; const T = st.tenant
const qs = st.questions.filter((q: any) => q.cat !== 'permission' && (!catsArg || catsArg.split(',').includes(q.cat)))
const norm = (s: string) => s.toLocaleLowerCase('tr')
const rows: any[] = []
const run = async (k: 'old' | 'new', q: any) => {
  const uid = T.users[q.asker ?? 'owner']
  const t = performance.now()
  const sub = await runInOrganization(T.orgId, () => E[k].exploreSubgraph({ orgId: T.orgId, query: q.q, scope: { ownerUserId: uid } }), { userId: uid })
  const text = E[k].fmt(sub, 1200); const ms = performance.now() - t
  const other = q.distractor ?? q.stale
  const a = norm(text).indexOf(norm(q.answer)), b = other ? norm(text).indexOf(norm(other)) : -1
  rows.push({ eng: k, id: q.id, cat: q.cat, kind: q.kind ?? q.cat, hit: has(text, q.answer), first: other ? a >= 0 && (b < 0 || a < b) : null, ms, tok: tokens(text) })
}
await run('old', qs[0]); await run('new', qs[0]); rows.length = 0
let i = 0
for (const q of qs) { if (i++ % 2) { await run('old', q); await run('new', q) } else { await run('new', q); await run('old', q) } }
const agg = (key: 'cat' | 'kind') => {
  const out: any = {}
  for (const r of rows) { const g = (out[`${r[key]}`] ||= { old: [], new: [] }); g[r.eng].push(r) }
  return Object.fromEntries(Object.entries(out).map(([k, v]: any) => [k, Object.fromEntries(['old', 'new'].map((e) => {
    const rs = v[e]; const f = rs.filter((r: any) => r.first !== null)
    return [e, { n: rs.length, hit: rs.filter((r: any) => r.hit).length, first: f.length ? f.filter((r: any) => r.first).length : null, msP50: stats(rs.map((r: any) => r.ms)).p50, tokP50: stats(rs.map((r: any) => r.tok)).p50 }]
  }))]))
}
const byCat = agg('cat'), byKind = agg('kind')
const all = Object.fromEntries(['old', 'new'].map((e) => { const rs = rows.filter((r) => r.eng === e); return [e, { n: rs.length, hit: rs.filter((r) => r.hit).length, msP50: stats(rs.map((r) => r.ms)).p50, msP95: stats(rs.map((r) => r.ms)).p95, tokP50: stats(rs.map((r) => r.tok)).p50 }] }))
const line = (k: string, v: any) => console.log(k.padEnd(26), ...['old', 'new'].map((e) => `${e} ${v[e].hit}/${v[e].n}${v[e].first != null ? ` first ${v[e].first}` : ''} ms ${v[e].msP50.toFixed(0)} tok ${v[e].tokP50}`.padEnd(42)))
console.log('── by cat'); for (const [k, v] of Object.entries(byCat)) line(k, v)
console.log('── by kind'); for (const [k, v] of Object.entries(byKind)) line(k, v)
console.log('ALL', JSON.stringify(all))
saveJson(`${RESULTS_DIR}/r45-ab-${ds}-${label}.json`, { ds, label, at: new Date().toISOString(), all, byCat, byKind, rows })
process.exit(0)
