// R51 Phase 1 — classify every WRONG Era answer (LoCoMo R46 run, LongMemEval R46 sample) by cause, with the
// owner's subscription CLI (claude-haiku-5-5, cached). Deterministic signals (evidence window in context, full-context
// result) are given to the classifier; the label set is fixed.
// Usage: bun run datasets/r51-classify.ts <locomo|lme|report> [--tag=r46] [--ctx=… --ans=… --judge=…]
import { readFileSync, appendFileSync } from 'node:fs'
import { llm, parseJson, counters } from '../lib/llm.ts'
import { saveJson, loadJson, RESULTS_DIR, BB2 } from '../lib/common.ts'

const phase = process.argv[2] ?? 'locomo'
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const TAG = flag('tag') ?? 'r46'
const LOG = `${BB2}/logs-R51-classify.log`
const log = (...a: unknown[]) => { const s = `${new Date().toISOString().slice(11, 19)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(s); appendFileSync(LOG, s + '\n') }
export const DEV = ['conv-26', 'conv-30', 'conv-41', 'conv-42', 'conv-43']

export const CAUSES: Record<string, string> = {
  missing: 'evidence missing from context — the fact(s) needed for the gold answer are not in the memory context at all',
  buried: 'present but buried or truncated — the needed fact is in the context but cut short / lacks the specific detail the gold names, or is drowned among many similar facts so the answer model picked another',
  date: 'date problem — the needed event is in the context but its date is missing, relative ("last week") without a resolvable anchor, or resolved to the wrong absolute date',
  multihop: 'multi-hop — one needed fact is in the context but a second fact the answer depends on (another event, a list member, the other person) is not',
  answerer: 'answer model error — everything needed is in the context, the answer model abstained, mis-read or over-reasoned anyway',
  judge: 'judge error — the generated answer actually matches the gold (same thing / same date) and should have been graded correct',
  gold: 'gold questionable — the gold answer is wrong, unanswerable from the conversation, or the question is ambiguous',
}

const SYSTEM = `You are auditing a memory system's wrong answers. For each numbered item you get: the question, the gold answer, the
conversation turns that hold the evidence (with the session date), the MEMORY CONTEXT the system gave the answer model, the
answer model's answer and its reasoning, the judge's reason, and the answer another run produced from the FULL conversation.
Decide the ONE main cause the answer was graded wrong, choosing exactly one label:
${Object.entries(CAUSES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
Rules: check the MEMORY CONTEXT carefully for the fact before choosing missing/multihop. Prefer "judge" only when the generated
answer really matches the gold. Prefer "gold" only when the evidence turns do not support the gold. If the needed fact is present
with a WRONG date, that is "date". If the fact is present but stated more vaguely than the gold (detail dropped), that is "buried".
Respond with ONLY a JSON array: [{"i": <item number>, "cause": "<label>", "why": "<one short sentence>"}]`

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …[cut]' : s)

async function classify(items: Array<{ id: string; user: string }>, out: Record<string, any>, file: string, B = 5) {
  const todo = items.filter((x) => !out[x.id])
  const jobs: typeof todo[] = []
  for (let i = 0; i < todo.length; i += B) jobs.push(todo.slice(i, i + B))
  log(`classify ${todo.length} items in ${jobs.length} calls`)
  let done = 0
  const runOne = async (job: typeof todo, single = false): Promise<void> => {
    const user = job.map((x, k) => `### ITEM ${k + 1}\n${x.user}`).join('\n\n')
    const arr = parseJson<any[]>(await llm(SYSTEM, user, 'r51-classify'))
    const by = new Map<number, any>()
    if (Array.isArray(arr)) for (const x of arr) if (x && Number.isInteger(Number(x.i))) by.set(Number(x.i), x)
    const miss: typeof todo = []
    job.forEach((x, k) => { const r = by.get(k + 1); if (r && CAUSES[r.cause]) out[x.id] = { cause: r.cause, why: r.why ?? '' }; else miss.push(x) })
    if (!single) for (const x of miss) await runOne([x], true)
    else for (const x of miss) out[x.id] = { cause: 'unparsed', why: '' }
    if (++done % 10 === 0) { saveJson(file, out); log(`classify ${done}/${jobs.length} cli=${counters.cliCalls}`) }
  }
  const q = [...jobs]
  await Promise.all(Array.from({ length: 3 }, async () => { while (q.length) await runOne(q.shift()!) }))
  saveJson(file, out)
}

async function locomo() {
  const data = JSON.parse(readFileSync(`${BB2}/data/locomo10.json`, 'utf8')) as any[]
  const ctx = loadJson<any>(flag('ctx') ?? `${RESULTS_DIR}/r46-locomo-ctx.json`)!
  const ans = loadJson<any>(flag('ans') ?? `${RESULTS_DIR}/r46-locomo-answers-era.json`)!
  const jud = loadJson<any>(flag('judge') ?? `${RESULTS_DIR}/r46-locomo-judge-era.json`)!
  const ansF = loadJson<any>(`${RESULTS_DIR}/r46-locomo-answers-full.json`)!
  const judF = loadJson<any>(`${RESULTS_DIR}/r46-locomo-judge-full.json`)!
  const FILE = `${RESULTS_DIR}/r51-classify-locomo-${TAG}.json`
  const out: Record<string, any> = loadJson(FILE) ?? {}
  const items: Array<{ id: string; user: string }> = []
  for (const c of data) {
    const turn = new Map<string, string>()
    for (let s = 1; c.conversation[`session_${s}`]; s++) for (const t of c.conversation[`session_${s}`]) turn.set(t.dia_id, `[${c.conversation[`session_${s}_date_time`]}] ${t.speaker}: ${t.text}${t.blip_caption ? ` [shares a photo: ${t.blip_caption}]` : ''}`)
    c.qa.filter((q: any) => q.category !== 5).forEach((q: any, i: number) => {
      const id = `${c.sample_id}-${i}`
      if (jud[id]?.label !== 'WRONG') return
      const ev = (q.evidence ?? []).flatMap((e: string) => e.split(/[;,]\s*/)).map((e: string) => e.trim()).filter(Boolean)
      items.push({ id, user: [
        `Question: ${q.question}`, `Gold answer: ${q.answer}`,
        `Evidence turns:\n${ev.map((e: string) => turn.get(e) ?? `(${e} not found)`).join('\n')}`,
        `MEMORY CONTEXT:\n${clip(ctx[id]?.text || '(none)', 9000)}`,
        `Answer model's answer: ${ans[id]?.answer || '(none)'}\nIts reasoning: ${ans[id]?.work ?? ''}`,
        `Judge's reason: ${jud[id]?.reason ?? ''}`,
        `Full-conversation run answered: ${ansF[id]?.answer ?? '?'} (graded ${judF[id]?.label ?? '?'})`,
      ].join('\n') })
    })
  }
  await classify(items, out, FILE)
  report('locomo', FILE)
}

async function lme() {
  const all = JSON.parse(readFileSync(`${BB2}/data/longmemeval_s_cleaned.json`, 'utf8')) as any[]
  const byId = new Map(all.map((x) => [x.question_id, x]))
  const ctx = loadJson<any>(flag('ctx') ?? `${RESULTS_DIR}/r46-lme-ctx.json`)!
  const ans = loadJson<any>(flag('ans') ?? `${RESULTS_DIR}/r46-lme-answers-era.json`)!
  const jud = loadJson<any>(flag('judge') ?? `${RESULTS_DIR}/r46-lme-judge-era.json`)!
  const ansF = loadJson<any>(`${RESULTS_DIR}/r46-lme-answers-full.json`)!
  const judF = loadJson<any>(`${RESULTS_DIR}/r46-lme-judge-full.json`)!
  const FILE = `${RESULTS_DIR}/r51-classify-lme-${TAG}.json`
  const out: Record<string, any> = loadJson(FILE) ?? {}
  const items: Array<{ id: string; user: string }> = []
  for (const id of Object.keys(jud)) {
    if (jud[id]?.label === 'yes') continue
    const x = byId.get(id)!
    const ev: string[] = []
    x.haystack_sessions.forEach((s: any[], si: number) => s.forEach((t: any) => { if (t.has_answer) ev.push(`[${x.haystack_dates[si]}] ${t.role}: ${clip(t.content, 700)}`) }))
    items.push({ id, user: [
      `Question (asked on ${x.question_date}; type ${x.question_type}): ${x.question}`, `Gold answer: ${x.answer}`,
      `Evidence turns:\n${ev.join('\n') || '(none marked)'}`,
      `MEMORY CONTEXT:\n${clip(ctx[id]?.text || '(none)', 9000)}`,
      `Answer model's answer: ${clip(ans[id]?.answer || '(none)', 1500)}`,
      `Judge: wrong`,
      `Full-conversation run answered: ${clip(ansF[id]?.answer ?? '?', 600)} (graded ${judF[id]?.label ?? '?'})`,
      ...(ctx[id]?.type === 'single-session-assistant' ? ['NOTE: the system only learns the USER\'s messages; the evidence here is in an assistant turn.'] : []),
    ].join('\n') })
  }
  await classify(items, out, FILE, 4)
  report('lme', FILE)
}

export function report(kind: string, file: string) {
  const out = loadJson<any>(file) ?? {}
  const ids = Object.keys(out)
  const cnt = (f: (id: string) => boolean) => { const r: Record<string, number> = {}; for (const id of ids.filter(f)) r[out[id].cause] = (r[out[id].cause] ?? 0) + 1; return r }
  log(kind, 'ALL', ids.length, cnt(() => true))
  if (kind === 'locomo') { log(kind, 'DEV', cnt((id) => DEV.some((d) => id.startsWith(d + '-')))); log(kind, 'TEST', cnt((id) => !DEV.some((d) => id.startsWith(d + '-')))) }
}

if (phase === 'locomo') await locomo()
if (phase === 'lme') await lme()
if (phase === 'report') { report('locomo', `${RESULTS_DIR}/r51-classify-locomo-${TAG}.json`); report('lme', `${RESULTS_DIR}/r51-classify-lme-${TAG}.json`) }
log('llm', { cli: counters.cliCalls, hits: counters.cacheHits, failures: counters.failures })
process.exit(0)
