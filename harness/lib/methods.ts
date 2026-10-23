// Recall methods under test. Each returns the text an LLM would be handed (tokens are counted on it),
// the memory ids it contains (rank order, for evidence recall@k) and its wall time.
// Every call runs under runInOrganization (engine role + RLS), as brain-agent runs in production.
import { REPO, CODE, BB2, loadTestEnv, tokens, tokens200, type Sql } from './common.ts'

loadTestEnv()
export const { db } = await import(`${REPO}/packages/db/index.ts`)
export const { dateShimOn } = await import('./dbshim.ts')
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { recallMemories, recallGraph } = await import(`${CODE}/apps/brain-agent/src/brain/recall.ts`)
export const { embedLocal } = await import(`${CODE}/apps/brain-agent/src/brain/local-embeddings.ts`)
const studioRecall = await import(`${CODE}/apps/studio/lib/brain/recall.ts`)
const { brainVisibilitySql } = await import(`${CODE}/apps/studio/lib/scope/context.ts`)

// The studio embeds through brain-agent's /brain/embed. No servers in a bench: answer that call in-process
// with the same local model (e5-small q8) so the studio code path runs unchanged.
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url
  if (url && /\/brain\/embed$/.test(url)) {
    const body = JSON.parse(init?.body ?? '{}')
    const vectors = await embedLocal(body.texts, body.kind ?? 'passage')
    return new Response(JSON.stringify({ vectors, column: 'embedding_e5' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch

const errSeen = new Set<string>()
// The studio recall with ONE change: recallViewerSql's `owner_user_id = $viewer::uuid` (text = uuid → every call throws)
// becomes ::text. Generated from the code under test into the scratch HEAD copy (never into the repo).
import { readFileSync as rf, writeFileSync as wf } from 'node:fs'
const FIX_PATH = `${BB2}/head/apps/studio/lib/brain/recall.fixcast.ts`
{
  const src = rf(`${CODE}/apps/studio/lib/brain/recall.ts`, 'utf8')
  const fixed = src.replace('owner_user_id = ${viewer.appUserId}::uuid', 'owner_user_id = ${viewer.appUserId}::text')
  if (fixed === src) console.warn('[fixcast] pattern not found — studio recall changed; fixcast == shipped')
  wf(FIX_PATH, fixed)
}
const studioFix = await import(FIX_PATH)

export interface Asker { orgId: string; workspaceId: string; userId: string }
export interface Retrieved { text: string; ids: string[]; ms: number; tokens: number; tokens_o200k: number; extra?: Record<string, unknown> }
export type Method = (q: string, who: Asker, opts?: { k?: number }) => Promise<Retrieved>

const render = (rows: Array<{ kind: string; content: string; previously?: string | null }>) =>
  rows.map((m) => `- [${m.kind}] ${m.content}${m.previously ? ` (was: ${m.previously})` : ''}`).join('\n')

async function timed(fn: () => Promise<{ text: string; ids: string[]; extra?: Record<string, unknown> }>): Promise<Retrieved> {
  const t = performance.now()
  let r: { text: string; ids: string[]; extra?: Record<string, unknown> }
  try { r = await fn() } catch (e: any) {
    const msg = String(e?.cause?.message ?? e?.message ?? e).slice(0, 160)
    if (!errSeen.has(msg)) { errSeen.add(msg); console.warn('[method error → empty context]', msg) }
    r = { text: '', ids: [], extra: { error: msg } }
  }
  const ms = performance.now() - t
  return { ...r, ms, tokens: tokens(r.text), tokens_o200k: tokens200(r.text) }
}

export const methods: Record<string, Method> = {
  /** brain-agent hybrid recall (vector + FTS + RRF + 1-hop memory edges). Personal context of the asker. */
  recallMemories: (q, who, o) =>
    timed(async () => {
      const rows = (await runInOrganization(who.orgId, () => recallMemories({ orgId: who.orgId, query: q, limit: o?.k ?? 10, scope: { ownerUserId: who.userId } }), { userId: who.userId })) as any[]
      return { text: render(rows), ids: rows.map((r) => r.id), extra: { n: rows.length, related: rows.filter((r) => r.related).length } }
    }),
  /** brain-agent compact graph recall (seeds → subgraph → formatCompact). */
  recallGraph: (q, who) =>
    timed(async () => {
      const g = (await runInOrganization(who.orgId, () => recallGraph({ orgId: who.orgId, query: q, scope: { ownerUserId: who.userId } }), { userId: who.userId })) as any
      if (!g) return { text: '', ids: [], extra: { nodes: 0 } }
      const text: string = g.text ?? ''
      const ids: string[] = []
      for (const n of g.subgraph?.nodes ?? []) for (const f of n.facts ?? []) if (f.memoryId && text.includes(String(f.content).slice(0, 60)) && !ids.includes(f.memoryId)) ids.push(f.memoryId)
      return { text, ids, extra: { nodes: g.nodeCount, edges: g.edgeCount, truncated: !!g.subgraph?.truncated, estTokens: g.estTokens, seeds: g.seedNames?.slice(0, 5) } }
    }),
  /** graph text + memories together (what a chat turn gets when both are on). */
  graphPlusMemories: async (q, who, o) => {
    const [g, m] = await Promise.all([methods.recallGraph(q, who), methods.recallMemories(q, who, o)])
    const text = [g.text, m.text].filter(Boolean).join('\n\n')
    return { text, ids: [...new Set([...m.ids, ...g.ids])], ms: Math.max(g.ms, m.ms), tokens: tokens(text), tokens_o200k: tokens200(text) }
  },
  /** studio hybridRecall WITH viewer — the member-facing path (Era turn context / MCP brain tools). Module + private gate. */
  studioRecall: (q, who, o) =>
    timed(async () => {
      const scope = brainVisibilitySql({ appUserId: who.userId, cloudWorkspaceId: who.workspaceId })
      const { results } = (await runInOrganization(who.orgId, () => studioRecall.hybridRecall(who.orgId, q, o?.k ?? 10, scope, null, { appUserId: who.userId, workspaceId: who.workspaceId }), { userId: who.userId })) as any
      return { text: render(results), ids: results.map((r: any) => r.id) }
    }),
}

/** studio hybridRecall with viewer, cast fixed (what the module gate would do if recallViewerSql worked). */
methods.studioRecallFixCast = (q, who, o) =>
  timed(async () => {
    const scope = brainVisibilitySql({ appUserId: who.userId, cloudWorkspaceId: who.workspaceId })
    const { results } = (await runInOrganization(who.orgId, () => studioFix.hybridRecall(who.orgId, q, o?.k ?? 10, scope, null, { appUserId: who.userId, workspaceId: who.workspaceId }), { userId: who.userId })) as any
    return { text: render(results), ids: results.map((r: any) => r.id) }
  })

/** Plain vector top-k baseline (owner SQL, no permission filter at all — the naive RAG floor). */
export function vectorBaseline(raw: Sql): Method {
  return (q, who, o) =>
    timed(async () => {
      const [vec] = await embedLocal([q], 'query')
      const rows = await raw.unsafe(`SELECT id, kind, content FROM brain_memories WHERE organization_id = $1 AND is_latest = true AND embedding_e5 IS NOT NULL ORDER BY embedding_e5 <=> $2::vector LIMIT $3`, [who.orgId, `[${vec.join(',')}]`, o?.k ?? 10])
      return { text: render(rows as any[]), ids: (rows as any[]).map((r) => r.id) }
    })
}

// ── R42-fix: the remaining member-facing recall paths (studio code, '@/'-aliased; 'server-only' stubbed) ──
Bun.plugin({ name: 'server-only-stub', setup(b) { b.module('server-only', () => ({ exports: {}, loader: 'object' })) } })
const eraTools = await import(`${CODE}/apps/studio/lib/os/era-tools.ts`)
const eraMcp = await import(`${CODE}/apps/studio/lib/os/era-mcp-tools.ts`)
const turnCtx = await import(`${CODE}/apps/studio/lib/era/turn/context.ts`)
const rightNow = await import(`${CODE}/apps/studio/lib/era/turn/right-now.ts`)
const brainCtx = await import(`${CODE}/apps/studio/lib/brain/brain-context.ts`)
const principals = new Map<string, any>()
async function eraEnv(who: Asker): Promise<any> {
  let p = principals.get(who.userId)
  if (!p) {
    p = await runInOrganization(who.orgId, () => eraTools.eraPrincipal({ userId: who.userId, orgId: who.orgId, workspaceId: who.workspaceId }), { userId: who.userId })
    if (!p) throw new Error('no era principal for ' + who.userId)
    principals.set(who.userId, p)
  }
  const no = async () => { throw new Error('not in bench') }
  return { p, orgId: who.orgId, authUserId: '', conversationId: null, run: no, settle: no, read: no, show: async () => {}, knowledge: null }
}
const inOrg = <T,>(who: Asker, fn: () => Promise<T>) => runInOrganization(who.orgId, fn, { userId: who.userId }) as Promise<T>
/** Era tool brain_search (lib/os/era-mcp-tools.ts) as the member. */
methods.eraBrainSearch = (q, who) => timed(async () => {
  const env = await eraEnv(who)
  const out: any = await inOrg(who, () => eraMcp.callV3(env, 'brain_search', { query: q }))
  if (!out.ok) throw new Error(JSON.stringify(out.body).slice(0, 160))
  const hits = out.body.hits ?? []
  return { text: hits.map((h: any) => `- ${h.snippet}`).join('\n'), ids: hits.map((h: any) => h.id) }
})
/** Era tool brain_graph (shared path engine with the member's viewer). */
methods.eraBrainGraph = (q, who) => timed(async () => {
  const env = await eraEnv(who)
  const out: any = await inOrg(who, () => eraMcp.callV3(env, 'brain_graph', { query: q }))
  if (!out.ok) throw new Error(JSON.stringify(out.body).slice(0, 160))
  return { text: String(out.body.graph ?? ''), ids: [] }
})
/** Per-turn recall + graph lines an Era chat turn gets (lib/era/turn/context.ts recallForTurn + right-now.ts graphForTurn). */
methods.eraTurn = (q, who) => timed(async () => {
  const person = { organizationId: who.orgId, workspaceId: who.workspaceId, appUserId: who.userId }
  // R51: one composed block (right-now.ts memoryForTurn); older code: recallForTurn + graphForTurn
  if ((rightNow as any).memoryForTurn) return { text: ((await inOrg(who, () => (rightNow as any).memoryForTurn(person, q))) as string[]).join(String.fromCharCode(10)), ids: [] }
  const [facts, graph] = await Promise.all([inOrg(who, () => (turnCtx as any).recallForTurn(person, q)), inOrg(who, () => (rightNow as any).graphForTurn(person, q))])
  return { text: [...(facts as string[]), ...(graph as string[])].join('\n'), ids: [] }
})
/** lib/brain/brain-context.ts recallBrain as the builder copilot calls it (person context, graph + memories). */
methods.brainContext = (q, who) => timed(async () => {
  const scopeFilter = brainVisibilitySql({ appUserId: who.userId, cloudWorkspaceId: who.workspaceId })
  const r: any = await inOrg(who, () => brainCtx.recallBrain({ orgId: who.orgId, query: q, scopeFilter, graphScope: { ownerUserId: who.userId }, mode: 'graph', limit: 10 }))
  return { text: [r.text, render(r.memories)].filter(Boolean).join('\n\n'), ids: r.memories.map((m: any) => m.id) }
})
