// Lane A: just the brain-agent recall methods (no studio imports).
import { REPO, loadTestEnv, tokens, tokens200 } from './common.ts'
loadTestEnv()
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { recallMemories, recallGraph } = await import(`${REPO}/apps/brain-agent/src/brain/recall.ts`)
async function timed(fn: () => Promise<any>) { const t = performance.now(); let r: any; try { r = await fn() } catch (e: any) { r = { text: '', ids: [], extra: { error: String(e?.message ?? e) } } } const ms = performance.now() - t; return { ...r, ms, tokens: tokens(r.text), tokens_o200k: tokens200(r.text) } }
export const methods: Record<string, (q: string, who: any, o?: any) => Promise<any>> = {
  recallGraph: (q, who) => timed(async () => {
    const g: any = await runInOrganization(who.orgId, () => recallGraph({ orgId: who.orgId, query: q, scope: { ownerUserId: who.userId } }), { userId: who.userId })
    if (!g) return { text: '', ids: [], extra: { nodes: 0 } }
    const text: string = g.text ?? ''; const ids: string[] = []
    for (const n of g.subgraph?.nodes ?? []) for (const f of n.facts ?? []) if (f.memoryId && text.includes(String(f.content).slice(0, 60)) && !ids.includes(f.memoryId)) ids.push(f.memoryId)
    return { text, ids, extra: { seeds: g.seedNames?.slice(0, 5) } }
  }),
  recallMemories: (q, who, o) => timed(async () => {
    const rows: any[] = await runInOrganization(who.orgId, () => recallMemories({ orgId: who.orgId, query: q, limit: o?.k ?? 10, scope: { ownerUserId: who.userId } }), { userId: who.userId })
    return { text: rows.map((m) => `- [${m.kind}] ${m.content}${m.previously ? ` (was: ${m.previously})` : ''}`).join('\n'), ids: rows.map((r) => r.id) }
  }),
}
