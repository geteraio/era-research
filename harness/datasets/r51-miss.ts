// R51 — why a needed (gold) memory is not in the product context: superseded / ranked below the cut / never recalled.
import { readFileSync } from 'node:fs'
import { arm } from '../lib/r46-router.ts'
import { ownerSql, loadJson, STATE_DIR, RESULTS_DIR, BB2, REPO } from '../lib/common.ts'
import '../lib/dbshim.ts'
arm()
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const rec: any = await import(`${REPO}/apps/brain-agent/src/brain/recall.ts`)
const cfg = process.argv[2] ?? 'p'
const res = loadJson<any[]>(`${RESULTS_DIR}/r51-retr-${cfg}.json`)!
const gold = loadJson<any>(`${RESULTS_DIR}/r51-gold-mem-r51-locomo.json`)!
const state = loadJson<any>(`${STATE_DIR}/r51-locomo.json`)!
const data = JSON.parse(readFileSync(`${BB2}/data/locomo10.json`, 'utf8')) as any[]
const qtext = new Map<string, string>()
for (const c of data) c.qa.filter((q: any) => q.category !== 5).forEach((q: any, i: number) => qtext.set(`${c.sample_id}-${i}`, q.question))
const raw = ownerSql(2)
const cause: Record<string, number> = {}
const ranks: number[] = []
const show: string[] = []
for (const r of res.filter((x) => !x.all)) {
  const conv = r.id.replace(/-\d+$/, ''), st = state[conv]
  const ctx = await runInOrganization(st.orgId, () => rec.recallContext({ orgId: st.orgId, query: qtext.get(r.id), scope: { ownerUserId: st.owner } }), { userId: st.owner }) as any
  const have = new Set([...(ctx?.graphMemoryIds ?? []), ...(ctx?.factMemoryIds ?? [])])
  const big = await runInOrganization(st.orgId, () => rec.recallMemories({ orgId: st.orgId, query: qtext.get(r.id), limit: 300, scope: { ownerUserId: st.owner } }), { userId: st.owner }) as any[]
  const direct = big.filter((m) => !m.related).map((m) => m.id)
  for (const id of gold[r.id].needed as string[]) {
    if (have.has(id)) continue
    const [m] = await raw`select is_latest, content from os.brain_memories where id = ${id}::uuid`
    let k: string
    if (!m?.is_latest) k = 'superseded'
    else { const pos = direct.indexOf(id); if (pos < 0) k = 'not in top-300'; else { k = pos < 50 ? 'rank 30-50' : pos < 100 ? 'rank 50-100' : 'rank 100+'; ranks.push(pos) } }
    cause[k] = (cause[k] ?? 0) + 1
    if (show.length < 25 && k !== 'superseded') show.push(`${r.id} [${k}] Q: ${qtext.get(r.id)} || needed: ${m?.content}`)
  }
}
console.log(cause)
console.log(show.join('\n'))
await raw.end()
process.exit(0)
