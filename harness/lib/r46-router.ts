// R46 — bench-layer hook (NO product change): brain-agent's background LLM calls go to studio's router
// (era-brains.ts routeBackgroundText → POST {STUDIO_INTERNAL_URL}/api/internal/ai/run). There are no servers in the
// bench, so that one URL is pointed at an unroutable host and answered in-process by the subscription CLI (lib/llm.ts).
// Any other request to a studio URL fails loudly.
import { loadTestEnv } from './common.ts'
import { llm, llmCoalesced, MODEL, evict } from './llm.ts'

loadTestEnv()
const FAKE = 'http://r46-bench.invalid'
/** loadTestEnv() (called by every bench helper) restores .env.test's studio URL — call arm() right before importing brain-agent. */
export function arm() {
  process.env.STUDIO_INTERNAL_URL = FAKE
  process.env.STUDIO_URL = FAKE
  process.env.INTERNAL_API_SECRET = 'r46-bench-intercept'
  process.env.BRAIN_EMBEDDING_BACKEND = process.env.BRAIN_EMBEDDING_BACKEND ?? 'e5-small'
}
arm()

export const routerStats = { calls: 0, byIntent: {} as Record<string, number> }
// judgeRelations' system prompt starts with this — those are coalesced (product: one call per new fact).
const JUDGE_HEAD = 'You compare a NEW fact against EXISTING memories'

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url
  if (url && url.startsWith(FAKE)) {
    if (!url.endsWith('/api/internal/ai/run')) return new Response('{}', { status: 404 })
    const body = JSON.parse(init?.body ?? '{}')
    const system: string = body.input?.system ?? ''
    const user: string = body.input?.messages?.[0]?.content ?? ''
    routerStats.calls++
    const purpose = system.startsWith(JUDGE_HEAD) ? 'judgeRelations' : system.includes('infer REAL relationships') ? 'relationships' : system.includes('memory-extraction engine') ? 'extract' : 'other'
    routerStats.byIntent[purpose] = (routerStats.byIntent[purpose] ?? 0) + 1
    // R51: the judge prompt carries fresh row ids, so every re-ingest missed the cache — ids become m1, m2, … for the
    // model (same order) and are mapped back in its answer. Cache entries written before R51 keep their raw-id keys.
    let text: string
    if (purpose === 'judgeRelations') {
      const ids: string[] = []
      const norm = user.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (u) => { let k = ids.indexOf(u); if (k < 0) { ids.push(u); k = ids.length - 1 } return `m${k + 1}` })
      const out = await llmCoalesced(system, norm, purpose)
      text = out.replace(/"m(\d+)"/g, (m, n) => (ids[Number(n) - 1] ? `"${ids[Number(n) - 1]}"` : m))
    } else text = await llm(system, user, purpose)
    return new Response(JSON.stringify({ ok: true, text, model: MODEL, source: 'subscription-cli', provider: 'anthropic' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const auth = String(init?.headers?.authorization ?? '')
  if (url && (/localhost:3001|127\.0\.0\.1:3001|quickera|getera/.test(url) || auth.includes('Bearer'))) throw new Error(`R46 bench must not call a server: ${url}`)
  return realFetch(input, init)
}) as typeof fetch

/** The `via` the product's batch path hands extractMemories / extractMemoriesBatch (era-brains extractViaRouter). */
export const via = async (system: string, user: string, _max: number) => ({ text: await llm(system, user, 'extract'), model: MODEL, source: 'subscription-cli', connection: { label: 'Claude Code (owner subscription)' } })

/** extractMemoriesBatch with the product's job retry (MAX_ATTEMPTS = 3): unusable output → evict that sample, ask again. */
export const retryStats = { extractRetries: 0, extractGaveUp: 0 }
export async function extractWithRetry(extractMemoriesBatch: any, sources: any[]): Promise<any[][]> {
  for (let attempt = 1; ; attempt++) {
    let last: [string, string] | null = null
    const v = async (system: string, user: string, max: number) => { last = [system, user]; return via(system, user, max) }
    try { return await extractMemoriesBatch({ sources, via: v }) } catch (e: any) {
      if (!/JSON array/.test(String(e?.message)) || !last) throw e
      evict(last[0], last[1])
      if (attempt >= 3) { retryStats.extractGaveUp++; return sources.map(() => []) }
      retryStats.extractRetries++
    }
  }
}
