import 'dotenv/config'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createSign } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const app = express()
const port = Number(process.env.PORT ?? 5174)
const rivileUrl = process.env.RIVILE_API_URL ?? 'https://api.manorivile.lt/client/v2'
const maxPageLimit = 5000
const snapshotVersion = 3
const priceSnapshotVersion = 1
const foreignStockSnapshotVersion = 2
const pageLimit = pageLimitValue(process.env.RIVILE_PAGE_LIMIT, 1000)
const productPageLimit = pageLimitValue(process.env.RIVILE_PRODUCT_PAGE_LIMIT, 1000)
const requestDelayMs = Math.max(0, Number(process.env.RIVILE_REQUEST_DELAY_MS ?? 150))
const snapshotTtlMs = Math.max(3_600_000, Number(process.env.WAREHOUSE_SNAPSHOT_TTL_MS ?? 86_400_000))
const priceSnapshotTtlMs = Math.max(3_600_000, Number(process.env.PRICE_SNAPSHOT_TTL_MS ?? snapshotTtlMs))
const foreignStockSnapshotTtlMs = Math.max(3_600_000, Number(process.env.FOREIGN_STOCK_SNAPSHOT_TTL_MS ?? 86_400_000))
const foreignStockDeliveryBusinessDays = Math.max(1, Number(process.env.FOREIGN_STOCK_DELIVERY_BUSINESS_DAYS ?? 10))
const foreignStockStaleDays = Math.max(1, Number(process.env.FOREIGN_STOCK_STALE_DAYS ?? 5))
const foreignStockSyncHour = Math.max(0, Math.min(Number(process.env.FOREIGN_STOCK_SYNC_HOUR ?? 3), 23))
const foreignStockCurrency = process.env.FOREIGN_STOCK_CURRENCY ?? 'EUR'
const foreignStockSourceTimeoutMs = Math.max(5_000, Number(process.env.FOREIGN_STOCK_SOURCE_TIMEOUT_MS ?? 30_000))
const priceSheetId = process.env.PRICE_SHEET_ID ?? '14j4GfREVs4ZOj9UrDsY6EzGXOUz5KTJlQf9qwkHFq84'
const priceSheetGid = process.env.PRICE_SHEET_GID ?? '1211767849'
const priceSheetName = process.env.PRICE_SHEET_NAME ?? 'SUPERBASE'
const priceSheetCurrency = process.env.PRICE_SHEET_CURRENCY ?? 'EUR'
const serverDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(serverDir, '..', 'data')
const distDir = path.resolve(serverDir, '..', 'dist')
const snapshotPath = path.join(dataDir, 'warehouse-snapshot.json')
const priceSnapshotPath = path.join(dataDir, 'price-snapshot.json')
const foreignStockSnapshotPath = path.join(dataDir, 'foreign-stock-snapshot.json')

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
  sheetPrice: number
  sheetPriceCurrency: string
  sheetPriceMatch: 'code' | 'name' | 'none'
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
    priceCached?: boolean
    priceComplete?: boolean
    priceGeneratedAt?: string
    priceMatched?: number
    priceRows?: number
    priceStale?: boolean
    priceSyncing?: boolean
    priceWarning?: string
  }
}

type PriceRecord = {
  code: string
  currency: string
  name: string
  price: number
  sourceRow: number
}

type PricePayload = {
  records: PriceRecord[]
  meta: {
    complete: boolean
    generatedAt: string
    priceSnapshotVersion: number
    rows: number
    sheetId: string
    sheetName: string
    warning?: string
  }
}

type ForeignStockItem = {
  id: string
  code: string
  category: string
  name: string
  brand: string
  supplier: string
  available: number
  quantityKnown: boolean
  price: number
  currency: string
  priceType: string
  priceTrend: 'down' | 'new' | 'same' | 'up'
  sourcePrice: string
  updatedAt: string
  ageDays: number
  possiblyStale: boolean
  deliveryBusinessDays: number
}

type ForeignStockPayload = {
  items: ForeignStockItem[]
  meta: {
    complete: boolean
    deliveryBusinessDays: number
    foreignStockSnapshotVersion: number
    generatedAt: string
    rows: number
    staleDays: number
    cached?: boolean
    source?: string
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
let priceLoadPromise: Promise<PricePayload> | null = null
let foreignStockLoadPromise: Promise<ForeignStockPayload> | null = null
let lastRivileRequestAt = 0

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function rivileRequest<T extends RivileRecord>(method: string, params: Record<string, string | number>) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wait = Math.max(0, requestDelayMs - (Date.now() - lastRivileRequestAt))
    if (wait > 0) await sleep(wait)
    lastRivileRequestAt = Date.now()

    let response: Awaited<ReturnType<typeof fetch>>

    try {
      response = await fetch(rivileUrl, {
        method: 'POST',
        headers: {
          ApiKey: apiKey(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ method, params }),
      })
    } catch (error) {
      if (attempt < 3) {
        await sleep(2500 * (attempt + 1))
        continue
      }

      throw error
    }

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

function moneyValue(value: string | undefined) {
  if (!value) return 0
  let normalized = value.replace(/[^\d,.-]/g, '').trim()
  if (!normalized) return 0

  const lastComma = normalized.lastIndexOf(',')
  const lastDot = normalized.lastIndexOf('.')

  if (lastComma > -1 && lastDot > -1) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.'
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
    normalized = normalized.replaceAll(thousandsSeparator, '')
    if (decimalSeparator === ',') normalized = normalized.replace(',', '.')
  } else if (lastComma > -1) {
    normalized = normalized.replace(',', '.')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function clean(value: string | undefined, fallback = '') {
  return value?.trim() || fallback
}

function normalizeLookup(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

function textValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function dateValue(value: string | undefined) {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''

  const dotMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (dotMatch) {
    const [, day, month, year] = dotMatch
    const fullYear = Number(year.length === 2 ? `20${year}` : year)
    const parsed = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)))
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
  }

  const direct = new Date(trimmed)
  if (Number.isFinite(direct.getTime())) return direct.toISOString()

  const excelSerial = Number(trimmed)
  if (Number.isFinite(excelSerial) && excelSerial > 20_000 && excelSerial < 80_000) {
    const parsed = new Date(Date.UTC(1899, 11, 30) + excelSerial * 86_400_000)
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
  }

  return ''
}

function daysSince(isoDate: string) {
  const time = new Date(isoDate).getTime()
  if (!Number.isFinite(time)) return 0
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000))
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

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(field)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      field = ''
      continue
    }

    field += char
  }

  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

function objectRowsFromCsv(text: string) {
  const [headers = [], ...rows] = parseCsv(text)
  return rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [clean(header), clean(row[index])])),
  ) as Record<string, string>[]
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function textFromHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function currencyFromText(value: string) {
  if (/\bEUR\b|€/.test(value)) return 'EUR'
  if (/\bGBP\b|£/.test(value)) return 'GBP'
  if (/\bUSD\b|\$/.test(value)) return 'USD'
  return foreignStockCurrency
}

function normalizedForeignCode(value: string) {
  return value === '-' || value === '—' ? '' : value
}

function priceTrendFromClass(value: string): ForeignStockItem['priceTrend'] {
  if (/\bprice-down\b/.test(value)) return 'down'
  if (/\bprice-up\b/.test(value)) return 'up'
  if (/\bprice-new\b/.test(value)) return 'new'
  return 'same'
}

function objectRowsFromTelegramPriceHtml(text: string) {
  const rows: Record<string, string>[] = []
  const sectionPattern =
    /<div class="category-section" data-category="([^"]+)">([\s\S]*?)(?=<div class="category-section" data-category=|<script|$)/g

  for (const sectionMatch of text.matchAll(sectionPattern)) {
    const category = decodeHtml(sectionMatch[1]).trim()
    const sectionHtml = sectionMatch[2]
    const rowPattern = /<tr([^>]*)>([\s\S]*?)<\/tr>/g
    let isHeader = true

    for (const rowMatch of sectionHtml.matchAll(rowPattern)) {
      if (isHeader) {
        isHeader = false
        continue
      }

      const cells = [...rowMatch[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => textFromHtml(cell[1]))
      if (cells.length < 7) continue

      const sourcePrice = cells[5] && !/^[-—]+$/.test(cells[5]) ? cells[5] : cells[3]
      const price = moneyValue(sourcePrice)
      if (price <= 0) continue

      rows.push({
        Brand: '',
        Category: category,
        Code: normalizedForeignCode(cells[1]),
        Currency: currencyFromText(`${cells[3]} ${cells[5]}`),
        Date: cells[6],
        Name: cells[2],
        Price: String(price),
        PriceTrend: priceTrendFromClass(rowMatch[1]),
        PriceType: cells[4],
        SourcePrice: sourcePrice,
      })
    }
  }

  return rows
}

function resolveColumn(headers: string[], override: string | undefined, patterns: RegExp[]) {
  if (override) {
    const numeric = Number(override)
    if (Number.isInteger(numeric) && numeric >= 0 && numeric < headers.length) return numeric
    const normalizedOverride = normalizeLookup(override)
    const overrideIndex = headers.findIndex((header) => normalizeLookup(header) === normalizedOverride)
    if (overrideIndex > -1) return overrideIndex
  }

  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)))
}

function resolveObjectKey(row: Record<string, unknown>, override: string | undefined, patterns: RegExp[]) {
  const keys = Object.keys(row)
  const index = resolveColumn(keys, override, patterns)
  return index > -1 ? keys[index] : ''
}

function foreignStockSourceLabel() {
  if (process.env.FOREIGN_STOCK_SOURCE_URL) return process.env.FOREIGN_STOCK_SOURCE_URL
  if (process.env.FOREIGN_STOCK_SOURCE_PATH) return process.env.FOREIGN_STOCK_SOURCE_PATH
  return ''
}

function foreignStockSourceHeaders() {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/csv, text/html;q=0.9, */*;q=0.8',
  }
  const token = process.env.FOREIGN_STOCK_SOURCE_TOKEN?.trim()
  const authHeader = process.env.FOREIGN_STOCK_SOURCE_AUTH_HEADER?.trim() || 'Authorization'

  if (token) {
    headers[authHeader] = authHeader.toLowerCase() === 'authorization' && !/^(bearer|basic)\s+/i.test(token) ? `Bearer ${token}` : token
  }

  const extraHeaders = process.env.FOREIGN_STOCK_SOURCE_HEADERS_JSON
  if (extraHeaders) {
    const parsed = JSON.parse(extraHeaders) as Record<string, unknown>
    Object.entries(parsed).forEach(([key, value]) => {
      if (typeof value === 'string' && key.trim()) headers[key] = value
    })
  }

  return headers
}

async function fetchTextWithTimeout(url: string, timeoutMs: number, headers: Record<string, string>) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Foreign stock source request failed with ${response.status}`)
    return text
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Foreign stock source request timed out after ${timeoutMs} ms`, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function loadForeignStockSourceRows() {
  const sourceUrl = process.env.FOREIGN_STOCK_SOURCE_URL
  const sourcePath = process.env.FOREIGN_STOCK_SOURCE_PATH
  if (!sourceUrl && !sourcePath) {
    throw new Error('Foreign stock source is not configured. Set FOREIGN_STOCK_SOURCE_URL or FOREIGN_STOCK_SOURCE_PATH.')
  }

  const content = sourceUrl
    ? await fetchTextWithTimeout(sourceUrl, foreignStockSourceTimeoutMs, foreignStockSourceHeaders())
    : await readFile(path.resolve(sourcePath as string), 'utf8')

  const trimmed = content.trim()
  if (!trimmed) return []

  if (/<div class="category-section"\s+data-category=/i.test(trimmed)) {
    return objectRowsFromTelegramPriceHtml(content)
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const payload = JSON.parse(trimmed) as unknown
    if (Array.isArray(payload)) return payload as Record<string, unknown>[]
    if (payload && typeof payload === 'object') {
      const objectPayload = payload as { data?: unknown; items?: unknown; records?: unknown }
      const rows = objectPayload.items ?? objectPayload.records ?? objectPayload.data
      if (Array.isArray(rows)) return rows as Record<string, unknown>[]
    }
    throw new Error('Foreign stock JSON source must be an array or contain items/data/records array.')
  }

  return objectRowsFromCsv(content)
}

function foreignStockItemsFromRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row, index) => {
      const codeKey = resolveObjectKey(row, process.env.FOREIGN_STOCK_CODE_COLUMN, [
        /^(code|sku|item\s*code)$/i,
        /(rivil|kodas|код|артикул|article|part\s*number|p\/n|pn)/i,
      ])
      const nameKey = resolveObjectKey(row, process.env.FOREIGN_STOCK_NAME_COLUMN, [
        /(name|description|component|model|наименование|название|описание|товар|компонент)/i,
      ])
      const brandKey = resolveObjectKey(row, process.env.FOREIGN_STOCK_BRAND_COLUMN, [/(brand|vendor|manufacturer|бренд|производитель)/i])
      const supplierKey = resolveObjectKey(row, process.env.FOREIGN_STOCK_SUPPLIER_COLUMN, [/(supplier|поставщик|vendor|seller)/i])
      const qtyKey = resolveObjectKey(row, process.env.FOREIGN_STOCK_QTY_COLUMN, [/(qty|quantity|stock|available|остат|кол-?во|количество)/i])
      const priceKey = resolveObjectKey(row, process.env.FOREIGN_STOCK_PRICE_COLUMN, [
        /^(price|цена|kaina)$/i,
        /(price|цена|kaina|eur|€|usd|\$|sale|sell|retail|offer)/i,
      ])
      const currencyKey = resolveObjectKey(row, process.env.FOREIGN_STOCK_CURRENCY_COLUMN, [/(currency|валюта|ccy)/i])
      const dateKey = resolveObjectKey(row, process.env.FOREIGN_STOCK_DATE_COLUMN, [
        /(date|updated|update|актуал|обнов|дата)/i,
      ])

      const code = textValue(row[codeKey])
      const name = textValue(row[nameKey])
      const category = textValue(row.Category) || textValue(row.category) || textValue(row.Section) || textValue(row.section) || 'Other'
      const price = moneyValue(textValue(row[priceKey]))
      if ((!code && !name) || price <= 0) return null

      const updatedAt = dateValue(textValue(row[dateKey])) || new Date().toISOString()
      const ageDays = daysSince(updatedAt)
      const brand = textValue(row[brandKey])
      const supplier = textValue(row[supplierKey])
      const rawQuantity = numberValue(textValue(row[qtyKey]))
      const quantityKnown = Boolean(qtyKey && rawQuantity > 0)
      const available = quantityKnown ? rawQuantity : 1
      const rawPriceTrend = textValue(row.PriceTrend) || textValue(row.priceTrend)
      const priceTrend = rawPriceTrend === 'down' || rawPriceTrend === 'new' || rawPriceTrend === 'up' ? rawPriceTrend : 'same'

      return {
        id: `${category}-${code || normalizeLookup(name)}-${index + 1}`,
        code,
        category,
        name: name || code,
        brand,
        supplier,
        available,
        quantityKnown,
        price,
        currency: textValue(row[currencyKey]) || foreignStockCurrency,
        priceType: textValue(row.PriceType) || textValue(row.priceType),
        priceTrend,
        sourcePrice: textValue(row.SourcePrice) || textValue(row.sourcePrice),
        updatedAt,
        ageDays,
        possiblyStale: ageDays > foreignStockStaleDays,
        deliveryBusinessDays: foreignStockDeliveryBusinessDays,
      } satisfies ForeignStockItem
    })
    .filter((item): item is ForeignStockItem => Boolean(item))
}

async function loadForeignStockPayload(): Promise<ForeignStockPayload> {
  const rows = await loadForeignStockSourceRows()
  const items = foreignStockItemsFromRows(rows)

  return {
    items,
    meta: {
      complete: true,
      deliveryBusinessDays: foreignStockDeliveryBusinessDays,
      foreignStockSnapshotVersion,
      generatedAt: new Date().toISOString(),
      rows: items.length,
      source: foreignStockSourceLabel(),
      staleDays: foreignStockStaleDays,
    },
  }
}

function priceRecordsFromRows(rows: string[][]) {
  const [headerRow, ...bodyRows] = rows
  if (!headerRow) throw new Error('Price sheet is empty')

  const headers = headerRow.map((header) => clean(header))
  const codeIndex = resolveColumn(headers, process.env.PRICE_SHEET_CODE_COLUMN, [
    /^(code|sku|item\s*code)$/i,
    /(rivil|kodas|код|артикул|article|part\s*number|p\/n|pn)/i,
  ])
  const nameIndex = resolveColumn(headers, process.env.PRICE_SHEET_NAME_COLUMN, [
    /(name|description|component|model|pavadinimas|наименование|название|описание|товар|компонент)/i,
  ])
  const priceIndex = resolveColumn(headers, process.env.PRICE_SHEET_PRICE_COLUMN, [
    /^(price|цена|kaina)$/i,
    /(price|цена|kaina|eur|€|usd|\$|superbase|sale|sell|retail)/i,
  ])

  if (priceIndex < 0) {
    throw new Error(`Price column was not found in ${priceSheetName}. Set PRICE_SHEET_PRICE_COLUMN in .env.`)
  }

  const records: PriceRecord[] = []

  bodyRows.forEach((row, index) => {
    const code = codeIndex > -1 ? clean(row[codeIndex]) : ''
    const name = nameIndex > -1 ? clean(row[nameIndex]) : ''
    const price = moneyValue(row[priceIndex])
    if ((!code && !name) || price <= 0) return

    records.push({
      code,
      currency: priceSheetCurrency,
      name,
      price,
      sourceRow: index + 2,
    })
  })

  return records
}

async function googleServiceAccountToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !privateKey) return ''

  const now = Math.floor(Date.now() / 1000)
  const claim = {
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  }
  const header = { alg: 'RS256', typ: 'JWT' }
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const signature = signer.sign(privateKey)

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      assertion: `${signingInput}.${base64Url(signature)}`,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    }),
  })

  const payload = (await response.json()) as { access_token?: string; error_description?: string }
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || 'Google service account authentication failed')
  }

  return payload.access_token
}

async function loadGoogleSheetRows() {
  const accessToken = await googleServiceAccountToken()
  if (accessToken) {
    const range = encodeURIComponent(priceSheetName)
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${priceSheetId}/values/${range}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const payload = (await response.json()) as { values?: string[][]; error?: { message?: string } }
    if (!response.ok || !payload.values) {
      throw new Error(payload.error?.message || 'Google Sheets API request failed')
    }
    return payload.values
  }

  const csvUrl =
    process.env.PRICE_SHEET_CSV_URL ||
    `https://docs.google.com/spreadsheets/d/${priceSheetId}/export?format=csv&gid=${priceSheetGid}`
  const response = await fetch(csvUrl, { redirect: 'follow' })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`Price sheet CSV request failed with ${response.status}`)
  }

  if (response.url.includes('accounts.google.com') || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) {
    throw new Error('Price sheet is not publicly readable. Share it with a Google service account or publish CSV export.')
  }

  return parseCsv(text)
}

async function loadPricePayload(): Promise<PricePayload> {
  const rows = await loadGoogleSheetRows()
  const records = priceRecordsFromRows(rows)

  return {
    records,
    meta: {
      complete: true,
      generatedAt: new Date().toISOString(),
      priceSnapshotVersion,
      rows: records.length,
      sheetId: priceSheetId,
      sheetName: priceSheetName,
    },
  }
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
      sheetPrice: 0,
      sheetPriceCurrency: priceSheetCurrency,
      sheetPriceMatch: 'none',
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

async function readPriceSnapshot() {
  try {
    const file = await readFile(priceSnapshotPath, 'utf8')
    return JSON.parse(file) as PricePayload
  } catch {
    return null
  }
}

async function readForeignStockSnapshot() {
  try {
    const file = await readFile(foreignStockSnapshotPath, 'utf8')
    return JSON.parse(file) as ForeignStockPayload
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

async function writePriceSnapshot(payload: PricePayload) {
  await mkdir(dataDir, { recursive: true })
  const tempPath = `${priceSnapshotPath}.tmp`
  await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tempPath, priceSnapshotPath)
}

async function writeForeignStockSnapshot(payload: ForeignStockPayload) {
  await mkdir(dataDir, { recursive: true })
  const tempPath = `${foreignStockSnapshotPath}.tmp`
  await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tempPath, foreignStockSnapshotPath)
}

function isSnapshotFresh(payload: WarehousePayload) {
  const generatedAt = new Date(payload.meta.generatedAt).getTime()
  return isSnapshotCompatible(payload) && Number.isFinite(generatedAt) && Date.now() - generatedAt < snapshotTtlMs
}

function isSnapshotCompatible(payload: WarehousePayload) {
  return payload.meta.snapshotVersion === snapshotVersion
}

function isPriceSnapshotFresh(payload: PricePayload) {
  const generatedAt = new Date(payload.meta.generatedAt).getTime()
  return isPriceSnapshotCompatible(payload) && Number.isFinite(generatedAt) && Date.now() - generatedAt < priceSnapshotTtlMs
}

function isPriceSnapshotCompatible(payload: PricePayload) {
  return payload.meta.priceSnapshotVersion === priceSnapshotVersion
}

function isForeignStockSnapshotFresh(payload: ForeignStockPayload) {
  const generatedAt = new Date(payload.meta.generatedAt).getTime()
  return (
    isForeignStockSnapshotCompatible(payload) &&
    Number.isFinite(generatedAt) &&
    Date.now() - generatedAt < foreignStockSnapshotTtlMs
  )
}

function isForeignStockSnapshotCompatible(payload: ForeignStockPayload) {
  return payload.meta.foreignStockSnapshotVersion === foreignStockSnapshotVersion
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

function startPriceSync() {
  priceLoadPromise ??= loadPricePayload()
    .then(async (payload) => {
      await writePriceSnapshot(payload)
      return payload
    })
    .finally(() => {
      priceLoadPromise = null
    })

  return priceLoadPromise
}

function startForeignStockSync() {
  foreignStockLoadPromise ??= loadForeignStockPayload()
    .then(async (payload) => {
      await writeForeignStockSnapshot(payload)
      return payload
    })
    .finally(() => {
      foreignStockLoadPromise = null
    })

  return foreignStockLoadPromise
}

function emptyForeignStockPayload(warning: string): ForeignStockPayload {
  return {
    items: [],
    meta: {
      complete: false,
      deliveryBusinessDays: foreignStockDeliveryBusinessDays,
      foreignStockSnapshotVersion,
      generatedAt: new Date().toISOString(),
      rows: 0,
      staleDays: foreignStockStaleDays,
      warning,
    },
  }
}

function mergePriceData(payload: WarehousePayload, pricePayload: PricePayload | null, meta: Partial<WarehousePayload['meta']> = {}) {
  if (!pricePayload) {
    return {
      ...payload,
      items: payload.items.map((item) => ({
        ...item,
        sheetPrice: 0,
        sheetPriceCurrency: priceSheetCurrency,
        sheetPriceMatch: 'none' as const,
      })),
      meta: { ...payload.meta, ...meta },
    }
  }

  const codePrices = new Map<string, PriceRecord>()
  const namePrices = new Map<string, PriceRecord>()
  pricePayload.records.forEach((record) => {
    if (record.code) codePrices.set(normalizeLookup(record.code), record)
    if (record.name) namePrices.set(normalizeLookup(record.name), record)
  })

  let matched = 0
  const items = payload.items.map((item) => {
    const codeMatch = codePrices.get(normalizeLookup(item.code))
    const nameMatch = namePrices.get(normalizeLookup(item.name))
    const record = codeMatch ?? nameMatch
    if (record) matched += 1

    return {
      ...item,
      sheetPrice: record?.price ?? 0,
      sheetPriceCurrency: record?.currency ?? priceSheetCurrency,
      sheetPriceMatch: record ? (codeMatch ? 'code' : 'name') : 'none',
    }
  })

  return {
    ...payload,
    items,
    meta: {
      ...payload.meta,
      priceComplete: pricePayload.meta.complete,
      priceGeneratedAt: pricePayload.meta.generatedAt,
      priceMatched: matched,
      priceRows: pricePayload.meta.rows,
      ...meta,
    },
  }
}

async function withPriceData(payload: WarehousePayload, forceRefresh: boolean) {
  try {
    const snapshot = await readPriceSnapshot()

    if (snapshot && !forceRefresh && isPriceSnapshotFresh(snapshot)) {
      return mergePriceData(payload, snapshot, { priceCached: true })
    }

    if (snapshot && !forceRefresh && isPriceSnapshotCompatible(snapshot)) {
      void startPriceSync().catch((error) => {
        console.error('Price background sync failed:', error)
      })
      return mergePriceData(payload, snapshot, { priceStale: true, priceSyncing: Boolean(priceLoadPromise) })
    }

    const pricePayload = await startPriceSync()
    return mergePriceData(payload, pricePayload)
  } catch (error) {
    return mergePriceData(payload, null, {
      priceWarning: error instanceof Error ? error.message : 'Unknown price sheet error',
    })
  }
}

app.get('/api/warehouse', async (req, res) => {
  try {
    const pages = pageLimitValue(String(req.query.pages ?? pageLimit), pageLimit)
    const forceRefresh = req.query.refresh === '1'
    const snapshot = await readSnapshot()

    if (snapshot && !forceRefresh && isSnapshotFresh(snapshot)) {
      res.json(await withPriceData({
        ...snapshot,
        meta: { ...snapshot.meta, cached: true },
      }, forceRefresh))
      return
    }

    if (snapshot && !forceRefresh && isSnapshotCompatible(snapshot)) {
      void startWarehouseSync(pages).catch((error) => {
        console.error('Warehouse background sync failed:', error)
      })
      res.json(await withPriceData({
        ...snapshot,
        meta: { ...snapshot.meta, stale: true, syncing: Boolean(warehouseLoadPromise) },
      }, forceRefresh))
      return
    }

    const payload = await startWarehouseSync(pages)
    res.json(await withPriceData(payload, forceRefresh))
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unknown warehouse API error',
    })
  }
})

app.get('/api/foreign-stock', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1'
    const snapshot = await readForeignStockSnapshot()

    if (snapshot && !forceRefresh && isForeignStockSnapshotFresh(snapshot)) {
      res.json({ ...snapshot, meta: { ...snapshot.meta, cached: true } })
      return
    }

    if (snapshot && !forceRefresh && isForeignStockSnapshotCompatible(snapshot)) {
      void startForeignStockSync().catch((error) => {
        console.error('Foreign stock background sync failed:', error)
      })
      res.json({ ...snapshot, meta: { ...snapshot.meta, stale: true, syncing: Boolean(foreignStockLoadPromise) } })
      return
    }

    try {
      res.json(await startForeignStockSync())
    } catch (error) {
      res.json(emptyForeignStockPayload(error instanceof Error ? error.message : 'Unknown foreign stock error'))
    }
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unknown foreign stock API error',
    })
  }
})

app.get('/api/health', async (_req, res) => {
  const snapshot = await readSnapshot()
  const priceSnapshot = await readPriceSnapshot()
  const foreignStockSnapshot = await readForeignStockSnapshot()

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
    prices: priceSnapshot
      ? {
          fresh: isPriceSnapshotFresh(priceSnapshot),
          complete: priceSnapshot.meta.complete,
          compatible: isPriceSnapshotCompatible(priceSnapshot),
          generatedAt: priceSnapshot.meta.generatedAt,
          rows: priceSnapshot.records.length,
          sheetName: priceSnapshot.meta.sheetName,
        }
      : null,
    foreignStock: foreignStockSnapshot
      ? {
          fresh: isForeignStockSnapshotFresh(foreignStockSnapshot),
          complete: foreignStockSnapshot.meta.complete,
          compatible: isForeignStockSnapshotCompatible(foreignStockSnapshot),
          generatedAt: foreignStockSnapshot.meta.generatedAt,
          rows: foreignStockSnapshot.items.length,
          staleItems: foreignStockSnapshot.items.filter((item) => item.possiblyStale).length,
        }
      : null,
  })
})

function msUntilNextSyncHour(hour: number) {
  const next = new Date()
  next.setHours(hour, 0, 0, 0)
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
  return next.getTime() - Date.now()
}

function scheduleForeignStockSync() {
  if (!foreignStockSourceLabel()) return

  setTimeout(() => {
    void startForeignStockSync().catch((error) => {
      console.error('Scheduled foreign stock sync failed:', error)
    })
    setInterval(() => {
      void startForeignStockSync().catch((error) => {
        console.error('Scheduled foreign stock sync failed:', error)
      })
    }, 86_400_000)
  }, msUntilNextSyncHour(foreignStockSyncHour))
}

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
  scheduleForeignStockSync()
})
