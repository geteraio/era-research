// R51 lane B — record mentions, community labels, consolidation surprises: a real bench tenant, 0 LLM.
// Usage: bun run r51b-check.ts
import { ownerSql, assertTestDb, REPO } from './lib/common.ts'
import { createTenant, dropTenant } from './lib/fixture.ts'
import './lib/dbshim.ts'

const raw = ownerSql(4)
await assertTestDb(raw)
const { prepareExtractedMemory, commitExtractedMemory } = await import(`${REPO}/apps/brain-agent/src/brain/ingestion.ts`)
const { surprisingConnections } = await import(`${REPO}/apps/brain-agent/src/brain/analyze.ts`)
const { resolveOrgViewer, viewerEntitySql } = await import(`${REPO}/packages/db/brain-viewer.ts`)
const { db } = await import(`${REPO}/packages/db/index.ts`)
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { sql } = await import('drizzle-orm')

const t = await createTenant(raw, 'r51b')
const out: Array<[string, boolean, unknown?]> = []
const check = (name: string, ok: boolean, info?: unknown) => { out.push([name, ok, info]); console.log(ok ? 'PASS' : 'FAIL', name, info ?? '') }
try {
  await assertTestDb(raw)
  const org = t.orgId, ws = t.workspaceId
  // Records as the connector writes them: entity + a module-tagged memory naming it.
  const mkRecord = async (name: string, type: string, module: string) => {
    const [e] = await raw`insert into os.brain_entities (organization_id, name, type, cloud_workspace_id) values (${org}, ${name}, ${type}, ${ws}) returning id`
    const [m] = await raw`insert into os.brain_memories (organization_id, content, kind, source_type, source_ref, module_code, audience, cloud_workspace_id)
      values (${org}, ${`${type} ${name} record`}, 'fact', 'connector', ${`shop:${type}:${name}`}, ${module}, 'module', ${ws}) returning id`
    await raw`insert into os.brain_memory_entities (memory_id, entity_id) values (${m.id}, ${e.id})`
    return e.id as string
  }
  const order = await mkRecord('ORD-1024', 'order', 'retail')
  const invoice = await mkRecord('F-3', 'invoice', 'invoices')
  await mkRecord('Order 3', 'order', 'retail') // a decoy for "F-3" by number only
  const era = (uid: string | null) => undefined as any
  void era

  const write = async (content: string, ownerUserId: string | null, entities: Array<{ name: string; type: string }>) => {
    const memory = { content, kind: 'fact', entities, importance: 0.6, decayHint: 'permanent', lang: 'tr', audience: 'workspace', module: null }
    const prep = await runInOrganization(org, () => prepareExtractedMemory(org, memory, { sourceType: 'chat', sourceRef: 'conv:user', scope: 'org', ownerUserId }))
    const id = await runInOrganization(org, () => commitExtractedMemory(org, prep, null))
    const [m] = await raw`select module_code, audience from os.brain_memories where id = ${id}`
    const links = (await raw`select e.id, e.name, e.type from os.brain_memory_entities me join os.brain_entities e on e.id = me.entity_id where me.memory_id = ${id}`) as any[]
    return { id, prep, m, links }
  }

  // 1. sales reads retail: "sipariş 1024" → ORD-1024, fact becomes retail data, Ahmet —about→ order.
  const a = await write('Ahmet sipariş 1024 geç geldiği için şikayet etti', t.users.sales, [{ name: 'Ahmet', type: 'person' }, { name: 'Sipariş 1024', type: 'topic' }])
  check('sales: sipariş 1024 links ORD-1024', a.links.some((l) => l.id === order), a.links.map((l) => `${l.type}:${l.name}`))
  check('sales: no topic entity made for the number', !a.links.some((l) => l.type === 'topic'))
  check('sales: fact takes the record module', a.m.module_code === 'retail' && a.m.audience === 'module', a.m)
  const [ahmet] = (await raw`select id from os.brain_entities where organization_id = ${org} and name = 'Ahmet'`) as any[]
  const edges = (await raw`select relation, source_ref, cloud_workspace_id from os.brain_entity_edges where from_entity_id = ${ahmet.id} and to_entity_id = ${order}`) as any[]
  check('about edge Ahmet → order behind retail', edges.length === 1 && edges[0].relation === 'about' && edges[0].source_ref === 'retail:mention', edges)

  // 2. sales may not read invoices: F-3 stays unlinked (and the "Order 3" decoy is never taken).
  const b = await write('Ahmet F-3 faturasını sordu', t.users.sales, [{ name: 'Ahmet', type: 'person' }])
  check('sales: F-3 (invoices, not readable) not linked', !b.links.some((l) => l.id === invoice) && !b.links.some((l) => l.type === 'order'), b.links.map((l) => l.name))
  check('sales: unlinked fact keeps no module', b.m.module_code == null, b.m)

  // 3. finance reads invoices: F-3 → the invoice.
  const c = await write('Mehmet F-3 faturasını ödeyeceğini söyledi', t.users.finance, [{ name: 'Mehmet', type: 'person' }])
  check('finance: F-3 links the invoice', c.links.some((l) => l.id === invoice), c.links.map((l) => l.name))
  check('finance: fact takes invoices module', c.m.module_code === 'invoices', c.m)

  // 4. no person: org-shared reader → nothing module-gated links.
  const d = await write('Bir müşteri #1024 için aradı ve iade istedi', null, [])
  check('no writer: #1024 not linked', !d.links.some((l) => l.id === order), d.links.map((l) => l.name))

  // 5. Community labels: records never; Ahmet yes (fact 2 stayed org-shared).
  const v = await resolveOrgViewer({ workspaceId: null })
  const ids = [order, invoice, ahmet.id]
  const lab = (await runInOrganization(org, () => db.execute(sql`SELECT e.id FROM brain_entities e WHERE e.organization_id = ${org} AND e.id = ANY(${`{${ids.join(',')}}`}::uuid[])${viewerEntitySql('e.id', v)}`))) as any[]
  check('labels: records are not labelable, Ahmet (an org-shared fact names him) is', lab.length === 1 && lab[0].id === ahmet.id, lab.map((r) => r.id))

  // 6. Consolidation surprises (org partition): the module-gated about edge never surfaces.
  const s = await runInOrganization(org, () => surprisingConnections(org, 10, { scope: 'org', teamId: null, ownerUserId: null }))
  check('surprises: no edge into a module record', !s.some((x: any) => /ORD-1024|F-3/.test(`${x.fromName} ${x.toName}`)), s)
} catch (e) {
  check('run', false, (e as Error).stack)
} finally {
  const left = await dropTenant(raw, t.orgId)
  const leftover = Object.entries(left).filter(([k, n]) => k.startsWith('left_') && Number(n) > 0)
  console.log('cleanup leftover:', leftover.length ? leftover : 'none')
  await raw.end()
  console.log(`${out.filter((x) => x[1]).length}/${out.length} pass`)
  process.exit(0)
}
