// Generates the synthetic business graph into ONE dedicated test org/workspace in the test database.
// Extraction OUTPUT shape is synthetic (no LLM); embeddings are REAL (repo embedLocal, e5-small q8, local).
import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const { embedLocal } = await import(`${process.env.ERA_REPO}/apps/brain-agent/src/brain/local-embeddings.ts`)
import { ownerSql, assertTestDb, rng, STATE_DIR, stats, columnExists } from '../lib/common.ts'
import { createTenant } from '../lib/fixture.ts'
const STATE_FILE = `${STATE_DIR}/bizA.json`

const R = rng(20261021)
const pick = <T>(a: T[]) => a[Math.floor(R() * a.length)]
const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

const FIRST = 'Ayşe Mehmet Elif Ahmet Zeynep Mustafa Fatma Emre Selin Burak Deniz Can Ece Kerem Merve Onur Derya Serkan Gizem Volkan Ebru Cem Sibel Tolga Aslı Barış Gamze Hakan İrem Kaan Nilay Ozan Pınar Sinan Tuba Umut Yasemin Batuhan Cansu Doğan Esra Furkan Gül Hande İlker Jale Koray Leyla Melis Necati Oya Polat Rüya Sedat Şule Taner Ülkü Vedat Yeliz Zafer Alp Bora Cemre Dilan Eda Ferhat Gökhan Hülya Irmak John Mary James Linda Robert Sarah Michael Emma David Olivia Daniel Sophia Thomas Grace Lucas Chloe Henry Mia Oliver Anna Jack Laura Noah Nina Leo Clara Adam Julia Max Ella Ivan Lena Marco Sofia Hans Greta Pierre Amelie Luca Giulia Omar Layla Yusuf Amira Kenji Yuki Raj Priya Wei Mei Arjun Sana'.split(' ')
const LAST = 'Yılmaz Kaya Demir Şahin Çelik Yıldız Yıldırım Öztürk Aydın Özdemir Arslan Doğan Kılıç Aslan Çetin Kara Koç Kurt Özkan Şimşek Polat Korkmaz Erdoğan Güneş Aksoy Tekin Bulut Karaca Uçar Keskin Avcı Tunç Ateş Sezer Duman Bozkurt Eren Güler Turan Ekinci Sarı Coşkun Işık Kocabaş Altun Taş Akın Bayram Önal Gündoğdu Smith Johnson Williams Brown Jones Garcia Miller Davis Wilson Anderson Taylor Thomas Moore Martin Jackson White Harris Clark Lewis Walker Hall Young King Wright Scott Green Baker Adams Nelson Hill Campbell Mitchell Roberts Carter Phillips Evans Turner Parker Collins Edwards Stewart Morris Murphy Cook Rogers Morgan Cooper Peterson Reed Bailey Bell Kelly Howard Ward Cox Rivera Richardson Wood Watson Brooks Bennett Gray James Hughes Price Sanders Myers Long Ross Foster Fischer Weber Schulz Becker Hoffmann Rossi Russo Ferrari Bianchi Dubois Laurent Moreau Novak Horvat Kowalski Nowak Tanaka Sato Suzuki Patel Shah Khan Chen Wang'.split(' ')
const CO_A = 'Northwind Bosphorus Anatolia Kestrel Meridian Atlas Vega Orion Aegean Cappadocia Lumen Nimbus Summit Harbor Cedar Falcon Granite Silverline Bluewave Redstone Ironbridge Goldleaf Evergreen Starling Polaris Sapphire Emerald Crescent Pinnacle Horizon Trident Zenith Apex Halcyon Quantum Vertex Sterling Brightpath Clearwater Oakridge Riverbend Stonegate Windmill Lighthouse Beacon Compass Keystone Pioneer Frontier Heritage Liberty Monarch Regal Sovereign Titan Vanguard Velocity Momentum Catalyst Fusion Nexus Pulse Spark Ember Aurora Solstice Equinox Tundra Sahara Mistral Sirocco Levant Marmara Karadeniz Ege Toros Erciyes Uludağ Kaçkar Palandöken Ilgaz Bolu Datça Kaş Bodrum Alaçatı Ayvalık Safranbolu Mardin Nemrut Efes Truva Pamukkale Göreme Sumela Ihlara'.split(' ')
const CO_B = 'Logistics Textiles Foods Systems Analytics Pharma Energy Retail Holdings Ventures Labs Software Robotics Foods Packaging Plastics Furniture Ceramics Media Studios Consulting Partners Capital Insurance Bank Motors Aviation Shipping Freight Construction Steel Chemicals Agro Dairy Bakery Coffee Tea Cosmetics Apparel Footwear Jewelry Optics Medical Dental Clinics Hotels Travel Catering Security Telecom Networks Cloud Data Payments Marketing Printing Paper Glass Solar Wind Water Mining Tools Electronics Appliances Toys Sports Fitness Education Academy'.split(' ')
const P_A = 'Aurora Nova Prime Ultra Swift Eco Smart Pro Flex Core Zen Pure Max Lite Edge Peak Bold Vivid Calm Rapid Fresh Solid Bright Prime Clever Silent Mighty Royal Urban Rural Classic Modern Fusion Arctic Desert Ocean Forest Stellar Lunar Solar Velvet Crystal Copper Cobalt Amber Ivory Onyx Jade Ruby Pearl Opal'.split(' ')
const P_B = 'Tee Hoodie Sneaker Backpack Kettle Blender Router Sensor Tablet Monitor Chair Desk Lamp Mattress Pillow Towel Mug Bottle Jacket Scarf Watch Ring Serum Cream Shampoo Candle Speaker Headset Charger Cable Drone Camera Printer Scanner Shelf Sofa Rug Curtain Planter Grill Cooler Tent Bike Helmet Glove Boot Sandal Wallet Belt Notebook Pen'.split(' ')
const PJ = 'Atlas Hermes Apollo Phoenix Pegasus Titan Orion Nebula Comet Meteor Quasar Pulsar Galaxy Cosmos Zephyr Typhoon Monsoon Cyclone Glacier Volcano Canyon Delta Fjord Lagoon Oasis Prairie Savanna Steppe Taiga Tundra'.split(' ')
const PJ2 = 'Rollout Migration Expansion Rebrand Launch Pilot Upgrade Integration Refresh Overhaul Program Initiative Sprint Wave Phase Track Stream Bridge Gateway Hub'.split(' ')
const CITIES = 'İstanbul Ankara İzmir Bursa Antalya Adana Konya Gaziantep Kayseri Mersin Eskişehir Diyarbakır Samsun Denizli Trabzon Malatya Erzurum Van Sakarya Kocaeli Tekirdağ Edirne Çanakkale Balıkesir Manisa Aydın Muğla Isparta Afyon Kütahya Bolu Düzce Zonguldak Karabük Kastamonu Sinop Ordu Giresun Rize Artvin Sivas Tokat Amasya Çorum Yozgat Kırşehir Nevşehir Niğde Aksaray Karaman Hatay Osmaniye Kahramanmaraş Adıyaman Şanlıurfa Mardin Batman Siirt Elazığ Tunceli Bingöl Muş Bitlis Hakkari Ağrı Kars Ardahan Iğdır Berlin Munich Hamburg London Manchester Paris Lyon Milan Rome Madrid Barcelona Lisbon Amsterdam Rotterdam Brussels Vienna Zurich Geneva Prague Warsaw Budapest Bucharest Sofia Athens Thessaloniki Dubai Doha Riyadh Cairo Baku Tbilisi Tashkent Almaty Kyiv Odesa Belgrade Zagreb Ljubljana Sarajevo Skopje Tirana Copenhagen Stockholm Oslo Helsinki Dublin Edinburgh Boston Chicago Toronto'.split(' ')
const STREETS = 'Bağdat Cad. İstiklal Cad. Atatürk Blv. Cumhuriyet Cad. Gazi Blv. Kennedy Cad. Barbaros Blv. Büyükdere Cad. Halaskargazi Cad. Abdi İpekçi Cad. Tunalı Hilmi Cad. Kızılay Sk. Alsancak Sk. Kordon Boyu Lara Cad. Konyaaltı Cad. Fevzi Çakmak Cad. Mithatpaşa Cad. Necatibey Cad. Cinnah Cad. Hürriyet Cad. Gülbahar Sk. Lale Sk. Menekşe Sk. Papatya Sk. Akasya Sk. Çınar Sk. Ihlamur Sk. Kavak Sk. Söğüt Sk. Zambak Sk. Karanfil Sk. Nergis Sk. Sümbül Sk. Yasemin Sk. Begonya Sk. Orkide Sk. Manolya Sk. Defne Sk. Mimoza Sk. Kaktüs Sk. Leylak Sk. Gardenya Sk. Fulya Sk. Ortanca Sk. Kamelya Sk. Lavanta Sk. Nilüfer Sk. Şebboy Sk. Hanımeli Sk.'.split(/(?<=\.)\s/)
const ROLES = 'procurement lead|operations manager|finance director|head of sales|logistics coordinator|marketing manager|IT administrator|purchasing specialist|account executive|product owner|warehouse supervisor|customer success manager|HR partner|legal counsel|CFO assistant'.split('|')
const PRODUCT_GOODS = 'packaging|raw cotton|steel coils|cold-chain transport|cloud hosting|office furniture|printing services|spare parts|cleaning chemicals|security services|plastic granules|glass bottles|software licences|courier services|labels'.split('|')

function zipfSampler(n: number, s: number) {
  const w = Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, s))
  const cum: number[] = []
  let t = 0
  for (const x of w) { t += x; cum.push(t) }
  return () => {
    const r = R() * t
    let lo = 0, hi = n - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid }
    return lo
  }
}

async function main() {
  const sql = ownerSql()
  await assertTestDb(sql)
  const tenant = await createTenant(sql, 'biza')
  const orgId = tenant.orgId, wsId = tenant.workspaceId
  const linkOrg = await columnExists(sql, 'brain_memory_entities', 'organization_id')
  const state: any = { dataset: 'biz100k', tenant, linkOrg }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  console.log('org', orgId, 'ws', wsId)

  // ── Entities (20,000) ──
  type Ent = { id: string; name: string; type: string; aliases: string[] }
  const persons: Ent[] = [], companies: Ent[] = [], products: Ent[] = [], projects: Ent[] = [], cities: Ent[] = []
  const pn = new Set<string>()
  for (const f of shuffle([...FIRST])) for (const l of LAST) pn.add(`${f} ${l}`)
  for (const n of shuffle([...pn]).slice(0, 12000)) persons.push({ id: randomUUID(), name: n, type: 'person', aliases: [] })
  const cn: string[] = []
  for (const a of CO_A) for (const b of new Set(CO_B)) cn.push(`${a} ${b}`)
  for (const n of shuffle(cn).slice(0, 5000)) companies.push({ id: randomUUID(), name: n, type: 'company', aliases: R() < 0.3 ? [n.split(' ')[0] + ' ' + n.split(' ')[1][0]] : [] })
  const prn: string[] = []
  for (const a of new Set(P_A)) for (const b of P_B) prn.push(`${a} ${b}`)
  for (const n of shuffle(prn).slice(0, 2000)) products.push({ id: randomUUID(), name: n, type: 'product', aliases: [] })
  const pjn: string[] = []
  for (const a of PJ) for (const b of PJ2) pjn.push(`Project ${a} ${b}`)
  for (const n of shuffle(pjn).slice(0, 600)) projects.push({ id: randomUUID(), name: n, type: 'project', aliases: [] })
  const cityList = [...new Set(CITIES)]
  for (const n of cityList) cities.push({ id: randomUUID(), name: n, type: 'location', aliases: [] })
  const filler = 20000 - persons.length - companies.length - products.length - projects.length - cities.length
  const topics: Ent[] = []
  const TOP = 'pricing|onboarding|churn|renewal|compliance|logistics|returns|warranty|forecast|budget|hiring|security audit|tax|cash flow|invoicing|support SLA|data migration|integration|training|expansion'.split('|')
  for (let i = 0; i < filler; i++) topics.push({ id: randomUUID(), name: `${pick(TOP)} ${pick(CO_A)} ${i}`, type: 'topic', aliases: [] })
  const allEnts = [...persons, ...companies, ...products, ...projects, ...cities, ...topics]
  console.log('entities', allEnts.length)

  const insertTimes: Record<string, { rows: number; ms: number }> = {}
  const timed = async (table: string, rows: number, fn: () => Promise<unknown>) => {
    await assertTestDb(sql)
    const t = performance.now(); await fn(); const ms = performance.now() - t
    const e = (insertTimes[table] ||= { rows: 0, ms: 0 }); e.rows += rows; e.ms += ms
  }
  for (let i = 0; i < allEnts.length; i += 1000) {
    const b = allEnts.slice(i, i + 1000).map((e) => ({ id: e.id, name: e.name, type: e.type, aliases: e.aliases }))
    await timed('brain_entities', b.length, () => sql`
      insert into os.brain_entities (id, organization_id, name, type, aliases, cloud_workspace_id)
      select x.id, ${orgId}::uuid, x.name, x.type, x.aliases, ${wsId}::uuid
      from jsonb_to_recordset(${sql.json(b)}::jsonb) as x(id uuid, name text, type text, aliases jsonb)`)
  }

  // ── Typed edges + their source memories ──
  type Mem = { id: string; content: string; ents: string[]; kind: string; importance: number; createdAt: Date; sourceRef: string; sourceType: string }
  type Edge = { from: string; to: string; rel: string; src: string | null }
  const mems: Mem[] = [], edges: Edge[] = []
  const edgeKeys = new Set<string>()
  const now = Date.now()
  const ago = () => new Date(now - Math.floor(R() * 365 * 86400_000))
  const mem = (content: string, ents: string[], kind = 'fact', sourceType = 'chat'): Mem => {
    const m: Mem = { id: randomUUID(), content, ents: [...new Set(ents)], kind, importance: Math.round((0.3 + R() * 0.6) * 100) / 100, createdAt: ago(), sourceRef: `bench:${sourceType}:${mems.length}`, sourceType }
    mems.push(m); return m
  }
  const edge = (from: string, to: string, rel: string, src: string | null) => {
    const k = `${from}|${to}|${rel}`; if (edgeKeys.has(k) || from === to) return false
    edgeKeys.add(k); edges.push({ from, to, rel, src }); return true
  }
  const coZipf = zipfSampler(companies.length, 0.7)
  const employer = new Map<string, Ent>()
  // works_at: every person, with a source memory
  for (const p of persons) {
    const c = companies[coZipf()]
    employer.set(p.id, c)
    const role = pick(ROLES)
    const m = mem(pick([
      `${p.name} works at ${c.name} as ${role}.`,
      `${p.name} joined ${c.name} as ${role} earlier this year.`,
      `Spoke with ${p.name}, ${role} at ${c.name}.`,
      `${p.name} (${role}, ${c.name}) is our main contact there.`,
    ]), [p.id, c.id])
    edge(p.id, c.id, 'works_at', m.sourceRef)
  }
  // ceo_of: 3000 companies
  const ceo = new Map<string, Ent>()
  for (const c of shuffle([...companies]).slice(0, 3000)) {
    const q = persons[Math.floor(R() * persons.length)]
    ceo.set(c.id, q)
    const m = mem(pick([`${q.name} is the CEO of ${c.name}.`, `${c.name} appointed ${q.name} as chief executive.`, `${q.name} runs ${c.name} as CEO since ${2015 + Math.floor(R() * 10)}.`]), [q.id, c.id])
    edge(q.id, c.id, 'ceo_of', m.sourceRef)
  }
  // HQ: 4000 companies, unique addresses
  const hq = new Map<string, string>()
  const usedAddr = new Set<string>()
  for (const c of shuffle([...companies]).slice(0, 4000)) {
    let addr = ''
    do { addr = `${pick(STREETS)} No:${1 + Math.floor(R() * 240)}` } while (usedAddr.has(addr))
    usedAddr.add(addr)
    const city = pick(cities)
    hq.set(c.id, `${addr}, ${city.name}`)
    const m = mem(pick([`${c.name} headquarters: ${addr}, ${city.name}.`, `${c.name} moved its head office to ${addr}, ${city.name}.`, `${c.name} HQ address is ${addr}, ${city.name}.`]), [c.id, city.id])
    edge(c.id, city.id, 'located_in', m.sourceRef)
  }
  // supplier_of: 6000 edges with memories
  const suppliersOf = new Map<string, string[]>()
  let sup = 0
  while (sup < 6000) {
    const d = companies[Math.floor(R() * companies.length)], c = companies[coZipf()]
    if (d.id === c.id || edgeKeys.has(`${d.id}|${c.id}|supplier_of`)) continue
    const goods = pick(PRODUCT_GOODS)
    const m = mem(pick([`${d.name} supplies ${goods} to ${c.name}.`, `${c.name} buys ${goods} from ${d.name}.`, `${d.name} is the ${goods} vendor for ${c.name}.`]), [d.id, c.id])
    edge(d.id, c.id, 'supplier_of', m.sourceRef)
    ;(suppliersOf.get(c.id) || suppliersOf.set(c.id, []).get(c.id)!).push(d.id)
    sup++
  }
  // contract codes: 2000 companies (direct-fact pool)
  const contract = new Map<string, { code: string; product: Ent; memId: string }>()
  for (const c of shuffle([...companies]).slice(0, 2000)) {
    const pr = pick(products)
    const code = `QX-${String(10000 + Math.floor(R() * 89999))}-${String.fromCharCode(65 + Math.floor(R() * 26))}`
    const m = mem(pick([
      `${c.name} signed the ${pr.name} framework agreement under contract ${code}; renewal is due in ${pick(['March', 'June', 'September', 'December'])}.`,
      `Contract ${code} covers ${c.name}'s ${pr.name} purchases for the next two years.`,
      `The ${pr.name} deal with ${c.name} was booked as contract ${code}.`,
    ]), [c.id, pr.id], 'fact', 'connector')
    contract.set(c.id, { code, product: pr, memId: m.id })
  }
  // inferred edges without memories: uses, manages, knows
  let uses = 0
  while (uses < 7000) { if (edge(companies[coZipf()].id, pick(products).id, 'uses', null)) uses++ }
  let man = 0
  while (man < 1400) { if (edge(pick(persons).id, pick(projects).id, 'manages', null)) man++ }
  while (edges.length < 40000) edge(pick(persons).id, pick(persons).id, 'knows', null)

  // background chunks up to 40,000 memories
  const T: Array<(e: any) => [string, string[]]> = [
    (e) => [`${e.P} from ${e.C} asked for a revised quote on ${e.PR}; they want ${e.N} units delivered by next month.`, [e.p, e.c, e.pr]],
    (e) => [`Call with ${e.P} (${e.C}): unhappy with late shipments last month, considering other suppliers.`, [e.p, e.c]],
    (e) => [`${e.C} renewed their annual subscription for ${e.PR} at ${e.N}k TRY.`, [e.c, e.pr]],
    (e) => [`${e.P} prefers WhatsApp over email and usually replies in the morning.`, [e.p]],
    (e) => [`Meeting notes: ${e.P} and ${e.P2} reviewed the ${e.PJ} timeline; launch slipped two weeks.`, [e.p, e.p2, e.pj]],
    (e) => [`${e.C} opened a support ticket about ${e.PR} sync errors after the latest update.`, [e.c, e.pr]],
    (e) => [`${e.C} and ${e.C2} are discussing a joint distribution deal in ${e.CITY}.`, [e.c, e.c2, e.city]],
    (e) => [`Invoice #${e.N}${e.N} for ${e.C} is overdue by 18 days; ${e.P} promised payment by Friday.`, [e.c, e.p]],
    (e) => [`${e.C} is expanding its warehouse in ${e.CITY} and will need more ${e.PR} next quarter.`, [e.c, e.city, e.pr]],
    (e) => [`${e.P} said the budget for ${e.PJ} is capped at ${e.N}k this year.`, [e.p, e.pj]],
    (e) => [`Demo of ${e.PR} for ${e.C} went well; ${e.P} wants a trial for the ${e.CITY} team.`, [e.pr, e.c, e.p, e.city]],
    (e) => [`${e.C} complained that ${e.PR} pricing went up ${e.N % 40}% compared to last year.`, [e.c, e.pr]],
    (e) => [`${e.P} introduced us to ${e.P2}, who handles logistics at ${e.C2}.`, [e.p, e.p2, e.c2]],
    (e) => [`Quarterly review: ${e.C} revenue from ${e.PR} grew ${e.N % 30}% quarter over quarter.`, [e.c, e.pr]],
    (e) => [`${e.P} is on parental leave until autumn; contact ${e.P2} meanwhile.`, [e.p, e.p2]],
    (e) => [`${e.C} asked whether ${e.PR} integrates with their ERP.`, [e.c, e.pr]],
    (e) => [`Shipment of ${e.N} ${e.PR} units to ${e.C} in ${e.CITY} was held at customs.`, [e.pr, e.c, e.city]],
    (e) => [`${e.P} requested a discount on the ${e.PR} bundle for their ${e.CITY} stores.`, [e.p, e.pr, e.city]],
    (e) => [`${e.C} signed an NDA ahead of the ${e.PJ} pilot.`, [e.c, e.pj]],
    (e) => [`Chat: ${e.P} asked about the return policy for defective ${e.PR} items.`, [e.p, e.pr]],
    (e) => [`${e.C2} lost the ${e.CITY} municipality tender to ${e.C}.`, [e.c2, e.c, e.city]],
    (e) => [`${e.P} will attend the trade fair in ${e.CITY} and wants to meet in person.`, [e.p, e.city]],
    (e) => [`Finance note: ${e.C} pays invoices net 60, cash-flow risk flagged.`, [e.c]],
    (e) => [`${e.P} wants a weekly status email about ${e.PJ}.`, [e.p, e.pj]],
  ]
  while (mems.length < 40000) {
    const p = pick(persons), p2 = pick(persons), c = companies[coZipf()], c2 = companies[coZipf()], pr = pick(products), pj = pick(projects), city = pick(cities)
    const [text, ents] = pick(T)({ P: p.name, p: p.id, P2: p2.name, p2: p2.id, C: c.name, c: c.id, C2: c2.name, c2: c2.id, PR: pr.name, pr: pr.id, PJ: pj.name, pj: pj.id, CITY: city.name, city: city.id, N: 10 + Math.floor(R() * 900) })
    mem(text, ents, pick(['fact', 'event', 'preference', 'fact']), pick(['chat', 'email', 'document', 'chat']))
  }
  console.log('memories', mems.length, 'edges', edges.length)

  // ── Needles (200) ──
  const needles: any[] = []
  const contractCos = shuffle([...contract.keys()]).slice(0, 100)
  for (const cid of contractCos) {
    const c = companies.find((x) => x.id === cid)!; const k = contract.get(cid)!
    needles.push({ kind: 'direct', query: pick([`What is the contract number for ${c.name}'s ${k.product.name} agreement?`, `Which contract reference covers the ${k.product.name} deal with ${c.name}?`, `${c.name} ${k.product.name} contract code?`]), answer: k.code, memId: k.memId })
  }
  const memByRef = new Map(mems.map((m) => [m.sourceRef, m]))
  const worksMem = new Map<string, string>()
  for (const e of edges) if (e.rel === 'works_at' && e.src) worksMem.set(e.from, memByRef.get(e.src)!.id)
  const ps = shuffle([...persons])
  let two = 0, three = 0
  for (const p of ps) {
    const c = employer.get(p.id)!
    if (two < 60 && hq.has(c.id)) {
      const addr = hq.get(c.id)!.split(',')[0]
      needles.push({ kind: '2hop', query: pick([`What is the headquarters address of the company ${p.name} works for?`, `Where is ${p.name}'s employer headquartered?`]), answer: addr, chain: [p.name, c.name], ids: [p.id, c.id] })
      two++; continue
    }
    const sups = suppliersOf.get(c.id) || []
    if (three < 40 && sups.length === 1 && ceo.has(sups[0])) {
      const d = companies.find((x) => x.id === sups[0])!; const q = ceo.get(d.id)!
      needles.push({ kind: '3hop', query: pick([`Who is the CEO of the supplier of ${p.name}'s employer?`, `Who runs the company that supplies ${p.name}'s company?`]), answer: q.name, chain: [p.name, c.name, d.name, q.name], ids: [p.id, c.id, d.id, q.id] })
      three++
    }
    if (two >= 60 && three >= 40) break
  }
  console.log('needles', needles.length, { two, three })

  // ── Insert memories (embed with real embedLocal, then timed insert) ──
  const embedMs: number[] = []
  const B = 400
  for (let i = 0; i < mems.length; i += B) {
    const batch = mems.slice(i, i + B)
    const t = performance.now()
    const vecs = await embedLocal(batch.map((m) => m.content), 'passage')
    embedMs.push(performance.now() - t)
    const rows = batch.map((m, j) => ({ id: m.id, content: m.content, kind: m.kind, importance: m.importance, source_type: m.sourceType, source_ref: m.sourceRef, created_at: m.createdAt.toISOString(), emb: `[${vecs[j].join(',')}]` }))
    await timed('brain_memories', rows.length, () => sql`
      insert into os.brain_memories (id, organization_id, content, kind, importance, source_type, source_ref, created_at, valid_from, embedding_e5, cloud_workspace_id)
      select x.id, ${orgId}::uuid, x.content, x.kind, x.importance, x.source_type, x.source_ref, x.created_at, x.created_at, x.emb::os.vector, ${wsId}::uuid
      from jsonb_to_recordset(${sql.json(rows)}::jsonb) as x(id uuid, content text, kind text, importance real, source_type text, source_ref text, created_at timestamp, emb text)`)
    const links = batch.flatMap((m) => m.ents.map((e) => ({ m: m.id, e })))
    await timed('brain_memory_entities', links.length, () => sql`
      insert into os.brain_memory_entities ${linkOrg ? sql`(memory_id, entity_id, organization_id)` : sql`(memory_id, entity_id)`}
      select x.m, x.e ${linkOrg ? sql`, ${orgId}::uuid` : sql``} from jsonb_to_recordset(${sql.json(links)}::jsonb) as x(m uuid, e uuid) on conflict do nothing`)
    if ((i / B) % 10 === 0) console.log('mem', i + batch.length, 'rss MB', (process.memoryUsage().rss / 1e6).toFixed(0))
  }
  for (let i = 0; i < edges.length; i += 2000) {
    const b = edges.slice(i, i + 2000).map((e) => ({ f: e.from, t: e.to, r: e.rel, s: e.src }))
    await timed('brain_entity_edges', b.length, () => sql`
      insert into os.brain_entity_edges (organization_id, from_entity_id, to_entity_id, relation, source_ref, cloud_workspace_id)
      select ${orgId}::uuid, x.f, x.t, x.r, x.s, ${wsId}::uuid from jsonb_to_recordset(${sql.json(b)}::jsonb) as x(f uuid, t uuid, r text, s text)`)
  }
  // a few memory edges (extends) between memories sharing a company
  const byCo = new Map<string, string[]>()
  for (const m of mems) for (const e of m.ents) if (byCo.has(e) || companies.length) { const l = byCo.get(e) || []; if (l.length < 6) { l.push(m.id); byCo.set(e, l) } }
  const medges: any[] = []
  for (const l of byCo.values()) { if (l.length >= 2 && medges.length < 3000) medges.push({ f: l[l.length - 1], t: l[0] }) }
  await timed('brain_memory_edges', medges.length, () => sql`
    insert into os.brain_memory_edges (from_memory_id, to_memory_id, type) select x.f, x.t, 'extends' from jsonb_to_recordset(${sql.json(medges)}::jsonb) as x(f uuid, t uuid) on conflict do nothing`)
  await sql`analyze os.brain_memories`; await sql`analyze os.brain_entities`; await sql`analyze os.brain_entity_edges`; await sql`analyze os.brain_memory_entities`; await sql`analyze os.brain_memory_edges`

  const es = stats(embedMs)
  state.insert = Object.fromEntries(Object.entries(insertTimes).map(([k, v]) => [k, { rows: v.rows, ms: Math.round(v.ms), rowsPerSec: Math.round(v.rows / v.ms * 1000) }]))
  state.embed = { batches: es.n, batchSize: B, totalMs: Math.round(embedMs.reduce((a, b) => a + b, 0)), textsPerSec: Math.round(mems.length / embedMs.reduce((a, b) => a + b, 0) * 1000) }
  state.counts = { entities: allEnts.length, memories: mems.length, edges: edges.length, memoryEdges: medges.length, links: mems.reduce((a, m) => a + m.ents.length, 0) }
  state.needles = needles
  // shared question format + evidence memory ids (the source memory of every typed edge on the answer path)
  const edgeMem = new Map<string, string>()
  for (const e of edges) if (e.src) edgeMem.set(`${e.from}|${e.to}|${e.rel}`, memByRef.get(e.src)!.id)
  const hqMem = new Map<string, string>()
  for (const e of edges) if (e.rel === 'located_in' && e.src) hqMem.set(e.from, memByRef.get(e.src)!.id)
  state.questions = needles.map((nd: any, i: number) => {
    const base = { id: `${nd.kind}-${i}`, cat: nd.kind === 'direct' ? 'direct' : nd.kind === '2hop' ? 'multihop2' : 'multihop3', asker: 'owner', q: nd.query, answer: nd.answer, chain: nd.chain }
    if (nd.kind === 'direct') return { ...base, evidenceIds: [nd.memId] }
    const [p, c, d, q] = nd.ids
    if (nd.kind === '2hop') return { ...base, evidenceIds: [edgeMem.get(`${p}|${c}|works_at`), hqMem.get(c)] }
    return { ...base, evidenceIds: [edgeMem.get(`${p}|${c}|works_at`), edgeMem.get(`${d}|${c}|supplier_of`), edgeMem.get(`${q}|${d}|ceo_of`)] }
  })
  state.secrets = []
  state.sampleIds = { persons: shuffle([...persons]).slice(0, 300).map((p) => p.id) }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  console.log(JSON.stringify({ insert: state.insert, embed: state.embed, counts: state.counts }, null, 1))
  await sql.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
