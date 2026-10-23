// R45 probe: every fact of one entity with its distance to the question and its stem hits.
// Usage: bun run r45-facts.ts <dataset> "<entity name>" "<question>"
import { loadJson, STATE_DIR, REPO, loadTestEnv, ownerSql } from './lib/common.ts'
loadTestEnv()
const { embedText } = await import(`${REPO}/apps/brain-agent/src/brain/embeddings.ts`)
const NEW = await import(`${REPO}/packages/db/brain-paths.ts`)
const [ds, name, q] = process.argv.slice(2)
const st = loadJson<any>(`${STATE_DIR}/${ds}.json`)!; const T = st.tenant
const raw = ownerSql()
const v = await embedText(q, { organizationId: T.orgId, scope: 'org' }, 'query')
const stems = NEW.questionStems(q)
console.log('stems', stems)
const rows = await raw.unsafe(`select m.content, m.source_ref, (m.embedding_e5 <=> $3::vector) d from os.brain_memories m join os.brain_memory_entities me on me.memory_id=m.id join os.brain_entities e on e.id=me.entity_id
  where e.organization_id=$1 and e.name=$2 and m.is_latest order by d limit 40`, [T.orgId, name, `[${v.join(',')}]`])
for (const r of rows as any[]) console.log(Number(r.d).toFixed(3), stems.filter((s: string) => r.content.toLocaleLowerCase('tr').includes(s)).join(','), '|', r.content.slice(0, 110))
await raw.end(); process.exit(0)
