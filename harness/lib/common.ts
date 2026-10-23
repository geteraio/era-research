// brain-bench2 shared helpers. The test database (ERA_TEST_DB) ONLY — every writer asserts it before writing.
import postgres from 'postgres'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { getEncoding } from 'js-tiktoken'

/** An Era checkout (the code under test). */
export const REPO = (process.env.ERA_REPO ?? '').replace(/\\/g, '/').replace(/\/$/, '')
if (!REPO) throw new Error('Set ERA_REPO to an Era checkout (see README.md).')
/** Where the Brain/studio SOURCE under test is loaded from: the live working tree (default) or a pristine
 *  git-archive export of HEAD (BB2_CODE=<bb2>/head) for the "before" baseline. The db layer always comes from REPO. */
/** The only database the harness writes to (a throwaway test database). */
export const TEST_DB = process.env.ERA_TEST_DB ?? 'era_test'
export const CODE = process.env.BB2_CODE || REPO
/** The repository root: state/, results/, data/, llm-cache/ and head/ live here. */
export const BB2 = decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '')
export const STATE_DIR = `${BB2}/state`
export const RESULTS_DIR = `${BB2}/results`
mkdirSync(STATE_DIR, { recursive: true })
mkdirSync(RESULTS_DIR, { recursive: true })

/** Load .env.test into process.env (it always wins over anything bun auto-loaded) and refuse anything but the test database. */
export function loadTestEnv(): void {
  const raw = readFileSync(`${REPO}/.env.test`, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
  for (const k of ['DATABASE_URL', 'DATABASE_URL_ENGINE', 'DATABASE_URL_APP', 'DATABASE_URL_WORKER']) {
    const u = process.env[k]
    if (u && !new RegExp(`/${TEST_DB}(\\?|$)`).test(u)) throw new Error(`${k} does not point at ${TEST_DB} — refusing`)
  }
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error'
}

export type Sql = ReturnType<typeof postgres>
export function ownerSql(max = 4): Sql {
  loadTestEnv()
  return postgres(process.env.DATABASE_URL!, { max, prepare: false, onnotice: () => {}, connection: { search_path: 'os' } })
}

/** Must be called before every write batch. */
export async function assertTestDb(sql: Sql): Promise<void> {
  const [r] = await sql`select current_database() as db`
  if (r.db !== TEST_DB) throw new Error(`connected to ${r.db}, not ${TEST_DB} — refusing to write`)
}

export function stats(xs: number[]) {
  const s = [...xs].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return { n: 0, p50: NaN, p95: NaN, max: NaN, mean: NaN }
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]
  return { n: s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length }
}

export function fmt(x: number | undefined | null) {
  if (x == null || !Number.isFinite(x)) return '—'
  return x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)
}
export const pct = (h: number, n: number) => (n ? `${((100 * h) / n).toFixed(1)}%` : '—')

// Tokens: cl100k_base (GPT-4 / text-embedding-3 family, the count competitor papers use) and o200k_base (GPT-4o/5).
const enc100 = getEncoding('cl100k_base')
const enc200 = getEncoding('o200k_base')
export const tokens = (text: string) => (text ? enc100.encode(text).length : 0)
export const tokens200 = (text: string) => (text ? enc200.encode(text).length : 0)

export function loadJson<T = any>(path: string): T | null {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}
export function saveJson(path: string, v: unknown) {
  writeFileSync(path, JSON.stringify(v, null, 2))
}

// Deterministic RNG (mulberry32)
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const norm = (s: string) => s.toLocaleLowerCase('tr').normalize('NFC')
export const has = (text: string, ans: string) => !!ans && norm(text).includes(norm(ans))

/** Optional columns that other lanes may add (e.g. organization_id on the link table). */
export async function columnExists(sql: Sql, table: string, col: string): Promise<boolean> {
  const r = await sql`select 1 from information_schema.columns where table_schema='os' and table_name=${table} and column_name=${col}`
  return r.length > 0
}

/** git state of the Brain code the run measured — recorded in every result file. */
export function codeFingerprint(): { head: string; dirty: string[]; code: string } {
  const run = (args: string[]) => Bun.spawnSync(['git', '-C', REPO, ...args]).stdout.toString().trim()
  const head = run(['rev-parse', '--short', 'HEAD'])
  const dirty = run(['status', '--porcelain', '--', 'apps/brain-agent/src/brain', 'packages/os-kernel/sql', 'packages/db/brain-graph-format.ts', 'apps/studio/lib/brain'])
    .split('\n').filter(Boolean)
  if (CODE !== REPO) return { head: readFileSync(`${CODE}/HEAD_SHA`, 'utf8').trim(), dirty: [], code: 'pristine HEAD export' }
  return { head, dirty, code: 'working tree' }
}
