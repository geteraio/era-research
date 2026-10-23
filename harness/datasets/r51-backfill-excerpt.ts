// R51 — bench-only: give the memories of an ALREADY ingested conversation the provenance.excerpt the product now stores at
// write time (same pure function, same source text the ingest handed the extractor) — saves a re-ingest for dev tuning.
import { readFileSync } from 'node:fs'
import { ownerSql, assertTestDb, loadJson, STATE_DIR, BB2, REPO } from '../lib/common.ts'
const { sourceExcerpt } = await import(`${REPO}/apps/brain-agent/src/brain/source-excerpt.ts`)
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const state = loadJson<any>(`${STATE_DIR}/${flag('state') ?? 'r51-locomo'}.json`)!
const data = JSON.parse(readFileSync(`${BB2}/data/locomo10.json`, 'utf8')) as any[]
const raw = ownerSql(2)
await assertTestDb(raw)
let n = 0
for (const c of data) {
  const st = state[c.sample_id]
  if (!st?.done) continue
  const A = c.conversation.speaker_a, B = c.conversation.speaker_b
  const text = new Map<string, string>()
  for (let s = 1; c.conversation[`session_${s}`]; s++) {
    const dateStr = c.conversation[`session_${s}_date_time`], turns = c.conversation[`session_${s}`] as any[]
    for (let w = 0; w * 8 < turns.length; w++) {
      const body = turns.slice(w * 8, w * 8 + 8).map((t) => `${t.speaker}: ${t.text}${t.blip_caption ? ` [shares a photo: ${t.blip_caption}]` : ''}`).join('\n')
      text.set(`locomo:${c.sample_id}:s${s}:w${w}`, `Conversation between ${A} and ${B} on ${dateStr} (session ${s}${w ? `, continued` : ''}).\n${body}`)
    }
  }
  const rows = await raw`select id, content, source_ref from os.brain_memories where organization_id = ${st.orgId}`
  for (const r of rows as any[]) {
    const ex = sourceExcerpt(text.get(r.source_ref), r.content, Number(flag("max") ?? 700))
    if (!ex) continue
    await raw`update os.brain_memories set provenance = coalesce(provenance, '{}'::jsonb) || jsonb_build_object('excerpt', ${ex}::text) where id = ${r.id}::uuid and organization_id = ${st.orgId}::uuid`
    n++
  }
}
console.log('excerpts written', n)
await raw.end()
process.exit(0)
