// R45 failure diagnosis for the CURRENT engine: per failed question, where the answer got lost.
//   seed    — no anchor is an entity of the answer fact's chain (wrong / missing seed)
//   reach   — the answer fact's entities never became subgraph nodes (path missing / cut)
//   rank    — a node of the answer fact is in the subgraph but the fact is not among its facts / path evidence
//   budget  — the fact is in the subgraph but formatPaths dropped it
// Usage: bun run r45-diag.ts <dataset> [kinds] [--verbose]
import { loadJson, STATE_DIR, REPO, has, loadTestEnv, ownerSql } from './lib/common.ts'
loadTestEnv()
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { embedText, embeddingColumn } = await import(`${REPO}/apps/brain-agent/src/brain/embeddings.ts`)
const NEW = await import(`${REPO}/packages/db/brain-paths.ts`)
const deps = { embedQuery: (orgId: string, text: string) => embedText(text, { organizationId: orgId, scope: 'org' }, 'query'), embeddingColumn, warn: () => {} }
const E = NEW.createBrainPaths(deps)
const [ds, kindsArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const verbose = process.argv.includes('--verbose')
const st = loadJson<any>(`${STATE_DIR}/${ds}.json`)!; const T = st.tenant
const raw = ownerSql()
const qs = st.questions.filter((q: any) => q.cat !== 'permission' && (!kindsArg || kindsArg.split(',').includes(q.kind ?? q.cat)))
const causes: Record<string, Record<string, number>> = {}
for (const q of qs) {
  const uid = T.users[q.asker ?? 'owner']
  const sub: any = await runInOrganization(T.orgId, () => E.exploreSubgraph({ orgId: T.orgId, query: q.q, scope: { ownerUserId: uid } }), { userId: uid })
  const text = NEW.formatPaths(sub, 1200)
  if (has(text, q.answer)) continue
  const mem = await raw`select m.id, m.content, array_agg(me.entity_id::text) ents from os.brain_memories m join os.brain_memory_entities me on me.memory_id = m.id
                         where m.organization_id = ${T.orgId} and m.is_latest and m.content ilike ${'%' + q.answer + '%'} group by m.id, m.content limit 3`
  const nodeIds = new Set(sub.nodes.map((n: any) => n.id))
  const inFacts = sub.nodes.some((n: any) => n.facts.some((f: any) => has(f.content, q.answer))) || sub.paths.some((p: any) => p.evidence.some((f: any) => f && has(f.content, q.answer)))
  const reached = mem.some((m: any) => m.ents.some((e: string) => nodeIds.has(e)))
  const cause = inFacts ? 'budget' : reached ? 'rank' : sub.seedIds.length === 0 ? 'seed-none' : 'reach'
  const k = q.kind ?? q.cat
  ;(causes[k] ||= {})[cause] = (causes[k][cause] || 0) + 1
  if (verbose) {
    const name = new Map(sub.nodes.map((n: any) => [n.id, `${n.name}[${n.type}]`]))
    console.log(`\n✗ ${k} ${cause} | ${q.q} => ${q.answer}`)
    console.log('  anchors:', sub.seeds.slice(0, 5).map((s: any) => `${s.name}[${s.type}] ${s.score.toFixed(2)}`).join(' | '))
    for (const p of sub.paths.slice(0, 6)) console.log('  path', p.kind, p.score, p.nodeIds.map((id: string) => name.get(id)).join(' → '), '|', p.relations.join(','))
    for (const m of mem) console.log('  answer fact:', m.content.slice(0, 140), '| ents', m.ents.map((e: string) => name.get(e) ?? `(not in subgraph)`).join(', '))
  }
}
console.log(JSON.stringify(causes, null, 1))
await raw.end()
process.exit(0)
