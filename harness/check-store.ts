// R42-fix check: storeMappedRecord without the Date shim — module tag, idempotent retry, concurrent copies, asOf recall.
import { ownerSql, assertTestDb, REPO, loadTestEnv } from './lib/common.ts'
import { createTenant, dropTenant } from './lib/fixture.ts'
loadTestEnv()
const sql = ownerSql(); await assertTestDb(sql)
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { storeMappedRecord, emptyStats } = await import(`${REPO}/apps/brain-agent/src/brain/connector-ingest.ts`)
const { recallMemories } = await import(`${REPO}/apps/brain-agent/src/brain/recall.ts`)
const t = await createTenant(sql, 'storecheck')
const ORG = t.orgId
const ok: string[] = [], bad: string[] = []
const check = (name: string, cond: boolean, extra = '') => (cond ? ok : bad).push(`${name}${extra ? ' ' + extra : ''}`)
try {
  const inv = (amount: string) => ({ recordRef: 'invoice:FTR-1', primaryKey: 'i', occurredAt: '2026-09-03T10:00:00Z',
    memory: { content: `Fatura FTR-1 tutar ${amount}`, kind: 'fact', importance: 0.6 },
    nodes: [{ key: 'i', type: 'invoice', name: 'FTR-1', externalRef: 'invoice:FTR-1' }, { key: 'c', type: 'company', name: 'Acme', externalRef: 'company:1' }],
    edges: [{ fromKey: 'i', toKey: 'c', relation: 'billed_to' }], raw: { amount } })
  const st = emptyStats()
  const scope = { scope: 'org', teamId: null, ownerUserId: null, cloudWorkspaceId: t.workspaceId }
  let err = ''
  try { await runInOrganization(ORG, () => storeMappedRecord(ORG, 'finance', inv('100 TL'), st, scope)) } catch (e: any) { err = String(e?.message ?? e).slice(0, 120) }
  check('store without Date shim', !err, err)
  await runInOrganization(ORG, () => storeMappedRecord(ORG, 'finance', inv('100 TL'), st, scope))
  const m1 = await sql`select module_code, audience, cloud_workspace_id, is_latest from os.brain_memories where organization_id = ${ORG} and source_ref = 'finance:invoice:FTR-1'`
  check('retry skipped (1 memory)', m1.length === 1 && st.skipped === 1, JSON.stringify({ n: m1.length, st }))
  check('module_code finance', m1[0]?.module_code === 'finance' && m1[0]?.audience === 'module', JSON.stringify(m1[0]))
  check('workspace stamped', m1[0]?.cloud_workspace_id === t.workspaceId)
  // three concurrent copies of a changed record → one new version
  const st2 = emptyStats()
  await Promise.all([1, 2, 3].map(() => runInOrganization(ORG, () => storeMappedRecord(ORG, 'finance', inv('250 TL'), st2, scope))))
  const m2 = await sql`select is_latest, valid_to from os.brain_memories where organization_id = ${ORG} and source_ref = 'finance:invoice:FTR-1' order by created_at`
  const v2 = await sql`select version_no, valid_to from os.brain_record_versions where organization_id = ${ORG} and record_ref = 'invoice:FTR-1' order by version_no`
  check('concurrent copies → 1 write', m2.length === 2 && m2.filter((r: any) => r.is_latest).length === 1 && st2.written === 1 && st2.skipped === 2, JSON.stringify({ n: m2.length, st2 }))
  check('old version closed', !!m2[0]?.valid_to && v2.length === 2 && !!v2[0]?.valid_to, JSON.stringify(v2))
  // other slugs
  const order = { recordRef: 'order:SP-1', primaryKey: 'o', memory: { content: 'Sipariş SP-1', kind: 'fact', importance: 0.5 }, nodes: [{ key: 'o', type: 'order', name: 'SP-1' }], edges: [] }
  const fileInv = { recordRef: 'invoices:9', primaryKey: 'o', memory: { content: 'Imported invoice 9', kind: 'fact', importance: 0.5 }, nodes: [{ key: 'o', type: 'invoice', name: 'INV-9' }], edges: [] }
  const card = { recordRef: 'note:1', primaryKey: 'o', memory: { content: 'Free note', kind: 'fact', importance: 0.5 }, nodes: [{ key: 'o', type: 'topic', name: 'Note 1' }], edges: [] }
  await runInOrganization(ORG, () => storeMappedRecord(ORG, 'shop', order as any, emptyStats(), scope))
  await runInOrganization(ORG, () => storeMappedRecord(ORG, 'file', fileInv as any, emptyStats(), scope))
  await runInOrganization(ORG, () => storeMappedRecord(ORG, 'gmail', card as any, emptyStats(), scope, { moduleCode: 'crm' }))
  const tags = Object.fromEntries((await sql`select source_ref, module_code from os.brain_memories where organization_id = ${ORG} and source_ref <> 'finance:invoice:FTR-1'`).map((r: any) => [r.source_ref, r.module_code]))
  check('shop:order → retail, file:invoices → invoices, metadata moduleCode → crm', tags['shop:order:SP-1'] === 'retail' && tags['file:invoices:9'] === 'invoices' && tags['gmail:note:1'] === 'crm', JSON.stringify(tags))
  // asOf recall (Date parameter) as the owner, and the sales member cannot see the invoice
  let asOfErr = ''
  const asOf = await runInOrganization(ORG, () => recallMemories({ orgId: ORG, query: 'Fatura FTR-1 tutar', asOf: '2026-09-10T00:00:00Z', scope: { ownerUserId: t.users.owner } }), { userId: t.users.owner }).catch((e: any) => { asOfErr = String(e?.message ?? e); return [] })
  console.log("ASOF-DEBUG", JSON.stringify(await sql`select content, valid_from, valid_to, is_latest, module_code, embedding_e5 is not null as e5, lang from os.brain_memories where organization_id = ${ORG} and source_ref = 'finance:invoice:FTR-1'`), JSON.stringify(await runInOrganization(ORG, () => recallMemories({ orgId: ORG, query: "Fatura FTR-1 tutar", scope: { ownerUserId: t.users.owner } }), { userId: t.users.owner })))
  check('asOf recall runs, sees the version valid then', !asOfErr && (asOf as any[]).length > 0, asOfErr || JSON.stringify((asOf as any[]).map((r) => r.content)))
  const sales = await runInOrganization(ORG, () => recallMemories({ orgId: ORG, query: 'Fatura FTR-1 tutar', scope: { ownerUserId: t.users.sales } }), { userId: t.users.sales })
  check('sales member: no invoice', !(sales as any[]).some((r) => /FTR-1/.test(r.content)), JSON.stringify((sales as any[]).map((r) => r.content)))
} finally {
  const r = await dropTenant(sql, ORG)
  console.log('cleanup left', Object.entries(r).filter(([k, v]) => k.startsWith('left_') && v))
  console.log('PASS', ok); console.log('FAIL', bad)
  await sql.end(); process.exit(bad.length ? 1 : 0)
}
