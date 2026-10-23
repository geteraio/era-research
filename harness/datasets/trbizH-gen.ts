// R45 HELD-OUT Turkish business set (trbizH). Written without looking at the R44 lane-A tuning probes.
// Different seed, name/company/city/product pools, ID formats (ISO dates, e-fatura numbers, bare tracking numbers),
// record wording (key · value cards), question phrasing (suffix forms, no-apostrophe, lowercase, word order,
// colloquial, English–Turkish mix) and relation kinds trbizA does not have:
//   person→company (employed_by, 'person' typed contacts), shipment records separate from orders, support tickets
//   assigned to staff (staff card holds the mobile), supplier purchase orders (product→PO→supplier card),
//   framework contracts (person→company→contract), e-mail address changes (old value in the contact card or a chat).
// Same real write paths as trbizA: storeMappedRecord (connector) + prepareExtractedMemory/commitExtractedMemory(judged=null).
// Usage: bun run datasets/trbizH-gen.ts → state/trbizH.json
import { ownerSql, assertTestDb, rng, saveJson, STATE_DIR, REPO, stats } from '../lib/common.ts'
import { createTenant } from '../lib/fixture.ts'
import '../lib/dbshim.ts'

const R = rng(4517093)
const pick = <T>(a: T[]) => a[Math.floor(R() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1))
const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

const sql = ownerSql()
await assertTestDb(sql)
const { runInOrganization } = await import(`${REPO}/packages/db/tenant.ts`)
const { storeMappedRecord, emptyStats } = await import(`${REPO}/apps/brain-agent/src/brain/connector-ingest.ts`)
const { prepareExtractedMemory, commitExtractedMemory } = await import(`${REPO}/apps/brain-agent/src/brain/ingestion.ts`)

const tenant = await createTenant(sql, 'trbizh')
const ORG = tenant.orgId
console.log('tenant', tenant)

// ── vocabulary (disjoint from trbizA's pools where Turkish allows) ──
const FIRST = 'Selim Nazlı Oğuz Berrin Tarık Füsun Levent Neslihan Erkan Yeşim Cengiz Melike Rıza Şebnem Kadir Gülşen İsmail Feride Okan Didem Bülent Sevgi Erdem Canan Recep Özlem Sami Aysel Taylan Bahar Yavuz Filiz Orhan Ayten Hamza Nermin Cihan Sefa Tülin Ercan Hilal Kenan Meltem Adem Songül Ufuk Nihan Nevzat Pelin Mert Begüm Tamer Sena Ertuğrul Ilgın Ferit Zerrin Şükrü Beyza Atilla Gönül Engin Dilek Rahmi Kübra Eray Nazan Sabri Jale Muammer Reyhan'.split(' ')
const LAST = 'Acar Ağaoğlu Akbulut Aktaş Albayrak Altıntaş Arıkan Atalay Babacan Balcı Başaran Bayraktar Berberoğlu Candan Cebeci Çakmak Çiftçi Dağdelen Demirci Dinçer Durmaz Elmas Ergin Esen Gökçe Gönen Günay Gürsoy Hacıoğlu İnce Kahraman Kalaycı Karabulut Kaplan Kartal Kocabaş Kuru Metin Oral Orhon Öncü Özbek Peker Saygın Selçuk Soylu Süer Tan Tatlı Tokgöz Topal Uslu Ünal Vural Yaman Yüksel Zengin Ilıcak Usta Dumlu'.split(' ')
const CO_ROOT = 'Gökada Yıldızlı Sarıkamış Beyaztaş Karaburun Akyaka Çamlıbel Gümüşsu Taşköprü Yeniköy Akçakoca Ortaca Kemerburgaz Bademli Narlıdere Selimiye Kumluca Fethiye Kalkan Assos Hasankeyf Zigana Köprülü Bafa Salda Abant Yedigöller Uzungöl Ayder Hemşin Tortum Ahlat Erciş Harran Zeugma Olimpos Likya Frig Lidya Karia'.split(' ')
const CO_SECTOR = 'Makina Hırdavat Boya İnşaat Denizcilik Döküm Elektronik Kağıt İlaç Danışmanlık Bilişim Optik Isıtma Hidrolik Kalıp Kauçuk Mermer Orman Ambalaj Çelik'.split(' ')
const CO_FORM = ['San. ve Tic. A.Ş.', 'Ltd.', 'Grup', 'Sanayi A.Ş.']
const PRODUCT_BASE = 'Paslanmaz Küresel Vana|Hidrolik Pompa|Vidalı Kompresör|Gazaltı Kaynak Makinesi|Forklift Aküsü|Endüstriyel Fan|Rulman Seti|Kesme Diski|Akıllı Sayaç|LED Projektör|Dizel Jeneratör|Hortum Makarası|Matkap Ucu Seti|Basınç Şalteri|Frekans İnvertörü|Lazer Metre|Tork Anahtarı|Zincirli Vinç|Termal Kamera|Pnömatik Silindir'.split('|')
const MODEL = ['HP', 'TX', 'MX', 'KR', 'ZD', 'PL', 'VN', 'QS']
const CITIES = 'Erzurum Van Malatya Elazığ Sivas Ordu Rize Edirne Çanakkale Aydın Hatay Kahramanmaraş Şanlıurfa Diyarbakır Bolu Düzce Zonguldak Kastamonu Afyonkarahisar Uşak'.split(' ')
const WAREHOUSES = ['Gebze', 'Hadımköy', 'Kemalpaşa', 'Sincan', 'Çorlu']
const CARRIERS = ['Aras Kargo', 'MNG Kargo', 'Sürat Kargo', 'PTT Kargo', 'Horoz Lojistik']
const iso = (d: Date) => d.toISOString().slice(0, 10)
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 9))
const NOW = day(2026, 10, 22) // "geçen ay" / "eylülde" / "last month" = September 2026
const used = new Set<string>()
const uniq = (gen: () => string) => { let s = ''; do { s = gen() } while (used.has(s)); used.add(s); return s }
const money = (lo: number, hi: number) => uniq(() => `${int(lo, hi).toLocaleString('tr-TR')},${String(int(0, 99)).padStart(2, '0')} TL`)
const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join('')
const slugify = (s: string) => s.toLocaleLowerCase('tr').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/[^a-z0-9]+/g, '')
const lowerTr = (s: string) => s.toLocaleLowerCase('tr')
// the genitive suffix a Turkish speaker writes after a name (vowel harmony + buffer n), with or without the apostrophe
function gen(name: string, apostrophe = true): string {
  const last = name.toLocaleLowerCase('tr')
  const vowels = last.match(/[aeıioöuü]/g) ?? ['e']
  const v = vowels[vowels.length - 1]
  const h = ({ a: 'ı', ı: 'ı', e: 'i', i: 'i', o: 'u', u: 'u', ö: 'ü', ü: 'ü' } as Record<string, string>)[v]
  const endsVowel = /[aeıioöuü]$/.test(last)
  return `${name}${apostrophe ? "'" : ''}${endsVowel ? 'n' : ''}${h}n`
}

function dat(name: string): string {
  const l = name.toLocaleLowerCase('tr'); const v = (l.match(/[aeıioöuü]/g) ?? ['e']).pop()!
  return `${name}'${/[aeıioöuü]$/.test(l) ? 'y' : ''}${'aıou'.includes(v) ? 'a' : 'e'}`
}
// ── people, companies, products ──
const nameSet = new Set<string>()
const personName = () => { let n = ''; do { n = `${pick(FIRST)} ${pick(LAST)}` } while (nameSet.has(n)); nameSet.add(n); return n }
const staff = Array.from({ length: 16 }, (_, i) => ({ id: `emp-${i}`, name: personName(), team: i < 8 ? 'satış' : i < 11 ? 'muhasebe' : i < 13 ? 'insan kaynakları' : 'teknik servis', mobile: uniq(() => `0505 ${int(200, 899)} ${int(10, 99)} ${int(10, 99)}`) }))
const managers = staff.slice(0, 3)
const staffMgr = new Map(staff.map((s, i) => [s.id, i < 3 ? null : managers[i % 3]]))
const reps = staff.slice(0, 8), techs = staff.slice(13)
const coNames = shuffle(CO_ROOT.flatMap((a) => CO_SECTOR.map((b) => `${a} ${b}`))).slice(0, 230)
const companies = coNames.map((n, i) => {
  const name = `${n} ${pick(CO_FORM)}`
  return { id: `acc-${i}`, name, vkn: uniq(() => String(int(1000000000, 9999999999))), iban: uniq(() => `TR${int(10, 99)} 00${int(10, 99)} ${digits(4)} ${digits(4)} ${digits(4)} ${digits(4)} ${digits(2)}`), web: uniq(() => `www.${slugify(n)}${int(1, 9)}.com.tr`), city: pick(CITIES), rep: pick(reps) }
})
const products = shuffle(PRODUCT_BASE.flatMap((b) => MODEL.map((m) => `${b} ${m}-${int(10, 99)}0`))).slice(0, 120).map((n, i) => ({ id: `sku-${i}`, name: n }))
const TITLES = ['satınalma müdürü', 'fabrika müdürü', 'mali işler uzmanı', 'kurucu ortak', 'depo şefi', 'proje mühendisi', 'operasyon direktörü']
const contacts = Array.from({ length: 400 }, (_, i) => {
  const name = personName(); const company = pick(companies)
  const local = slugify(name.split(' ')[0]) + '.' + slugify(name.split(' ')[1])
  return { id: `ct-${i}`, name, company, title: pick(TITLES), city: pick(CITIES), email: uniq(() => `${local}${int(1, 99)}@${company.web.replace(/^www\./, '')}`) }
})
const suppliers = Array.from({ length: 40 }, (_, i) => {
  const base = coNames[230 + (i % 10)] ?? `${pick(CO_ROOT)} ${pick(CO_SECTOR)}`
  return { id: `sup-${i}`, name: uniq(() => `${pick(CO_ROOT)} ${pick(['Endüstri', 'Tedarik', 'Teknik', 'Dış Ticaret'])} ${pick(['Ltd.', 'A.Ş.'])}`), contact: personName(), phone: uniq(() => `0${pick(['212', '216', '232', '262', '312'])} ${int(200, 899)} ${int(10, 99)} ${int(10, 99)}`), base }
})

// ── question bookkeeping ──
type Ev = string
interface Q { id: string; cat: string; kind: string; asker: 'owner' | 'sales' | 'finance'; q: string; answer: string; stale?: string; distractor?: string; evidence: Ev[]; secret?: boolean; secretClass?: string }
const questions: Q[] = []
const secrets: Array<{ secret: string; cls: string; visibleTo: string[] }> = []
const addQ = (q: Omit<Q, 'id'>) => questions.push({ ...q, id: `${q.kind}-${questions.length}` })

// ── records ──
type Rec = { slug: string; rec: any }
const records: Rec[] = []
const recRef = (slug: string, ref: string) => `rec:${slug}:${ref}`
for (const c of companies) {
  records.push({ slug: 'crm', rec: {
    recordRef: `account:${c.id}`, primaryKey: 'c',
    memory: { content: `${c.name} · VKN: ${c.vkn} · IBAN: ${c.iban} · Web: ${c.web} · Şehir: ${c.city} · Hesap yöneticisi: ${c.rep.name}`, kind: 'fact', importance: 0.6 },
    nodes: [{ key: 'c', type: 'company', name: c.name, externalRef: `account:${c.id}` }, { key: 'r', type: 'person', name: c.rep.name, externalRef: `emp:${c.rep.id}` }],
    edges: [{ fromKey: 'c', toKey: 'r', relation: 'account_manager' }],
    raw: { vkn: c.vkn, iban: c.iban, web: c.web },
  } })
}
for (const p of contacts) {
  records.push({ slug: 'crm', rec: {
    recordRef: `contact:${p.id}`, primaryKey: 'p',
    memory: { content: `Kişi: ${p.name} — ${p.title}, ${p.company.name}. E-posta ${p.email}, ${p.city}.`, kind: 'fact', importance: 0.6 },
    nodes: [{ key: 'p', type: 'person', name: p.name, externalRef: `contact:${p.id}` }, { key: 'c', type: 'company', name: p.company.name, externalRef: `account:${p.company.id}` }],
    edges: [{ fromKey: 'p', toKey: 'c', relation: 'employed_by' }],
    raw: { email: p.email, title: p.title },
  } })
}
for (const s of staff) {
  const mgr = staffMgr.get(s.id)
  records.push({ slug: 'crm', rec: {
    recordRef: `employee-card:${s.id}`, primaryKey: 's',
    memory: { content: `Ekip kartı: ${s.name} (${s.team})${mgr ? `, bağlı olduğu yönetici ${mgr.name}` : ''}, cep ${s.mobile}.`, kind: 'fact', importance: 0.55 },
    nodes: [{ key: 's', type: 'person', name: s.name, externalRef: `emp:${s.id}` }, ...(mgr ? [{ key: 'm', type: 'person', name: mgr.name, externalRef: `emp:${mgr.id}` }] : [])],
    edges: mgr ? [{ fromKey: 's', toKey: 'm', relation: 'reports_to' }] : [],
    raw: { mobile: s.mobile },
  } })
}

type Order = { no: string; ct: typeof contacts[0]; product: typeof products[0]; qty: number; date: Date; ship?: { no: string; carrier: string; track: string; wh: string }; inv?: { no: string; total: string; due: Date }; pay?: { no: string; ref: string; date: Date } }
const orders: Order[] = []
const addOrder = (ct: typeof contacts[0], product: typeof products[0], date: Date): Order => {
  const o: Order = { no: uniq(() => `S26-${String(int(1, 99999)).padStart(5, '0')}`), ct, product, qty: int(2, 60), date }
  if (R() < 0.75) o.ship = { no: uniq(() => `GN-${int(100000, 999999)}`), carrier: pick(CARRIERS), track: uniq(() => digits(10).replace(/^0/, '7')), wh: pick(WAREHOUSES) }
  orders.push(o); return o
}
const randDate = () => new Date(day(2026, 1, 3).getTime() + Math.floor(R() * (day(2026, 10, 20).getTime() - day(2026, 1, 3).getTime())))
const shuffledCt = shuffle([...contacts])
const temporalCt = shuffledCt.slice(0, 30)
const otherCt = shuffledCt.slice(30)
const tempPairs: Array<{ c: typeof contacts[0]; last: Order; old: Order }> = []
for (const c of temporalCt) {
  const pl = pick(products); let po = pick(products); while (po.id === pl.id) po = pick(products)
  tempPairs.push({ c, last: addOrder(c, pl, day(2026, 9, int(1, 29))), old: addOrder(c, po, day(2026, pick([3, 5, 6, 8]), int(1, 28))) })
}
for (let i = 0; i < 1100; i++) addOrder(pick(otherCt), pick(products), randDate())
const orderContent = (o: Order) => `${o.no} numaralı sipariş · Müşteri: ${o.ct.name} / ${o.ct.company.name} · ${o.qty} x ${o.product.name} · Tarih: ${iso(o.date)} · Durum: ${o.ship ? 'sevk edildi' : 'onay bekliyor'}`
for (const o of orders) records.push({ slug: 'shop', rec: {
  recordRef: `order:${o.no}`, primaryKey: 'o', occurredAt: o.date.toISOString(),
  memory: { content: orderContent(o), kind: 'fact', importance: 0.55 },
  nodes: [{ key: 'o', type: 'order', name: o.no, externalRef: `order:${o.no}` }, { key: 'p', type: 'person', name: o.ct.name, externalRef: `contact:${o.ct.id}` }, { key: 'u', type: 'product', name: o.product.name, externalRef: `sku:${o.product.id}` }],
  edges: [{ fromKey: 'o', toKey: 'p', relation: 'ordered_by' }, { fromKey: 'o', toKey: 'u', relation: 'includes' }],
  raw: { no: o.no },
} })
const shipRec = (o: Order, track: string, note = '') => ({
  recordRef: `shipment:${o.ship!.no}`, primaryKey: 's', occurredAt: new Date(o.date.getTime() + 2 * 86400_000).toISOString(),
  memory: { content: `Sevkiyat ${o.ship!.no} · Sipariş: ${o.no} · Taşıyıcı: ${o.ship!.carrier} · Takip no: ${track} · Çıkış deposu: ${o.ship!.wh}${note}`, kind: 'fact', importance: 0.5 },
  nodes: [{ key: 's', type: 'shipment', name: o.ship!.no, externalRef: `shipment:${o.ship!.no}` }, { key: 'o', type: 'order', name: o.no, externalRef: `order:${o.no}` }],
  edges: [{ fromKey: 's', toKey: 'o', relation: 'ships' }],
  raw: { track },
})
for (const o of orders) if (o.ship) records.push({ slug: 'shop', rec: shipRec(o, o.ship.track) })

const tempSet = new Set(temporalCt.map((c) => c.id))
const invoiced = shuffle(orders.filter((o) => !tempSet.has(o.ct.id))).slice(0, 760)
for (const o of invoiced) {
  const due = new Date(o.date.getTime() + 45 * 86400_000)
  o.inv = { no: uniq(() => `EAR2026${String(int(1, 999999999)).padStart(9, '0')}`), total: money(1200, 650000), due }
  records.push({ slug: 'finance', rec: {
    recordRef: `invoice:${o.inv.no}`, primaryKey: 'i', occurredAt: o.date.toISOString(),
    memory: { content: `e-Fatura ${o.inv.no} · Sipariş ${o.no} · Alıcı: ${o.ct.company.name} · Toplam: ${o.inv.total} (KDV dahil) · Son ödeme: ${iso(due)}`, kind: 'fact', importance: 0.6 },
    nodes: [{ key: 'i', type: 'invoice', name: o.inv.no, externalRef: `invoice:${o.inv.no}` }, { key: 'o', type: 'order', name: o.no, externalRef: `order:${o.no}` }, { key: 'c', type: 'company', name: o.ct.company.name, externalRef: `account:${o.ct.company.id}` }],
    edges: [{ fromKey: 'i', toKey: 'o', relation: 'invoices' }, { fromKey: 'i', toKey: 'c', relation: 'issued_to' }],
    raw: { total: o.inv.total },
  } })
  secrets.push({ secret: o.inv.total, cls: 'finance-record-untagged', visibleTo: ['owner', 'finance'] })
}
for (const o of invoiced.slice(0, 560)) {
  const pd = new Date(o.inv!.due.getTime() - int(0, 30) * 86400_000)
  o.pay = { no: uniq(() => `MKB-${int(1000, 99999)}`), ref: uniq(() => `REF${digits(8)}`), date: pd }
  records.push({ slug: 'finance', rec: {
    recordRef: `payment:${o.pay.no}`, primaryKey: 't', occurredAt: pd.toISOString(),
    memory: { content: `Ödeme kaydı ${o.pay.no}: ${o.inv!.no} numaralı faturaya karşılık ${o.inv!.total} hesaba geçti (${iso(pd)}), banka referansı ${o.pay.ref}.`, kind: 'fact', importance: 0.55 },
    nodes: [{ key: 't', type: 'payment', name: o.pay.no, externalRef: `payment:${o.pay.no}` }, { key: 'i', type: 'invoice', name: o.inv!.no, externalRef: `invoice:${o.inv!.no}` }],
    edges: [{ fromKey: 't', toKey: 'i', relation: 'settles' }],
    raw: { ref: o.pay.ref },
  } })
}
// support tickets → contact + assigned technician/rep
const tickets: Array<{ no: string; ct: typeof contacts[0]; who: typeof staff[0]; topic: string }> = []
for (let i = 0; i < 260; i++) {
  const ct = pick(contacts), who = R() < 0.6 ? pick(techs) : pick(reps)
  const t = { no: uniq(() => `T-${int(10000, 99999)}`), ct, who, topic: pick(['cihaz çalışmıyor', 'yedek parça talebi', 'garanti sorgusu', 'kurulum randevusu', 'fatura itirazı', 'eğitim talebi']) }
  tickets.push(t)
  records.push({ slug: 'inbox', rec: {
    recordRef: `ticket:${t.no}`, primaryKey: 't', occurredAt: randDate().toISOString(),
    memory: { content: `Destek talebi ${t.no} — açan ${ct.name} (${ct.company.name}), konu: ${t.topic}, ilgilenen: ${who.name}, öncelik ${pick(['normal', 'yüksek', 'acil'])}.`, kind: 'fact', importance: 0.5 },
    nodes: [{ key: 't', type: 'ticket', name: t.no, externalRef: `ticket:${t.no}` }, { key: 'p', type: 'person', name: ct.name, externalRef: `contact:${ct.id}` }, { key: 'w', type: 'person', name: who.name, externalRef: `emp:${who.id}` }],
    edges: [{ fromKey: 't', toKey: 'p', relation: 'opened_by' }, { fromKey: 't', toKey: 'w', relation: 'assigned_to' }],
  } })
}
// suppliers + purchase orders (each product bought from exactly one supplier)
for (const s of suppliers) records.push({ slug: 'crm', rec: {
  recordRef: `vendor:${s.id}`, primaryKey: 'v',
  memory: { content: `Tedarikçi ${s.name} — irtibat ${s.contact}, telefon ${s.phone}.`, kind: 'fact', importance: 0.55 },
  nodes: [{ key: 'v', type: 'company', name: s.name, externalRef: `vendor:${s.id}` }],
  edges: [],
  raw: { phone: s.phone },
} })
const productSupplier = new Map(products.map((p) => [p.id, pick(suppliers)]))
for (const p of products) {
  const s = productSupplier.get(p.id)!
  for (let k = 0; k < int(1, 3); k++) {
    const no = uniq(() => `SA-${int(1000, 9999)}`)
    records.push({ slug: 'shop', rec: {
      recordRef: `purchase:${no}`, primaryKey: 'po', occurredAt: randDate().toISOString(),
      memory: { content: `Satınalma ${no}: ${s.name} firmasından ${int(20, 400)} adet ${p.name}, teslim ${iso(randDate())}.`, kind: 'fact', importance: 0.5 },
      nodes: [{ key: 'po', type: 'purchase_order', name: no, externalRef: `purchase:${no}` }, { key: 'v', type: 'company', name: s.name, externalRef: `vendor:${s.id}` }, { key: 'u', type: 'product', name: p.name, externalRef: `sku:${p.id}` }],
      edges: [{ fromKey: 'po', toKey: 'v', relation: 'supplied_by' }, { fromKey: 'po', toKey: 'u', relation: 'includes' }],
    } })
  }
}
// framework contracts (one per company that has one)
const contracted = shuffle([...companies]).slice(0, 120)
const contracts = new Map<string, { no: string; end: string; disc: string }>()
for (const c of contracted) {
  const k = { no: uniq(() => `SZ-26-${int(100, 999)}`), end: uniq(() => iso(day(2027, int(1, 12), int(1, 28)))), disc: `%${int(3, 25)}` }
  contracts.set(c.id, k)
  records.push({ slug: 'crm', rec: {
    recordRef: `contract:${k.no}`, primaryKey: 'k',
    memory: { content: `Çerçeve sözleşme ${k.no} — taraf ${c.name}, iskonto ${k.disc}, ödeme vadesi ${pick([30, 45, 60, 90])} gün, bitiş tarihi ${k.end}.`, kind: 'fact', importance: 0.55 },
    nodes: [{ key: 'k', type: 'contract', name: k.no, externalRef: `contract:${k.no}` }, { key: 'c', type: 'company', name: c.name, externalRef: `account:${c.id}` }],
    edges: [{ fromKey: 'k', toKey: 'c', relation: 'party' }],
  } })
}

// ── conversations ──
type Conv = { n: number; content: string; sourceType: string; ents: Array<{ name: string; type: string }>; moduleCode?: string; scope?: 'personal'; ownerUserId?: string; phase: number }
const convs: Conv[] = []
const conv = (c: Omit<Conv, 'n'>) => { const x = { ...c, n: convs.length }; convs.push(x); return `conv:${x.n}` }
const nm = (c: { name: string }) => (R() < 0.25 ? lowerTr(c.name) : c.name) // people type names in lowercase in chat

// direct — 30
for (const o of shuffle(orders.filter((x) => !tempSet.has(x.ct.id))).slice(0, 30)) {
  addQ({ cat: 'direct', kind: 'direct', asker: 'owner', q: pick([`${o.no} kimin siparişi?`, `Who placed order ${o.no}?`, `${o.no}'yi hangi kişi vermiş`, `sipariş ${o.no} müşteri adı`]), answer: o.ct.name, evidence: [recRef('shop', `order:${o.no}`)] })
}
// join — 60: order → the contact's chat about who receives deliveries
const receiverNames = new Set<string>()
const joinCt = new Set<string>()
for (const o of shuffle(orders.filter((x) => !tempSet.has(x.ct.id)))) {
  if (joinCt.size >= 60) break
  if (joinCt.has(o.ct.id)) continue
  joinCt.add(o.ct.id)
  const rcv = personName()
  receiverNames.add(rcv)
  const content = pick([
    `WA · ${o.ct.name}: "selam, bundan sonra bizim malları ${rcv} teslim alsın, ben sahadayım"`,
    `Mail · ${o.ct.name} (${o.ct.company.name}): Teslimatlarda muhatabınız ${rcv} olacak, lütfen kargocuya iletin.`,
    `Telefon notu — ${o.ct.name} aradı: gelecek sevkiyatları ${rcv} karşılayacakmış.`,
  ])
  const ev = conv({ phase: 0, sourceType: pick(['chat', 'email', 'call']), content, ents: [{ name: o.ct.name, type: 'person' }] })
  addQ({ cat: 'join', kind: 'join_receiver', asker: 'owner', q: pick([`${o.no} siparişini kim teslim alacak?`, `${o.no} için teslim alacak kişi kim, müşteri ne demişti`, `who receives the delivery for ${o.no}?`, `${o.no} nolu siparişte malı karşılayacak kişi`]), answer: rcv, evidence: [recRef('shop', `order:${o.no}`), ev] })
}
// 2-hop — 60: contact → employer card → VKN / IBAN / web
for (const c of shuffle(otherCt.filter((x) => !joinCt.has(x.id))).slice(0, 60)) {
  const attr = pick(['vkn', 'iban', 'web'] as const)
  const answer = c.company[attr]
  const n = nm(c)
  const q = attr === 'vkn'
    ? pick([`${gen(n)} şirketinin VKN'si ne?`, `${gen(n, false)} çalıştığı firmanın vergi kimlik numarası`, `${n} hangi şirkette, onların vergi no su kaç?`, `What is the tax number of ${gen(n)} company?`])
    : attr === 'iban'
      ? pick([`${gen(n)} firmasının IBAN'ı nedir?`, `${gen(n)} şirketine para göndereceğim, IBAN lazım`, `IBAN of the company ${n} works for?`, `${gen(n, false)} işyerinin iban numarası`])
      : pick([`${gen(n)} şirketinin web sitesi ne?`, `${n} nerede çalışıyor, firmanın sitesi?`, `${gen(n)} company website`])
  addQ({ cat: 'multihop2', kind: `hop2_company_${attr}`, asker: 'owner', q, answer, evidence: [recRef('crm', `contact:${c.id}`), recRef('crm', `account:${c.company.id}`)] })
}
// 2-hop — 25: ticket → assigned staff → staff mobile (staff card)
for (const t of shuffle([...tickets]).slice(0, 25)) {
  addQ({ cat: 'multihop2', kind: 'hop2_ticket_staff', asker: 'owner', q: pick([`${t.no} numaralı talebe bakan arkadaşın cep numarası ne?`, `${t.no} ile kim ilgileniyor, cebini ver`, `${t.no} talebindeki sorumlunun telefonu`, `mobile of the person handling ticket ${t.no}`]), answer: t.who.mobile, evidence: [recRef('inbox', `ticket:${t.no}`), recRef('crm', `employee-card:${t.who.id}`)] })
}
// 2-hop — 20: product → purchase order → supplier card phone
for (const p of shuffle([...products]).slice(0, 20)) {
  const s = productSupplier.get(p.id)!
  addQ({ cat: 'multihop2', kind: 'hop2_supplier', asker: 'owner', q: pick([`${p.name} ürününü hangi tedarikçiden alıyoruz, telefonları ne?`, `${p.name} tedarikçisinin telefon numarası`, `who supplies ${p.name}? need their phone`]), answer: s.phone, evidence: [] })
}
// 3-hop — 30: chat complaint → order → invoice → payment bank reference
const hop3Ct = new Set<string>()
for (const o of shuffle(orders.filter((x) => x.pay))) {
  if (hop3Ct.size >= 30) break
  if (hop3Ct.has(o.ct.id) || joinCt.has(o.ct.id)) continue
  hop3Ct.add(o.ct.id)
  const issue = pick(['sızdırıyor', 'eksik geldi', 'yanlış model gönderilmiş', 'çalışmıyor'])
  const ev = conv({ phase: 0, sourceType: pick(['chat', 'email']), content: pick([`WA · ${nm(o.ct)}: "${o.no} ile gelen ${o.product.name} ${issue}, ne yapacağız?"`, `Mail · ${o.ct.name}: ${o.no} siparişimizdeki ürün ${issue}. İade/değişim rica ediyoruz.`]), ents: [{ name: o.ct.name, type: 'person' }, { name: o.no, type: 'topic' }] })
  const n = nm(o.ct)
  addQ({ cat: 'multihop3', kind: 'hop3_complaint_payment', asker: 'owner', q: pick([`${gen(n)} şikayet ettiği siparişin faturası hangi banka referansıyla ödendi?`, `${n} ${issue} dediği siparişin ödemesinin bank ref'i ne`, `bank reference of the payment for the order ${n} complained about`]), answer: o.pay!.ref, evidence: [ev, recRef('finance', `invoice:${o.inv!.no}`), recRef('finance', `payment:${o.pay!.no}`)] })
}
// 3-hop — 25: contact → company → framework contract end date
for (const c of shuffle(otherCt.filter((x) => contracts.has(x.company.id) && !joinCt.has(x.id) && !hop3Ct.has(x.id))).slice(0, 25)) {
  const k = contracts.get(c.company.id)!
  const n = nm(c)
  addQ({ cat: 'multihop3', kind: 'hop3_contract_end', asker: 'owner', q: pick([`${gen(n)} şirketiyle yaptığımız sözleşme ne zaman bitiyor?`, `${n} firmasının çerçeve sözleşmesinin bitiş tarihi`, `when does our contract with ${gen(n)} company end?`]), answer: k.end, evidence: [recRef('crm', `contact:${c.id}`), recRef('crm', `contract:${k.no}`)] })
}
// temporal — 30
for (const t of tempPairs) {
  const n = nm(t.c)
  addQ({ cat: 'temporal', kind: 'temporal_last_month', asker: 'owner', q: pick([`${n} eylülde ne sipariş etti?`, `${gen(n)} geçtiğimiz ayki siparişinde hangi ürün vardı?`, `What did ${n} order last month?`, `geçen ay ${n} ne almıştı`]), answer: t.last.product.name, distractor: t.old.product.name, evidence: [recRef('shop', `order:${t.last.no}`)] })
}
// record update — 20: the shipment's tracking number is corrected by a later re-sync
const updShip = shuffle(orders.filter((o) => o.ship && !tempSet.has(o.ct.id))).slice(0, 20)
const shipUpdates = updShip.map((o) => ({ o, v2: uniq(() => digits(10).replace(/^0/, '8')) }))
for (const u of shipUpdates) addQ({ cat: 'update_record', kind: 'update_shipment_track', asker: 'owner', q: pick([`${u.o.no} kargo takip no güncel hali`, `${u.o.no} siparişinin takip numarası ne oldu?`, `latest tracking number for ${u.o.no}`]), answer: u.v2, stale: u.o.ship!.track, evidence: [recRef('shop', `shipment:${u.o.ship!.no}`)] })
// conversation update — 25: a contact gives a new e-mail later (old value in an earlier chat or only in the contact card)
const mailCt = shuffle(otherCt.filter((c) => !joinCt.has(c.id) && !hop3Ct.has(c.id))).slice(0, 25)
mailCt.forEach((c, i) => {
  const dom = c.company.web.replace(/^www\./, '')
  const neu = uniq(() => `${slugify(c.name.split(' ')[0])}${int(100, 999)}@${pick(['gmail.com', 'outlook.com', dom])}`)
  let old = c.email
  if (i % 2 === 0) {
    old = uniq(() => `${slugify(c.name.split(' ')[1])}.${int(10, 99)}@${pick(['yandex.com', 'hotmail.com'])}`)
    conv({ phase: 0, sourceType: 'chat', content: `WA · ${c.name}: "Teklifleri ${old} adresine atarsanız sevinirim"`, ents: [{ name: c.name, type: 'person' }] })
  }
  const ev = conv({ phase: 1, sourceType: pick(['chat', 'email']), content: pick([`Mail · ${c.name}: Merhaba, e-posta adresim değişti; bundan sonra ${neu} üzerinden yazışalım.`, `WA · ${c.name}: "eski maili kapattım, yenisi ${neu}"`]), ents: [{ name: c.name, type: 'person' }] })
  const n = nm(c)
  addQ({ cat: 'update_conversation', kind: i % 2 === 0 ? 'update_email_chat' : 'update_email_card', asker: 'owner', q: pick([`${gen(n)} güncel mail adresi ne?`, `${dat(n)} hangi adresten mail atalım`, `current email of ${n}?`, `${gen(n, false)} yeni e-postası`]), answer: neu, stale: old, evidence: [ev] })
})
// permissions — 40, asked by the sales member
for (let i = 0; i < 12; i++) {
  const s = staff[(i * 3) % staff.length]
  const amount = money(42000, 210000)
  const ev = conv({ phase: 0, sourceType: 'email', moduleCode: 'employees', content: `Bordro bilgisi: ${s.name} için 2026 aylık brüt ücret ${amount}.`, ents: [{ name: s.name, type: 'person' }] })
  secrets.push({ secret: amount, cls: 'employees-tagged', visibleTo: ['owner'] })
  addQ({ cat: 'permission', kind: 'perm_salary', asker: 'sales', q: pick([`${gen(s.name)} maaşı ne kadar?`, `${s.name} brüt kaç alıyor`]), answer: amount, evidence: [ev], secret: true, secretClass: 'employees-tagged' })
}
for (const c of shuffle([...companies]).slice(0, 10)) {
  const limit = money(80000, 3000000)
  const ev = conv({ phase: 0, sourceType: 'email', moduleCode: 'finance', content: `Muhasebe: ${c.name} için açık hesap risk limiti ${limit} olarak güncellendi.`, ents: [{ name: c.name, type: 'company' }] })
  secrets.push({ secret: limit, cls: 'finance-tagged', visibleTo: ['owner', 'finance'] })
  addQ({ cat: 'permission', kind: 'perm_limit', asker: 'sales', q: `${c.name} risk limiti ne?`, answer: limit, evidence: [ev], secret: true, secretClass: 'finance-tagged' })
}
for (const o of shuffle(invoiced.filter((x) => !x.pay)).slice(0, 10)) {
  addQ({ cat: 'permission', kind: 'perm_invoice', asker: 'sales', q: pick([`${o.inv!.no} faturası ne kadar tuttu?`, `${o.no} siparişinin fatura toplamı`]), answer: o.inv!.total, evidence: [recRef('finance', `invoice:${o.inv!.no}`)], secret: true, secretClass: 'finance-record-untagged' })
}
for (let i = 0; i < 8; i++) {
  const s = staff[(i * 5 + 1) % staff.length]
  const bonus = money(4000, 75000)
  const ev = conv({ phase: 0, sourceType: 'chat', scope: 'personal', ownerUserId: tenant.users.owner, content: `Kendime not: ${s.name} yıl sonu ikramiyesi ${bonus}, şimdilik aramızda.`, ents: [{ name: s.name, type: 'person' }] })
  secrets.push({ secret: bonus, cls: 'personal', visibleTo: ['owner'] })
  addQ({ cat: 'permission', kind: 'perm_personal', asker: 'sales', q: `${gen(s.name)} ikramiyesi ne kadar?`, answer: bonus, evidence: [ev], secret: true, secretClass: 'personal' })
}
// noise
const NOISE = [
  (c: any, o: Order) => `WA · ${nm(c)}: "${o.product.name} için teknik föy var mı? pdf atarsanız süper olur"`,
  (c: any) => `Mail · ${c.name}: Yeni yıl fiyat listesini ve teslim sürelerini paylaşabilir misiniz?`,
  (c: any) => `Toplantı (${iso(randDate())}) — ${c.company.rep.name}, ${c.company.name} ile ${int(5, 150)} adet ${pick(products).name} için bütçe konuştu.`,
  (c: any) => `WA · ${nm(c)}: "kargo bugün çıkar mı? acil lazım"`,
  (c: any) => `Telefon notu — ${c.name}, ${c.city} fabrikası için keşif istedi.`,
  (c: any) => `Mail · ${c.company.name}: irsaliye ve sevk adresi için yetkili ${c.name}.`,
  (c: any, o: Order) => `WA · ${nm(c)}: "${o.no} faturası mail'e düşmedi galiba, tekrar atar mısınız?"`,
]
for (let i = 0; i < 700; i++) {
  const o = pick(orders), c = R() < 0.5 ? o.ct : pick(contacts)
  conv({ phase: 0, sourceType: pick(['chat', 'email', 'meeting', 'call']), content: pick(NOISE)(c, o), ents: [{ name: c.name, type: 'person' }, { name: c.company.name, type: 'company' }] })
}
console.log({ records: records.length, convs: convs.length, questions: questions.length, secrets: secrets.length })

// ── ingest ──
const recStats = emptyStats()
const tRec: number[] = [], tConv: number[] = []
const convIds = new Map<number, string>()
const runConv = async (c: Conv) => {
  const t = performance.now()
  const mem = { content: c.content, kind: 'fact' as any, entities: c.ents, importance: 0.6, decayHint: 'permanent', lang: 'tr' }
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
await assertTestDb(sql)
for (const u of shipUpdates) {
  const t = performance.now()
  await runInOrganization(ORG, () => storeMappedRecord(ORG, 'shop', { ...shipRec(u.o, u.v2, ' · Not: takip numarası taşıyıcı tarafından değiştirildi'), occurredAt: new Date(u.o.date.getTime() + 5 * 86400_000).toISOString() }, recStats))
  tRec.push(performance.now() - t)
}
for (const c of convs.filter((x) => x.phase === 1)) await runConv(c)

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
const counts = (await sql`select (select count(*) from os.brain_memories where organization_id = ${ORG})::int memories,
  (select count(*) from os.brain_memories where organization_id = ${ORG} and is_latest)::int latest,
  (select count(*) from os.brain_memories where organization_id = ${ORG} and module_code is not null)::int module_tagged,
  (select count(*) from os.brain_entities where organization_id = ${ORG})::int entities,
  (select count(*) from os.brain_entity_edges where organization_id = ${ORG})::int edges`)[0]
const out = {
  dataset: 'trbizH', createdAt: new Date().toISOString(), tenant, now: NOW.toISOString(),
  counts: { ...counts, records: records.length + shipUpdates.length, conversations: convs.length, questions: questions.length, secrets: secrets.length },
  ingest: { recordMs: stats(tRec), convMs: stats(tConv), recStats },
  missingEvidence: missing, questions, secrets,
}
saveJson(`${STATE_DIR}/trbizH.json`, out)
console.log(JSON.stringify({ counts: out.counts, missing: missing.length, byKind: questions.reduce((a: any, q) => ((a[q.kind] = (a[q.kind] || 0) + 1), a), {}) }, null, 1))
await sql.end()
process.exit(0)
