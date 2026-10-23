// R46 — LoCoMo-10 through Era Brain's REAL write path, LLM = owner's subscription CLI (lib/llm.ts, cached).
//   per conversation (one bench org each): sessions in order → 8-turn windows (one "source" each) →
//   extractMemoriesBatch (≤ 5 sources per call, the worker's CLAIM_BATCH) → prepareExtractedMemory →
//   judgeRelations (staleness, the no-brain path of processBatch) → commitExtractedMemory;
//   after the conversation: discoverRelationships rounds (typed entity edges) until no candidates.
// Usage: bun run datasets/r46-ingest.ts [--only=conv-26,conv-30] [--par=3] [--fresh]
import { readFileSync, appendFileSync } from 'node:fs'
import { routerStats, via, arm, extractWithRetry, retryStats } from '../lib/r46-router.ts'
import { counters, coalesceStats, MODEL } from '../lib/llm.ts'
import { ownerSql, assertTestDb, saveJson, loadJson, STATE_DIR, BB2, REPO, stats } from '../lib/common.ts'
import { createTenant, dropTenant } from '../lib/fixture.ts'
import '../lib/dbshim.ts'

arm()
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { extractMemoriesBatch, judgeRelations } = await import(`${REPO}/apps/brain-agent/src/brain/extraction.ts`)
const { prepareExtractedMemory, commitExtractedMemory } = await import(`${REPO}/apps/brain-agent/src/brain/ingestion.ts`)
const { discoverRelationships } = await import(`${REPO}/apps/brain-agent/src/brain/relationships.ts`)

const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const ONLY = flag('only')?.split(',')
const PAR = Number(flag('par') ?? 3)
const WIN = 8, BATCH = 5
const LOG = `${BB2}/logs-R51-ingest.log`
const log = (...a: unknown[]) => { const s = `${new Date().toISOString().slice(11, 19)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(s); appendFileSync(LOG, s + '\n') }

const raw = ownerSql(4)
await assertTestDb(raw)
const STATE = `${STATE_DIR}/r51-locomo.json`
const state: Record<string, any> = loadJson(STATE) ?? {}
const data = JSON.parse(readFileSync(`${BB2}/data/locomo10.json`, 'utf8')) as any[]
const convs = data.filter((c) => !ONLY || ONLY.includes(c.sample_id))

const parseDate = (d: string) => new Date(Date.parse(d.replace(/^(\d+:\d+ [ap]m) on /, '')) || Date.now())

async function ingestConversation(c: any) {
  const id = c.sample_id
  const prev = state[id]
  if (prev?.done && !process.argv.includes('--fresh')) { log(id, 'already ingested'); return }
  if (prev?.orgId) { await dropTenant(raw, prev.orgId).catch(() => null) }
  await assertTestDb(raw)
  const tenant = await createTenant(raw, `r51-${id}`)
  const ORG = tenant.orgId, WS = tenant.workspaceId
  state[id] = { orgId: ORG, workspaceId: WS, owner: tenant.users.owner, slug: tenant.slug, done: false }
  saveJson(STATE, state)
  const A = c.conversation.speaker_a, B = c.conversation.speaker_b
  // windows
  type Src = { text: string; sourceType: string; metadata: Record<string, unknown>; ref: string; at: Date; dias: string[] }
  const sources: Src[] = []
  for (let s = 1; c.conversation[`session_${s}`]; s++) {
    const dateStr = c.conversation[`session_${s}_date_time`]
    const at = parseDate(dateStr)
    const turns = c.conversation[`session_${s}`] as any[]
    for (let w = 0; w * WIN < turns.length; w++) {
      const part = turns.slice(w * WIN, w * WIN + WIN)
      const body = part.map((t) => `${t.speaker}: ${t.text}${t.blip_caption ? ` [shares a photo: ${t.blip_caption}]` : ''}`).join('\n')
      sources.push({
        text: `Conversation between ${A} and ${B} on ${dateStr} (session ${s}${w ? `, continued` : ''}).\n${body}`,
        sourceType: 'chat',
        metadata: { conversation: `locomo-${id}`, session: s, date: dateStr, speakers: [A, B] },
        ref: `locomo:${id}:s${s}:w${w}`,
        at,
        dias: part.map((t) => t.dia_id),
      })
    }
  }
  if (flag('maxsrc')) sources.splice(Number(flag('maxsrc')))
  const st = { sources: sources.length, extracted: 0, stored: 0, dup: 0, judged: 0, updates: 0, extends: 0, decayShifted: 0, msPerSource: [] as number[] }
  const windowOf: Record<string, string[]> = {}
  for (const s of sources) windowOf[s.ref] = s.dias
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH)
    const t0 = performance.now()
    const results: any[][] = await extractWithRetry(extractMemoriesBatch, batch.map(({ text, sourceType, metadata }) => ({ text, sourceType, metadata })))
    const flat = batch.flatMap((src, k) => (results[k] ?? []).map((memory: any) => ({ src, memory })))
    st.extracted += flat.length
    const preps: any[] = []
    for (const f of flat) {
      preps.push(await runInOrganization(ORG, () => prepareExtractedMemory(ORG, f.memory, { sourceType: f.src.sourceType, sourceRef: f.src.ref, metadata: f.src.metadata, scope: 'org', sourceText: f.src.text })))
    }
    // staleness: the product's old judge (one per fact with candidates; coalesced into few CLI calls here)
    const judged = await Promise.all(preps.map((p) => (p.dupId || !p.llmCandidates.length ? null : runInOrganization(ORG, () => judgeRelations({ newFact: p.memory.content, candidates: p.llmCandidates, cost: p.costCtx }))))) as any[]
    for (let k = 0; k < preps.length; k++) {
      const p = preps[k], j = judged[k] as Map<string, string> | null
      if (j) { st.judged++; for (const r of j.values()) { if (r === 'updates') st.updates++; if (r === 'extends') st.extends++ } }
      if (p.dupId) st.dup++
      const newId = await runInOrganization(ORG, () => commitExtractedMemory(ORG, p, j))
      if (!newId || newId === p.dupId) continue
      st.stored++
      // Bench-only placement: the conversation happened on the session date (not today) in this workspace.
      // A "temporary:<date>" hint was written relative to that date; shift it by the same amount so replaying
      // 2023 data in 2026 does not decay it before the question is asked.
      const at = flat[k].src.at as Date
      const r = await raw`update os.brain_memories set created_at = ${at.toISOString()}::timestamptz, valid_from = ${at.toISOString()}::timestamptz,
          cloud_workspace_id = coalesce(cloud_workspace_id, ${WS}::uuid),
          decay_at = case when decay_at is null then null else decay_at + (now() - ${at.toISOString()}::timestamptz) end
        where id = ${newId}::uuid and organization_id = ${ORG}::uuid returning (decay_at is not null) as d`
      if (r[0]?.d) st.decayShifted++
    }
    st.msPerSource.push((performance.now() - t0) / batch.length)
    if ((i / BATCH) % 10 === 0) log(id, `sources ${Math.min(i + BATCH, sources.length)}/${sources.length}`, { extracted: st.extracted, stored: st.stored, llm: counters.cliCalls, hits: counters.cacheHits })
  }
  // typed entity edges: the product's semantic-discovery pass, repeated until it has nothing left to look at
  const disc = { rounds: 0, inferred: 0, candidates: 0 }
  for (let r = 0; r < 15; r++) {
    const d = await runInOrganization(ORG, () => discoverRelationships(ORG))
    disc.rounds++; disc.inferred += d.inferred; disc.candidates += d.candidates
    if (!d.candidates || !d.inferred) break
  }
  const [g] = await raw`select
      (select count(*)::int from os.brain_memories where organization_id = ${ORG}) memories,
      (select count(*)::int from os.brain_memories where organization_id = ${ORG} and is_latest) latest,
      (select count(*)::int from os.brain_entities where organization_id = ${ORG}) entities,
      (select count(*)::int from os.brain_entity_edges where organization_id = ${ORG}) entity_edges,
      (select count(*)::int from os.brain_memory_edges e join os.brain_memories m on m.id = e.from_memory_id where m.organization_id = ${ORG}) memory_edges,
      (select count(*)::int from os.brain_memory_entities me join os.brain_memories m on m.id = me.memory_id where m.organization_id = ${ORG}) memory_entity_links`
  const relTypes = await raw`select relation, count(*)::int n from os.brain_entity_edges where organization_id = ${ORG} group by 1 order by 2 desc limit 12`
  state[id] = { ...state[id], done: true, stats: { ...st, msPerSource: stats(st.msPerSource) }, discovery: disc, graph: g, relTypes, windowOf }
  saveJson(STATE, state)
  log(id, 'DONE', { ...st, msPerSource: undefined }, disc, g)
}

log(`R46 ingest start model=${MODEL} convs=${convs.length} par=${PAR}`)
const queue = [...convs]
await Promise.all(Array.from({ length: PAR }, async () => { while (queue.length) { const c = queue.shift()!; try { await ingestConversation(c) } catch (e: any) { log(c.sample_id, 'FAILED', String(e?.stack ?? e).slice(0, 800)) } } }))
log('router', routerStats, 'llm', { cli: counters.cliCalls, hits: counters.cacheHits, retries: counters.retries, failures: counters.failures, byPurpose: counters.byPurpose }, 'coalesce', coalesceStats, 'retry', retryStats)
saveJson(`${STATE_DIR}/r51-ingest-counters.json`, { at: new Date().toISOString(), model: MODEL, routerStats, counters, coalesceStats })
await raw.end()
process.exit(0)
