import 'dotenv/config'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const app = express()
const port = Number(process.env.PORT ?? 5174)
const rivileUrl = process.env.RIVILE_API_URL ?? 'https://api.manorivile.lt/client/v2'
const maxPageLimit = 5000
const snapshotVersion = 2
const pageLimit = pageLimitValue(process.env.RIVILE_PAGE_LIMIT, 1000)
const productPageLimit = pageLimitValue(process.env.RIVILE_PRODUCT_PAGE_LIMIT, 1000)
const requestDelayMs = Math.max(0, Number(process.env.RIVILE_REQUEST_DELAY_MS ?? 150))
const snapshotTtlMs = Math.max(3_600_000, Number(process.env.WAREHOUSE_SNAPSHOT_TTL_MS ?? 86_400_000))
const serverDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(serverDir, '..', 'data')
const distDir = path.resolve(serverDir, '..', 'dist')
const snapshotPath = path.join(dataDir, 'warehouse-snapshot.json')

function pageLimitValue(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, maxPageLimit)) : fallback
}

type RivileRecord = Record<string, string | undefined>

type ProductInfo = {
  code: string
  name: string
  shortName: string
  group: string
  equipmentType: string
  accountingState: string
  updatedAt: string
}

type StockItem = {
  id: string
  code: string
  name: string
  warehouse: string
  object: string
  series: string
  unit: string
  alternateUnit: string
  quantity: number
  reserved: number
  inTransit: number
  available: number
  value: number
  purchasePrice: number
  barcode: string
  productGroup: string
  equipmentType: string
  accountingState: string
  stockState: 'available' | 'reserved' | 'inTransit' | 'empty'
  updatedAt: string
}

type WarehousePayload = {
  items: StockItem[]
  meta: {
    loadedRows: number
    loadedPages: number
    pageLimit: number
    complete: boolean
    snapshotVersion: number
    generatedAt: string
    cached?: boolean
    stale?: boolean
    syncing?: boolean
    warning?: string
  }
}

const equipmentTypesByGroup: Record<string, string> = {
  '11': 'СХД и дисковые полки',
  '13': 'Корпуса',
  '14': 'Серверные шасси',
  '15': 'Материнские платы',
  '20': 'CPU',
  '21': 'Радиаторы CPU',
  '22': 'Вентиляторы',
  '30': 'RAM',
  '40': 'HDD/SSD',
  '41': 'Салазки и адаптеры дисков',
  '50': 'RAID/NVMe контроллеры',
  '51': 'Удалённое управление',
  '52': 'Сетевые адаптеры',
  '53': 'HBA/FC контроллеры',
  '60': 'PSU',
  '70': 'Рельсы',
  '80': 'Сетевое оборудование',
  '81': 'Кабели и трансиверы',
  '83': 'ОС и лицензии',
  '85': 'Заглушки и аксессуары',
  '86': 'SD/Boot модули',
  '87': 'Серверные платы',
  '88': 'Backplane/Riser/внутренние модули',
  '89': 'GPU',
  '90': 'Прочие комплектующие',
  '91': 'ПК/ноутбуки/PDU',
  '92': 'Периферия',
  '93': 'Лицензионные ключи',
  '94': 'Расходники',
  '95': 'Мониторы',
  '96': 'Упаковка и складские материалы',
  '97': 'Офисное оборудование',
  '99': 'Комплекты',
  '100': 'Серверные базы Dell',
  '101': 'Серверные базы HPE',
  '102': 'Серверные базы Lenovo',
  '9991': 'Доставка и таможня',
  '9992': 'Корректировки',
  '9993': 'Аренда серверов',
  '9994': 'Списание',
  '9995': 'Сборка',
  '9999': 'Услуги',
}

const equipmentTypeRules: Array<{ type: string; patterns: RegExp[] }> = [
  { type: 'CPU', patterns: [/\bcpu\b/i, /\bxeon\b/i, /\bepyc\b/i, /\bopteron\b/i] },
  {
    type: 'Серверные базы',
    patterns: [
      /\bsxd\b/i,
      /\bserver\b/i,
      /\bchassis\b/i,
      /\benclosure\b/i,
      /\b\d{1,2}sff\b/i,
      /\b\d{1,2}lff\b/i,
    ],
  },
  { type: 'RAM', patterns: [/\bram\b/i, /\bmemory\b/i, /\bddr[3-5]\b/i, /\brdimm\b/i, /\blrdimm\b/i] },
  { type: 'SSD/HDD', patterns: [/\bssd\b/i, /\bhdd\b/i, /\bdisk\b/i, /\bsas\b/i, /\bsata\b/i, /\bnvme\b/i] },
  { type: 'RAID/HBA', patterns: [/\braid\b/i, /\bhba\b/i, /\bperc\b/i, /\bsmart array\b/i, /\bcontroller\b/i] },
  { type: 'PSU', patterns: [/\bpsu\b/i, /\bpower supply\b/i, /\b\d{3,4}w\b/i] },
  { type: 'Сеть', patterns: [/\bnic\b/i, /\bethernet\b/i, /\bfiber\b/i, /\bsfp/i, /\bnetwork\b/i, /\b10gbe\b/i] },
  { type: 'Материнские платы', patterns: [/\bmotherboard\b/i, /\bsystem board\b/i, /\bmainboard\b/i] },
  { type: 'GPU', patterns: [/\bgpu\b/i, /\bnvidia\b/i, /\btesla\b/i, /\bquadro\b/i, /\bradeon\b/i] },
  { type: 'Охлаждение', patterns: [/\bfan\b/i, /\bheatsink\b/i, /\bcooling\b/i, /\bcooler\b/i] },
  { type: 'Салазки и рейки', patterns: [/\brail\b/i, /\bcaddy\b/i, /\btray\b/i] },
  { type: 'Кабели', patterns: [/\bcable\b/i, /\bcord\b/i, /\bsff-?\d+/i, /\bmini-?sas\b/i] },
]

function apiKey() {
  if (!process.env.RIVILE_API_KEY) {
    throw new Error('RIVILE_API_KEY is not configured')
  }
  return process.env.RIVILE_API_KEY
}

let productsCache: { expiresAt: number; products: Map<string, ProductInfo> } | null = null
let warehouseLoadPromise: Promise<WarehousePayload> | null = null
let lastRivileRequestAt = 0

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function rivileRequest<T extends RivileRecord>(method: string, params: Record<string, string | number>) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wait = Math.max(0, requestDelayMs - (Date.now() - lastRivileRequestAt))
    if (wait > 0) await sleep(wait)
    lastRivileRequestAt = Date.now()

    const response = await fetch(rivileUrl, {
      method: 'POST',
      headers: {
        ApiKey: apiKey(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ method, params }),
    })

    const text = await response.text()
    let payload: unknown

    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = { errorMessage: text }
    }

    if (response.ok) {
      const rows = (payload as Record<string, T[] | T | undefined>)[method.includes('N17') ? 'N17' : 'I17']
      if (!rows) return []
      return Array.isArray(rows) ? rows : [rows]
    }

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2500 * (attempt + 1))
      continue
    }

    const message =
      typeof payload === 'object' && payload && 'errorMessage' in payload
        ? String((payload as { errorMessage?: string }).errorMessage)
        : `Rivile request failed with ${response.status}`
    throw new Error(message)
  }

  throw new Error('Rivile request failed')
}

function numberValue(value: string | undefined) {
  if (!value) return 0
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function clean(value: string | undefined, fallback = '') {
  return value?.trim() || fallback
}

function accountingStateFromUnit(unit: string) {
  const normalized = unit.toUpperCase()
  if (['KG', 'G', 'T', 'TON', 'L', 'ML', 'M3'].includes(normalized)) return 'Измеряемый'
  if (['VNT', 'PCS', 'ШТ', 'шт'].includes(normalized)) return 'Штучный'
  if (normalized.includes('KOMPL') || normalized.includes('SET')) return 'Комплект'
  return 'Не указан'
}

function equipmentTypeFromProduct(name: string, group: string) {
  const byGroup = equipmentTypesByGroup[group]
  if (byGroup) return byGroup

  const rule = equipmentTypeRules.find(({ patterns }) => patterns.some((pattern) => pattern.test(name)))
  return rule?.type ?? 'Другое'
}

async function loadProductDirectory() {
  if (productsCache && productsCache.expiresAt > Date.now()) {
    return productsCache.products
  }

  const { rows } = await loadPages<RivileRecord>('GET_N17_LIST', { list: 'H' }, productPageLimit)
  const products = new Map<string, ProductInfo>()

  rows.forEach((row) => {
    const code = clean(row.N17_KODAS_PS)
    if (!code) return

    const name = clean(row.N17_PAV, code)
    const shortName = clean(row.N17_MEN_PAV, name)
    const group = clean(row.N17_KODAS_GS)

    products.set(code, {
      code,
      name,
      shortName,
      group: group || 'Без группы',
      equipmentType: equipmentTypeFromProduct(shortName, group),
      accountingState: accountingStateFromUnit(clean(row.N17_KODAS_US)),
      updatedAt: clean(row.N17_R_DATE),
    })
  })

  productsCache = { expiresAt: Date.now() + snapshotTtlMs, products }
  return products
}

function stockState(quantity: number, reserved: number, inTransit: number): StockItem['stockState'] {
  if (quantity > 0 && quantity - reserved > 0) return 'available'
  if (reserved > 0) return 'reserved'
  if (inTransit > 0) return 'inTransit'
  return 'empty'
}

async function loadPages<T extends RivileRecord>(
  method: string,
  params: Record<string, string | number>,
  pages = pageLimit,
) {
  const result: T[] = []
  let loadedPages = 0

  for (let page = 1; page <= pages; page += 1) {
    const rows = await rivileRequest<T>(method, { ...params, pagenumber: page })
    loadedPages = page
    result.push(...rows)
    if (rows.length < 100) {
      return { complete: true, loadedPages, rows: result }
    }
  }

  return { complete: false, loadedPages, rows: result }
}

async function loadWarehousePayload(pages: number): Promise<WarehousePayload> {
  const stockPage = await loadPages<RivileRecord>('GET_I17_LIST', {}, pages)
  const stockRows = stockPage.rows

  const products = await loadProductDirectory()

  const items: StockItem[] = stockRows.map((row) => {
    const code = clean(row.I17_KODAS_PS)
    const product = products.get(code)
    const quantity = numberValue(row.KIEKIS ?? row.I17_KIEKIS ?? row.des_likutis_us)
    const reserved = numberValue(row.I17_REZERVAS)
    const inTransit = numberValue(row.I17_KELYJE)
    const unit = clean(row.I17_KODAS_US, clean(row.I17_KODAS_US_A, '-'))
    const warehouse = clean(row.I17_KODAS_IS, 'Без склада')
    const object = clean(row.I17_KODAS_OS, 'Без объекта')
    const series = clean(row.I17_SERIJA, 'Без серии')

    return {
      id: `${code}-${warehouse}-${object}-${series}-${unit}`,
      code,
      name: product?.shortName || product?.name || code,
      warehouse,
      object,
      series,
      unit,
      alternateUnit: clean(row.I17_KODAS_US_A, unit),
      quantity,
      reserved,
      inTransit,
      available: quantity - reserved,
      value: numberValue(row.I17_SUMA),
      purchasePrice: numberValue(row.I17_P_PIR_K),
      barcode: clean(row.N37_BAR_KODAS),
      productGroup: product?.group ?? 'Без группы',
      equipmentType: product?.equipmentType ?? equipmentTypeFromProduct(product?.name ?? code, product?.group ?? ''),
      accountingState: product?.accountingState ?? accountingStateFromUnit(unit),
      stockState: stockState(quantity, reserved, inTransit),
      updatedAt: product?.updatedAt ?? '',
    }
  })

  return {
    items,
    meta: {
      loadedRows: items.length,
      loadedPages: stockPage.loadedPages,
      pageLimit,
      complete: stockPage.complete,
      snapshotVersion,
      generatedAt: new Date().toISOString(),
    },
  }
}

async function readSnapshot() {
  try {
    const file = await readFile(snapshotPath, 'utf8')
    return JSON.parse(file) as WarehousePayload
  } catch {
    return null
  }
}

async function writeSnapshot(payload: WarehousePayload) {
  await mkdir(dataDir, { recursive: true })
  const tempPath = `${snapshotPath}.tmp`
  await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tempPath, snapshotPath)
}

function isSnapshotFresh(payload: WarehousePayload) {
  const generatedAt = new Date(payload.meta.generatedAt).getTime()
  return isSnapshotCompatible(payload) && Number.isFinite(generatedAt) && Date.now() - generatedAt < snapshotTtlMs
}

function isSnapshotCompatible(payload: WarehousePayload) {
  return payload.meta.snapshotVersion === snapshotVersion
}

function startWarehouseSync(pages: number) {
  warehouseLoadPromise ??= loadWarehousePayload(pages)
    .then(async (payload) => {
      await writeSnapshot(payload)
      return payload
    })
    .finally(() => {
      warehouseLoadPromise = null
    })

  return warehouseLoadPromise
}

app.get('/api/warehouse', async (req, res) => {
  try {
    const pages = pageLimitValue(String(req.query.pages ?? pageLimit), pageLimit)
    const forceRefresh = req.query.refresh === '1'
    const snapshot = await readSnapshot()

    if (snapshot && !forceRefresh && isSnapshotFresh(snapshot)) {
      res.json({
        ...snapshot,
        meta: { ...snapshot.meta, cached: true },
      })
      return
    }

    if (snapshot && !forceRefresh && isSnapshotCompatible(snapshot)) {
      void startWarehouseSync(pages).catch((error) => {
        console.error('Warehouse background sync failed:', error)
      })
      res.json({
        ...snapshot,
        meta: { ...snapshot.meta, stale: true, syncing: Boolean(warehouseLoadPromise) },
      })
      return
    }

    const payload = await startWarehouseSync(pages)
    res.json(payload)
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unknown warehouse API error',
    })
  }
})

app.get('/api/health', async (_req, res) => {
  const snapshot = await readSnapshot()

  res.json({
    ok: true,
    snapshot: snapshot
      ? {
          fresh: isSnapshotFresh(snapshot),
          complete: snapshot.meta.complete,
          compatible: isSnapshotCompatible(snapshot),
          generatedAt: snapshot.meta.generatedAt,
          rows: snapshot.items.length,
        }
      : null,
  })
})

if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(distDir, 'index.html'))
      return
    }

    next()
  })
}

app.listen(port, () => {
  console.log(`Warehouse app listening on http://localhost:${port}`)
})
