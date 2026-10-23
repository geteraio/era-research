// HARNESS-ONLY SHIM (not a product fix). drizzle's postgres-js driver installs pass-through serializers for
// timestamp/date OIDs, so a raw sql`` template with a JS Date parameter (storeMappedRecord's validFrom,
// recallMemories' asOf, ...) throws "Received an instance of Date". Without this shim the connector path fails at
// brain_record_versions on EVERY record. Disable with BB2_NO_DATE_SHIM=1 to reproduce the product behaviour.
import { REPO, loadTestEnv } from './common.ts'
loadTestEnv()
const { db } = await import(`${REPO}/packages/db/index.ts`)
export const dateShimOn = process.env.BB2_NO_DATE_SHIM !== '1'
if (dateShimOn) {
  const ser = (db as any).$client.options.serializers
  for (const oid of [1082, 1114, 1184]) {
    const prev = ser[oid]
    ser[oid] = (x: unknown) => (x instanceof Date ? x.toISOString() : prev ? prev(x) : x)
  }
}
