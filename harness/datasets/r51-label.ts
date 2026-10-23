// R51 — per question, which stored memories carry the gold answer (dev conversations only, current r51 ingest).
// Candidates = the memories extracted from the question's evidence windows. The LLM (subscription CLI, cached) marks which
// of them are needed and whether together they suffice. Result: results/r51-gold-mem-<state>.json
//   { [qid]: { cand: n, needed: [memoryId…], sufficient: bool } }
// That makes retrieval tuning measurable WITHOUT more LLM calls (gold-fact recall in context), and splits
// "evidence missing" into not-extracted vs extracted-but-not-retrieved.
import { readFileSync, appendFileSync } from 'node:fs'
import { llm, parseJson, counters } from '../lib/llm.ts'
import { ownerSql, saveJson, loadJson, STATE_DIR, RESULTS_DIR, BB2 } from '../lib/common.ts'

const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const STATE = flag('state') ?? 'r51-locomo'
const DEV = ['conv-26', 'conv-30', 'conv-41', 'conv-42', 'conv-43']
const CONVS = flag('convs')?.split(',') ?? DEV
const LOG = `${BB2}/logs-R51-label.log`
const log = (...a: unknown[]) => { const s = `${new Date().toISOString().slice(11, 19)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(s); appendFileSync(LOG, s + '\n') }

const data = JSON.parse(readFileSync(`${BB2}/data/locomo10.json`, 'utf8')) as any[]
const state = loadJson<any>(`${STATE_DIR}/${STATE}.json`)!
const FILE = `${RESULTS_DIR}/r51-gold-mem-${STATE}.json`
const out: Record<string, any> = loadJson(FILE) ?? {}
const raw = ownerSql(2)

const SYSTEM = `You check a memory store. For each numbered item: a question, its gold answer, the conversation turns that hold the
evidence, and numbered candidate MEMORIES (facts extracted from that part of the conversation, each with its date).
Pick the memories a reader needs to give the gold answer (the ones that state the asked fact, or the date/number/item it needs).
Then say whether those picked memories TOGETHER are sufficient to give the gold answer (true/false) — false when a detail the gold
names was lost in extraction, or a date cannot be worked out from them.
Respond with ONLY a JSON array: [{"i": <item number>, "needed": [<memory numbers>], "sufficient": true|false}]`

type It = { id: string; user: string; mems: string[] }
const items: It[] = []
for (const c of data.filter((c) => CONVS.includes(c.sample_id))) {
  const st = state[c.sample_id]
  const turn = new Map<string, string>()
  for (let s = 1; c.conversation[`session_${s}`]; s++) for (const t of c.conversation[`session_${s}`]) turn.set(t.dia_id, `[${c.conversation[`session_${s}_date_time`]}] ${t.speaker}: ${t.text}${t.blip_caption ? ` [shares a photo: ${t.blip_caption}]` : ''}`)
  const rows = await raw`select id, content, source_ref, created_at, is_latest from os.brain_memories where organization_id = ${st.orgId} order by created_at, id`
  const byRef = new Map<string, any[]>()
  for (const r of rows as any[]) (byRef.get(r.source_ref) || byRef.set(r.source_ref, []).get(r.source_ref)!).push(r)
  const refsOf = (dia: string) => Object.entries<string[]>(st.windowOf).filter(([, ds]) => ds.includes(dia)).map(([ref]) => ref)
  c.qa.filter((q: any) => q.category !== 5).forEach((q: any, i: number) => {
    const id = `${c.sample_id}-${i}`
    if (out[id]) return
    const ev = (q.evidence ?? []).flatMap((e: string) => e.split(/[;,]\s*/)).map((e: string) => e.trim()).filter(Boolean)
    const refs = [...new Set(ev.flatMap(refsOf))]
    const mems = refs.flatMap((r) => byRef.get(r) ?? [])
    if (!mems.length) { out[id] = { cand: 0, needed: [], sufficient: false }; return }
    items.push({ id, mems: mems.map((m) => m.id), user: [
      `Question: ${q.question}`, `Gold answer: ${q.answer}`,
      `Evidence turns:\n${ev.map((e: string) => turn.get(e) ?? '').join('\n')}`,
      `MEMORIES:\n${mems.map((m, k) => `${k + 1}. ${m.content} (${new Date(m.created_at).toISOString().slice(0, 10)})`).join('\n')}`,
    ].join('\n') })
  })
}
log(`label ${items.length} questions`)
const jobs: It[][] = []
for (let i = 0; i < items.length; i += 8) jobs.push(items.slice(i, i + 8))
const runOne = async (job: It[], single = false): Promise<void> => {
  const arr = parseJson<any[]>(await llm(SYSTEM, job.map((x, k) => `### ITEM ${k + 1}\n${x.user}`).join('\n\n'), 'r51-label'))
  const by = new Map<number, any>()
  if (Array.isArray(arr)) for (const x of arr) if (x && Number.isInteger(Number(x.i))) by.set(Number(x.i), x)
  const miss: It[] = []
  job.forEach((x, k) => {
    const r = by.get(k + 1)
    if (r && Array.isArray(r.needed)) out[x.id] = { cand: x.mems.length, needed: r.needed.map((n: any) => x.mems[Number(n) - 1]).filter(Boolean), sufficient: !!r.sufficient }
    else miss.push(x)
  })
  if (!single) for (const x of miss) await runOne([x], true)
}
let done = 0
const q = [...jobs]
await Promise.all(Array.from({ length: 3 }, async () => { while (q.length) { await runOne(q.shift()!); if (++done % 10 === 0) { saveJson(FILE, out); log(`label ${done}/${jobs.length}`) } } }))
saveJson(FILE, out)
const v = Object.values<any>(out)
log('labelled', v.length, 'no candidates', v.filter((x) => !x.cand).length, 'none needed', v.filter((x) => x.cand && !x.needed.length).length, 'sufficient', v.filter((x) => x.sufficient).length, 'llm', { cli: counters.cliCalls, hits: counters.cacheHits })
await raw.end()
process.exit(0)
