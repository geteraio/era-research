// R51 lane A check — the new read paths keep the viewer rules, and the stored source passages (provenance.excerpt) never
// carry a sibling fact past them:
//   1  recallContext (brain-agent) and memoryForTurn (studio per-turn) as sales / finance / owner: a finance-module fact and a
//      private fact of the same chat source must not reach sales — neither as a fact nor inside the other fact's passage
//   2  erasing a fact strips the passages of its source (os-kernel eraseFromBrain)
//   3  the "Era's answers" switch: off by default, on when the brain's learn_from.era_replies is true
// Usage: bun run r51a-check.ts      (the test database only; the tenant is dropped at the end)
import { ownerSql, assertTestDb, REPO } from './lib/common.ts'
import { createTenant, dropTenant, grantModuleToAll } from './lib/fixture.ts'
import { methods, embedLocal } from './lib/a-methods-full.ts'
import { arm } from './lib/r46-router.ts'
arm()
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { recallContext } = await import(`${REPO}/apps/brain-agent/src/brain/recall.ts`)
const { learnsEraReplies } = await import(`${REPO}/apps/brain-agent/src/brain/ingestion.ts`)
const { eraseFromBrain, seedDefaultBrain } = await import(`${REPO}/packages/os-kernel/src/ai/brain-actions.ts`)

const sql = ownerSql(2)
await assertTestDb(sql)
const ok: string[] = [], bad: string[] = []
const check = (name: string, cond: boolean, extra = '') => (cond ? ok : bad).push(`${name}${!cond && extra ? ' — ' + extra : ''}`)

const t = await createTenant(sql, 'r51a')
const ORG = t.orgId, WS = t.workspaceId
try {
  await grantModuleToAll(sql, WS, ORG, 'ai')
  const SRC = 'chat-r51a-1:user'
  const passage = 'Kemal Bey ile toplantı yaptık, bütçe onayı Mart ayında geliyor. Bu arada F-77 numaralı faturanın tutarı 48.250 TL, kimseye söyleme. Ayrıca maaşım 91.300 TL oldu.'
  const mk = async (content: string, extra: { module?: string | null; priv?: boolean }) => {
    const [e] = await embedLocal([content], 'passage')
    const [r] = await sql`insert into os.brain_memories (organization_id, content, kind, source_type, source_ref, scope, cloud_workspace_id, lang,
        module_code, audience, private, owner_user_id, provenance, embedding_e5)
      values (${ORG}, ${content}, 'fact', 'chat', ${SRC}, 'org', ${WS}, 'tr', ${extra.module ?? null}, ${extra.module ? 'module' : 'workspace'},
        ${!!extra.priv}, ${extra.priv ? t.users.owner : null}, ${JSON.stringify({ excerpt: passage })}::text::jsonb, ${`[${e.join(',')}]`}::os.vector)
      returning id`
    return r.id as string
  }
  const general = await mk('Kemal Bey ile görüşüldü; bütçe onayı Mart 2026 ayında bekleniyor.', {})
  const finance = await mk('F-77 numaralı faturanın tutarı 48.250 TL.', { module: 'finance' })
  const personal = await mk('Sahibin maaşı 91.300 TL oldu.', { priv: true })
  const q = 'Kemal Bey bütçe onayı ne zaman?'
  const who = (k: 'owner' | 'sales' | 'finance') => ({ orgId: ORG, workspaceId: WS, userId: t.users[k] })
  for (const k of ['sales', 'finance', 'owner'] as const) {
    const w = who(k)
    const rc: any = await runInOrganization(ORG, () => recallContext({ orgId: ORG, query: q, scope: { ownerUserId: w.userId, workspaceId: WS } }), { userId: w.userId })
    if (process.env.DBG) { const bp: any = await import(`${REPO}/packages/db/brain-paths.ts`); const { resolveBrainViewer } = await import(`${REPO}/packages/db/brain-viewer.ts`); const v = await runInOrganization(ORG, () => resolveBrainViewer(ORG, { appUserId: w.userId, workspaceId: WS }), { userId: w.userId }); console.log(k, 'ids', rc?.factMemoryIds, 'ex', [...(await runInOrganization(ORG, () => bp.sourceExcerpts(ORG, rc?.factMemoryIds ?? [], v), { userId: w.userId }) as any).keys()]) }
    const turn = await methods.eraTurn(q, w)
    for (const [path, text] of [['recallContext', rc?.text ?? ''], ['memoryForTurn', turn.text]] as const) {
      check(`${path} as ${k}: the general fact is there`, text.includes('Kemal Bey'), text.slice(0, 300))
      const seesFinance = text.includes('48.250'), seesSalary = text.includes('91.300')
      // the passage holds both secrets: it may appear only for someone who may read every fact of the source (the owner)
      if (k === 'sales') check(`${path} as sales: no finance figure, no private salary`, !seesFinance && !seesSalary, text)
      if (k === 'finance') check(`${path} as finance: no private salary (passage withheld)`, !seesSalary, text)
      if (k === 'owner') check(`${path} as owner: the passage is shown`, text.includes('said: "') && seesSalary, text.slice(0, 600))
    }
  }
  // 2 — erase the finance fact: the source's passages go with it
  await sql.begin(async (tx: any) => { await tx`select set_config('app.workspace_id', ${WS}, true)`; await eraseFromBrain(tx, [finance], []) })
  const left = await sql`select id, provenance ? 'excerpt' as has from os.brain_memories where organization_id = ${ORG} and source_ref = ${SRC}`
  check('erase: the erased fact is gone', !left.some((r: any) => r.id === finance))
  check('erase: no fact of that source keeps the passage', left.length === 2 && left.every((r: any) => !r.has), JSON.stringify(left))
  void general; void personal
  // 3 — "Era's answers" switch
  const prev = process.env.ERA_LEARN_ASSISTANT
  delete process.env.ERA_LEARN_ASSISTANT
  await sql.begin(async (tx: any) => { await tx`select set_config('app.workspace_id', ${WS}, true), set_config('app.organization_id', ${ORG}, true)`; await seedDefaultBrain(tx, { organizationId: ORG, workspaceId: WS }) })
  check("era_replies: off by default (company brain as created)", (await runInOrganization(ORG, () => learnsEraReplies(ORG))) === false)
  const upd = await sql.begin(async (tx: any) => { await tx`select set_config('app.workspace_id', ${WS}, true), set_config('app.organization_id', ${ORG}, true)`; await seedDefaultBrain(tx, { organizationId: ORG, workspaceId: WS }); return tx`update os.brain set learn_from = coalesce(learn_from, '{}'::jsonb) || '{"era_replies": true}'::jsonb where organization_id = ${ORG} and is_default returning id` })
  console.log('brains switched on:', upd.length)
  check("era_replies: on when the brain's switch is on", (await runInOrganization(ORG, () => learnsEraReplies(ORG))) === true)
  if (prev !== undefined) process.env.ERA_LEARN_ASSISTANT = prev
} finally {
  await dropTenant(sql, ORG).catch((e: any) => console.warn('drop failed', e?.message))
}
for (const s of ok) console.log('  ✓', s)
for (const s of bad) console.log('  ✗', s)
console.log(bad.length ? `FAIL ${bad.length}` : `PASS ${ok.length}/${ok.length}`)
await sql.end()
process.exit(bad.length ? 1 : 0)
