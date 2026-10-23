// R51 — retrieval-only experiments on the DEV conversations (0 LLM calls): gold-memory recall in the context
// (labels from r51-label.ts) under different context shapes. Usage: bun run datasets/r51-retr.ts <config,…>
import { readFileSync, appendFileSync } from 'node:fs'
import { arm } from '../lib/r46-router.ts'
import { ownerSql, saveJson, loadJson, STATE_DIR, RESULTS_DIR, BB2, REPO, stats, tokens } from '../lib/common.ts'
import '../lib/dbshim.ts'
arm()
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const rec: any = await import(`${REPO}/apps/brain-agent/src/brain/recall.ts`)
const gq: any = await import(`${REPO}/apps/brain-agent/src/brain/graph-query.ts`)

const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const STATE = flag('state') ?? 'r51-locomo'
const DEV = ['conv-26', 'conv-30', 'conv-41', 'conv-42', 'conv-43']
const LOG = `${BB2}/logs-R51-retr.log`
const log = (...a: unknown[]) => { const s = `${new Date().toISOString().slice(11, 19)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(s); appendFileSync(LOG, s + '\n') }
const data = JSON.parse(readFileSync(`${BB2}/data/locomo10.json`, 'utf8')) as any[]
const state = loadJson<any>(`${STATE_DIR}/${STATE}.json`)!
const gold = loadJson<any>(`${RESULTS_DIR}/r51-gold-mem-${STATE}.json`) ?? {}
const qs = data.filter((c) => DEV.includes(c.sample_id)).flatMap((c) => c.qa.filter((q: any) => q.category !== 5).map((q: any, i: number) => ({ id: `${c.sample_id}-${i}`, conv: c.sample_id, cat: q.category, q: q.question })))
  .filter((q) => gold[q.id]?.needed?.length)

const configs = (process.argv[2] ?? 'product').split(',')
const fmtD = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '')
for (const cfg of configs) {
  const res: any[] = []
  for (const q of qs) {
    const st = state[q.conv]
    const inOrg = <T,>(fn: () => Promise<T>) => runInOrganization(st.orgId, fn, { userId: st.owner }) as Promise<T>
    const t = performance.now()
    let ids: string[] = [], text = ''
    if (cfg.startsWith('p')) {
      // p[-b<budget>][-g<graphTokens>][-k<facts>] — the product's recallContext (defaults unless given)
      const num = (k: string) => { const m = cfg.match(new RegExp(`-${k}(\\d+)`)); return m ? Number(m[1]) : undefined }
      const r = await inOrg(() => rec.recallContext({ orgId: st.orgId, query: q.q, scope: { ownerUserId: st.owner }, budgetTokens: num('b'), graphTokens: num('g'), factLimit: num('k'), pool: num('p') }))
      ids = [...(r?.graphMemoryIds ?? []), ...(r?.factMemoryIds ?? [])]; text = r?.text ?? ''
    } else {
      // m<K>[d] g<budget>: K memories (d = direct only, no edge expansion), graph budget
      const K = Number(cfg.match(/m(\d+)/)?.[1] ?? 10), G = Number(cfg.match(/g(\d+)/)?.[1] ?? 1200), directOnly = /m\d+d/.test(cfg)
      const [g, m] = await Promise.all([
        G ? inOrg(() => rec.recallGraph({ orgId: st.orgId, query: q.q, scope: { ownerUserId: st.owner }, budgetTokens: G })) : null,
        K ? inOrg(() => rec.recallMemories({ orgId: st.orgId, query: q.q, limit: K, scope: { ownerUserId: st.owner } })) : [],
      ]) as any
      const gText = g?.text ?? ''
      const gIds: string[] = []
      for (const nd of g?.subgraph?.nodes ?? []) for (const f of nd.facts ?? []) if (f.memoryId && gText.includes(String(f.content).slice(0, 60)) && !gIds.includes(f.memoryId)) gIds.push(f.memoryId)
      const ms = (m as any[]).filter((r) => !directOnly || !r.related).filter((r) => !gIds.includes(r.id))
      ids = [...gIds, ...ms.map((r) => r.id)]
      text = [gText, ms.map((r: any) => `- ${r.content} (${r.sourceType}, ${fmtD(r.createdAt)})`).join('\n')].join('\n')
    }
    const need: string[] = gold[q.id].needed
    res.push({ id: q.id, cat: q.cat, all: need.every((x) => ids.includes(x)), any: need.some((x) => ids.includes(x)), frac: need.filter((x) => ids.includes(x)).length / need.length, tok: tokens(text), ms: performance.now() - t, n: ids.length })
  }
  const pc = (f: (r: any) => boolean, xs = res) => ((100 * xs.filter(f).length) / xs.length).toFixed(1)
  const byCat = Object.fromEntries([1, 2, 3, 4].map((c) => { const xs = res.filter((r) => r.cat === c); return [c, `${pc((r) => r.all, xs)}/${pc((r) => r.any, xs)}`] }))
  log(cfg.padEnd(14), `n=${res.length} goldAll=${pc((r) => r.all)}% goldAny=${pc((r) => r.any)}% frac=${(100 * res.reduce((a, r) => a + r.frac, 0) / res.length).toFixed(1)}% tok p50=${stats(res.map((r) => r.tok)).p50} p95=${stats(res.map((r) => r.tok)).p95} facts p50=${stats(res.map((r) => r.n)).p50} ms p50=${stats(res.map((r) => r.ms)).p50.toFixed(0)}`, 'byCat all/any', byCat)
  saveJson(`${RESULTS_DIR}/r51-retr-${cfg}.json`, res)
}
process.exit(0)
