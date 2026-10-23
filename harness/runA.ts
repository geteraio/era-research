// Retrieval-only runner for the structured datasets (trbiz, biz100k). No LLM anywhere: a "hit" = the exact
// answer string is in the context handed to the model; evidence recall = the evidence memories are in it.
// Usage: bun run run.ts <trbiz|biz100k> <label> [--methods=a,b] [--sweep] [--limit=N]
//   label: free text recorded with the results (e.g. before / after) + the git state of the Brain code.
import { stats, saveJson, loadJson, STATE_DIR, RESULTS_DIR, has, pct, fmt, codeFingerprint, ownerSql } from './lib/common.ts'
import { methods as M } from './lib/a-methods.ts'
type Asker = any; type Retrieved = any

const [dataset = 'trbiz', label = 'adhoc'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}`))?.split('=')[1] ?? (process.argv.includes(`--${k}`) ? '1' : undefined)
const st = loadJson<any>(`${STATE_DIR}/${dataset}.json`)
if (!st) throw new Error(`no state for ${dataset} — run its generator first`)
const raw = ownerSql()
const all: Record<string, (q: string, who: Asker, o?: any) => Promise<Retrieved>> = { ...M }
const methodNames = (flag('methods') ?? 'recallMemories,recallGraph,graphPlusMemories,studioRecall,studioRecallFixCast,vectorTop10').split(',')
const limit = Number(flag('limit') ?? 1e9)
const T = st.tenant
const askers: Record<string, Asker> = Object.fromEntries(Object.entries(T.users).map(([k, u]) => [k, { orgId: T.orgId, workspaceId: T.workspaceId, userId: u as string }]))
const secrets: Array<{ secret: string; cls: string; visibleTo: string[] }> = st.secrets ?? []
const questions: any[] = st.questions.slice(0, limit)
// R42-fix: Era's tools need read on Era's brain (ai) — every bench role gets it
if (methodNames.some((m) => m.startsWith('era'))) { const { grantModuleToAll } = await import('./lib/fixture.ts'); await grantModuleToAll(raw, T.workspaceId, T.orgId, 'ai') }

const fp = codeFingerprint()
console.log(`dataset=${dataset} label=${label} q=${questions.length} methods=${methodNames} head=${fp.head} dirtyBrainFiles=${fp.dirty.length}`)

// warm-up (model load, first plans) — measured separately, excluded from latency stats
const cold: Record<string, number> = {}
for (const m of methodNames) { const r = await all[m](questions[0].q, askers.owner); cold[m] = r.ms }

function leaksFor(text: string, asker: string) {
  const out: string[] = []
  for (const s of secrets) if (!s.visibleTo.includes(asker) && has(text, s.secret)) out.push(s.cls)
  return out
}

type Row = { qid: string; cat: string; asker: string; method: string; hit: boolean; evAll: boolean; evAny: boolean; stalePresent?: boolean; latestFirst?: boolean; leaks: string[]; ms: number; tokens: number; tokens_o200k: number; extra?: any }
const rows: Row[] = []
async function ask(q: any, asker: string, method: string): Promise<Row> {
  const r = await all[method](q.q, askers[asker])
  const ev: string[] = (q.evidenceIds ?? []).filter(Boolean)
  const row: Row = { qid: q.id, cat: q.cat, asker, method, hit: has(r.text, q.answer), evAll: ev.length > 0 && ev.every((id) => r.ids.includes(id)), evAny: ev.some((id) => r.ids.includes(id)), leaks: leaksFor(r.text, asker), ms: r.ms, tokens: r.tokens, tokens_o200k: r.tokens_o200k, extra: r.extra }
  // a superseded value shown as the product labels it — "(was: X)" — is history, not a stale answer
  if (q.stale) { const bare = r.text.replace(/(was: [^)]*)/g, ""); row.stalePresent = has(bare, q.stale); (row as any).staleAnnotated = !has(bare, q.stale) && has(r.text, q.stale) }
  if (q.distractor || q.stale) {
    const other = q.distractor ?? q.stale
    const a = r.text.toLocaleLowerCase('tr').indexOf(q.answer.toLocaleLowerCase('tr')), b = r.text.toLocaleLowerCase('tr').indexOf(other.toLocaleLowerCase('tr'))
    row.latestFirst = a >= 0 && (b < 0 || a < b)
  }
  return row
}

const t0 = performance.now()
let n = 0
for (const q of questions) {
  for (const m of methodNames) {
    rows.push(await ask(q, q.asker, m))
    // permission questions: the same question from the people who MAY see it (shows the gate is not "return nothing")
    if (q.cat === 'permission') {
      rows.push({ ...(await ask(q, 'owner', m)), cat: 'permission_owner' })
      rows.push({ ...(await ask(q, 'finance', m)), cat: 'permission_finance' })
    }
    // leak sweep: every functional question also asked by the sales member
    if (flag('sweep') && q.cat !== 'permission' && q.asker !== 'sales') rows.push({ ...(await ask(q, 'sales', m)), cat: `sweep_sales` })
  }
  if (++n % 25 === 0) console.log(`${n}/${questions.length}  ${((performance.now() - t0) / 1000).toFixed(0)}s`)
}

// ── aggregate ──
const groups = new Map<string, Row[]>()
for (const r of rows) { const k = `${r.method}|${r.cat}`; (groups.get(k) || groups.set(k, []).get(k)!).push(r) }
const summary: any[] = []
for (const [k, rs] of groups) {
  const [method, cat] = k.split('|')
  const cnt = (f: (r: Row) => boolean | undefined) => rs.filter((r) => f(r)).length
  summary.push({
    method, cat, n: rs.length,
    answerInContext: cnt((r) => r.hit), evidenceAll: cnt((r) => r.evAll), evidenceAny: cnt((r) => r.evAny),
    stalePresent: rs[0].stalePresent === undefined ? null : cnt((r) => r.stalePresent), latestWinsStrict: rs[0].stalePresent === undefined ? null : cnt((r) => r.hit && !r.stalePresent),
    latestFirst: rs[0].latestFirst === undefined ? null : cnt((r) => r.latestFirst),
    errors: cnt((r) => !!r.extra?.error), leakQueries: cnt((r) => r.leaks.length > 0), leakByClass: rs.flatMap((r) => [...new Set(r.leaks)]).reduce((a: any, c) => ((a[c] = (a[c] || 0) + 1), a), {}),
    ms: stats(rs.map((r) => r.ms)), tokens: stats(rs.map((r) => r.tokens)), tokens_o200k: stats(rs.map((r) => r.tokens_o200k)),
  })
}
summary.sort((a, b) => a.cat.localeCompare(b.cat) || a.method.localeCompare(b.method))
const out = { dataset, label, at: new Date().toISOString(), code: fp, counts: st.counts, methods: methodNames, cold, wallSec: (performance.now() - t0) / 1000, summary, rows }
const file = `${RESULTS_DIR}/${dataset}-${label}.json`
saveJson(file, out)
for (const s of summary) {
  console.log(`${s.cat.padEnd(20)} ${s.method.padEnd(18)} n=${String(s.n).padStart(3)} ans=${pct(s.answerInContext, s.n).padStart(6)} evAll=${pct(s.evidenceAll, s.n).padStart(6)}${s.latestWinsStrict != null ? ` latestStrict=${pct(s.latestWinsStrict, s.n)}` : ''}${s.latestFirst != null ? ` first=${pct(s.latestFirst, s.n)}` : ''} leak=${s.leakQueries}${s.errors ? ` ERR=${s.errors}` : ''} tok p50=${fmt(s.tokens.p50)} ms p50=${fmt(s.ms.p50)} p95=${fmt(s.ms.p95)}`)
}
console.log('wrote', file)
await raw.end()
process.exit(0)
