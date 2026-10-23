// R44 lane B check: the remaining permission gaps.
//   1  callers with no person — brain-agent research (researchMemories), org/workspace workflow brain
//      block (resolveWorkflowBrainScope → recallBrain, memories + graph), headless internal brain list
//   2  /api/internal/brain list_memories (brainListMemories) applies the module filter
//   3  records from connectors that are not modules (stripe:charge, paypal:transaction …) get a module (sql/901)
//   4  the same paths over the TR business set (state/<dataset>.json, read-only): leak = a secret the reader may not see
// Usage: bun run check-gaps.ts [dataset=trbizA] [--limit=N]
import { ownerSql, assertTestDb, REPO, CODE, loadJson, STATE_DIR, RESULTS_DIR, has, stats, saveJson, fmt } from './lib/common.ts'
import { createTenant, dropTenant } from './lib/fixture.ts'

const sql = ownerSql(); await assertTestDb(sql)
// studio embeds through brain-agent's /brain/embed: no servers in a check, so that one call is answered
// in-process by the same local model (e5-small q8) — installed before any studio module is loaded.
const { embedLocal } = await import(`${CODE}/apps/brain-agent/src/brain/local-embeddings.ts`)
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url
  if (url && /\/brain\/embed$/.test(url)) {
    const body = JSON.parse(init?.body ?? '{}')
    return new Response(JSON.stringify({ vectors: await embedLocal(body.texts, body.kind ?? 'passage'), column: 'embedding_e5' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { storeMappedRecord, emptyStats } = await import(`${CODE}/apps/brain-agent/src/brain/connector-ingest.ts`)
const { recallMemories } = await import(`${CODE}/apps/brain-agent/src/brain/recall.ts`)
const { researchMemories } = await import(`${CODE}/apps/brain-agent/src/research/run.ts`)
const { resolveWorkflowBrainScope, resolveSelectedBrainScope } = await import(`${CODE}/apps/studio/lib/brain/workflow-scope.ts`)
const { recallBrain } = await import(`${CODE}/apps/studio/lib/brain/brain-context.ts`)
const { brainListMemories, brainRecall } = await import(`${CODE}/apps/studio/lib/mcp/brain-tools.ts`)
const { brainVisibilityForScope } = await import(`${CODE}/apps/studio/lib/scope/context.ts`)
// R45: the remaining no-person callers — builder copilot (buildBrainContext), graph-context, meetings brief
process.env.BRAIN_GRAPH_RECALL = '1' // buildBrainContext's auto mode walks the graph too
const { buildBrainContext } = await import(`${CODE}/apps/studio/lib/brain/brain-context.ts`)
const { buildGraphContext } = await import(`${CODE}/apps/studio/lib/brain/graph-context.ts`)
const { hybridRecall } = await import(`${CODE}/apps/studio/lib/brain/recall.ts`)
const { resolveBrainReader } = await import(`${REPO}/packages/db/brain-viewer.ts`)
const { sql: dsql } = await import(`${REPO}/packages/db/node_modules/drizzle-orm/index.js`)

const ok: string[] = [], bad: string[] = []
const check = (name: string, cond: boolean, extra = '') => { (cond ? ok : bad).push(`${name}${extra && !cond ? ' ' + extra : ''}`) }
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}`))?.split('=')[1]
const dataset = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'trbizA'

// ── the paths under test (each returns the text a model would read) ──
type Who = { orgId: string; workspaceId: string; userId: string | null; authUserId?: string | null }
const memText = (rows: any[]) => rows.map((r) => `- ${r.content}`).join('\n')
const inOrg = <T,>(w: Who, fn: () => Promise<T>) => runInOrganization(w.orgId, fn, w.userId ? { userId: w.userId } : undefined) as Promise<T>
let wfId = ''
const paths: Record<string, (q: string, w: Who) => Promise<string>> = {
  /** brain-agent /research recall (R44: the asking person, else org-shared). */
  research: async (q, w) => memText(await inOrg(w, () => researchMemories({ orgId: w.orgId, query: q, userId: w.userId, workspaceId: w.workspaceId, limit: 10 }))),
  /** what /research recalled before R44 (no viewer at all). */
  researchBefore: async (q, w) => memText(await inOrg(w, () => recallMemories({ orgId: w.orgId, query: q, limit: 10 }))),
  /** the Brain block of an org-scoped workflow in the bench workspace (resolveWorkflowBrainScope → recallBrain, auto = memories + graph). */
  workflowBlock: async (q, w) => {
    const s = await inOrg(w, () => resolveWorkflowBrainScope({ workflowId: wfId }))
    if (s.orgId !== w.orgId) throw new Error(`workflow scope resolved org ${s.orgId}`)
    const r: any = await inOrg(w, () => recallBrain({ orgId: w.orgId, query: q, scopeFilter: s.scopeFilter, graphScope: s.graphScope, mode: 'graph', limit: 10 }))
    return [r.text, memText(r.memories)].join('\n')
  },
  /** the same block with the brain-scope selector on "org" (guardrails / retrieval blocks). */
  workflowBlockOrgSel: async (q, w) => {
    const s = await inOrg(w, () => resolveSelectedBrainScope({ workflowId: wfId, brainScope: 'org' }))
    const r: any = await inOrg(w, () => recallBrain({ orgId: w.orgId, query: q, scopeFilter: s.scopeFilter, graphScope: s.graphScope, mode: 'graph', limit: 10 }))
    return [r.text, memText(r.memories)].join('\n')
  },
  /** the block before R44: org scope filter + { orgOnly } graph scope, no reader. */
  workflowBlockBefore: async (q, w) => {
    const r: any = await inOrg(w, () => recallBrain({ orgId: w.orgId, query: q, scopeFilter: brainVisibilityForScope({ scope: 'org', cloudWorkspaceId: w.workspaceId, ownerUserId: null }), graphScope: { orgOnly: true }, mode: 'graph', limit: 10 }))
    return [r.text, memText(r.memories)].join('\n')
  },
  /** R45 builder copilot: buildBrainContext as lib/copilot/brain-recall.ts calls it (the person), or with no person. */
  copilotContext: async (q, w) => inOrg(w, () => buildBrainContext(w.userId
    ? { orgId: w.orgId, query: q, graphScope: { ownerUserId: w.userId }, person: { appUserId: w.userId, workspaceId: w.workspaceId }, workspaceId: w.workspaceId }
    : { orgId: w.orgId, query: q, workspaceId: w.workspaceId })),
  /** R45 lib/brain/graph-context.ts buildGraphContext (the person, or the org-shared reader). */
  graphContext: async (q, w) => inOrg(w, () => buildGraphContext(w.orgId, q, undefined, 2500, w.userId ? { appUserId: w.userId, workspaceId: w.workspaceId } : null, w.workspaceId)),
  /** R45 meetings brief recall (lib/meetings/server.ts writeBrief): the meeting owner's reader, else org-shared; scope = 'org'. */
  meetingsBrief: async (q, w) => {
    const reader = await inOrg(w, () => resolveBrainReader(w.orgId, w.userId ? { appUserId: w.userId, workspaceId: w.workspaceId } : null, { workspaceId: w.workspaceId }))
    const out: any = await inOrg(w, () => hybridRecall(w.orgId, q, 6, dsql`scope = 'org'`, null, reader))
    return memText(out.results)
  },
  /** /api/internal/brain list_memories (brainListMemories) with the question as its keyword filter. */
  manageList: async (q, w) => {
    const ctx: any = { userId: w.authUserId ?? '', appUserId: w.userId ?? '', orgId: w.orgId, cloudWorkspaceId: w.workspaceId, teamIds: [] }
    const words = q.split(/\s+/).filter((x) => x.length > 3).slice(0, 4)
    const out: string[] = []
    for (const word of words) {
      const r: any = await inOrg(w, () => brainListMemories(ctx, w.orgId, { q: word.replace(/[^\p{L}\p{N}]/gu, ''), limit: 50 }))
      out.push(memText(r.memories))
    }
    return out.join('\n')
  },
  /** /api/internal/brain recall (brainRecall). */
  manageRecall: async (q, w) => {
    const ctx: any = { userId: w.authUserId ?? '', appUserId: w.userId ?? '', orgId: w.orgId, cloudWorkspaceId: w.workspaceId, teamIds: [] }
    const r: any = await inOrg(w, () => brainRecall(ctx, w.orgId, q, 12))
    return memText(r.results)
  },
}

async function makeWorkflow(orgId: string, workspaceId: string, ownerAppUserId: string, label: string): Promise<string> {
  await assertTestDb(sql)
  // workflow.user_id references the auth user table; the bench people have no auth row, so the test DB's dev user stands in (the run reads the workflow's own scope columns only)
  const [u] = await sql`select id as auth_user_id from os."user" where email = 'owner@acme.test'`
  const [r] = await sql`insert into os.workflow (id, user_id, name, last_synced, created_at, updated_at, organization_id, scope, cloud_workspace_id)
    values (${crypto.randomUUID()}, ${u.auth_user_id}, ${'bb2 ' + label}, now(), now(), now(), ${orgId}, 'org', ${workspaceId}) returning id`
  return r.id
}

// ═══ Part 1 — a small tenant with each kind of secret ═══
const t = await createTenant(sql, 'gaps')
const ORG = t.orgId
const W = (k: 'owner' | 'sales' | 'finance' | 'none'): Who => ({ orgId: ORG, workspaceId: t.workspaceId, userId: k === 'none' ? null : t.users[k] })
try {
  const wsScope = { scope: 'org', teamId: null, ownerUserId: null, cloudWorkspaceId: t.workspaceId }
  const rec = (slug: string, ref: string, content: string, type: string, name: string) => ({
    recordRef: ref, primaryKey: 'r', occurredAt: '2026-09-03T10:00:00Z', memory: { content, kind: 'fact', importance: 0.6 },
    nodes: [{ key: 'r', type, name, externalRef: ref }, { key: 'c', type: 'company', name: 'Kestane Lojistik' }],
    edges: [{ fromKey: 'r', toKey: 'c', relation: 'paid_by' }], raw: {} })
  const store = (slug: string, r: any, scope: any = wsScope, meta?: any) => runInOrganization(ORG, () => storeMappedRecord(ORG, slug, r, emptyStats(), scope, meta))
  await store('stripe', rec('stripe', 'charge:ch_9KX', 'Kestane Lojistik Stripe tahsilatı ch_9KX tutarı 48.913,27 TL', 'charge', 'ch_9KX'))
  await store('paypal', rec('paypal', 'transaction:PP-77', 'Kestane Lojistik PayPal işlemi PP-77 tutarı 7.402,15 USD', 'transaction', 'PP-77'))
  await store('iyzico', rec('iyzico', 'payout:IY-5', 'Kestane Lojistik iyzico ödemesi IY-5 net 12.118,40 TL', 'payout', 'IY-5'))
  await store('gusto-payroll', rec('gusto-payroll', 'record:G-1', 'Kestane Lojistik sevkiyat sorumlusu maaşı 61.250,00 TL', 'record', 'G-1'))
  await store('gmail', rec('gmail', 'note:HR-1', 'Kestane Lojistik muhasebe şefi primi 9.990,00 TL', 'note', 'HR-1'), wsScope, { moduleCode: 'employees' })
  await store('notes', rec('notes', 'note:P-1', 'Kestane Lojistik için kişisel not: patron bonusu 3.333,33 TL', 'note', 'P-1'), { scope: 'personal', teamId: null, ownerUserId: t.users.owner, cloudWorkspaceId: t.workspaceId })
  await store('notes', rec('notes', 'note:S-1', 'Kestane Lojistik teslim adresi Tuzla Liman Caddesi 14', 'note', 'S-1'))
  const SECRETS: Array<[string, string, string[]]> = [
    ['48.913,27', 'stripe:charge', ['owner', 'finance']], ['7.402,15', 'paypal:transaction', ['owner', 'finance']],
    ['12.118,40', 'iyzico:payout', ['owner', 'finance']], ['61.250,00', 'payroll slug', ['owner']],
    ['9.990,00', 'employees-tagged', ['owner']], ['3.333,33', 'personal', ['owner']],
  ]
  const SHARED = 'Tuzla Liman'

  // (3) tags written by storeMappedRecord through sql/901
  const tags = Object.fromEntries((await sql`select source_ref, module_code, audience from os.brain_memories where organization_id = ${ORG}`).map((r: any) => [r.source_ref, `${r.module_code}/${r.audience}`]))
  check('3 stripe:charge → finance', tags['stripe:charge:ch_9KX'] === 'finance/module', tags['stripe:charge:ch_9KX'])
  check('3 paypal:transaction → finance', tags['paypal:transaction:PP-77'] === 'finance/module', tags['paypal:transaction:PP-77'])
  check('3 iyzico:payout → finance', tags['iyzico:payout:IY-5'] === 'finance/module', tags['iyzico:payout:IY-5'])
  check('3 gusto-payroll:record (slug words) → employees', tags['gusto-payroll:record:G-1'] === 'employees/module', tags['gusto-payroll:record:G-1'])
  check('3 notes:note stays unplaced', tags['notes:note:S-1'] === 'null/workspace', tags['notes:note:S-1'])
  // (3) backfill: a pre-901 row (no module) is placed by the migration's statement
  await sql`update os.brain_memories set module_code = null, audience = 'workspace' where organization_id = ${ORG} and source_ref = 'stripe:charge:ch_9KX'`
  const mig = (await Bun.file(`${REPO}/packages/os-kernel/sql/901_brain_record_type_rule.sql`).text())
  const backfill = mig.slice(mig.indexOf('WITH tagged AS'), mig.lastIndexOf('COMMIT;')).replace("AND m.source_type = 'connector'", `AND m.source_type = 'connector' AND m.organization_id = '${ORG}'`)
  await sql.unsafe(backfill)
  const [bf] = await sql`select module_code from os.brain_memories where organization_id = ${ORG} and source_ref = 'stripe:charge:ch_9KX'`
  check('3 backfill places an old stripe:charge row', bf?.module_code === 'finance', JSON.stringify(bf))
  const [{ n: unplaced }] = await sql`select count(*)::int n from os.brain_memories m where m.source_type = 'connector' and m.module_code is null and m.audience = 'workspace'
                                        and cardinality(os.brain_source_modules(m.source_type, m.source_ref, '{}'::jsonb)) > 0`
  check('3 no connector row left that the rule would place (whole the test database)', unplaced === 0, String(unplaced))

  wfId = await makeWorkflow(ORG, t.workspaceId, t.users.owner, 'gaps')
  const Q = ['Kestane Lojistik ödemeleri ve tutarları', 'Kestane Lojistik maaş prim bonus', 'Kestane Lojistik']
  for (const [name, fn] of Object.entries(paths)) {
    for (const who of ['none', 'sales', 'finance', 'owner'] as const) {
      if (name.startsWith('workflow') && who !== 'none') continue
      let text = ''
      let err = ''
      for (const q of Q) { try { text += '\n' + (await fn(q, W(who))) } catch (e: any) { err = String(e?.message ?? e).slice(0, 160) } }
      const leaks = SECRETS.filter(([s, , vis]) => !(who !== 'none' && vis.includes(who)) && text.includes(s)).map(([, c]) => c)
      const seen = SECRETS.filter(([s]) => text.includes(s)).map(([, c]) => c)
      const label = `${name} as ${who}`
      if (name.endsWith('Before')) { console.log(`  (before) ${label}: leaks ${leaks.length ? leaks.join(', ') : 'none'}`); continue }
      check(`1/2 ${label}: no error`, !err, err)
      check(`1/2 ${label}: 0 leaks`, leaks.length === 0, leaks.join(', '))
      if (name !== 'manageList' || who !== 'none') check(`1/2 ${label}: shared fact still read`, text.includes(SHARED))
      if (who === 'owner' && !name.startsWith('workflow') && name !== 'meetingsBrief') check(`1/2 ${label}: owner still sees finance + own personal`, seen.includes('stripe:charge') && seen.includes('personal'), seen.join(','))
      if (who === 'finance' && !name.startsWith('workflow')) check(`1/2 ${label}: finance member sees stripe, not payroll`, seen.includes('stripe:charge') && !seen.includes('payroll slug'), seen.join(','))
    }
  }
} finally {
  await sql`delete from os.workflow where organization_id = ${ORG}`
  const r = await dropTenant(sql, ORG)
  const left = Object.entries(r).filter(([k, v]) => k.startsWith('left_') && v)
  check('cleanup: gaps tenant gone', left.length === 0, JSON.stringify(left))
}

// ═══ Part 2 — the same paths over the TR business set (read-only, existing tenant) ═══
const st = loadJson<any>(`${STATE_DIR}/${dataset}.json`)
const summary: any[] = []
if (!st) console.log(`no state/${dataset}.json — part 2 skipped`)
else {
  const T = st.tenant
  const [{ n: exists }] = await sql`select count(*)::int n from os.organization where id = ${T.orgId}`
  if (!exists) console.log(`${dataset} tenant not in the DB — part 2 skipped`)
  else {
    wfId = await makeWorkflow(T.orgId, T.workspaceId, T.users.owner, 'gaps-sweep')
    try {
      const secrets: Array<{ secret: string; cls: string; visibleTo: string[] }> = st.secrets
      const questions: any[] = st.questions.slice(0, Number(flag('limit') ?? 1e9))
      const runs: Array<[string, 'none' | 'sales' | 'finance']> = [
        ['research', 'none'], ['research', 'sales'], ['research', 'finance'], ['researchBefore', 'none'],
        ['workflowBlock', 'none'], ['workflowBlockOrgSel', 'none'], ['workflowBlockBefore', 'none'],
        ['manageRecall', 'none'], ['manageRecall', 'sales'], ['manageList', 'none'], ['manageList', 'sales'],
        ['copilotContext', 'none'], ['copilotContext', 'sales'], ['graphContext', 'none'], ['graphContext', 'sales'], ['meetingsBrief', 'none'], ['meetingsBrief', 'sales'],
      ]
      for (const [name, who] of runs) {
        const w: Who = { orgId: T.orgId, workspaceId: T.workspaceId, userId: who === 'none' ? null : T.users[who] }
        let leakQ = 0, errs = 0, hits = 0
        const byCls: Record<string, number> = {}
        const ms: number[] = []
        for (const q of questions) {
          const t0 = performance.now()
          let text = ''
          try { text = await paths[name](q.q, w) } catch (e: any) { errs++; if (errs === 1) console.warn(name, who, String(e?.message ?? e).slice(0, 160)) }
          ms.push(performance.now() - t0)
          const leaks = secrets.filter((s) => !(who !== 'none' && s.visibleTo.includes(who)) && has(text, s.secret))
          if (leaks.length) leakQ++
          for (const c of new Set(leaks.map((l) => l.cls))) byCls[c] = (byCls[c] ?? 0) + 1
          if (has(text, q.answer)) hits++
        }
        const row = { path: name, reader: who, n: questions.length, leakQueries: leakQ, leakByClass: byCls, errors: errs, answerInContext: hits, ms: stats(ms) }
        summary.push(row)
        console.log(`${name.padEnd(20)} ${who.padEnd(8)} n=${row.n} leak=${leakQ} ${JSON.stringify(byCls)} err=${errs} ans=${hits} ms p50=${fmt(row.ms.p50)}`)
        if (!name.endsWith('Before')) check(`4 ${dataset} ${name} as ${who}: 0 leaks / 0 errors over ${row.n} q`, leakQ === 0 && errs === 0, `${leakQ} leaks ${JSON.stringify(byCls)} ${errs} errors`)
      }
    } finally {
      await assertTestDb(sql)
      await sql`delete from os.workflow where id = ${wfId}`
    }
  }
}
saveJson(`${RESULTS_DIR}/check-gaps-${dataset}.json`, { at: new Date().toISOString(), ok, bad, summary })
console.log('PASS', ok.length); for (const b of ok) console.log('  ✓', b)
console.log('FAIL', bad.length); for (const b of bad) console.log('  ✗', b)
await sql.end()
process.exit(bad.length ? 1 : 0)
