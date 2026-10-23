// A real tenant for the benchmarks: create_organization + three people with real role grants.
//   owner   — reads every module (sees finance + HR facts)
//   sales   — role 'agent': customers/crm/inbox/meetings/appointments read; NO finance/invoices/employees
//   finance — role 'manager': customers + finance + invoices read; NO employees
// All slugs/emails start with 'bb2-' so cleanup can only ever touch what this harness made.
import { assertTestDb, type Sql } from './common.ts'

export interface BenchTenant {
  orgId: string
  workspaceId: string
  users: { owner: string; sales: string; finance: string }
  slug: string
}

export const BASE_MODULES = ['customers', 'crm', 'inbox', 'meetings', 'appointments', 'retail'] // retail: orders (R42-fix: connector orders now carry module_code retail)
export const SENSITIVE_MODULES = ['finance', 'invoices', 'employees']

export async function createTenant(sql: Sql, label: string): Promise<BenchTenant> {
  await assertTestDb(sql)
  const tag = `${label}-${Date.now().toString(36)}`
  const slug = `bb2-${tag}`
  const mk = async (local: string) => {
    const [u] = await sql`insert into os.app_user (email, name, auth_user_id) values (${`${local}@${slug}.test`}, ${local}, ${`auth_${local}_${slug}`}) returning id`
    return u.id as string
  }
  const owner = await mk('owner')
  const [{ organization_id, workspace_id }] = await sql`select * from os.create_organization(${owner}::uuid, ${'Brain Bench ' + label}, ${slug}, ${'Main'}, ${'main'})`
  await sql`
    insert into os.setting (organization_id, workspace_id, module_code, key, value)
    values (${organization_id}, null, null, 'plan', ${JSON.stringify('enterprise')}::text::jsonb)
    on conflict (organization_id, coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(module_code, ''), key)
      do update set value = excluded.value, updated_at = now()`
  const roles = Object.fromEntries((await sql`select code, id from os.role where workspace_id = ${workspace_id}`).map((r: any) => [r.code, r.id]))
  const sales = await mk('sales'), finance = await mk('finance')
  for (const [uid, role] of [[sales, 'agent'], [finance, 'manager']] as const) {
    await sql`insert into os.membership (organization_id, user_id, org_role) values (${organization_id}, ${uid}, 'member')`
    await sql`insert into os.workspace_member (organization_id, workspace_id, user_id, role_id) values (${organization_id}, ${workspace_id}, ${uid}, ${roles[role]})`
  }
  for (const m of [...BASE_MODULES, ...SENSITIVE_MODULES]) {
    await sql`insert into os.workspace_module (organization_id, workspace_id, module_code, enabled) values (${organization_id}, ${workspace_id}, ${m}, true)
              on conflict (workspace_id, module_code) do update set enabled = true`
  }
  const grant = async (role: string, modules: string[]) => {
    for (const m of modules) {
      await sql`insert into os.role_module_capability (organization_id, workspace_id, role_id, module_code, capability, own_records_scope)
                values (${organization_id}, ${workspace_id}, ${roles[role]}, ${m}, 'read', 'self_only')
                on conflict (role_id, module_code, capability) do nothing`
    }
  }
  await grant('owner', [...BASE_MODULES, ...SENSITIVE_MODULES])
  await grant('agent', BASE_MODULES)
  await grant('manager', [...BASE_MODULES, 'finance', 'invoices'])
  // The agent role must hold nothing on the sensitive modules — fail loudly if a system default granted it.
  const leaked = await sql`select module_code from os.effective_access_for_member(${sales}::uuid, ${workspace_id}::uuid)
                           where capability = 'read' and module_code = any(${SENSITIVE_MODULES})`
  if (leaked.length) throw new Error(`sales member unexpectedly reads ${leaked.map((r: any) => r.module_code)}`)
  return { orgId: organization_id, workspaceId: workspace_id, users: { owner, sales, finance }, slug }
}

/** Delete every brain row of one bench org (+ the org and its people), then count what is left. */
export async function dropTenant(sql: Sql, orgId: string): Promise<Record<string, number>> {
  await assertTestDb(sql)
  const [o] = await sql`select slug from os.organization where id = ${orgId}`
  if (o && !String(o.slug).startsWith('bb2-')) throw new Error(`org ${orgId} is not a bb2 bench org — refusing`)
  const deleted: Record<string, number> = {}
  deleted.memory_edges = (await sql`delete from os.brain_memory_edges e using os.brain_memories m where m.organization_id = ${orgId} and (m.id = e.from_memory_id or m.id = e.to_memory_id)`).count
  deleted.memory_entities = (await sql`delete from os.brain_memory_entities me using os.brain_memories m where m.id = me.memory_id and m.organization_id = ${orgId}`).count
  const tables = (await sql`select table_name from information_schema.columns where table_schema = 'os' and column_name = 'organization_id' and table_name like 'brain\\_%'
                             and table_name in (select table_name from information_schema.tables where table_schema='os' and table_type='BASE TABLE')`).map((r: any) => r.table_name as string)
  const order = ['brain_entity_sources', 'brain_record_versions', 'brain_connector_sync', 'brain_memories', 'brain_entity_edges', 'brain_entities']
  const rest = tables.filter((t) => !order.includes(t))
  for (const t of [...rest, ...order.filter((t) => tables.includes(t))]) {
    try { deleted[t] = (await sql.unsafe(`delete from os.${t} where organization_id = $1`, [orgId])).count } catch (e: any) { deleted[t] = -1; console.warn('delete', t, e.message) }
  }
  if (o) {
    const slug = String(o.slug)
    await sql`delete from os.organization where id = ${orgId}`
    deleted.app_users = (await sql`delete from os.app_user where email like ${'%@' + slug + '.test'}`).count
  }
  const left: Record<string, number> = {}
  for (const t of tables) left[t] = Number((await sql.unsafe(`select count(*)::int n from os.${t} where organization_id = $1`, [orgId]))[0].n)
  left.organization = (await sql`select count(*)::int n from os.organization where id = ${orgId}`)[0].n
  return { ...Object.fromEntries(Object.entries(deleted).map(([k, v]) => [`deleted_${k}`, v])), ...Object.fromEntries(Object.entries(left).map(([k, v]) => [`left_${k}`, v])) }
}

/** Enable one more module in a bench tenant and give every bench role read on it (idempotent). */
export async function grantModuleToAll(sql: Sql, workspaceId: string, organizationId: string, code: string): Promise<void> {
  await assertTestDb(sql)
  await sql`insert into os.workspace_module (organization_id, workspace_id, module_code, enabled) values (${organizationId}, ${workspaceId}, ${code}, true)
            on conflict (workspace_id, module_code) do update set enabled = true`
  for (const r of await sql`select id from os.role where workspace_id = ${workspaceId} and code in ('owner', 'agent', 'manager')`) {
    await sql`insert into os.role_module_capability (organization_id, workspace_id, role_id, module_code, capability, own_records_scope)
              values (${organizationId}, ${workspaceId}, ${r.id}, ${code}, 'read', 'self_only') on conflict (role_id, module_code, capability) do nothing`
  }
}
