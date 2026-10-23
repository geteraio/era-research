// R46 — the bench's LLM: the owner's Claude subscription through the Claude Code CLI, headless.
// Never an API key: ANTHROPIC_API_KEY / OPENAI_API_KEY (and friends) are removed from the child env.
// Every response is cached on disk (llm-cache/<sha256>.json, keyed by model + system + user), so a rerun costs nothing.
// Concurrency ≤ 3 CLI processes, retry with backoff, progress counters.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { BB2 } from './common.ts'

export const MODEL = process.env.R46_MODEL || 'claude-haiku-5-5'
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude'
export const CACHE_DIR = `${BB2}/llm-cache`
const CWD = `${BB2}/llm-cwd` // empty folder: no CLAUDE.md, no project settings
mkdirSync(CACHE_DIR, { recursive: true })
mkdirSync(`${CWD}/tmp`, { recursive: true })
const CALL_LOG = `${BB2}/llm-calls.log`

export const counters = { evicted: 0, cliCalls: 0, cacheHits: 0, failures: 0, retries: 0, inTok: 0, outTok: 0, cacheCreate: 0, cacheRead: 0, byPurpose: {} as Record<string, { cli: number; hit: number }> }
const MAXC = Number(process.env.R46_CONCURRENCY || 3)
let active = 0
const waiters: Array<() => void> = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAXC) await new Promise<void>((r) => waiters.push(r))
  active++
  try { return await fn() } finally { active--; waiters.shift()?.() }
}

const key = (system: string, user: string) => createHash('sha256').update(`${MODEL}\u0000${system}\u0000${user}`).digest('hex')
export function cached(system: string, user: string): string | null {
  const f = `${CACHE_DIR}/${key(system, user)}.json`
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).text : null
}
export function putCache(system: string, user: string, text: string, meta: Record<string, unknown> = {}) {
  writeFileSync(`${CACHE_DIR}/${key(system, user)}.json`, JSON.stringify({ model: MODEL, at: new Date().toISOString(), ...meta, system: system.slice(0, 400), userHead: user.slice(0, 400), text }))
}

/** The product retries a job whose model output was unusable (a fresh sample); a cached answer would repeat forever —
 *  move it to llm-cache/rejected/ so the retry asks again. */
export function evict(system: string, user: string) {
  const k = key(system, user), f = `${CACHE_DIR}/${k}.json`
  if (!existsSync(f)) return
  mkdirSync(`${CACHE_DIR}/rejected`, { recursive: true })
  writeFileSync(`${CACHE_DIR}/rejected/${k}-${Date.now()}.json`, readFileSync(f))
  require('node:fs').unlinkSync(f)
  counters.evicted++
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue
    if (/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|DATABASE_URL.*)$/.test(k)) continue
    env[k] = v
  }
  return env
}

async function runCli(system: string, user: string): Promise<{ text: string; usage: any; model: string }> {
  const sysFile = `${CWD}/tmp/sys-${key(system, '')}.txt`
  if (!existsSync(sysFile)) writeFileSync(sysFile, system)
  const p = Bun.spawn([CLAUDE, '-p', '--model', MODEL, '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--system-prompt-file', sysFile], {
    cwd: CWD, env: childEnv(), stdin: new TextEncoder().encode(user), stdout: 'pipe', stderr: 'pipe',
  })
  const timer = setTimeout(() => p.kill(), 15 * 60_000)
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  await p.exited
  clearTimeout(timer)
  let j: any
  try { j = JSON.parse(out) } catch { throw new Error(`cli exit ${p.exitCode}: ${(err || out).slice(0, 300)}`) }
  if (j.is_error || j.subtype !== 'success') throw new Error(`cli error: ${String(j.result ?? j.subtype).slice(0, 300)}`)
  const model = Object.keys(j.modelUsage ?? {})[0] ?? MODEL
  return { text: String(j.result ?? ''), usage: j.usage ?? {}, model }
}

/** One prompt → the model's text. Cached; retried with backoff (rate limits can mean long waits). */
export async function llm(system: string, user: string, purpose = 'misc'): Promise<string> {
  const bp = (counters.byPurpose[purpose] ??= { cli: 0, hit: 0 })
  const hit = cached(system, user)
  if (hit != null) { counters.cacheHits++; bp.hit++; return hit }
  return slot(async () => {
    const again = cached(system, user)
    if (again != null) { counters.cacheHits++; bp.hit++; return again }
    const waits = [10, 30, 60, 120, 300, 600, 900, 1200, 1800]
    for (let attempt = 0; ; attempt++) {
      const t = performance.now()
      try {
        const r = await runCli(system, user)
        counters.cliCalls++; bp.cli++
        counters.inTok += r.usage.input_tokens ?? 0; counters.outTok += r.usage.output_tokens ?? 0
        counters.cacheCreate += r.usage.cache_creation_input_tokens ?? 0; counters.cacheRead += r.usage.cache_read_input_tokens ?? 0
        putCache(system, user, r.text, { servedBy: r.model, usage: r.usage, ms: Math.round(performance.now() - t), purpose })
        appendFileSync(CALL_LOG, `${new Date().toISOString()} ${purpose} ${r.model} ms=${Math.round(performance.now() - t)} in=${(r.usage.input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0)} out=${r.usage.output_tokens ?? 0}\n`)
        if (r.model !== MODEL) console.warn('[llm] served by', r.model)
        return r.text
      } catch (e: any) {
        if (attempt >= waits.length) { counters.failures++; throw e }
        counters.retries++
        const w = waits[attempt]
        console.warn(`[llm] ${purpose} attempt ${attempt + 1} failed (${String(e?.message).slice(0, 200)}) — waiting ${w}s`)
        appendFileSync(CALL_LOG, `${new Date().toISOString()} RETRY ${purpose} ${String(e?.message).slice(0, 200)}\n`)
        await new Promise((r) => setTimeout(r, w * 1000))
      }
    }
  })
}

export function parseJson<T = any>(raw: string): T | null {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  for (const re of [/\[[\s\S]*\]/, /\{[\s\S]*\}/]) {
    const m = cleaned.match(re)
    if (m) try { return JSON.parse(m[0]) } catch {}
  }
  return null
}

// ── Coalescer: many independent prompts with the SAME system prompt → one CLI call (per-item cache) ──
// Used for the product's judgeRelations (one call per new fact in the product; here up to 25 facts per call).
const COALESCE_HEAD = (system: string) => `You perform ONE task, independently, for each numbered input below. The task's own instructions:
=== TASK INSTRUCTIONS ===
${system}
=== END TASK INSTRUCTIONS ===
Treat each input on its own (never mix information between inputs).
Respond with ONLY a JSON array, one element per input: [{"n": <the K of its "### INPUT K" label>, "output": <exactly the JSON the task instructions ask for>}]`
type Pending = { system: string; user: string; resolve: (s: string) => void; reject: (e: unknown) => void; purpose: string }
const queues = new Map<string, Pending[]>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
export const coalesceStats = { items: 0, calls: 0, missing: 0 }
export function llmCoalesced(system: string, user: string, purpose: string, max = 25): Promise<string> {
  const hit = cached(system, user)
  if (hit != null) { counters.cacheHits++; (counters.byPurpose[purpose] ??= { cli: 0, hit: 0 }).hit++; return Promise.resolve(hit) }
  return new Promise((resolve, reject) => {
    const q = queues.get(system) ?? []
    queues.set(system, q)
    q.push({ system, user, resolve, reject, purpose })
    if (q.length >= max) flush(system)
    else if (!timers.has(system)) timers.set(system, setTimeout(() => flush(system), 400))
  })
}
function flush(system: string) {
  const t = timers.get(system); if (t) clearTimeout(t); timers.delete(system)
  const items = (queues.get(system) ?? []).splice(0)
  if (!items.length) return
  const user = items.map((it, n) => `### INPUT ${n + 1}\n${it.user}`).join('\n\n')
  coalesceStats.items += items.length; coalesceStats.calls++
  llm(COALESCE_HEAD(system), user, items[0]!.purpose + '-batch')
    .then((raw) => {
      const arr = parseJson<any[]>(raw)
      const byN = new Map<number, any>()
      if (Array.isArray(arr)) for (const x of arr) if (x && Number.isInteger(Number(x.n))) byN.set(Number(x.n) - 1, x.output)
      items.forEach((it, n) => {
        if (!byN.has(n)) { coalesceStats.missing++; it.resolve('[]'); return }
        const out = byN.get(n)
        const text = typeof out === 'string' ? out : JSON.stringify(out)
        putCache(it.system, it.user, text, { coalesced: true })
        it.resolve(text)
      })
    })
    .catch((e) => items.forEach((it) => it.reject(e)))
}
