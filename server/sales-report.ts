import 'dotenv/config'

export type SalesReportLineBucket = {
  cost: number
  lines: number
  margin: number
  quantity: number
  revenue: number
}

export type SalesReportGroup = SalesReportLineBucket & {
  code?: string
  department?: string
  documents: number
  name: string
}

export type MonthSalesReport = {
  departments: SalesReportGroup[]
  documents: number
  equipment: SalesReportLineBucket
  from: string
  generatedAt: string
  managers: SalesReportGroup[]
  services: SalesReportLineBucket
  to: string
  total: SalesReportLineBucket
  vat: number
}

type SalesReportWindow = {
  from: string
  to: string
  toExclusive: string
}

type ManagerInfo = {
  code: string
  name: string
}

type MutableSalesReportGroup = SalesReportGroup & {
  documentQuantities: Map<string, number>
}

type RivileRecord = Record<string, RivileRecord | RivileRecord[] | string | undefined>

const maxPageLimit = 5000
const rivileUrl = process.env.RIVILE_API_URL ?? 'https://api.manorivile.lt/client/v2'
const pageLimit = pageLimitValue(process.env.RIVILE_PAGE_LIMIT, 1000)
const requestDelayMs = Math.max(0, Number(process.env.RIVILE_REQUEST_DELAY_MS ?? 150))
const reportTimeZone = process.env.REPORT_TIME_ZONE ?? 'Europe/Moscow'
const reportCurrency = process.env.REPORT_CURRENCY ?? 'EUR'
const deliveryLineCode = '9990006'
const departmentSortOrder = ['Отдел Продаж', 'CS']
const defaultDepartmentByManager = {
  '103': 'CS',
  '104': 'Отдел Продаж',
  '105': 'Отдел Продаж',
  '107': 'CS',
  '115': 'Отдел Продаж',
  '118': 'CS',
  '120': 'CS',
  '121': 'Отдел Продаж',
  '122': 'CS',
  '124': 'Отдел Продаж',
  '125': 'Отдел Продаж',
  '126': 'CS',
  '127': 'Отдел Продаж',
}
const defaultManagerDisplayNames = {
  '103': 'Серафима',
  '104': 'Сергей',
  '105': 'Билал',
  '107': 'Стефанчик',
  '115': 'Эд',
  '118': 'Кристина',
  '120': 'Антонио',
  '121': 'Андрей',
  '122': 'Ася',
  '124': 'Вита',
  '125': 'Артемий',
  '126': 'Илья',
  '127': 'Саша',
}

let lastRivileRequestAt = 0

function pageLimitValue(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, maxPageLimit)) : fallback
}

function apiKey() {
  if (!process.env.RIVILE_API_KEY) {
    throw new Error('RIVILE_API_KEY is not configured')
  }
  return process.env.RIVILE_API_KEY
}

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
          Accept: 'application/json',
          ApiKey: apiKey(),
          'Content-Type': 'application/json',
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
      const resultKey = method.match(/(?:GET|EDIT)_([A-Z]\d{2})/)?.[1]
      const payloadRecord = payload as Record<string, T[] | T | Record<string, T[] | T | undefined> | undefined>
      const nestedPayload = payloadRecord.RET_DOK
      const rows =
        (resultKey ? payloadRecord[resultKey] : undefined) ??
        (resultKey && nestedPayload && typeof nestedPayload === 'object'
          ? (nestedPayload as Record<string, T[] | T | undefined>)[resultKey]
          : undefined)

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

function numberValue(value: RivileRecord | RivileRecord[] | string | undefined) {
  if (typeof value !== 'string' || !value) return 0
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function clean(value: RivileRecord | RivileRecord[] | string | undefined) {
  return typeof value === 'string' ? value.trim() : ''
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

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function assertIsoDate(value: string, name: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must be in YYYY-MM-DD format`)
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} is not a valid date`)
  }
}

function reportWindow(from: string, to: string): SalesReportWindow {
  assertIsoDate(from, 'from')
  assertIsoDate(to, 'to')

  if (from > to) {
    throw new Error('from must be earlier than or equal to to')
  }

  return {
    from,
    to,
    toExclusive: addDays(to, 1),
  }
}

function datePartsInTimeZone(date: Date) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: reportTimeZone,
      year: 'numeric',
    }).formatToParts(date)
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
    return { day: part('day'), month: part('month'), year: part('year') }
  } catch {
    return {
      day: String(date.getDate()).padStart(2, '0'),
      month: String(date.getMonth() + 1).padStart(2, '0'),
      year: String(date.getFullYear()),
    }
  }
}

function currentMonthReportWindow(now = new Date()): SalesReportWindow {
  const parts = datePartsInTimeZone(now)
  const today = `${parts.year}-${parts.month}-${parts.day}`
  return reportWindow(`${parts.year}-${parts.month}-01`, today)
}

function emptySalesBucket(): SalesReportLineBucket {
  return { cost: 0, lines: 0, margin: 0, quantity: 0, revenue: 0 }
}

function emptySalesGroup(name: string, code?: string, department?: string): MutableSalesReportGroup {
  return { ...emptySalesBucket(), code, department, documentQuantities: new Map(), documents: 0, name }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function addSalesLine(bucket: SalesReportLineBucket, revenue: number, signedCost: number) {
  bucket.lines += 1
  bucket.revenue += revenue
  bucket.cost += Math.abs(signedCost)
  bucket.margin += revenue + signedCost
}

function addDocumentQuantity(documents: Map<string, number>, documentId: string, sign: number) {
  if (!documents.has(documentId)) documents.set(documentId, sign)
}

function documentQuantityTotal(documents: Map<string, number>) {
  return [...documents.values()].reduce((sum, value) => sum + value, 0)
}

function addSalesGroupLine(
  bucket: MutableSalesReportGroup,
  documentId: string,
  revenue: number,
  signedCost: number,
  sign: number,
) {
  addSalesLine(bucket, revenue, signedCost)
  addDocumentQuantity(bucket.documentQuantities, documentId, sign)
}

function finalizeSalesBucket(bucket: SalesReportLineBucket) {
  bucket.cost = roundMoney(bucket.cost)
  bucket.margin = roundMoney(bucket.margin)
  bucket.quantity = roundMoney(bucket.quantity)
  bucket.revenue = roundMoney(bucket.revenue)
}

function finalizeSalesGroup(bucket: MutableSalesReportGroup): SalesReportGroup {
  finalizeSalesBucket(bucket)
  return {
    code: bucket.code,
    cost: bucket.cost,
    department: bucket.department,
    documents: bucket.documentQuantities.size,
    lines: bucket.lines,
    margin: bucket.margin,
    quantity: documentQuantityTotal(bucket.documentQuantities),
    name: bucket.name,
    revenue: bucket.revenue,
  }
}

function isServiceSalesLine(line: RivileRecord) {
  const code = clean(line.I07_KODAS)
  if (code === deliveryLineCode) return false
  return clean(line.I07_TIPAS) === '2' || code.startsWith('999')
}

function normalizeMapKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function objectMap(source: Record<string, string>) {
  const map = new Map<string, string>()
  Object.entries(source).forEach(([key, value]) => {
    map.set(normalizeMapKey(key), value)
  })
  return map
}

function mergeJsonMap(map: Map<string, string>, raw: string | undefined, envName: string) {
  if (!raw) return map

  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    Object.entries(parsed).forEach(([key, value]) => {
      if (key.trim() && value.trim()) map.set(normalizeMapKey(key), value.trim())
    })
  } catch (error) {
    console.warn(`${envName} ignored: ${error instanceof Error ? error.message : 'invalid JSON'}`)
  }

  return map
}

function departmentMap() {
  return mergeJsonMap(
    objectMap(defaultDepartmentByManager),
    process.env.REPORT_DEPARTMENT_MAP_JSON,
    'REPORT_DEPARTMENT_MAP_JSON',
  )
}

function managerDisplayNameMap() {
  return mergeJsonMap(
    objectMap(defaultManagerDisplayNames),
    process.env.REPORT_MANAGER_NAME_MAP_JSON,
    'REPORT_MANAGER_NAME_MAP_JSON',
  )
}

function departmentForManager(managerCode: string, managerName: string, map: Map<string, string>) {
  return map.get(normalizeMapKey(managerCode)) ?? map.get(normalizeMapKey(managerName))
}

function displayNameForManager(managerCode: string, managerName: string, map: Map<string, string>) {
  return map.get(normalizeMapKey(managerCode)) ?? map.get(normalizeMapKey(managerName)) ?? managerName
}

function departmentSort(department: string) {
  const index = departmentSortOrder.indexOf(department)
  return index === -1 ? departmentSortOrder.length : index
}

async function loadManagers() {
  const page = await loadPages<RivileRecord>('GET_N15_LIST', {}, pageLimit)
  const managers = new Map<string, ManagerInfo>()

  page.rows.forEach((row) => {
    const code = clean(row.N15_KODAS_MS)
    if (!code) return
    managers.set(code, {
      code,
      name: clean(row.N15_PAV) || code,
    })
  })

  return managers
}

async function loadSalesReportForWindow(window: SalesReportWindow): Promise<MonthSalesReport> {
  const managers = await loadManagers()
  const departments = new Map<string, MutableSalesReportGroup>()
  const managerGroups = new Map<string, MutableSalesReportGroup>()
  const departmentsByManager = departmentMap()
  const displayNamesByManager = managerDisplayNameMap()
  const filter = [
    'i06_op_tip in (51,52)',
    `i06_dok_data >= '${window.from}'`,
    `i06_dok_data < '${window.toExclusive}'`,
  ].join(' and ')
  const page = await loadPages<RivileRecord & { I07?: RivileRecord | RivileRecord[] }>(
    'GET_I06_LIST',
    { fil: filter, list: 'A' },
    pageLimit,
  )
  const transferredRows = page.rows.filter((document) => clean(document.I06_PERKELTA) === '2')
  const equipment = emptySalesBucket()
  const services = emptySalesBucket()
  const total = emptySalesBucket()
  const equipmentDocumentQuantities = new Map<string, number>()
  const servicesDocumentQuantities = new Map<string, number>()
  const totalDocumentQuantities = new Map<string, number>()
  let vat = 0

  transferredRows.forEach((document) => {
    const operationType = clean(document.I06_OP_TIP)
    const documentId = clean(document.I06_KODAS_PO) || clean(document.I06_DOK_NR) || JSON.stringify(document).slice(0, 120)
    const managerCode = clean(document.I06_KODAS_MS)
    const rivileManagerName = managers.get(managerCode)?.name || managerCode || 'Без менеджера'
    const managerName = displayNameForManager(managerCode, rivileManagerName, displayNamesByManager)
    const departmentName = departmentForManager(managerCode, managerName, departmentsByManager)
    const sign = operationType === '52' ? -1 : 1
    vat += Math.abs(numberValue(document.I06_SUMA_PVM)) * sign

    const lines = Array.isArray(document.I07) ? document.I07 : document.I07 ? [document.I07] : []
    lines.forEach((line) => {
      const revenue = Math.abs(numberValue(line.I07_SUMA)) * sign
      const signedCost = -Math.abs(numberValue(line.I07_SAVIKAINA)) * sign
      const bucket = isServiceSalesLine(line) ? services : equipment

      addSalesLine(bucket, revenue, signedCost)
      addSalesLine(total, revenue, signedCost)
      addDocumentQuantity(bucket === equipment ? equipmentDocumentQuantities : servicesDocumentQuantities, documentId, sign)
      addDocumentQuantity(totalDocumentQuantities, documentId, sign)

      if (bucket === equipment && departmentName) {
        if (!departments.has(departmentName)) {
          departments.set(departmentName, emptySalesGroup(departmentName))
        }
        if (!managerGroups.has(managerCode || managerName)) {
          managerGroups.set(
            managerCode || managerName,
            emptySalesGroup(managerName, managerCode || undefined, departmentName),
          )
        }
        addSalesGroupLine(departments.get(departmentName)!, documentId, revenue, signedCost, sign)
        addSalesGroupLine(managerGroups.get(managerCode || managerName)!, documentId, revenue, signedCost, sign)
      }
    })
  })

  equipment.quantity = documentQuantityTotal(equipmentDocumentQuantities)
  services.quantity = documentQuantityTotal(servicesDocumentQuantities)
  total.quantity = documentQuantityTotal(totalDocumentQuantities)

  ;[equipment, services, total].forEach((bucket) => {
    finalizeSalesBucket(bucket)
  })

  const departmentRows = [...departments.values()]
    .map(finalizeSalesGroup)
    .sort((a, b) => departmentSort(a.name) - departmentSort(b.name) || b.revenue - a.revenue)
  const managerRows = [...managerGroups.values()]
    .map(finalizeSalesGroup)
    .sort(
      (a, b) =>
        departmentSort(a.department ?? '') - departmentSort(b.department ?? '') ||
        b.revenue - a.revenue ||
        a.name.localeCompare(b.name),
    )

  return {
    departments: departmentRows,
    documents: transferredRows.length,
    equipment,
    from: window.from,
    generatedAt: new Date().toISOString(),
    managers: managerRows,
    services,
    to: window.to,
    total,
    vat: roundMoney(vat),
  }
}

export async function loadSalesReport(from: string, to: string): Promise<MonthSalesReport> {
  return loadSalesReportForWindow(reportWindow(from, to))
}

export async function loadCurrentMonthSalesReport(): Promise<MonthSalesReport> {
  return loadSalesReportForWindow(currentMonthReportWindow())
}

function formatReportDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

function formatReportTimestamp(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    timeZone: reportTimeZone,
    year: 'numeric',
  }).format(new Date(value))
}

function formatReportMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    currency: reportCurrency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(value)
}

function formatReportPercent(margin: number, revenue: number) {
  if (!revenue) return '-'
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    style: 'percent',
  }).format(margin / revenue)
}

function formatReportQuantity(value: number) {
  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)} шт.`
}

function departmentBreakdownLines(report: MonthSalesReport) {
  if (report.departments.length === 0) {
    return ['Нет отгрузок по заданным менеджерам']
  }

  return report.departments.flatMap((department, index) => {
    const managers = report.managers.filter((manager) => manager.department === department.name)
    const lines = [
      `${department.name}: ${formatReportMoney(department.margin)} (${formatReportQuantity(department.quantity)})`,
      ...managers.map(
        (manager) => `${manager.name}: ${formatReportMoney(manager.margin)} (${formatReportQuantity(manager.quantity)})`,
      ),
    ]

    return index === report.departments.length - 1 ? lines : [...lines, '']
  })
}

export function buildSalesReportMessage(report: MonthSalesReport) {
  return [
    `Отчёт по отгрузкам: ${formatReportDate(report.from)}-${formatReportDate(report.to)}`,
    '',
    `Выручка: ${formatReportMoney(report.equipment.revenue)}`,
    `Маржа: ${formatReportMoney(report.equipment.margin)}`,
    `Маржинальность: ${formatReportPercent(report.equipment.margin, report.equipment.revenue)}`,
    `Количество: ${formatReportQuantity(report.equipment.quantity)}`,
    '',
    '',
    ...departmentBreakdownLines(report),
    '',
    `Обновлено: ${formatReportTimestamp(report.generatedAt)}`,
  ].join('\n')
}
