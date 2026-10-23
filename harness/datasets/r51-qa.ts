// R51 (from R46) — end-to-end QA on LoCoMo-10 (cat 1–4): Era Brain context vs full conversation, same answer + judge model.
// Phases (each cached / resumable):  retrieve → answer(era|full) → judge(era|full) → report
// Usage: bun run datasets/r51-qa.ts <retrieve|answer|judge|report|all> --tag=<run> [--convs=dev|test|conv-26,…] [--ctx=r46|product]  (full-context answers are R46's, reused)
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { llm, parseJson, counters, MODEL } from '../lib/llm.ts'
import { arm } from '../lib/r46-router.ts'
import { ownerSql, assertTestDb, saveJson, loadJson, STATE_DIR, RESULTS_DIR, BB2, REPO, stats, tokens, pct, fmt, has } from '../lib/common.ts'
import '../lib/dbshim.ts'
arm()
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const recallMod: any = await import(`${REPO}/apps/brain-agent/src/brain/recall.ts`)
const { recallMemories, recallGraph } = recallMod

const phase = process.argv[2] ?? 'all'
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const SYSTEMS = (flag('systems') ?? 'era').split(',')
const TAG = flag('tag') ?? 'dev0'
const CTXMODE = flag('ctx') ?? 'product'
const onum = (k: string) => { const m = (flag('opts') ?? '').match(new RegExp(`(?:^|-)${k}(\\d+)`)); return m ? Number(m[1]) : undefined }
const OPTS: any = { budgetTokens: onum('b'), graphTokens: onum('g'), factLimit: onum('k'), sources: onum('s'), order: /(^|-)ff/.test(flag('opts') ?? '') ? 'facts-first' : undefined }
const LOG = `${BB2}/logs-R51-qa.log`
const log = (...a: unknown[]) => { const s = `${new Date().toISOString().slice(11, 19)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(s); appendFileSync(LOG, s + '\n') }
const CAT: Record<number, string> = { 1: 'multi-hop', 2: 'temporal', 3: 'open-domain', 4: 'single-hop' }

const data = JSON.parse(readFileSync(`${BB2}/data/locomo10.json`, 'utf8')) as any[]
const state: Record<string, any> = loadJson(`${STATE_DIR}/${flag('state') ?? 'r51-locomo'}.json`) ?? {}
type Q = { id: string; conv: string; cat: number; q: string; answer: string; evidence: string[] }
const DEVC = ['conv-26', 'conv-30', 'conv-41', 'conv-42', 'conv-43']
const cf = flag('convs')
const ONLYC = cf === 'dev' ? DEVC : cf === 'test' ? (JSON.parse(readFileSync(`${BB2}/data/locomo10.json`, 'utf8')) as any[]).map((c) => c.sample_id).filter((x) => !DEVC.includes(x)) : cf?.split(',')
const questions: Q[] = data.filter((c) => !ONLYC || ONLYC.includes(c.sample_id)).flatMap((c) => c.qa.filter((q: any) => q.category !== 5).map((q: any, i: number) => ({
  id: `${c.sample_id}-${i}`, conv: c.sample_id, cat: q.category, q: q.question, answer: String(q.answer ?? q.adversarial_answer ?? ''),
  evidence: (q.evidence ?? []).flatMap((e: string) => e.split(/[;,]\s*/)).map((e: string) => e.trim()).filter(Boolean),
})))
log(`questions ${questions.length} model=${MODEL}`)

// ─────────── retrieve: Era Brain context per question (recallGraph + recallMemories, the product's budgets) ───────────
const CTX = `${RESULTS_DIR}/r51-locomo-ctx-${TAG}.json`
const WINDOW_TEXT = new Map<string, string>()
for (const c of data) for (let s = 1; c.conversation[`session_${s}`]; s++) {
  const turns = c.conversation[`session_${s}`] as any[]
  for (let w = 0; w * 8 < turns.length; w++) WINDOW_TEXT.set(`locomo:${c.sample_id}:s${s}:w${w}`, `[${c.conversation[`session_${s}_date_time`]}]\n` + turns.slice(w * 8, w * 8 + 8).map((t) => `${t.speaker}: ${t.text}${t.blip_caption ? ` [shares a photo: ${t.blip_caption}]` : ''}`).join('\n'))
}
const fmtDate = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '')
async function retrieve() {
  const raw = ownerSql(2); await assertTestDb(raw)
  const out: Record<string, any> = loadJson(CTX) ?? {}
  const t0 = performance.now()
  let n = 0
  for (const q of questions) {
    if (out[q.id]) continue
    const st = state[q.conv]
    if (!st?.done) throw new Error(`${q.conv} not ingested`)
    const who = { orgId: st.orgId, userId: st.owner }
    const inOrg = <T,>(fn: () => Promise<T>) => runInOrganization(who.orgId, fn, { userId: who.userId }) as Promise<T>
    let text = '', gText = '', mText = '', gms = 0, mms = 0, g: any = null, gIds: string[] = [], memIds: string[] = []
    if (CTXMODE === 'r46') {
      const tG = performance.now()
      const gP = inOrg(() => recallGraph({ orgId: who.orgId, query: q.q, scope: { ownerUserId: who.userId } })).then((g: any) => ({ g, ms: performance.now() - tG }))
      const tM = performance.now()
      const mP = inOrg(() => recallMemories({ orgId: who.orgId, query: q.q, limit: 10, scope: { ownerUserId: who.userId } })).then((m: any) => ({ m, ms: performance.now() - tM }))
      const [G, M] = await Promise.all([gP, mP])
      g = G.g; gms = G.ms; mms = M.ms
      gText = g?.text ?? ''
      // memories rendered as the per-turn recall renders a fact: content (source, date)
      mText = (M.m as any[]).map((r) => `- ${r.content} (${r.sourceType ?? 'memory'}, ${fmtDate(r.createdAt)})${r.previously ? ` (was: ${r.previously})` : ''}`).join('\n')
      text = [gText && `Graph:\n${gText}`, mText && `Memories:\n${mText}`].filter(Boolean).join('\n\n')
      for (const nd of g?.subgraph?.nodes ?? []) for (const f of nd.facts ?? []) if (f.memoryId && gText.includes(String(f.content).slice(0, 60)) && !gIds.includes(f.memoryId)) gIds.push(f.memoryId)
      memIds = (M.m as any[]).map((r) => r.id)
    } else {
      // the product's own memory context (brain-agent recallContext): graph paths + recalled facts, one budget
      const t = performance.now()
      const r = await inOrg(() => recallMod.recallContext({ orgId: who.orgId, query: q.q, scope: { ownerUserId: who.userId }, ...OPTS }))
      gms = mms = performance.now() - t
      text = r?.text ?? ''
      // WHAT-IF (bench only, --snip=N): the raw source window behind the top N facts, as a stored source snippet would give
      const SNIP = Number(flag('snip') ?? 0)
      if (SNIP && r) {
        const top = [...(r.factMemoryIds ?? []).slice(0, SNIP)]
        const rows = top.length ? await raw`select id, source_ref from os.brain_memories where id = any(${top}::uuid[])` : []
        const refs = [...new Set(top.map((id) => (rows as any[]).find((x) => x.id === id)?.source_ref).filter(Boolean))] as string[]
        const snips = refs.map((ref) => WINDOW_TEXT.get(ref)).filter(Boolean)
        if (snips.length) text += `\n\nSOURCES of the top facts (the original conversation):\n${snips.join('\n---\n')}`
      }
      gText = r?.graphText ?? ''; mText = r?.factsText ?? ''
      g = { nodeCount: r?.nodeCount ?? 0, edgeCount: r?.edgeCount ?? 0 }
      gIds = r?.graphMemoryIds ?? []; memIds = r?.factMemoryIds ?? []
    }
    const ids = [...new Set([...memIds, ...gIds])]
    const refs = ids.length ? (await raw`select id, source_ref from os.brain_memories where id = any(${ids}::uuid[])`) : []
    const refOf = new Map(refs.map((r: any) => [r.id, r.source_ref]))
    const dias = new Set<string>()
    for (const id of ids) for (const d of st.windowOf[refOf.get(id)] ?? []) dias.add(d)
    const memDias = new Set<string>()
    for (const id of memIds) for (const d of st.windowOf[refOf.get(id)] ?? []) memDias.add(d)
    out[q.id] = {
      text, tokens: tokens(text), tokensGraph: tokens(gText), tokensMem: tokens(mText), ms: Math.max(gms, mms), msGraph: gms, msMem: mms,
      nMem: memIds.length, nGraphFacts: gIds.length, graphNodes: g?.nodeCount ?? 0, graphEdges: g?.edgeCount ?? 0,
      evAny: q.evidence.some((e) => dias.has(e)), evAll: q.evidence.length > 0 && q.evidence.every((e) => dias.has(e)),
      evAnyMem: q.evidence.some((e) => memDias.has(e)), evAllMem: q.evidence.length > 0 && q.evidence.every((e) => memDias.has(e)),
      ansInCtx: has(text, q.answer),
    }
    if (++n % 100 === 0) { saveJson(CTX, out); log(`retrieve ${n} new  ${((performance.now() - t0) / 1000).toFixed(0)}s`) }
  }
  saveJson(CTX, out)
  log(`retrieve done (${Object.keys(out).length})`)
  await raw.end()
}

// ─────────── answer: Mem0's answer prompt (evaluation/prompts.py ANSWER_PROMPT_ZEP), batched as JSON ───────────
const ANSWER_SYSTEM = `You are an intelligent memory assistant tasked with retrieving accurate information from conversation memories.

# CONTEXT:
You have access to memories from a conversation. These memories contain
timestamped information that may be relevant to answering the question.

# INSTRUCTIONS:
1. Carefully analyze all provided memories
2. Pay special attention to the timestamps to determine the answer
3. If the question asks about a specific event or fact, look for direct evidence in the memories
4. If the memories contain contradictory information, prioritize the most recent memory
5. If there is a question about time references (like "last year", "two months ago", etc.),
   calculate the actual date based on the memory timestamp. For example, if a memory from
   4 May 2022 mentions "went to India last year," then the trip occurred in 2021.
6. Always convert relative time references to specific dates, months, or years. For example,
   convert "last year" to "2022" or "two months ago" to "March 2023" based on the memory
   timestamp. Ignore the reference while answering the question.
7. Focus only on the content of the memories. Do not confuse character
   names mentioned in memories with the actual users who created those memories.
8. The answer should be less than 5-6 words.

# APPROACH (Think step by step):
1. First, examine all memories that contain information related to the question
2. Examine the timestamps and content of these memories carefully
3. Look for explicit mentions of dates, times, locations, or events that answer the question
4. If the answer requires calculation (e.g., converting relative time references), show your work
5. Formulate a precise, concise answer based solely on the evidence in the memories
6. Double-check that your answer directly addresses the question asked
7. Ensure your final answer is specific and avoids vague time references

# BATCH FORMAT (bench wrapper):
You receive several numbered items. Answer each item ONLY from its own memories (shared memories, when given once for all items, apply to every item).
Respond with ONLY a JSON array, one element per item: [{"i": <item number>, "work": "<at most two short sentences>", "answer": "<the answer, less than 5-6 words>"}]`

const sessionsText = (c: any) => {
  const parts: string[] = []
  for (let s = 1; c.conversation[`session_${s}`]; s++) {
    parts.push(`[${c.conversation[`session_${s}_date_time`]}]\n` + (c.conversation[`session_${s}`] as any[]).map((t) => `${t.speaker}: ${t.text}${t.blip_caption ? ` [shares a photo: ${t.blip_caption}]` : ''}`).join('\n'))
  }
  return parts.join('\n\n')
}
const FULL_TOKENS: Record<string, number> = {}

const ANS = (sys: string) => (sys === 'full' ? `${RESULTS_DIR}/r46-locomo-answers-full.json` : `${RESULTS_DIR}/r51-locomo-answers-${sys}-${TAG}.json`)
async function answer(sys: string) {
  const ctx = loadJson<Record<string, any>>(CTX) ?? {}
  const out: Record<string, any> = loadJson(ANS(sys)) ?? {}
  const B = sys === 'full' ? 20 : 12
  const jobs: Array<{ items: Q[]; user: string }> = []
  for (const c of data) {
    const qs = questions.filter((q) => q.conv === c.sample_id)
    const full = sys === 'full' ? sessionsText(c) : ''
    if (sys === 'full') FULL_TOKENS[c.sample_id] = tokens(full)
    for (let i = 0; i < qs.length; i += B) {
      const items = qs.slice(i, i + B)
      if (items.every((q) => out[q.id])) continue
      const user = sys === 'full'
        ? `Memories (the whole conversation, every session with its timestamp; shared by all items):\n\n${full}\n\n` + items.map((q, k) => `### ITEM ${k + 1}\nQuestion: ${q.q}`).join('\n\n')
        : items.map((q, k) => `### ITEM ${k + 1}\nMemories:\n\n${ctx[q.id]?.text || '(none)'}\n\nQuestion: ${q.q}`).join('\n\n')
      jobs.push({ items, user })
    }
  }
  log(`answer ${sys}: ${jobs.length} calls to make (cached ones are free)`)
  let done = 0
  const runOne = async (job: { items: Q[]; user: string }, single = false) => {
    const rawText = await llm(ANSWER_SYSTEM, job.user, `answer-${sys}`)
    const arr = parseJson<any[]>(rawText)
    const byI = new Map<number, any>()
    if (Array.isArray(arr)) for (const x of arr) if (x && Number.isInteger(Number(x.i))) byI.set(Number(x.i), x)
    const missing: Q[] = []
    job.items.forEach((q, k) => {
      const x = byI.get(k + 1)
      if (x && typeof x.answer === 'string' || (x && x.answer != null)) out[q.id] = { answer: String(x.answer), work: x.work ?? '' }
      else missing.push(q)
    })
    if (missing.length && !single) {
      for (const q of missing) {
        const user = sys === 'full' ? `Memories (the whole conversation, every session with its timestamp; shared by all items):\n\n${sessionsText(data.find((c) => c.sample_id === q.conv))}\n\n### ITEM 1\nQuestion: ${q.q}` : `### ITEM 1\nMemories:\n\n${ctx[q.id]?.text || '(none)'}\n\nQuestion: ${q.q}`
        await runOne({ items: [q], user }, true)
      }
    } else for (const q of missing) out[q.id] = { answer: '', work: 'unparsed', unparsed: true }
    done++
    if (done % 10 === 0) { saveJson(ANS(sys), out); log(`answer ${sys} ${done}/${jobs.length}  cli=${counters.cliCalls} hits=${counters.cacheHits}`) }
  }
  const q = [...jobs]
  await Promise.all(Array.from({ length: 3 }, async () => { while (q.length) await runOne(q.shift()!) }))
  saveJson(ANS(sys), out)
  log(`answer ${sys} done: ${Object.keys(out).length}`)
}

// ─────────── judge: Mem0's ACCURACY_PROMPT (evaluation/metrics/llm_judge.py), batched as JSON ───────────
const JUDGE_SYSTEM = `Your task is to label an answer to a question as 'CORRECT' or 'WRONG'. You will be given the following data:
    (1) a question (posed by one user to another user),
    (2) a 'gold' (ground truth) answer,
    (3) a generated answer
which you will score as CORRECT/WRONG.

The point of the question is to ask about something one user should know about the other user based on their prior conversations.
The gold answer will usually be a concise and short answer that includes the referenced topic, for example:
Question: Do you remember what I got the last time I went to Hawaii?
Gold answer: A shell necklace
The generated answer might be much longer, but you should be generous with your grading - as long as it touches on the same topic as the gold answer, it should be counted as CORRECT.

For time related questions, the gold answer will be a specific date, month, year, etc. The generated answer might be much longer or use relative time references (like "last Tuesday" or "next month"), but you should be generous with your grading - as long as it refers to the same date or time period as the gold answer, it should be counted as CORRECT. Even if the format differs (e.g., "May 7th" vs "7 May"), consider it CORRECT if it's the same date.

First, provide a short (one sentence) explanation of your reasoning, then finish with CORRECT or WRONG.
Do NOT include both CORRECT and WRONG in your response, or it will break the evaluation script.

# BATCH FORMAT (bench wrapper):
You receive several numbered items (Question / Gold answer / Generated answer). Grade each one on its own.
Respond with ONLY a JSON array, one element per item: [{"i": <item number>, "reason": "<one sentence>", "label": "CORRECT" or "WRONG"}]`

const JUD = (sys: string) => (sys === 'full' ? `${RESULTS_DIR}/r46-locomo-judge-full.json` : `${RESULTS_DIR}/r51-locomo-judge-${sys}-${TAG}.json`)
async function judge(sys: string) {
  const ans = loadJson<Record<string, any>>(ANS(sys)) ?? {}
  const out: Record<string, any> = loadJson(JUD(sys)) ?? {}
  const todo = questions.filter((q) => ans[q.id] && !out[q.id])
  const B = 30
  const jobs: Q[][] = []
  for (let i = 0; i < todo.length; i += B) jobs.push(todo.slice(i, i + B))
  log(`judge ${sys}: ${jobs.length} calls`)
  const userOf = (items: Q[]) => items.map((q, k) => `### ITEM ${k + 1}\nQuestion: ${q.q}\nGold answer: ${q.answer}\nGenerated answer: ${ans[q.id].answer || '(no answer)'}`).join('\n\n')
  const runOne = async (items: Q[], single = false): Promise<void> => {
    const arr = parseJson<any[]>(await llm(JUDGE_SYSTEM, userOf(items), `judge-${sys}`))
    const byI = new Map<number, any>()
    if (Array.isArray(arr)) for (const x of arr) if (x && Number.isInteger(Number(x.i))) byI.set(Number(x.i), x)
    const missing: Q[] = []
    items.forEach((q, k) => {
      const x = byI.get(k + 1)
      const label = String(x?.label ?? '').toUpperCase()
      if (label === 'CORRECT' || label === 'WRONG') out[q.id] = { label, reason: x.reason ?? '' }
      else missing.push(q)
    })
    if (!single) for (const q of missing) await runOne([q], true)
    else for (const q of missing) out[q.id] = { label: 'WRONG', reason: 'unparsed judge output', unparsed: true }
  }
  let done = 0
  const qq = [...jobs]
  await Promise.all(Array.from({ length: 3 }, async () => { while (qq.length) { await runOne(qq.shift()!); if (++done % 10 === 0) { saveJson(JUD(sys), out); log(`judge ${sys} ${done}/${jobs.length}`) } } }))
  saveJson(JUD(sys), out)
  log(`judge ${sys} done: ${Object.keys(out).length}`)
}

// ─────────── report ───────────
function report() {
  const ctx = loadJson<Record<string, any>>(CTX) ?? {}
  const rows: any[] = []
  const summary: any = { model: MODEL, systems: {} }
  for (const sys of SYSTEMS) {
    const j = loadJson<Record<string, any>>(JUD(sys)) ?? {}
    const ans = loadJson<Record<string, any>>(ANS(sys)) ?? {}
    const per: any = {}
    for (const c of [1, 2, 3, 4, 0]) {
      const qs = questions.filter((q) => (c === 0 || q.cat === c) && j[q.id])
      const ok = qs.filter((q) => j[q.id].label === 'CORRECT').length
      per[c === 0 ? 'ALL' : CAT[c]] = { n: qs.length, correct: ok, J: qs.length ? (100 * ok) / qs.length : NaN, unparsedAnswers: qs.filter((q) => ans[q.id]?.unparsed).length, unparsedJudge: qs.filter((q) => j[q.id]?.unparsed).length }
    }
    summary.systems[sys] = per
  }
  const cs = questions.map((q) => ctx[q.id]).filter(Boolean)
  summary.eraContext = {
    n: cs.length, tokens: stats(cs.map((c) => c.tokens)), tokensGraph: stats(cs.map((c) => c.tokensGraph)), tokensMem: stats(cs.map((c) => c.tokensMem)),
    ms: stats(cs.map((c) => c.ms)), msGraph: stats(cs.map((c) => c.msGraph)), msMem: stats(cs.map((c) => c.msMem)),
    graphUsed: cs.filter((c) => c.tokensGraph > 0).length,
  }
  const evid: any = {}
  for (const c of [1, 2, 3, 4, 0]) {
    const qs = questions.filter((q) => (c === 0 || q.cat === c) && ctx[q.id])
    const k = (f: string) => qs.filter((q) => ctx[q.id][f]).length
    evid[c === 0 ? 'ALL' : CAT[c]] = { n: qs.length, evAny: k('evAny'), evAll: k('evAll'), evAnyMem: k('evAnyMem'), evAllMem: k('evAllMem'), ansInCtx: k('ansInCtx') }
  }
  summary.evidence = evid
  summary.fullContextTokens = stats(data.map((c) => tokens(sessionsText(c))))
  saveJson(`${RESULTS_DIR}/r51-locomo-summary-${TAG}.json`, summary)
  for (const sys of SYSTEMS) for (const [k, v] of Object.entries<any>(summary.systems[sys])) log(`${sys.padEnd(5)} ${k.padEnd(12)} n=${String(v.n).padStart(4)} J=${fmt(v.J)}%  unparsed ans/judge ${v.unparsedAnswers}/${v.unparsedJudge}`)
  log('era ctx tokens p50', summary.eraContext.tokens.p50, 'ms p50', fmt(summary.eraContext.ms.p50), 'p95', fmt(summary.eraContext.ms.p95), 'full ctx tokens p50', summary.fullContextTokens.p50)
  for (const [k, v] of Object.entries<any>(evid)) log(`evidence ${k.padEnd(12)} n=${v.n} any=${pct(v.evAny, v.n)} all=${pct(v.evAll, v.n)} (memories only any=${pct(v.evAnyMem, v.n)} all=${pct(v.evAllMem, v.n)}) answer-in-ctx=${pct(v.ansInCtx, v.n)}`)
}

if (phase === 'retrieve' || phase === 'all') await retrieve()
if (phase === 'answer' || phase === 'all') for (const s of SYSTEMS) await answer(s)
if (phase === 'judge' || phase === 'all') for (const s of SYSTEMS) await judge(s)
if (phase === 'report' || phase === 'all') report()
log('llm', { cli: counters.cliCalls, hits: counters.cacheHits, retries: counters.retries, failures: counters.failures, byPurpose: counters.byPurpose })
process.exit(0)
