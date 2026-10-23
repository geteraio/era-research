// Drops every bb2- bench org from the test database (or one: bun run cleanup.ts <orgId>) and prints what is left.
import { ownerSql, assertTestDb } from './lib/common.ts'
import { dropTenant } from './lib/fixture.ts'
const sql = ownerSql(); await assertTestDb(sql)
const ids = process.argv[2] ? [process.argv[2]] : (await sql`select id from os.organization where slug like 'bb2-%'`).map((r: any) => r.id)
for (const id of ids) { const r = await dropTenant(sql, id); const left = Object.entries(r).filter(([k, v]) => k.startsWith('left_') && v); console.log(id, 'deleted memories', r.deleted_brain_memories, 'left', left.length ? left : 'none') }
const [{ n }] = await sql`select count(*)::int n from os.organization where slug like 'bb2-%'`
const [{ u }] = await sql`select count(*)::int u from os.app_user where email like '%@bb2-%'`
console.log('bb2 orgs remaining', n, 'bb2 users remaining', u)
await sql.end()
