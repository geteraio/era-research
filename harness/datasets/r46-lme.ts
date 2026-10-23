// R46 — LongMemEval-S (cleaned) end-to-end QA on a stratified sample, Era Brain's real write path + subscription CLI.
// Per question: bench org → the question's haystack sessions in date order, the USER's messages (product default:
// ERA_LEARN_ASSISTANT off — assistant turns are not learned) as one chat source per session window (≤ 6,000 chars,
// the batch extractor's per-source cut) → extractMemoriesBatch (≤ 8 sources/call, BATCH_SOURCES) → prepare → judgeRelations → commit
// → 3 discovery rounds → recallGraph + recallMemories → org dropped. Then answer (LongMemEval's own CoN prompts) and
// judge (LongMemEval's evaluate_qa.py prompts, per type), for Era and for the full haystack, same models.
// Usage: bun run datasets/r46-lme.ts <ingest|answer|judge|report|all> [--n=100] [--par=3] [--systems=era,full]
import { readFileSync, appendFileSync } from 'node:fs'
import { routerStats, via, arm, extractWithRetry, retryStats } from '../lib/r46-router.ts'
import { llm, parseJson, counters, coalesceStats, MODEL } from '../lib/llm.ts'
import { ownerSql, assertTestDb, saveJson, loadJson, STATE_DIR, RESULTS_DIR, BB2, REPO, stats, tokens, pct, fmt, rng } from '../lib/common.ts'
import { createTenant, dropTenant } from '../lib/fixture.ts'
import '../lib/dbshim.ts'
arm()
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { extractMemoriesBatch, judgeRelations } = await import(`${REPO}/apps/brain-agent/src/brain/extraction.ts`)
const { prepareExtractedMemory, commitExtractedMemory } = await import(`${REPO}/apps/brain-agent/src/brain/ingestion.ts`)
const { discoverRelationships } = await import(`${REPO}/apps/brain-agent/src/brain/relationships.ts`)
const { recallMemories, recallGraph } = await import(`${REPO}/apps/brain-agent/src/brain/recall.ts`)

const phase = process.argv[2] ?? 'all'
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const N = Number(flag('n') ?? 100)
const PAR = Number(flag('par') ?? 3)
const SYSTEMS = (flag('systems') ?? 'era,full').split(',')
const LOG = `${BB2}/logs-R46-lme.log`
const log = (...a: unknown[]) => { const s = `${new Date().toISOString().slice(11, 19)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(s); appendFileSync(LOG, s + '\n') }

const all = JSON.parse(readFileSync(`${BB2}/data/longmemeval_s_cleaned.json`, 'utf8')) as any[]
const typeOf = (x: any) => (x.question_id.endsWith('_abs') ? 'abstention' : x.question_type)
// stratified sample: proportional allocation (largest remainder), seeded shuffle inside each type
function sample(): any[] {
  const byType = new Map<string, any[]>()
  for (const x of all) byType.set(typeOf(x), [...(byType.get(typeOf(x)) ?? []), x])
  const quota = [...byType].map(([t, xs]) => ({ t, xs, exact: (N * xs.length) / all.length }))
  quota.forEach((q: any) => (q.n = Math.floor(q.exact)))
  let left = N - quota.reduce((a: number, q: any) => a + q.n, 0)
  for (const q of [...quota].sort((a: any, b: any) => (b.exact - b.n) - (a.exact - a.n))) { if (left-- <= 0) break; (q as any).n++ }
  const r = rng(46)
  const out: any[] = []
  for (const q of quota as any[]) {
    const xs = [...q.xs]
    for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]] }
    out.push(...xs.slice(0, q.n))
  }
  return out
}
const qs = sample()
log(`LME sample n=${qs.length}`, Object.fromEntries([...new Set(qs.map(typeOf))].map((t) => [t, qs.filter((x) => typeOf(x) === t).length])))

const lmeDate = (s: string) => { const m = s.match(/(\d{4})\/(\d{2})\/(\d{2}).*?(\d{2}):(\d{2})/); return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`) : new Date() }
const fmtDate = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '')
const CTX = `${RESULTS_DIR}/r46-lme-ctx.json`

async function ingestOne(raw: any, x: any, ctxOut: Record<string, any>) {
  const qid = x.question_id
  const tenant = await createTenant(raw, `r46-lme-${qid.slice(0, 12).toLowerCase().replace(/[^a-z0-9-]/g, "-")}`)
  const ORG = tenant.orgId, WS = tenant.workspaceId
  try {
    type Src = { text: string; sourceType: string; metadata: any; ref: string; at: Date; keys: string[] }
    const sources: Src[] = []
    const order = x.haystack_sessions.map((_: any, i: number) => i).sort((a: number, b: number) => lmeDate(x.haystack_dates[a]).getTime() - lmeDate(x.haystack_dates[b]).getTime())
    for (const si of order) {
      const sid = x.haystack_session_ids[si], dateStr = x.haystack_dates[si], at = lmeDate(dateStr)
      const head = `Chat between the user and their AI assistant on ${dateStr}. The user's messages:\n`
      let cur: string[] = [], keys: string[] = [], len = head.length, w = 0
      const push = () => { if (cur.length) sources.push({ text: head + cur.join('\n'), sourceType: 'chat', metadata: { session: sid, date: dateStr }, ref: `lme:${sid}:w${w++}`, at, keys }); cur = []; keys = []; len = head.length }
      x.haystack_sessions[si].forEach((m: any, i: number) => {
        if (m.role !== 'user') return
        const line = `user: ${m.content}`.slice(0, 6000 - head.length)
        if (len + line.length + 1 > 6000) push()
        cur.push(line); keys.push(`${sid}#${i}`); len += line.length + 1
      })
      push()
    }
    const windowOf: Record<string, string[]> = {}
    for (const s of sources) windowOf[s.ref] = s.keys
    const st = { sources: sources.length, extracted: 0, stored: 0 }
    // the worker's batching: ≤ BATCH_SOURCES (8) sources and ≤ BATCH_CHARS (24,000) per extraction call
    const batches: Src[][] = []
    { let cur: Src[] = [], chars = 0
      for (const s of sources) { const n = Math.min(s.text.length, 6000); if (cur.length && (cur.length >= 8 || chars + n > 24000)) { batches.push(cur); cur = []; chars = 0 } cur.push(s); chars += n }
      if (cur.length) batches.push(cur) }
    for (const batch of batches) {
      const results: any[][] = await extractWithRetry(extractMemoriesBatch, batch.map(({ text, sourceType, metadata }) => ({ text, sourceType, metadata })))
      const flat = batch.flatMap((src, k) => (results[k] ?? []).map((memory: any) => ({ src, memory })))
      st.extracted += flat.length
      const preps: any[] = []
      for (const f of flat) preps.push(await runInOrganization(ORG, () => prepareExtractedMemory(ORG, f.memory, { sourceType: 'chat', sourceRef: f.src.ref, metadata: f.src.metadata, scope: 'org' })))
      const judged = await Promise.all(preps.map((p) => (p.dupId || !p.llmCandidates.length ? null : runInOrganization(ORG, () => judgeRelations({ newFact: p.memory.content, candidates: p.llmCandidates, cost: p.costCtx }))))) as any[]
      for (let k = 0; k < preps.length; k++) {
        const p = preps[k]
        const newId = await runInOrganization(ORG, () => commitExtractedMemory(ORG, p, judged[k]))
        if (!newId || newId === p.dupId) continue
        st.stored++
        const at = flat[k].src.at as Date
        await raw`update os.brain_memories set created_at = ${at.toISOString()}::timestamptz, valid_from = ${at.toISOString()}::timestamptz,
            cloud_workspace_id = coalesce(cloud_workspace_id, ${WS}::uuid),
            decay_at = case when decay_at is null then null else decay_at + (now() - ${at.toISOString()}::timestamptz) end
          where id = ${newId}::uuid and organization_id = ${ORG}::uuid`
      }
    }
    const disc = { rounds: 0, inferred: 0 }
    for (let r = 0; r < 3; r++) { const d = await runInOrganization(ORG, () => discoverRelationships(ORG)); disc.rounds++; disc.inferred += d.inferred; if (!d.candidates || !d.inferred) break }
    const [g] = await raw`select (select count(*)::int from os.brain_memories where organization_id = ${ORG}) memories,
        (select count(*)::int from os.brain_entities where organization_id = ${ORG}) entities,
        (select count(*)::int from os.brain_entity_edges where organization_id = ${ORG}) entity_edges`
    // retrieve
    const who = { orgId: ORG, userId: tenant.users.owner }
    const inOrg = <T,>(fn: () => Promise<T>) => runInOrganization(ORG, fn, { userId: who.userId }) as Promise<T>
    const t0 = performance.now()
    const [gr, m] = await Promise.all([
      inOrg(() => recallGraph({ orgId: ORG, query: x.question, scope: { ownerUserId: who.userId } })).then((v: any) => ({ v, ms: performance.now() - t0 })),
      inOrg(() => recallMemories({ orgId: ORG, query: x.question, limit: 10, scope: { ownerUserId: who.userId } })).then((v: any) => ({ v, ms: performance.now() - t0 })),
    ])
    const gText: string = gr.v?.text ?? ''
    const mText = (m.v as any[]).map((r) => `- ${r.content} (${r.sourceType ?? 'memory'}, ${fmtDate(r.createdAt)})`).join('\n')
    const text = [gText && `Graph:\n${gText}`, mText && `Memories:\n${mText}`].filter(Boolean).join('\n\n')
    const gIds: string[] = []
    for (const nd of gr.v?.subgraph?.nodes ?? []) for (const f of nd.facts ?? []) if (f.memoryId && gText.includes(String(f.content).slice(0, 60)) && !gIds.includes(f.memoryId)) gIds.push(f.memoryId)
    const ids = [...new Set([...(m.v as any[]).map((r) => r.id), ...gIds])]
    const refs = ids.length ? await raw`select id, source_ref from os.brain_memories where id = any(${ids}::uuid[])` : []
    const keys = new Set<string>(), sess = new Set<string>()
    for (const r of refs as any[]) for (const k of windowOf[r.source_ref] ?? []) { keys.add(k); sess.add(k.split('#')[0]) }
    const evKeys: string[] = []
    x.haystack_sessions.forEach((s: any[], si: number) => s.forEach((t: any, i: number) => { if (t.has_answer && t.role === 'user') evKeys.push(`${x.haystack_session_ids[si]}#${i}`) }))
    ctxOut[qid] = {
      type: typeOf(x), text, tokens: tokens(text), ms: Math.max(gr.ms, m.ms), msGraph: gr.ms, msMem: m.ms, graph: g, discovery: disc, ingest: st,
      evUserTurns: evKeys.length, evAny: evKeys.some((k) => keys.has(k)), evAll: evKeys.length > 0 && evKeys.every((k) => keys.has(k)),
      sessAny: (x.answer_session_ids ?? []).some((s: string) => sess.has(s)), sessAll: (x.answer_session_ids ?? []).every((s: string) => sess.has(s)),
    }
    log(qid, typeOf(x), st, g, `ctx ${ctxOut[qid].tokens} tok`, `llm cli=${counters.cliCalls} hits=${counters.cacheHits}`)
  } finally {
    await dropTenant(raw, ORG)
  }
}

async function ingest() {
  const raw = ownerSql(4); await assertTestDb(raw)
  const out: Record<string, any> = loadJson(CTX) ?? {}
  const queue = qs.filter((x) => !out[x.question_id])
  log(`ingest+retrieve: ${queue.length} questions to do`)
  let done = 0
  await Promise.all(Array.from({ length: PAR }, async () => {
    while (queue.length) {
      const x = queue.shift()!
      try { await ingestOne(raw, x, out) } catch (e: any) { log(x.question_id, 'FAILED', String(e?.stack ?? e).slice(0, 600)) }
      saveJson(CTX, out)
      if (++done % 5 === 0) log(`ingest ${done}`, { router: routerStats, coalesce: coalesceStats })
    }
  }))
  await raw.end()
}

// LongMemEval run_generation.py templates (CoN step-by-step variants): facts for Era, history chats for full context.
const T_FACTS = 'I will give you several facts extracted from history chats between you and a user. Please answer the question based on the relevant facts. Answer the question step by step: first extract all the relevant information, and then reason over the information to get the answer.\n\n\nHistory Chats:\n\n{}\n\nCurrent Date: {}\nQuestion: {}\nAnswer (step by step):'
const T_FULL = 'I will give you several history chats between you and a user. Please answer the question based on the relevant chat history. Answer the question step by step: first extract all the relevant information, and then reason over the information to get the answer.\n\n\nHistory Chats:\n\n{}\n\nCurrent Date: {}\nQuestion: {}\nAnswer (step by step):'
const fill = (t: string, ...a: string[]) => a.reduce((s, v) => s.replace('{}', () => v), t)
const historyOf = (x: any) => {
  const order = x.haystack_sessions.map((_: any, i: number) => i).sort((a: number, b: number) => lmeDate(x.haystack_dates[a]).getTime() - lmeDate(x.haystack_dates[b]).getTime())
  return order.map((si: number, n: number) => `### Session ${n + 1}:\nSession Date: ${x.haystack_dates[si]}\nSession Content:\n${JSON.stringify(x.haystack_sessions[si].map((m: any) => ({ role: m.role, content: m.content })))}`).join('\n\n')
}
const SYS_ANS = 'You are a helpful assistant.'
const ANS = (s: string) => `${RESULTS_DIR}/r46-lme-answers-${s}.json`
async function answer(sys: string) {
  const ctx = loadJson<Record<string, any>>(CTX) ?? {}
  const out: Record<string, any> = loadJson(ANS(sys)) ?? {}
  const todo = qs.filter((x) => !out[x.question_id] && (sys === 'full' || ctx[x.question_id]))
  log(`lme answer ${sys}: ${todo.length}`)
  let done = 0
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (todo.length) {
      const x = todo.shift()!
      const prompt = sys === 'full' ? fill(T_FULL, historyOf(x), x.question_date, x.question) : fill(T_FACTS, ctx[x.question_id].text || '(none)', x.question_date, x.question)
      const r = await llm(SYS_ANS, prompt, `lme-answer-${sys}`).catch((e) => `ERROR ${e?.message}`)
      out[x.question_id] = { answer: r, promptTokens: tokens(prompt) }
      if (++done % 10 === 0) { saveJson(ANS(sys), out); log(`lme answer ${sys} ${done}`) }
    }
  }))
  saveJson(ANS(sys), out)
}

// LongMemEval evaluate_qa.py get_anscheck_prompt, verbatim
function anscheck(task: string, question: string, answer: string, response: string, abstention: boolean) {
  if (abstention) return fill("I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: {}\n\nExplanation: {}\n\nModel Response: {}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.", question, answer, response)
  if (['single-session-user', 'single-session-assistant', 'multi-session'].includes(task)) return fill("I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.", question, answer, response)
  if (task === 'temporal-reasoning') return fill("I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.", question, answer, response)
  if (task === 'knowledge-update') return fill("I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.", question, answer, response)
  return fill("I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: {}\n\nRubric: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.", question, answer, response)
}
const JUDGE_SYS = `You grade model responses. You receive several numbered items; each item is a complete grading instruction ending in a yes/no question. Grade each item on its own, exactly as its instruction says.
Respond with ONLY a JSON array, one element per item: [{"i": <item number>, "label": "yes" or "no"}]`
const JUD = (s: string) => `${RESULTS_DIR}/r46-lme-judge-${s}.json`
async function judge(sys: string) {
  const ans = loadJson<Record<string, any>>(ANS(sys)) ?? {}
  const out: Record<string, any> = loadJson(JUD(sys)) ?? {}
  const todo = qs.filter((x) => ans[x.question_id] && !out[x.question_id])
  const jobs: any[][] = []
  for (let i = 0; i < todo.length; i += 20) jobs.push(todo.slice(i, i + 20))
  const run = async (items: any[], single = false): Promise<void> => {
    const user = items.map((x, k) => `### ITEM ${k + 1}\n${anscheck(x.question_type, x.question, String(x.answer), ans[x.question_id].answer, x.question_id.endsWith('_abs'))}`).join('\n\n')
    const arr = parseJson<any[]>(await llm(JUDGE_SYS, user, `lme-judge-${sys}`))
    const by = new Map<number, string>()
    if (Array.isArray(arr)) for (const e of arr) if (e && Number.isInteger(Number(e.i))) by.set(Number(e.i), String(e.label).toLowerCase())
    const miss: any[] = []
    items.forEach((x, k) => { const l = by.get(k + 1); if (l === 'yes' || l === 'no') out[x.question_id] = { label: l }; else miss.push(x) })
    if (!single) for (const x of miss) await run([x], true)
    else for (const x of miss) out[x.question_id] = { label: 'no', unparsed: true }
  }
  await Promise.all(Array.from({ length: 3 }, async () => { while (jobs.length) await run(jobs.shift()!) }))
  saveJson(JUD(sys), out)
}

function report() {
  const ctx = loadJson<Record<string, any>>(CTX) ?? {}
  const types = [...new Set(qs.map(typeOf))].sort()
  const summary: any = { model: MODEL, n: qs.length, systems: {} }
  for (const sys of SYSTEMS) {
    const j = loadJson<Record<string, any>>(JUD(sys)) ?? {}
    const per: any = {}
    for (const t of [...types, 'ALL']) {
      const xs = qs.filter((x) => (t === 'ALL' || typeOf(x) === t) && j[x.question_id] && (sys === 'full' || ctx[x.question_id]))
      const ok = xs.filter((x) => j[x.question_id].label === 'yes').length
      per[t] = { n: xs.length, correct: ok, acc: xs.length ? (100 * ok) / xs.length : NaN }
      log(`lme ${sys.padEnd(5)} ${t.padEnd(26)} n=${String(xs.length).padStart(3)} acc=${fmt(per[t].acc)}%`)
    }
    summary.systems[sys] = per
  }
  const cs = qs.map((x) => ctx[x.question_id]).filter(Boolean)
  const ev = cs.filter((c) => c.type !== 'abstention' && c.evUserTurns > 0)
  summary.era = { tokens: stats(cs.map((c) => c.tokens)), ms: stats(cs.map((c) => c.ms)), evidenceUserTurnAny: `${ev.filter((c) => c.evAny).length}/${ev.length}`, sessionAny: `${cs.filter((c) => c.type !== 'abstention' && c.sessAny).length}/${cs.filter((c) => c.type !== 'abstention').length}`,
    memories: stats(cs.map((c) => c.graph?.memories)), entities: stats(cs.map((c) => c.graph?.entities)), entityEdges: stats(cs.map((c) => c.graph?.entity_edges)) }
  const fa = loadJson<Record<string, any>>(ANS('full')) ?? {}
  summary.fullTokens = stats(qs.map((x) => fa[x.question_id]?.promptTokens).filter(Boolean))
  saveJson(`${RESULTS_DIR}/r46-lme-summary.json`, summary)
  log('lme era', summary.era, 'full prompt tokens', summary.fullTokens)
}

if (phase === 'ingest' || phase === 'all') await ingest()
if (phase === 'answer' || phase === 'all') for (const s of SYSTEMS) await answer(s)
if (phase === 'judge' || phase === 'all') for (const s of SYSTEMS) await judge(s)
if (phase === 'report' || phase === 'all') report()
log('llm', { cli: counters.cliCalls, hits: counters.cacheHits, retries: counters.retries, failures: counters.failures, byPurpose: counters.byPurpose }, 'router', routerStats)
process.exit(0)
