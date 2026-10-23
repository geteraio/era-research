// R51 — the product's discovery pass runs on every brain tick; the bench runs it right after ingest and stops at the first
// round that infers nothing. A round whose model answer was unusable (0 of N) stopped one conversation early — run it again.
import { arm } from '../lib/r46-router.ts'
import { counters } from '../lib/llm.ts'
import { ownerSql, assertTestDb, loadJson, saveJson, STATE_DIR, REPO } from '../lib/common.ts'
import '../lib/dbshim.ts'
arm()
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { discoverRelationships } = await import(`${REPO}/apps/brain-agent/src/brain/relationships.ts`)
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const STATE = `${STATE_DIR}/${flag('state') ?? 'r51f-locomo'}.json`
const state = loadJson<any>(STATE)!
const raw = ownerSql(2)
await assertTestDb(raw)
for (const id of flag('only')!.split(',')) {
  const ORG = state[id].orgId
  const d0 = { rounds: 0, inferred: 0, candidates: 0 }
  for (let r = 0; r < 15; r++) {
    const d = await runInOrganization(ORG, () => discoverRelationships(ORG))
    d0.rounds++; d0.inferred += d.inferred; d0.candidates += d.candidates
    if (!d.candidates) break
  }
  const [g] = await raw`select count(*)::int n from os.brain_entity_edges where organization_id = ${ORG}`
  console.log(id, d0, 'entity_edges', g.n)
  state[id].rediscovery = { ...d0, entityEdges: g.n }
}
saveJson(STATE, state)
console.log('llm', counters.cliCalls)
await raw.end()
process.exit(0)
