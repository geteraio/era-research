// LongMemEval-S (cleaned, MIT) and LoCoMo-10 (CC BY-NC 4.0, evaluation use only) — RETRIEVAL-ONLY runner.
// Each question (LME) / conversation (LoCoMo) is one user's memory: its haystack is written into a bench org in
// the test database, queried through the real recall functions, then deleted. No LLM: no extraction (raw rounds/turns are
// stored as memories, with real e5 embeddings), no answer generation, no judge.
// Usage: bun run datasets/memeval.ts <lme|locomo> <label> [--limit=N] [--methods=recallMemories,vectorTop10] [--k=10]
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { ownerSql, assertTestDb, stats, saveJson, loadJson, RESULTS_DIR, STATE_DIR, BB2, has, pct, fmt, codeFingerprint, tokens } from '../lib/common.ts'
import { createTenant, dropTenant } from '../lib/fixture.ts'
import { methods as M, vectorBaseline, embedLocal, type Asker } from '../lib/methods.ts'

const [which = 'lme', label = 'adhoc'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const LIMIT = Number(flag('limit') ?? 1e9)
const K = Number(flag('k') ?? 10)
const methodNames = (flag('methods') ?? 'recallMemories,vectorTop10').split(',')
const raw = ownerSql(6)
await assertTestDb(raw)
const all: Record<string, any> = { ...M, vectorTop10: vectorBaseline(raw) }

// ── units: one memory store per unit ──
type Mem = { key: string; content: string; date: string; evidence: boolean }
type Query = { id: string; type: string; q: string; answer: string; evidenceKeys: string[]; evidenceSessions?: string[] }
type Unit = { id: string; mems: Mem[]; queries: Query[] }
const MAXC = 4000
function lmeDate(s: string) { const m = s.match(/(\d{4})\/(\d{2})\/(\d{2}).*?(\d{2}):(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : new Date().toISOString() }
function loadUnits(): Unit[] {
  if (which === 'lme') {
    const data = JSON.parse(readFileSync(`${BB2}/data/longmemeval_s_cleaned.json`, 'utf8'))
    return data.slice(0, LIMIT).map((x: any) => {
      const mems: Mem[] = []
      x.haystack_sessions.forEach((sess: any[], si: number) => {
        const sid = x.haystack_session_ids[si], date = lmeDate(x.haystack_dates[si])
        // one memory per round (user turn + the assistant reply), the LongMemEval "round" key
        for (let i = 0; i < sess.length; i += 1) {
          if (sess[i].role !== 'user' && i > 0 && sess[i - 1].role === 'user') continue
          const u = sess[i], a = sess[i + 1]?.role === 'assistant' ? sess[i + 1] : null
          const content = `${u.role}: ${u.content}${a ? `\nassistant: ${a.content}` : ''}`.slice(0, MAXC)
          mems.push({ key: `${sid}#${i}`, content, date, evidence: !!(u.has_answer || a?.has_answer) })
        }
      })
      const ev = mems.filter((m) => m.evidence).map((m) => m.key)
      return { id: x.question_id, mems, queries: [{ id: x.question_id, type: x.question_id.endsWith('_abs') ? 'abstention' : x.question_type, q: x.question, answer: String(x.answer), evidenceKeys: ev, evidenceSessions: x.answer_session_ids }] }
    })
  }
  const data = JSON.parse(readFileSync(`${BB2}/data/locomo10.json`, 'utf8'))
  const CAT: Record<number, string> = { 1: 'multi-hop', 2: 'temporal', 3: 'open-domain', 4: 'single-hop', 5: 'adversarial' }
  return data.slice(0, LIMIT).map((c: any) => {
    const mems: Mem[] = []
    for (let s = 1; c.conversation[`session_${s}`]; s++) {
      const date = c.conversation[`session_${s}_date_time`]
      for (const t of c.conversation[`session_${s}`]) mems.push({ key: t.dia_id, content: `[${date}] ${t.speaker}: ${t.text}${t.blip_caption ? ` (shared a photo: ${t.blip_caption})` : ''}`, date: new Date(Date.parse(date.replace(/^(\d+:\d+ [ap]m) on /, '')) || Date.now()).toISOString(), evidence: false })
    }
    const queries = c.qa.filter((q: any) => q.category !== 5).map((q: any, i: number) => ({ id: `${c.sample_id}-${i}`, type: CAT[q.category] ?? String(q.category), q: q.question, answer: String(q.answer), evidenceKeys: (q.evidence ?? []).flatMap((e: string) => e.split(/[;,]\s*/)).map((e: string) => e.trim()) }))
    return { id: c.sample_id, mems, queries }
  })
}
const units = loadUnits()
const totalMems = units.reduce((a, u) => a + u.mems.length, 0)
console.log(`${which}: units=${units.length} memories=${totalMems} queries=${units.reduce((a, u) => a + u.queries.length, 0)}`)

// ── embedding cache (content hash → e5 passage vector) ──
const cacheFile = `${BB2}/data/emb-${which}.bin`, cacheIdx = `${BB2}/data/emb-${which}.json`
const idx: Record<string, number> = existsSync(cacheIdx) ? JSON.parse(readFileSync(cacheIdx, 'utf8')) : {}
let buf = existsSync(cacheFile) ? new Float32Array(readFileSync(cacheFile).buffer.slice(0)) : new Float32Array(0)
const h = (s: string) => createHash('sha1').update(s).digest('hex')
// merge shard caches written by parallel --shard=i/N runs (same model, same inputs; only the work is split)
{
  const { readdirSync } = await import('node:fs')
  const shards = readdirSync(`${BB2}/data`).filter((x) => x.startsWith(`emb-${which}-shard-`) && x.endsWith('.json'))
  for (const sj of shards) {
    const sidx: Record<string, number> = JSON.parse(readFileSync(`${BB2}/data/${sj}`, 'utf8'))
    const sbuf = new Float32Array(readFileSync(`${BB2}/data/${sj.replace('.json', '.bin')}`).buffer.slice(0))
    const add = Object.entries(sidx).filter(([k]) => !(k in idx))
    const grow = new Float32Array(Object.keys(idx).length * 384 + add.length * 384); grow.set(buf.subarray(0, Object.keys(idx).length * 384)); buf = grow
    let next = Object.keys(idx).length
    for (const [k, i] of add) { buf.set(sbuf.subarray(i * 384, i * 384 + 384), next * 384); idx[k] = next++ }
  }
}
let need = [...new Set(units.flatMap((u) => u.mems.map((m) => m.content)))].filter((c) => !(h(c) in idx)).sort()
const shardArg = flag('shard')
let cacheFileW = cacheFile, cacheIdxW = cacheIdx
if (shardArg) {
  const [si, sn] = shardArg.split('/').map(Number)
  need = need.filter((_, i) => i % sn === si)
  cacheFileW = `${BB2}/data/emb-${which}-shard-${si}.bin`; cacheIdxW = `${BB2}/data/emb-${which}-shard-${si}.json`
  for (const k of Object.keys(idx)) delete idx[k]
  buf = new Float32Array(0)
}
if (need.length) {
  console.log('embedding', need.length, 'new texts (cached ones:', Object.keys(idx).length, ')')
  const t0 = performance.now()
  const grow = new Float32Array(buf.length + need.length * 384); grow.set(buf); buf = grow
  let next = Object.keys(idx).length
  for (let i = 0; i < need.length; i += 256) {
    const vecs = await embedLocal(need.slice(i, i + 256), 'passage')
    vecs.forEach((v: number[], j: number) => { buf.set(v, next * 384); idx[h(need[i + j])] = next++ })
    if ((i / 256) % 40 === 0) console.log(`  ${i + 256}/${need.length}  ${((performance.now() - t0) / 1000).toFixed(0)}s`)
    if ((i / 256) % 100 === 99) { writeFileSync(cacheFileW, Buffer.from(buf.buffer, 0, next * 384 * 4)); writeFileSync(cacheIdxW, JSON.stringify(idx)) }
  }
  writeFileSync(cacheFileW, Buffer.from(buf.buffer, 0, next * 384 * 4)); writeFileSync(cacheIdxW, JSON.stringify(idx))
  console.log('embedded in', ((performance.now() - t0) / 1000).toFixed(0), 's')
}
if (process.argv.includes('--embed-only')) { console.log('embed cache ready:', Object.keys(idx).length); process.exit(0) }
const vecOf = (c: string) => { const i = idx[h(c)]; return `[${Array.from(buf.subarray(i * 384, i * 384 + 384)).join(',')}]` }

// ── tenant ──
const stFile = `${STATE_DIR}/memeval.json`
let tenant = loadJson<any>(stFile)?.tenant
const exists = tenant && (await raw`select 1 from os.organization where id = ${tenant.orgId}`).length
if (!exists) { tenant = await createTenant(raw, 'memeval'); saveJson(stFile, { tenant }) }
const ORG = tenant.orgId, WS = tenant.workspaceId
const who: Asker = { orgId: ORG, workspaceId: WS, userId: tenant.users.owner }
const env = (await raw`select count(*)::int total, count(*) filter (where organization_id <> ${ORG})::int foreign_rows from os.brain_memories`)[0]
const fp = codeFingerprint()
console.log('env', env, 'code', fp.head, 'dirty brain files', fp.dirty.length)

// recall fires an async access-counter update on the rows it returned; deleting them at the same moment can deadlock.
async function wipe() {
  await assertTestDb(raw)
  for (let attempt = 1; ; attempt++) {
    await new Promise((r) => setTimeout(r, 250))
    try {
      await raw`delete from os.brain_memory_edges e using os.brain_memories m where m.organization_id = ${ORG} and (m.id = e.from_memory_id or m.id = e.to_memory_id)`
      await raw`delete from os.brain_memories where organization_id = ${ORG}`
      return
    } catch (e: any) { if (!/deadlock/.test(String(e?.message)) || attempt >= 5) throw e }
  }
}
await wipe()

type Row = { id: string; type: string; method: string; ms: number; tokens: number; nCtx: number; hit: boolean; evAny: boolean; evAll: boolean; sessAny?: boolean; sessAll?: boolean; evAny5: boolean }
const rows: Row[] = []
const t0 = performance.now()
let done = 0
for (const u of units) {
  await assertTestDb(raw)
  const idByKey = new Map<string, string>(), keyById = new Map<string, string>()
  const clean = (t: string) => Array.from(t).filter((c) => { const cp = c.codePointAt(0)!; return cp < 0xd800 || cp > 0xdfff }).join('')
  const recs = u.mems.map((m) => { const id = randomUUID(); idByKey.set(m.key, id); keyById.set(id, m.key); return { id, content: clean(m.content), at: m.date, emb: vecOf(m.content), ref: `${which}:${m.key}`.slice(0, 255) } })
  for (let i = 0; i < recs.length; i += 500) {
    await raw`insert into os.brain_memories (id, organization_id, content, kind, importance, source_type, source_ref, created_at, valid_from, embedding_e5, cloud_workspace_id, lang)
      select x.id, ${ORG}::uuid, x.content, 'episode', 0.5, 'chat', x.ref, x.at, x.at, x.emb::os.vector, ${WS}::uuid, 'en'
      from jsonb_to_recordset(${raw.json(recs.slice(i, i + 500))}::jsonb) as x(id uuid, content text, at timestamp, emb text, ref text)`
  }
  for (const q of u.queries) {
    for (const m of methodNames) {
      const r = await all[m](q.q, who, { k: K })
      const keys = r.ids.map((id: string) => keyById.get(id)).filter(Boolean) as string[]
      const keys5 = keys.slice(0, 5)
      const ev = q.evidenceKeys
      const row: Row = { id: q.id, type: q.type, method: m, ms: r.ms, tokens: r.tokens, nCtx: r.ids.length, hit: has(r.text, q.answer), evAny: ev.some((k) => keys.includes(k)), evAll: ev.length > 0 && ev.every((k) => keys.includes(k)), evAny5: ev.some((k) => keys5.includes(k)) }
      if (q.evidenceSessions) {
        const sess = new Set(keys.map((k) => k.split('#')[0]))
        row.sessAny = q.evidenceSessions.some((s) => sess.has(s))
        row.sessAll = q.evidenceSessions.every((s) => sess.has(s))
      }
      rows.push(row)
    }
  }
  await wipe()
  if (++done % 25 === 0 || done === units.length) console.log(`${done}/${units.length}  ${((performance.now() - t0) / 1000).toFixed(0)}s`)
}

// ── aggregate by method × type (+ ALL, excluding abstention which has no evidence) ──
const summary: any[] = []
for (const m of methodNames) {
  const mine = rows.filter((r) => r.method === m)
  const types = [...new Set(mine.map((r) => r.type))].sort()
  for (const t of [...types, 'ALL']) {
    const rs = t === 'ALL' ? mine.filter((r) => r.type !== 'abstention') : mine.filter((r) => r.type === t)
    const c = (f: (r: Row) => any) => rs.filter(f).length
    summary.push({ method: m, type: t, n: rs.length, answerInContext: c((r) => r.hit), evidenceAny: c((r) => r.evAny), evidenceAll: c((r) => r.evAll), evidenceAny5: c((r) => r.evAny5),
      sessionAny: rs[0]?.sessAny === undefined ? null : c((r) => r.sessAny), sessionAll: rs[0]?.sessAll === undefined ? null : c((r) => r.sessAll),
      ms: stats(rs.map((r) => r.ms)), tokens: stats(rs.map((r) => r.tokens)), ctxItems: stats(rs.map((r) => r.nCtx)) })
  }
}
const out = { dataset: which, label, at: new Date().toISOString(), code: fp, env, k: K, methods: methodNames, units: units.length, memories: totalMems, wallSec: (performance.now() - t0) / 1000, summary, rows }
const file = `${RESULTS_DIR}/${which}-${label}.json`
saveJson(file, out)
for (const s of summary) console.log(`${s.method.padEnd(15)} ${s.type.padEnd(26)} n=${String(s.n).padStart(4)} ans=${pct(s.answerInContext, s.n).padStart(6)} ev@${K}any=${pct(s.evidenceAny, s.n).padStart(6)} all=${pct(s.evidenceAll, s.n).padStart(6)} ev@5=${pct(s.evidenceAny5, s.n).padStart(6)}${s.sessionAny != null ? ` sess@${K}any=${pct(s.sessionAny, s.n)} all=${pct(s.sessionAll, s.n)}` : ''} tok p50=${fmt(s.tokens.p50)} ms p50=${fmt(s.ms.p50)} p95=${fmt(s.ms.p95)}`)
console.log('wrote', file)
if (process.argv.includes('--drop')) console.log('dropped', await dropTenant(raw, ORG))
await raw.end()
process.exit(0)
