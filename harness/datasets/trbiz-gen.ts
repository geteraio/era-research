// Turkish structured-business dataset → the test database, through the product's REAL write paths:
//   records (company/customer cards, orders, invoices, payments, bookings, deals) → storeMappedRecord (connector path, 0 LLM)
//   conversations (WhatsApp, e-mail, meeting notes, finance/HR notes)             → prepareExtractedMemory + commitExtractedMemory(judged=null)
// The extraction OUTPUT of conversations is synthetic (what the LLM extractor would emit); no model is called.
// Usage: bun run datasets/trbiz-gen.ts      → state/trbiz.json (tenant, questions, secrets)
import { ownerSql, assertTestDb, rng, saveJson, STATE_DIR, REPO, stats } from '../lib/common.ts'
import { createTenant } from '../lib/fixture.ts'
import '../lib/dbshim.ts'

const R = rng(20261022)
const pick = <T>(a: T[]) => a[Math.floor(R() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1))
const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

const sql = ownerSql()
await assertTestDb(sql)
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { storeMappedRecord, emptyStats } = await import(`${REPO}/apps/brain-agent/src/brain/connector-ingest.ts`)
const { prepareExtractedMemory, commitExtractedMemory } = await import(`${REPO}/apps/brain-agent/src/brain/ingestion.ts`)

const tenant = await createTenant(sql, 'trbiz')
const ORG = tenant.orgId
console.log('tenant', tenant)

// ── vocabulary ──
const FIRST = 'Ayşe Mehmet Elif Ahmet Zeynep Mustafa Fatma Emre Selin Burak Deniz Can Ece Kerem Merve Onur Derya Serkan Gizem Volkan Ebru Cem Sibel Tolga Aslı Barış Gamze Hakan İrem Kaan Nilay Ozan Pınar Sinan Tuba Umut Yasemin Batuhan Cansu Doğan Esra Furkan Gül Hande İlker Koray Leyla Melis Necati Oya Rüya Sedat Şule Taner Ülkü Vedat Yeliz Zafer Alp Bora Cemre Dilan Eda Ferhat Gökhan Hülya Irmak Hatice Halil Hüseyin Emine Murat Seda Tuncay Nur Arda Berk Damla'.split(' ')
const LAST = 'Yılmaz Kaya Demir Şahin Çelik Yıldız Yıldırım Öztürk Aydın Özdemir Arslan Doğan Kılıç Aslan Çetin Kara Koç Kurt Özkan Şimşek Polat Korkmaz Erdoğan Güneş Aksoy Tekin Bulut Karaca Uçar Keskin Avcı Tunç Ateş Sezer Duman Bozkurt Eren Güler Turan Ekinci Sarı Coşkun Işık Altun Taş Akın Bayram Önal Gündoğdu Erbil Toprak Karakaya Akgül Sönmez Kalkan Yalçın Uysal Bilgin Çakır Özer'.split(' ')
const CO_A = 'Kaya Ege Toros Anadolu Marmara Boğaziçi Kapadokya Akdeniz Karadeniz Uludağ Erciyes Ilgaz Palandöken Datça Bodrum Alaçatı Ayvalık Safranbolu Mardin Nemrut Efes Truva Pamukkale Göreme Sumela Kaçkar Munzur Fırat Dicle Seyhan Ceyhan Sakarya Kızılırmak Yeşilırmak Meriç Gediz Menderes Bakırçay Aras Çoruh'.split(' ')
const CO_B = 'Tekstil Gıda Lojistik Yapı Mobilya Kimya Enerji Otomotiv Plastik Ambalaj Elektrik Tarım Turizm Medikal Kozmetik Seramik Cam Metal Matbaa Yazılım'.split(' ')
const CO_SFX = ['A.Ş.', 'Ltd. Şti.']
const P_A = 'Defne Lale Ada Mavi Nova Ege Toros Ilgaz Zeytin Çınar Poyraz Lodos Yakamoz Gökkuşağı Bulut Kuzey Güney Mercan İnci Safir'.split(' ')
const P_B = 'Çaydanlık|Termos|Kahve Makinesi|Blender|Ütü|Halı|Nevresim Takımı|Havlu Seti|Masa Lambası|Ofis Sandalyesi|Kablosuz Kulaklık|Akıllı Saat|Robot Süpürge|Su Arıtma Cihazı|Tost Makinesi|Yemek Takımı|Çelik Tencere Seti'.split('|')
const CITIES = 'İstanbul Ankara İzmir Bursa Antalya Adana Konya Gaziantep Kayseri Mersin Eskişehir Samsun Denizli Trabzon Sakarya Kocaeli Tekirdağ Manisa Muğla Balıkesir'.split(' ')
const DISTRICTS = 'Kadıköy Beşiktaş Üsküdar Şişli Bakırköy Ataşehir Çankaya Keçiören Karşıyaka Bornova Nilüfer Osmangazi Muratpaşa Konyaaltı Seyhan Selçuklu'.split(' ')
const STREETS = 'Bağdat Cad.|İstiklal Cad.|Atatürk Blv.|Cumhuriyet Cad.|Gazi Blv.|Barbaros Blv.|Büyükdere Cad.|Lale Sk.|Menekşe Sk.|Papatya Sk.|Akasya Sk.|Çınar Sk.|Ihlamur Sk.|Zambak Sk.|Karanfil Sk.'.split('|')
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const trDate = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 10))
const NOW = day(2026, 10, 22) // "geçen ay" = Eylül 2026
const used = new Set<string>()
const uniq = (gen: () => string) => { let s = ''; do { s = gen() } while (used.has(s)); used.add(s); return s }
const money = (lo: number, hi: number) => uniq(() => { const v = int(lo, hi); const k = int(0, 99); return `${v.toLocaleString('tr-TR')},${String(k).padStart(2, '0')} TL` })

// ── people, companies, products ──
const nameSet = new Set<string>()
const personName = () => { let n = ''; do { n = `${pick(FIRST)} ${pick(LAST)}` } while (nameSet.has(n)); nameSet.add(n); return n }
const staff = Array.from({ length: 12 }, (_, i) => ({ id: `staff-${i}`, name: personName(), dept: i < 6 ? 'satış' : i < 9 ? 'finans' : 'insan kaynakları' }))
const reps = staff.slice(0, 6)
const coNames = shuffle(CO_A.flatMap((a) => CO_B.map((b) => `${a} ${b}`))).slice(0, 250)
const companies = coNames.map((n, i) => ({ id: `company-${i}`, name: `${n} ${pick(CO_SFX)}`, taxNo: uniq(() => String(int(1000000000, 9999999999))), city: pick(CITIES), rep: pick(reps) }))
const products = shuffle(P_A.flatMap((a) => P_B.map((b) => `${a} ${b}`))).slice(0, 140).map((n, i) => ({ id: `product-${i}`, name: n }))
const customers = Array.from({ length: 420 }, (_, i) => ({ id: `cust-${i}`, name: personName(), code: uniq(() => `MŞ-${int(1000, 9999)}`), company: pick(companies), city: pick(CITIES), role: pick(['satın alma sorumlusu', 'işletme müdürü', 'muhasebe yetkilisi', 'genel müdür', 'lojistik sorumlusu', 'mağaza müdürü']) }))

// ── question bookkeeping ──
type Ev = string // 'rec:<slug>:<ref>' | 'conv:<n>'
interface Q { id: string; cat: string; asker: 'owner' | 'sales' | 'finance'; q: string; answer: string; stale?: string; distractor?: string; evidence: Ev[]; secret?: boolean; secretClass?: string }
const questions: Q[] = []
const secrets: Array<{ secret: string; cls: 'employees-tagged' | 'finance-tagged' | 'finance-record-untagged' | 'personal'; visibleTo: string[] }> = []

// ── records ──
type Rec = { slug: string; rec: any; phase: number }
const records: Rec[] = []
const recRef = (slug: string, ref: string) => `rec:${slug}:${ref}`
for (const c of companies) {
  records.push({ slug: 'crm', phase: 0, rec: {
    recordRef: `company:${c.id}`, primaryKey: 'c',
    memory: { content: `Firma kartı: ${c.name} — vergi numarası ${c.taxNo}, merkez ${c.city}, müşteri temsilcisi ${c.rep.name}.`, kind: 'fact', importance: 0.6 },
    nodes: [{ key: 'c', type: 'company', name: c.name, externalRef: `company:${c.id}` }, { key: 'r', type: 'person', name: c.rep.name, externalRef: `staff:${c.rep.id}` }],
    edges: [{ fromKey: 'r', toKey: 'c', relation: 'manages_account' }],
    raw: { name: c.name, taxNo: c.taxNo, city: c.city },
  } })
}
for (const p of customers) {
  records.push({ slug: 'crm', phase: 0, rec: {
    recordRef: `customer:${p.id}`, primaryKey: 'p',
    memory: { content: `Müşteri kartı: ${p.name} (${p.code}) — ${p.company.name} firmasında ${p.role}, şehir ${p.city}.`, kind: 'fact', importance: 0.6 },
    nodes: [{ key: 'p', type: 'customer', name: p.name, externalRef: `party:${p.id}` }, { key: 'c', type: 'company', name: p.company.name, externalRef: `company:${p.company.id}` }],
    edges: [{ fromKey: 'p', toKey: 'c', relation: 'works_at' }],
    raw: { name: p.name, code: p.code, company: p.company.name },
  } })
}
type Order = { no: string; cust: typeof customers[0]; product: typeof products[0]; qty: number; date: Date; status: string; tracking?: string; invoice?: { no: string; amount: string; due: Date }; payment?: { no: string; dk: string; date: Date } }
const orders: Order[] = []
const orderNo = () => uniq(() => `SP-${int(10000, 99999)}`)
const addOrder = (cust: typeof customers[0], product: typeof products[0], date: Date): Order => {
  const status = pick(['hazırlanıyor', 'kargoda', 'teslim edildi', 'teslim edildi'])
  const o: Order = { no: orderNo(), cust, product, qty: int(1, 40), date, status }
  if (status !== 'hazırlanıyor') o.tracking = uniq(() => `YK-${int(100000, 999999)}`)
  orders.push(o); return o
}
const randDate = () => new Date(day(2026, 1, 5).getTime() + Math.floor(R() * (NOW.getTime() - day(2026, 1, 5).getTime())))
// temporal customers: exactly two orders — one last month (Eylül 2026), one in an earlier month, different products
const shuffledCust = shuffle([...customers])
const temporalCust = shuffledCust.slice(0, 50)
const otherCust = shuffledCust.slice(50)
for (const c of temporalCust) {
  const pLast = pick(products); let pOld = pick(products); while (pOld.id === pLast.id) pOld = pick(products)
  const oLast = addOrder(c, pLast, day(2026, 9, int(2, 28)))
  const oOld = addOrder(c, pOld, day(2026, pick([4, 5, 6, 7]), int(2, 27)))
  questions.push({ id: `temporal-${questions.length}`, cat: 'temporal', asker: 'owner', q: pick([`${c.name} geçen ay hangi ürünü sipariş etti?`, `Geçen ay ${c.name}'ın verdiği siparişteki ürün neydi?`]), answer: pLast.name, distractor: pOld.name, evidence: [recRef('shop', `order:${oLast.no}`)] })
  void oOld
}
for (let i = 0; i < 1150; i++) addOrder(pick(otherCust), pick(products), randDate())
const orderContent = (o: Order, tracking = o.tracking, status = o.status) =>
  `Sipariş ${o.no} — müşteri ${o.cust.name} (${o.cust.company.name}), ${o.qty} adet ${o.product.name}, sipariş tarihi ${trDate(o.date)}, durum: ${status}${tracking ? `, kargo takip numarası ${tracking}` : ''}.`
const orderRec = (o: Order, content: string) => ({
  recordRef: `order:${o.no}`, primaryKey: 'o', occurredAt: o.date.toISOString(),
  memory: { content, kind: 'fact', importance: 0.55 },
  nodes: [{ key: 'o', type: 'order', name: o.no, externalRef: `order:${o.no}` }, { key: 'p', type: 'customer', name: o.cust.name, externalRef: `party:${o.cust.id}` }, { key: 'u', type: 'product', name: o.product.name, externalRef: `product:${o.product.id}` }],
  edges: [{ fromKey: 'p', toKey: 'o', relation: 'placed' }, { fromKey: 'o', toKey: 'u', relation: 'contains' }],
  raw: { no: o.no, status: o.status, tracking: o.tracking ?? null },
})
for (const o of orders) records.push({ slug: 'shop', phase: 0, rec: orderRec(o, orderContent(o)) })

// invoices for 820 orders, payments for 620 of those
const invoiced = shuffle(orders.filter((o) => !temporalCust.includes(o.cust))).slice(0, 820)
for (const o of invoiced) {
  const due = new Date(o.date.getTime() + 30 * 86400_000)
  o.invoice = { no: uniq(() => `FTR-2026-${String(int(1, 99999)).padStart(5, '0')}`), amount: money(900, 480000), due }
  records.push({ slug: 'finance', phase: 0, rec: {
    recordRef: `invoice:${o.invoice.no}`, primaryKey: 'i', occurredAt: o.date.toISOString(),
    memory: { content: `Fatura ${o.invoice.no} — ${o.no} siparişi için ${o.cust.company.name} adına kesildi, tutar ${o.invoice.amount}, vade ${trDate(due)}.`, kind: 'fact', importance: 0.6 },
    nodes: [{ key: 'i', type: 'invoice', name: o.invoice.no, externalRef: `invoice:${o.invoice.no}` }, { key: 'o', type: 'order', name: o.no, externalRef: `order:${o.no}` }, { key: 'c', type: 'company', name: o.cust.company.name, externalRef: `company:${o.cust.company.id}` }],
    edges: [{ fromKey: 'i', toKey: 'o', relation: 'for_order' }, { fromKey: 'i', toKey: 'c', relation: 'billed_to' }],
    raw: { no: o.invoice.no, amount: o.invoice.amount },
  } })
  secrets.push({ secret: o.invoice.amount, cls: 'finance-record-untagged', visibleTo: ['owner', 'finance'] })
}
for (const o of invoiced.slice(0, 620)) {
  const pd = new Date(o.invoice!.due.getTime() - int(0, 25) * 86400_000)
  o.payment = { no: uniq(() => `TH-${int(10000, 99999)}`), dk: uniq(() => `DK-${int(100000, 999999)}`), date: pd }
  records.push({ slug: 'finance', phase: 0, rec: {
    recordRef: `payment:${o.payment.no}`, primaryKey: 't', occurredAt: pd.toISOString(),
    memory: { content: `Tahsilat ${o.payment.no} — ${o.invoice!.no} faturası için ${o.invoice!.amount} ${pick(['havale', 'EFT', 'kredi kartı'])} ile alındı, ${trDate(pd)}, dekont numarası ${o.payment.dk}.`, kind: 'fact', importance: 0.55 },
    nodes: [{ key: 't', type: 'payment', name: o.payment.no, externalRef: `payment:${o.payment.no}` }, { key: 'i', type: 'invoice', name: o.invoice!.no, externalRef: `invoice:${o.invoice!.no}` }],
    edges: [{ fromKey: 't', toKey: 'i', relation: 'pays' }],
    raw: { no: o.payment.no, dk: o.payment.dk },
  } })
}
// bookings + deals (background structure)
for (let i = 0; i < 300; i++) {
  const c = pick(customers), rep = pick(reps), d = randDate(), no = uniq(() => `RV-${int(1000, 9999)}`)
  records.push({ slug: 'appointments', phase: 0, rec: {
    recordRef: `booking:${no}`, primaryKey: 'b', occurredAt: d.toISOString(),
    memory: { content: `Randevu ${no} — ${c.name}, ${trDate(d)} saat ${int(9, 17)}:00, ${pick(['showroom ziyareti', 'ürün demosu', 'kurulum', 'servis kontrolü'])}, ${pick(DISTRICTS)} şubesi, temsilci ${rep.name}.`, kind: 'fact', importance: 0.5 },
    nodes: [{ key: 'b', type: 'booking', name: no, externalRef: `booking:${no}` }, { key: 'p', type: 'customer', name: c.name, externalRef: `party:${c.id}` }, { key: 'r', type: 'person', name: rep.name, externalRef: `staff:${rep.id}` }],
    edges: [{ fromKey: 'p', toKey: 'b', relation: 'booked' }, { fromKey: 'b', toKey: 'r', relation: 'with' }],
  } })
}
for (let i = 0; i < 200; i++) {
  const c = pick(companies), rep = pick(reps)
  records.push({ slug: 'crm', phase: 0, rec: {
    recordRef: `deal:${i}`, primaryKey: 'd',
    memory: { content: `Fırsat: ${c.name} — ${pick(['yıllık bakım sözleşmesi', 'toplu alım', 'bayilik anlaşması', 'yeni şube donanımı'])}, aşama ${pick(['ilk görüşme', 'teklif', 'pazarlık', 'kazanıldı', 'kaybedildi'])}, sorumlu ${rep.name}.`, kind: 'fact', importance: 0.5 },
    nodes: [{ key: 'd', type: 'deal', name: `Fırsat ${c.name} ${i}`, externalRef: `deal:${i}` }, { key: 'c', type: 'company', name: c.name, externalRef: `company:${c.id}` }],
    edges: [{ fromKey: 'd', toKey: 'c', relation: 'for_company' }],
  } })
}

// ── conversations ──
type Conv = { n: number; content: string; sourceType: string; ents: Array<{ name: string; type: string }>; moduleCode?: string; scope?: 'personal'; ownerUserId?: string; phase: number; kind?: string }
const convs: Conv[] = []
const conv = (c: Omit<Conv, 'n'>) => { const x = { ...c, n: convs.length }; convs.push(x); return `conv:${x.n}` }

// (1) direct record lookup — 30
for (const o of shuffle(orders.filter((x) => !temporalCust.includes(x.cust))).slice(0, 30)) {
  questions.push({ id: `direct-${questions.length}`, cat: 'direct', asker: 'owner', q: pick([`${o.no} numaralı siparişi hangi müşteri verdi?`, `${o.no} siparişinin müşterisi kim?`]), answer: o.cust.name, evidence: [recRef('shop', `order:${o.no}`)] })
}
// (2) record+conversation join — 80: the question names an order, the answer lives in a WhatsApp message that names only the customer
const joinOrders = shuffle(orders.filter((o) => !temporalCust.includes(o.cust)))
const joinCust = new Set<string>()
let joins = 0
for (const o of joinOrders) {
  if (joins >= 80) break
  if (joinCust.has(o.cust.id)) continue
  joinCust.add(o.cust.id)
  const code = uniq(() => String(int(1000, 9999)))
  const ev = conv({ phase: 0, sourceType: 'chat', content: `WhatsApp — ${o.cust.name}: "Teslimat için site girişindeki kapı kodu ${code}#, kargocu arayınca aşağı inerim."`, ents: [{ name: o.cust.name, type: 'customer' }] })
  questions.push({ id: `join-${questions.length}`, cat: 'join', asker: 'owner', q: pick([`${o.no} siparişini veren müşteri WhatsApp'ta teslimat için hangi kapı kodunu verdi?`, `${o.no} numaralı siparişin müşterisinin kapı kodu ne?`]), answer: code, evidence: [recRef('shop', `order:${o.no}`), ev] })
  joins++
}
// (3) 2-hop — 60: customer → company (customer card) → company tax number (company card)
for (const c of shuffle([...otherCust]).slice(0, 60)) {
  questions.push({ id: `hop2-${questions.length}`, cat: 'multihop2', asker: 'owner', q: pick([`${c.name}'ın çalıştığı firmanın vergi numarası nedir?`, `${c.name} hangi firmada çalışıyor ve o firmanın vergi numarası ne?`]), answer: c.company.taxNo, evidence: [recRef('crm', `customer:${c.id}`), recRef('crm', `company:${c.company.id}`)] })
}
// (4) 3-hop — 40: WhatsApp complaint names an order → that order's invoice → the payment's receipt number
let hop3 = 0
const hop3Cust = new Set<string>()
for (const o of shuffle(orders.filter((x) => x.payment))) {
  if (hop3 >= 40) break
  if (hop3Cust.has(o.cust.id) || joinCust.has(o.cust.id)) continue
  hop3Cust.add(o.cust.id)
  const ev = conv({ phase: 0, sourceType: 'chat', content: `WhatsApp — ${o.cust.name}: "${o.no} siparişimdeki ${o.product.name} kırık geldi, değişim istiyorum."`, ents: [{ name: o.cust.name, type: 'customer' }, { name: o.no, type: 'topic' }] })
  questions.push({ id: `hop3-${questions.length}`, cat: 'multihop3', asker: 'owner', q: `${o.cust.name}'ın WhatsApp'ta kırık geldiğini söylediği siparişin faturası hangi dekont numarasıyla ödendi?`, answer: o.payment!.dk, evidence: [ev, recRef('finance', `invoice:${o.invoice!.no}`), recRef('finance', `payment:${o.payment!.no}`)] })
  hop3++
}
// (5) updates, record — 25: the order's tracking number is corrected by a later sync of the same record
const updOrders = shuffle(orders.filter((o) => o.tracking && !temporalCust.includes(o.cust))).slice(0, 25)
const updates: Array<{ o: Order; v2: string }> = []
for (const o of updOrders) {
  const v2 = uniq(() => `YK-${int(100000, 999999)}`)
  updates.push({ o, v2 })
  questions.push({ id: `updrec-${questions.length}`, cat: 'update_record', asker: 'owner', q: pick([`${o.no} siparişinin güncel kargo takip numarası nedir?`, `${o.no} için son kargo takip numarası ne?`]), answer: v2, stale: o.tracking!, evidence: [recRef('shop', `order:${o.no}`)] })
}
// (6) updates, conversation — 25: the customer says a new phone number later (no LLM judge → nothing supersedes the old fact)
const phoneCust = shuffle(otherCust.filter((c) => !joinCust.has(c.id) && !hop3Cust.has(c.id))).slice(0, 25)
for (const c of phoneCust) {
  const old = uniq(() => `0532 ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`), neu = uniq(() => `0544 ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`)
  conv({ phase: 0, sourceType: 'chat', content: `WhatsApp — ${c.name}: "Telefon numaram ${old}, bana buradan ulaşabilirsiniz."`, ents: [{ name: c.name, type: 'customer' }] })
  const ev = conv({ phase: 1, sourceType: 'chat', content: `WhatsApp — ${c.name}: "Numaram değişti, yeni numaram ${neu}; eskisini artık kullanmıyorum."`, ents: [{ name: c.name, type: 'customer' }] })
  questions.push({ id: `updconv-${questions.length}`, cat: 'update_conversation', asker: 'owner', q: pick([`${c.name}'ın güncel telefon numarası nedir?`, `${c.name}'a hangi numaradan ulaşmalıyız?`]), answer: neu, stale: old, evidence: [ev] })
}
// (7) permissions — 60 questions asked by the SALES member (no finance/invoices/employees read), each about a secret
const hr = staff
for (let i = 0; i < 20; i++) {
  const s = hr[i % hr.length]
  const amount = money(38000, 190000)
  const ev = conv({ phase: 0, sourceType: 'email', moduleCode: 'employees', content: `İK notu: ${s.name}'ın brüt maaşı ${i < 12 ? '2026' : '2025'} için ${amount} olarak belirlendi.`, ents: [{ name: s.name, type: 'person' }] })
  secrets.push({ secret: amount, cls: 'employees-tagged', visibleTo: ['owner'] })
  questions.push({ id: `perm-${questions.length}`, cat: 'permission', asker: 'sales', q: `${s.name}'ın maaşı ne kadar?`, answer: amount, evidence: [ev], secret: true, secretClass: 'employees-tagged' })
}
for (const c of shuffle([...companies]).slice(0, 15)) {
  const limit = money(50000, 2500000)
  const ev = conv({ phase: 0, sourceType: 'email', moduleCode: 'finance', content: `Finans e-postası: ${c.name} için kredi limiti ${limit} olarak onaylandı, ödeme vadesi 60 gün.`, ents: [{ name: c.name, type: 'company' }] })
  secrets.push({ secret: limit, cls: 'finance-tagged', visibleTo: ['owner', 'finance'] })
  questions.push({ id: `perm-${questions.length}`, cat: 'permission', asker: 'sales', q: `${c.name}'ın kredi limiti ne kadar?`, answer: limit, evidence: [ev], secret: true, secretClass: 'finance-tagged' })
}
for (const o of shuffle(invoiced.filter((x) => !x.payment)).slice(0, 15)) {
  questions.push({ id: `perm-${questions.length}`, cat: 'permission', asker: 'sales', q: `${o.invoice!.no} faturasının tutarı ne kadar?`, answer: o.invoice!.amount, evidence: [recRef('finance', `invoice:${o.invoice!.no}`)], secret: true, secretClass: 'finance-record-untagged' })
}
for (let i = 0; i < 10; i++) {
  const s = hr[(i * 5) % hr.length]
  const bonus = money(5000, 60000)
  const ev = conv({ phase: 0, sourceType: 'chat', scope: 'personal', ownerUserId: tenant.users.owner, content: `Kişisel not: ${s.name}'ın bu yılki performans primi ${bonus}, henüz kendisine söylenmedi.`, ents: [{ name: s.name, type: 'person' }] })
  secrets.push({ secret: bonus, cls: 'personal', visibleTo: ['owner'] })
  questions.push({ id: `perm-${questions.length}`, cat: 'permission', asker: 'sales', q: `${s.name}'ın performans primi ne kadar?`, answer: bonus, evidence: [ev], secret: true, secretClass: 'personal' })
}
// (8) noise — ordinary conversations around the same people/orders
const NOISE = [
  (c: any, o: any) => `WhatsApp — ${c.name}: "Merhaba, ${o.product.name} için kullanım kılavuzunu gönderebilir misiniz?"`,
  (c: any) => `WhatsApp — ${c.name}: "Yarın öğleden sonra mağazaya uğrayacağım, ${pick(DISTRICTS)} şubesi açık mı?"`,
  (c: any) => `E-posta — ${c.name} (${c.company.name}): katalog ve güncel fiyat listesi istendi.`,
  (c: any) => `Toplantı notu (${trDate(randDate())}) — ${c.company.rep.name} ile ${c.company.name}: ${int(10, 200)} adet ${pick(products).name} için yıllık talep konuşuldu.`,
  (c: any) => `WhatsApp — ${c.name}: "Kargo ne zaman çıkar? Hafta sonu evde olmayacağım."`,
  (c: any) => `Çağrı notu — ${c.name}, ${pick(STREETS)} No:${int(1, 120)} ${pick(DISTRICTS)} adresine yeni şube açtıklarını söyledi.`,
  (c: any) => `E-posta — ${c.company.name}: ${pick(['e-fatura', 'irsaliye', 'sözleşme taslağı', 'teklif'])} için yetkili kişi ${c.name} olarak güncellendi.`,
]
for (let i = 0; i < 700; i++) {
  const o = pick(orders), c = R() < 0.5 ? o.cust : pick(customers)
  conv({ phase: 0, sourceType: pick(['chat', 'email', 'meeting']), content: pick(NOISE)(c, o), ents: [{ name: c.name, type: 'customer' }, { name: c.company.name, type: 'company' }] })
}

console.log({ records: records.length, convs: convs.length, questions: questions.length, secrets: secrets.length })

// ── ingest through the real write paths (engine role, sequential — the production worker serialises per org) ──
const recStats = emptyStats()
const tRec: number[] = [], tConv: number[] = []
const convIds = new Map<number, string>()
const runConv = async (c: Conv) => {
  const t = performance.now()
  const mem = { content: c.content, kind: (c.kind ?? 'fact') as any, entities: c.ents, importance: 0.6, decayHint: 'permanent', lang: 'tr' }
  const src = { sourceType: c.sourceType, sourceRef: `bb2:${c.sourceType}:${c.n}`, metadata: c.moduleCode ? { moduleCode: c.moduleCode } : {}, scope: c.scope ?? 'org', ownerUserId: c.ownerUserId ?? null }
  const id = await runInOrganization(ORG, async () => commitExtractedMemory(ORG, await prepareExtractedMemory(ORG, mem as any, src), null))
  if (id) convIds.set(c.n, id)
  tConv.push(performance.now() - t)
}
let i = 0
for (const r of records) {
  if (i++ % 500 === 0) { await assertTestDb(sql); console.log('records', i, '/', records.length) }
  const t = performance.now()
  await runInOrganization(ORG, () => storeMappedRecord(ORG, r.slug, r.rec, recStats))
  tRec.push(performance.now() - t)
}
i = 0
for (const c of convs.filter((x) => x.phase === 0)) { if (i++ % 300 === 0) { await assertTestDb(sql); console.log('convs', i) } await runConv(c) }
// phase 1: later facts (record re-sync with corrected tracking, the new phone numbers)
await assertTestDb(sql)
for (const u of updates) {
  const t = performance.now()
  const r = orderRec(u.o, orderContent(u.o, u.v2, 'kargoda (takip numarası düzeltildi)'))
  r.raw.tracking = u.v2
  await runInOrganization(ORG, () => storeMappedRecord(ORG, 'shop', r, recStats))
  tRec.push(performance.now() - t)
}
for (const c of convs.filter((x) => x.phase === 1)) await runConv(c)

// ── resolve evidence keys to memory ids ──
const sync = await sql`select connector_slug, record_ref, memory_id from os.brain_connector_sync where organization_id = ${ORG}`
const recIds = new Map(sync.map((r: any) => [`rec:${r.connector_slug}:${r.record_ref}`, r.memory_id as string]))
const missing: string[] = []
for (const q of questions) {
  ;(q as any).evidenceIds = q.evidence.map((e) => {
    const id = e.startsWith('rec:') ? recIds.get(e) : convIds.get(Number(e.slice(5)))
    if (!id) missing.push(e)
    return id
  })
}
// secret memories (for the per-class leak attribution)
const counts = (await sql`select (select count(*) from os.brain_memories where organization_id = ${ORG})::int memories,
  (select count(*) from os.brain_memories where organization_id = ${ORG} and is_latest)::int latest,
  (select count(*) from os.brain_memories where organization_id = ${ORG} and module_code is not null)::int module_tagged,
  (select count(*) from os.brain_entities where organization_id = ${ORG})::int entities,
  (select count(*) from os.brain_entity_edges where organization_id = ${ORG})::int edges`)[0]
const out = {
  dataset: 'trbiz', createdAt: new Date().toISOString(), tenant, now: NOW.toISOString(),
  counts: { ...counts, records: records.length + updates.length, conversations: convs.length, questions: questions.length, secrets: secrets.length },
  ingest: { recordMs: stats(tRec), convMs: stats(tConv), recStats },
  missingEvidence: missing,
  questions, secrets,
}
saveJson(`${STATE_DIR}/trbiz.json`, out)
console.log(JSON.stringify({ counts: out.counts, ingest: out.ingest, missing: missing.length, byCat: questions.reduce((a: any, q) => ((a[q.cat] = (a[q.cat] || 0) + 1), a), {}) }, null, 1))
await sql.end()
process.exit(0)
