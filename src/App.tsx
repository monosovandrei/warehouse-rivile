import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, Clock, Filter, Search, Warehouse } from 'lucide-react'
import './App.css'

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

type WarehouseResponse = {
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

type SectionSummary = {
  sourceType: string
  label: string
  rows: number
}

type FilterOption = {
  label: string
  count: number
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

type ForeignStockResponse = {
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

type StockDisplayRow = {
  available: number
  barcode: string
  brand: string
  code: string
  key: string
  name: string
  pricedUnits: number
  salePrice: number
  salePriceCurrency: string
  salePriceMatch: 'code' | 'name' | 'none'
  salePriceTotal: number
  salePricedUnits: number
  purchasePrice: number
  purchasePriceTotal: number
  purchaseValue: number
  section: string
  specs: string[]
}

type ForeignDisplayRow = {
  ageDays: number
  available: number
  brand: string
  category: string
  codes: string[]
  currency: string
  deliveryBusinessDays: number
  key: string
  name: string
  offers: number
  possiblyStale: boolean
  price: number
  priceTrend: 'down' | 'new' | 'same' | 'up'
  priceType: string
  quantityKnown: boolean
  sourcePrice: string
  supplier: string
  updatedAt: string
}

type SyncBadgeProps = {
  label: string
  timestamp?: string
  hasWarning?: boolean
  isLoading?: boolean
  isStale?: boolean
  isSyncing?: boolean
}

async function fetchWarehouseData() {
  const response = await fetch('/api/warehouse')
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.message || 'Failed to load stock')
  }
  return payload as WarehouseResponse
}

async function fetchForeignStockData() {
  const response = await fetch('/api/foreign-stock')
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.message || 'Failed to load foreign stock')
  }
  return payload as ForeignStockResponse
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', { currency: 'EUR', style: 'currency' }).format(value)
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', { currency: currency || 'EUR', style: 'currency' }).format(value)
}

function formatDate(value: Date | string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function formatSyncTimestamp(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''

  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function syncStateLabel({ hasWarning, isLoading, isStale, isSyncing, timestamp }: SyncBadgeProps) {
  if (isLoading && !timestamp) return 'Loading'
  if (!timestamp) return 'No successful sync'
  if (isSyncing) return 'Refreshing'
  if (isStale) return 'Stale cache'
  if (hasWarning) return 'Needs attention'
  return 'Updated'
}

function addBusinessDays(value: Date, days: number) {
  const date = new Date(value)
  date.setHours(12, 0, 0, 0)

  let added = 0
  while (added < days) {
    date.setDate(date.getDate() + 1)
    const day = date.getDay()
    if (day !== 0 && day !== 6) added += 1
  }

  return date
}

function normalizeLookup(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

function detectBrand(name: string) {
  const normalized = name.toLowerCase()
  if (normalized.includes('dell') || normalized.includes('poweredge') || normalized.includes('powervault')) return 'Dell'
  if (normalized.includes('hpe') || normalized.includes('hewlett') || normalized.includes('proliant')) return 'HPE'
  if (normalized.includes('hp ')) return 'HP'
  if (normalized.includes('lenovo') || normalized.includes('thinksystem')) return 'Lenovo'
  if (normalized.includes('ibm')) return 'IBM'
  if (normalized.includes('intel')) return 'Intel'
  if (normalized.includes('amd ') || normalized.includes('epyc') || normalized.includes('ryzen')) return 'AMD'
  if (normalized.includes('cisco')) return 'Cisco'
  if (normalized.includes('broadcom')) return 'Broadcom'
  if (normalized.includes('nvidia')) return 'NVIDIA'
  if (normalized.includes('mellanox')) return 'Mellanox'
  if (normalized.includes('supermicro')) return 'Supermicro'
  if (normalized.includes('seagate')) return 'Seagate'
  if (normalized.includes('samsung')) return 'Samsung'
  if (normalized.includes('kingston')) return 'Kingston'
  if (normalized.includes('micron')) return 'Micron'
  if (normalized.includes('kioxia')) return 'Kioxia'
  if (normalized.includes('toshiba')) return 'Toshiba'
  if (normalized.includes('western digital') || normalized.includes(' wd ')) return 'Western Digital'
  if (normalized.includes('hgst')) return 'HGST'
  if (normalized.includes('huawei')) return 'Huawei'
  if (normalized.includes('qlogic')) return 'QLogic'
  if (normalized.includes('emulex')) return 'Emulex'
  if (normalized.includes('lsi ')) return 'LSI'
  return 'Other'
}

function detectFormFactor(name: string) {
  const normalized = name.toLowerCase()
  if (/\b2[.,]5\s*(?:"|in|inch)?\b/.test(normalized) || /\bsff\b/.test(normalized)) return '2.5" / SFF'
  if (/\b3[.,]5\s*(?:"|in|inch)?\b/.test(normalized) || /\blff\b/.test(normalized)) return '3.5" / LFF'
  if (/\bm[.\- ]?2\b/.test(normalized)) return 'M.2'
  if (/\bu[.\- ]?2\b/.test(normalized)) return 'U.2'
  if (/\bhhhl\b/.test(normalized)) return 'HHHL'
  if (/mini\s*mono|minimono/.test(normalized)) return 'Mini Mono'
  if (/mini\s*blade/.test(normalized)) return 'Mini Blade'
  if (/\bblade\b/.test(normalized)) return 'Blade'
  if (/pci[\s-]?e|pcie/.test(normalized)) return 'PCIe card'
  if (/\bocp\b/.test(normalized)) return 'OCP'
  if (/\blrdimm\b|\bld\b/.test(normalized)) return 'LRDIMM'
  if (/\brdimm\b|pc4-[\w-]+-r\b/.test(normalized)) return 'RDIMM'
  if (/\budimm\b|pc4-[\w-]+-e\b/.test(normalized)) return 'UDIMM'
  if (/\btray\b|\bcaddy\b/.test(normalized)) return 'Tray / caddy'
  if (/\brail\b/.test(normalized)) return 'Rail kit'
  return ''
}

function detectTechnology(name: string) {
  const normalized = name.toLowerCase()
  if (/\bnvme\b/.test(normalized)) return 'NVMe'
  if (/\bsas\b/.test(normalized)) return 'SAS'
  if (/\bsata\b/.test(normalized)) return 'SATA'
  if (/\bfc\b|fibre|fiber/.test(normalized)) return 'Fibre Channel'
  if (/\b10\s?g(?:be|bit)?\b|\b10gbe\b/.test(normalized)) return '10GbE'
  if (/\b25\s?g(?:be|bit)?\b|\b25gbe\b/.test(normalized)) return '25GbE'
  if (/\b40\s?g(?:be|bit)?\b|\b40gbe\b/.test(normalized)) return '40GbE'
  if (/sfp\+?/.test(normalized)) return 'SFP'
  if (/ethernet|network/.test(normalized)) return 'Ethernet'
  if (/\bddr5\b/.test(normalized)) return 'DDR5'
  if (/\bddr4\b/.test(normalized)) return 'DDR4'
  if (/\bddr3\b/.test(normalized)) return 'DDR3'
  if (/xeon\s+gold/.test(normalized)) return 'Xeon Gold'
  if (/xeon\s+silver/.test(normalized)) return 'Xeon Silver'
  if (/xeon\s+bronze/.test(normalized)) return 'Xeon Bronze'
  if (/\be5-\d+v4\b/.test(normalized)) return 'Xeon E5 v4'
  if (/\be5-\d+v3\b/.test(normalized)) return 'Xeon E5 v3'
  if (/pci[\s-]?e|pcie/.test(normalized)) return 'PCIe'
  return ''
}

function detectCondition(name: string) {
  const normalized = name.toLowerCase()
  if (/\bnew\b/.test(normalized)) return 'New'
  if (/\bused\b/.test(normalized)) return 'Used'
  return ''
}

function sectionLabel(type: string) {
  const normalized = type.toLowerCase()
  if (normalized.includes('raid') || normalized.includes('nvme')) return 'RAID / NVMe'
  if (normalized.includes('cpu') && !normalized.includes('\u0440\u0430\u0434\u0438') && !normalized.includes('heatsink')) return 'CPU'
  if (normalized.includes('hdd') || normalized.includes('ssd') || normalized.includes('disk')) return 'Drives'
  if (normalized.includes('\u0441\u0435\u0442') || normalized.includes('network')) return 'Network'
  if (normalized.includes('hba') || normalized.includes('fc')) return 'HBA / FC'
  if (normalized.includes('ram')) return 'RAM'
  if (normalized.includes('\u0432\u0435\u043d\u0442') || normalized.includes('fan')) return 'Fans'
  if (normalized.includes('\u0440\u0430\u0434\u0438') || normalized.includes('heatsink')) return 'Heatsinks'
  if (normalized.includes('\u0441\u0430\u043b\u0430\u0437') || normalized.includes('tray') || normalized.includes('caddy')) return 'Drive trays'
  if (normalized.includes('\u0441\u0445\u0434') || normalized.includes('storage')) return 'Storage shelves'
  if (normalized.includes('\u0443\u0434\u0430\u043b') || normalized.includes('remote')) return 'Remote access'
  if (normalized.includes('psu') || normalized.includes('power')) return 'PSU'
  if (normalized.includes('gpu')) return 'GPU'
  if (normalized.includes('\u043a\u0430\u0431') || normalized.includes('cable')) return 'Cables'
  if (normalized.includes('\u0441\u0435\u0440\u0432\u0435\u0440') || normalized.includes('server')) return 'Server bases'
  return 'Other components'
}

function itemSection(item: StockItem) {
  if (['14', '100', '101', '102'].includes(item.productGroup)) return 'Server bases'
  return sectionLabel(item.equipmentType)
}

function sectionOrder(label: string) {
  if (label === 'Server bases') return 0
  return 1
}

function optionBreakdown<T>(items: T[], detector: (item: T) => string, weight: (item: T) => number = () => 1) {
  const map = new Map<string, number>()
  items.forEach((item) => {
    const label = detector(item)
    if (!label) return
    map.set(label, (map.get(label) ?? 0) + weight(item))
  })
  return [...map.entries()]
    .map<FilterOption>(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function selectedOptions(values: string[], options: FilterOption[]) {
  const available = new Set(options.map((option) => option.label))
  return values.filter((value) => available.has(value))
}

function filterByOptions<T>(items: T[], values: string[], detector: (item: T) => string) {
  if (values.length === 0) return items
  const selected = new Set(values)
  return items.filter((item) => selected.has(detector(item)))
}

function itemSpecs(item: StockItem) {
  return Array.from(new Set([detectFormFactor(item.name), detectTechnology(item.name), detectCondition(item.name)].filter(Boolean)))
}

function stockUnits(items: StockItem[]) {
  return items.reduce((sum, item) => sum + item.available, 0)
}

function groupStockItems(items: StockItem[]) {
  const rows = new Map<string, StockDisplayRow>()

  items.forEach((item) => {
    const section = itemSection(item)
    const brand = detectBrand(item.name)
    const specs = itemSpecs(item)
    const key = [item.code, item.name, item.barcode, section, brand, specs.join('|')].join('::')
    const current =
      rows.get(key) ??
      ({
        available: 0,
        barcode: item.barcode,
        brand,
        code: item.code,
        key,
        name: item.name,
        pricedUnits: 0,
        salePrice: 0,
        salePriceCurrency: item.sheetPriceCurrency || 'EUR',
        salePriceMatch: 'none',
        salePriceTotal: 0,
        salePricedUnits: 0,
        purchasePrice: 0,
        purchasePriceTotal: 0,
        purchaseValue: 0,
        section,
        specs,
      } satisfies StockDisplayRow)

    current.available += item.available
    current.purchaseValue += item.value
    if (item.sheetPrice > 0 && item.available > 0) {
      current.salePriceCurrency = item.sheetPriceCurrency || current.salePriceCurrency
      current.salePriceMatch = current.salePriceMatch === 'code' ? 'code' : item.sheetPriceMatch
      current.salePricedUnits += item.available
      current.salePriceTotal += item.sheetPrice * item.available
    }
    if (item.purchasePrice > 0 && item.available > 0) {
      current.pricedUnits += item.available
      current.purchasePriceTotal += item.purchasePrice * item.available
    }
    current.salePrice = current.salePricedUnits > 0 ? current.salePriceTotal / current.salePricedUnits : 0
    current.purchasePrice =
      current.purchaseValue > 0 && current.available > 0
        ? current.purchaseValue / current.available
        : current.pricedUnits > 0
          ? current.purchasePriceTotal / current.pricedUnits
          : 0
    rows.set(key, current)
  })

  return [...rows.values()].sort((a, b) => b.available - a.available || a.name.localeCompare(b.name))
}

type FilterGroupProps = {
  allCount: number
  allLabel: string
  onChange: (value: string) => void
  onClear: () => void
  options: FilterOption[]
  title: string
  values: string[]
}

function filterSummary(allLabel: string, values: string[]) {
  if (values.length === 0) return allLabel
  if (values.length === 1) return values[0]
  return `${values[0]} +${values.length - 1}`
}

function resultSummary(rows: StockDisplayRow[]) {
  const pieces = rows.reduce((sum, row) => sum + row.available, 0)
  return `${formatNumber(rows.length)} models / ${formatNumber(pieces)} pcs in stock`
}

const foreignCategoryOrder = [
  'Servers',
  'CPU',
  'RAM',
  'HDD',
  'SSD',
  'GPU',
  'Network',
  'Power Supply',
  'Chassis',
  'Cables & Accessories',
  'Other',
]

function foreignSectionOrder(label: string) {
  const index = foreignCategoryOrder.indexOf(label)
  return index === -1 ? foreignCategoryOrder.length : index
}

function foreignBrand(item: ForeignStockItem) {
  return item.brand || detectBrand(item.name)
}

function foreignStatus(item: ForeignStockItem) {
  return item.possiblyStale ? 'Possibly stale' : 'Fresh'
}

function foreignRowsSummary(rows: ForeignDisplayRow[]) {
  const knownPieces = rows.reduce((sum, row) => sum + (row.quantityKnown ? row.available : 0), 0)
  const groupedOffers = rows.reduce((sum, row) => sum + row.offers, 0)
  if (knownPieces > 0) {
    return `${formatNumber(rows.length)} models / ${formatNumber(knownPieces)} pcs abroad`
  }
  return `${formatNumber(rows.length)} models / ${formatNumber(groupedOffers)} offers`
}

function groupForeignItems(items: ForeignStockItem[]) {
  const rows = new Map<string, ForeignDisplayRow>()

  items.forEach((item) => {
    const brand = foreignBrand(item)
    const category = item.category || 'Other'
    const key = [category, normalizeLookup(item.name), brand, item.price, item.currency].join('::')
    const current =
      rows.get(key) ??
      ({
        ageDays: item.ageDays,
        available: 0,
        brand,
        category,
        codes: [],
        currency: item.currency || 'EUR',
        deliveryBusinessDays: item.deliveryBusinessDays,
        key,
        name: item.name,
        offers: 0,
        possiblyStale: item.possiblyStale,
        price: item.price,
        priceTrend: item.priceTrend,
        priceType: item.priceType,
        quantityKnown: false,
        sourcePrice: item.sourcePrice,
        supplier: item.supplier,
        updatedAt: item.updatedAt,
      } satisfies ForeignDisplayRow)

    current.offers += 1
    if (item.code && !current.codes.includes(item.code)) current.codes.push(item.code)
    if (item.quantityKnown) {
      current.available += item.available
      current.quantityKnown = true
    }

    if (new Date(item.updatedAt).getTime() > new Date(current.updatedAt).getTime()) {
      current.ageDays = item.ageDays
      current.possiblyStale = item.possiblyStale
      current.priceTrend = item.priceTrend
      current.sourcePrice = item.sourcePrice
      current.updatedAt = item.updatedAt
    }

    rows.set(key, current)
  })

  return [...rows.values()].sort(
    (a, b) =>
      Number(a.possiblyStale) - Number(b.possiblyStale) ||
      foreignSectionOrder(a.category) - foreignSectionOrder(b.category) ||
      a.name.localeCompare(b.name),
  )
}

function FilterGroup({ allCount, allLabel, onChange, onClear, options, title, values }: FilterGroupProps) {
  if (options.length < 2 && values.length === 0) return null
  const selectedCount = values.reduce((sum, value) => sum + (options.find((option) => option.label === value)?.count ?? 0), 0)

  return (
    <details className="filter-dropdown">
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{filterSummary(allLabel, values)}</small>
        </span>
        <b>{formatNumber(values.length === 0 ? allCount : selectedCount)}</b>
      </summary>
      <div className="filter-menu">
        <button className="clear-filter" disabled={values.length === 0} type="button" onClick={onClear}>
          {allLabel}
        </button>
        {options.map((option) => (
          <label className="check-row" key={option.label}>
            <input
              checked={values.includes(option.label)}
              onChange={() => onChange(option.label)}
              type="checkbox"
            />
            <span>{option.label}</span>
            <strong>{formatNumber(option.count)}</strong>
          </label>
        ))}
      </div>
    </details>
  )
}

function SyncBadge(props: SyncBadgeProps) {
  const { label, timestamp } = props
  const timestampLabel = formatSyncTimestamp(timestamp)
  const classes = ['sync-badge']

  if (props.isStale) classes.push('stale')
  if (props.isSyncing) classes.push('syncing')
  if (props.hasWarning && !timestampLabel) classes.push('warning')

  return (
    <div className={classes.join(' ')} role="status" aria-live="polite">
      <Clock size={17} aria-hidden="true" />
      <div className="sync-badge-text">
        <span className="sync-badge-label">{label}</span>
        <strong>{timestampLabel ? <time dateTime={timestamp}>{timestampLabel}</time> : syncStateLabel(props)}</strong>
      </div>
      {timestampLabel ? <span className="sync-badge-state">{syncStateLabel(props)}</span> : null}
    </div>
  )
}

function App() {
  const startsOnForeignView = window.location.hash === '#foreign'
  const [data, setData] = useState<WarehouseResponse | null>(null)
  const [foreignData, setForeignData] = useState<ForeignStockResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isForeignLoading, setIsForeignLoading] = useState(startsOnForeignView)
  const [error, setError] = useState('')
  const [foreignError, setForeignError] = useState('')
  const [query, setQuery] = useState('')
  const [foreignQuery, setForeignQuery] = useState('')
  const [brands, setBrands] = useState<string[]>([])
  const [conditions, setConditions] = useState<string[]>([])
  const [formFactors, setFormFactors] = useState<string[]>([])
  const [foreignBrands, setForeignBrands] = useState<string[]>([])
  const [foreignStatuses, setForeignStatuses] = useState<string[]>([])
  const [foreignSuppliers, setForeignSuppliers] = useState<string[]>([])
  const [foreignSection, setForeignSection] = useState('all')
  const [technologies, setTechnologies] = useState<string[]>([])
  const [section, setSection] = useState('all')
  const [view, setView] = useState<'local' | 'foreign'>(() => (startsOnForeignView ? 'foreign' : 'local'))

  useEffect(() => {
    let isCancelled = false

    fetchWarehouseData()
      .then((payload) => {
        if (!isCancelled) setData(payload)
      })
      .catch((requestError) => {
        if (!isCancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load stock')
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [])

  const loadForeignStock = useCallback(() => {
    if (foreignData || isForeignLoading) return

    setIsForeignLoading(true)
    setForeignError('')

    fetchForeignStockData()
      .then((payload) => setForeignData(payload))
      .catch((requestError) => {
        setForeignError(requestError instanceof Error ? requestError.message : 'Failed to load foreign stock')
      })
      .finally(() => setIsForeignLoading(false))
  }, [foreignData, isForeignLoading])

  useEffect(() => {
    if (!startsOnForeignView) return
    let isCancelled = false

    fetchForeignStockData()
      .then((payload) => {
        if (!isCancelled) setForeignData(payload)
      })
      .catch((requestError) => {
        if (!isCancelled) {
          setForeignError(requestError instanceof Error ? requestError.message : 'Failed to load foreign stock')
        }
      })
      .finally(() => {
        if (!isCancelled) setIsForeignLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [startsOnForeignView])

  function openForeignStock() {
    if (window.location.hash !== '#foreign') window.history.replaceState(null, '', '#foreign')
    setView('foreign')
    loadForeignStock()
  }

  const items = useMemo(() => (data?.items ?? []).filter((item) => item.available > 0), [data])

  const sectionItems = useMemo(() => {
    return items.filter((item) => section === 'all' || itemSection(item) === section)
  }, [items, section])

  const brandOptions = useMemo(() => optionBreakdown(sectionItems, (item) => detectBrand(item.name), (item) => item.available), [sectionItems])

  const selectedBrands = selectedOptions(brands, brandOptions)
  const brandItems = useMemo(() => filterByOptions(sectionItems, selectedBrands, (item) => detectBrand(item.name)), [sectionItems, selectedBrands])

  const formFactorOptions = useMemo(() => optionBreakdown(brandItems, (item) => detectFormFactor(item.name), (item) => item.available), [brandItems])
  const selectedFormFactors = selectedOptions(formFactors, formFactorOptions)
  const formFactorItems = useMemo(
    () => filterByOptions(brandItems, selectedFormFactors, (item) => detectFormFactor(item.name)),
    [brandItems, selectedFormFactors],
  )

  const technologyOptions = useMemo(
    () => optionBreakdown(formFactorItems, (item) => detectTechnology(item.name), (item) => item.available),
    [formFactorItems],
  )
  const selectedTechnologies = selectedOptions(technologies, technologyOptions)
  const technologyItems = useMemo(
    () => filterByOptions(formFactorItems, selectedTechnologies, (item) => detectTechnology(item.name)),
    [formFactorItems, selectedTechnologies],
  )

  const conditionOptions = useMemo(
    () => optionBreakdown(technologyItems, (item) => detectCondition(item.name), (item) => item.available),
    [technologyItems],
  )
  const selectedConditions = selectedOptions(conditions, conditionOptions)
  const conditionItems = useMemo(
    () => filterByOptions(technologyItems, selectedConditions, (item) => detectCondition(item.name)),
    [selectedConditions, technologyItems],
  )

  const hasFilterGroups =
    brandOptions.length > 1 || formFactorOptions.length > 1 || technologyOptions.length > 1 || conditionOptions.length > 1

  const sections = useMemo<SectionSummary[]>(() => {
    const map = new Map<string, SectionSummary>()
    items.forEach((item) => {
      const label = itemSection(item)
      const current = map.get(label) ?? { sourceType: item.equipmentType, label, rows: 0 }
      current.rows += 1
      map.set(label, current)
    })
    return [...map.values()].sort((a, b) => sectionOrder(a.label) - sectionOrder(b.label) || b.rows - a.rows)
  }, [items])

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase()

    return conditionItems.filter((item) => {
      const sectionName = itemSection(item)
      const matchesQuery =
        !search ||
        [item.name, item.code, item.barcode, item.warehouse, item.object, sectionName, ...itemSpecs(item)]
          .join(' ')
          .toLowerCase()
          .includes(search)
      return matchesQuery
    })
  }, [conditionItems, query])

  const displayRows = useMemo(() => groupStockItems(filtered), [filtered])

  const foreignItems = useMemo(() => foreignData?.items ?? [], [foreignData])

  const foreignSections = useMemo<SectionSummary[]>(() => {
    const map = new Map<string, SectionSummary>()
    foreignItems.forEach((item) => {
      const label = item.category || 'Other'
      const current = map.get(label) ?? { sourceType: label, label, rows: 0 }
      current.rows += 1
      map.set(label, current)
    })
    return [...map.values()].sort((a, b) => foreignSectionOrder(a.label) - foreignSectionOrder(b.label) || b.rows - a.rows)
  }, [foreignItems])

  const foreignSectionItems = useMemo(
    () => foreignItems.filter((item) => foreignSection === 'all' || item.category === foreignSection),
    [foreignItems, foreignSection],
  )

  const foreignBrandOptions = useMemo(() => optionBreakdown(foreignSectionItems, foreignBrand), [foreignSectionItems])
  const selectedForeignBrands = selectedOptions(foreignBrands, foreignBrandOptions)
  const foreignBrandItems = useMemo(
    () => filterByOptions(foreignSectionItems, selectedForeignBrands, foreignBrand),
    [foreignSectionItems, selectedForeignBrands],
  )

  const foreignSupplierOptions = useMemo(() => optionBreakdown(foreignBrandItems, (item) => item.supplier), [foreignBrandItems])
  const selectedForeignSuppliers = selectedOptions(foreignSuppliers, foreignSupplierOptions)
  const foreignSupplierItems = useMemo(
    () => filterByOptions(foreignBrandItems, selectedForeignSuppliers, (item) => item.supplier),
    [foreignBrandItems, selectedForeignSuppliers],
  )

  const foreignStatusOptions = useMemo(
    () => optionBreakdown(foreignSupplierItems, foreignStatus),
    [foreignSupplierItems],
  )
  const selectedForeignStatuses = selectedOptions(foreignStatuses, foreignStatusOptions)
  const foreignStatusItems = useMemo(
    () => filterByOptions(foreignSupplierItems, selectedForeignStatuses, foreignStatus),
    [foreignSupplierItems, selectedForeignStatuses],
  )

  const hasForeignFilterGroups =
    foreignBrandOptions.length > 1 ||
    foreignSupplierOptions.length > 1 ||
    foreignStatusOptions.length > 1

  const foreignRows = useMemo(() => {
    const search = foreignQuery.trim().toLowerCase()
    return foreignStatusItems.filter((item) => {
      if (!search) return true
      return [item.name, item.code, foreignBrand(item), item.supplier, item.category].join(' ').toLowerCase().includes(search)
    })
  }, [foreignQuery, foreignStatusItems])

  const foreignDisplayRows = useMemo(() => groupForeignItems(foreignRows), [foreignRows])
  const foreignHasQuantity = foreignDisplayRows.some((item) => item.quantityKnown)
  const foreignHasSupplier = foreignDisplayRows.some((item) => item.supplier)

  return (
    <main className="warehouse-shell">
      <header className="warehouse-header">
        <span className="app-mark">
          <Warehouse size={18} aria-hidden="true" />
          Rivile GAMA
        </span>
        <h1>In-stock warehouse</h1>
      </header>

      <div className="view-status-row">
        <div className="view-switch" role="tablist" aria-label="Stock source">
          <button
            className={view === 'local' ? 'view-tab active' : 'view-tab'}
            type="button"
            onClick={() => {
              if (window.location.hash === '#foreign') window.history.replaceState(null, '', window.location.pathname)
              setView('local')
            }}
          >
            Local stock
          </button>
          <button className={view === 'foreign' ? 'view-tab active' : 'view-tab'} type="button" onClick={openForeignStock}>
            Foreign stock
          </button>
        </div>

        {view === 'local' ? (
          <SyncBadge
            hasWarning={Boolean(error || data?.meta.warning)}
            isLoading={isLoading}
            isStale={data?.meta.stale}
            isSyncing={data?.meta.syncing}
            label="Rivile snapshot"
            timestamp={data?.meta.generatedAt}
          />
        ) : (
          <SyncBadge
            hasWarning={Boolean(foreignError || foreignData?.meta.warning)}
            isLoading={isForeignLoading}
            isStale={foreignData?.meta.stale}
            isSyncing={foreignData?.meta.syncing}
            label="Price source"
            timestamp={foreignData?.meta.complete ? foreignData.meta.generatedAt : undefined}
          />
        )}
      </div>

      {error ? (
        <section className="notice notice-error" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>Stock did not load</strong>
            <span>{error}</span>
          </div>
        </section>
      ) : null}

      {view === 'local' && data?.meta.priceWarning ? (
        <section className="notice notice-warning" role="status">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>Prices did not load</strong>
            <span>{data.meta.priceWarning}</span>
          </div>
        </section>
      ) : null}

      {view === 'foreign' && foreignData?.meta.warning ? (
        <section className="notice notice-warning" role="status">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>Foreign stock did not sync</strong>
            <span>{foreignData.meta.warning}</span>
          </div>
        </section>
      ) : null}

      {view === 'local' ? (
      <nav className="section-menu" aria-label="Stock sections">
        <button
          className={section === 'all' ? 'section-tab active' : 'section-tab'}
          type="button"
          onClick={() => {
            setSection('all')
            setBrands([])
            setFormFactors([])
            setTechnologies([])
            setConditions([])
          }}
        >
          All
        </button>
        {sections.map((item) => (
          <button
            className={section === item.label ? 'section-tab active' : 'section-tab'}
            key={item.label}
            type="button"
            onClick={() => {
              setSection(item.label)
              setBrands([])
              setFormFactors([])
              setTechnologies([])
              setConditions([])
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      ) : (
      <nav className="section-menu" aria-label="Foreign stock sections">
        <button
          className={foreignSection === 'all' ? 'section-tab active' : 'section-tab'}
          type="button"
          onClick={() => {
            setForeignSection('all')
            setForeignBrands([])
            setForeignSuppliers([])
            setForeignStatuses([])
          }}
        >
          All
        </button>
        {foreignSections.map((item) => (
          <button
            className={foreignSection === item.label ? 'section-tab active' : 'section-tab'}
            key={item.label}
            type="button"
            onClick={() => {
              setForeignSection(item.label)
              setForeignBrands([])
              setForeignSuppliers([])
              setForeignStatuses([])
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      )}

      {view === 'local' ? (
      <section className="warehouse-layout">
        <aside className="filters-panel" aria-label="Filters">
          <div className="panel-heading">
            <Filter size={18} aria-hidden="true" />
            <span>Filters</span>
          </div>

          {hasFilterGroups ? (
            <>
              <FilterGroup
                allCount={stockUnits(sectionItems)}
                allLabel="All brands"
                onChange={(value) => {
                  setBrands((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
                  setFormFactors([])
                  setTechnologies([])
                  setConditions([])
                }}
                onClear={() => {
                  setBrands([])
                  setFormFactors([])
                  setTechnologies([])
                  setConditions([])
                }}
                options={brandOptions}
                title="Brand"
                values={selectedBrands}
              />

              <FilterGroup
                allCount={stockUnits(brandItems)}
                allLabel="All form factors"
                onChange={(value) => {
                  setFormFactors((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
                  setTechnologies([])
                  setConditions([])
                }}
                onClear={() => {
                  setFormFactors([])
                  setTechnologies([])
                  setConditions([])
                }}
                options={formFactorOptions}
                title="Form factor"
                values={selectedFormFactors}
              />

              <FilterGroup
                allCount={stockUnits(formFactorItems)}
                allLabel="All tech"
                onChange={(value) => {
                  setTechnologies((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
                  setConditions([])
                }}
                onClear={() => {
                  setTechnologies([])
                  setConditions([])
                }}
                options={technologyOptions}
                title="Interface / tech"
                values={selectedTechnologies}
              />

              <FilterGroup
                allCount={stockUnits(technologyItems)}
                allLabel="Any condition"
                onChange={(value) => {
                  setConditions((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
                }}
                onClear={() => setConditions([])}
                options={conditionOptions}
                title="Condition"
                values={selectedConditions}
              />
            </>
          ) : (
            <p className="empty-filters">No extra filters for this section.</p>
          )}
        </aside>

        <section className="stock-workspace">
          <div className="stock-toolbar">
            <label className="search-field">
              <Search size={18} aria-hidden="true" />
              <span className="visually-hidden">Search stock</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, code, barcode, specs"
              />
            </label>
            <div className="result-count">{isLoading ? 'Loading' : resultSummary(displayRows)}</div>
          </div>

          {isLoading ? (
            <div className="loading-grid" aria-label="Loading stock">
              {Array.from({ length: 8 }).map((_, index) => (
                <div className="skeleton-row" key={index} />
              ))}
            </div>
          ) : displayRows.length === 0 ? (
            <div className="empty-state">
              <Boxes size={34} aria-hidden="true" />
              <strong>No stock found</strong>
              <span>Change the search, brand, or section.</span>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Section</th>
                    <th>Brand</th>
                    <th>Specs</th>
                    <th className="num">Price</th>
                    <th className="num">Purchase</th>
                    <th className="num">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((item) => (
                    <tr key={item.key}>
                      <td className="product-cell">
                        <strong>{item.name}</strong>
                        <span>{[item.code, item.barcode].filter(Boolean).join(' / ')}</span>
                      </td>
                      <td>
                        <span className="type-pill">{item.section}</span>
                      </td>
                      <td>{item.brand}</td>
                      <td>
                        {item.specs.length ? (
                          <span className="spec-list">
                            {item.specs.map((spec) => (
                              <span className="spec-pill" key={spec}>
                                {spec}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td className="num" title={item.salePrice > 0 ? `SUPERBASE match: ${item.salePriceMatch}` : undefined}>
                        {item.salePrice > 0 ? formatCurrency(item.salePrice, item.salePriceCurrency) : '-'}
                      </td>
                      <td className="num" title={item.purchaseValue > 0 ? `Stock value: ${formatMoney(item.purchaseValue)}` : undefined}>
                        {item.purchasePrice > 0 ? formatMoney(item.purchasePrice) : '-'}
                      </td>
                      <td className="num">{formatNumber(item.available)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
      ) : (
      <section className="warehouse-layout">
        <aside className="filters-panel" aria-label="Foreign stock filters">
          <div className="panel-heading">
            <Filter size={18} aria-hidden="true" />
            <span>Filters</span>
          </div>

          {hasForeignFilterGroups ? (
            <>
              <FilterGroup
                allCount={foreignSectionItems.length}
                allLabel="All brands"
                onChange={(value) => {
                  setForeignBrands((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
                  setForeignSuppliers([])
                  setForeignStatuses([])
                }}
                onClear={() => {
                  setForeignBrands([])
                  setForeignSuppliers([])
                  setForeignStatuses([])
                }}
                options={foreignBrandOptions}
                title="Brand"
                values={selectedForeignBrands}
              />

              <FilterGroup
                allCount={foreignBrandItems.length}
                allLabel="All suppliers"
                onChange={(value) => {
                  setForeignSuppliers((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
                  setForeignStatuses([])
                }}
                onClear={() => {
                  setForeignSuppliers([])
                  setForeignStatuses([])
                }}
                options={foreignSupplierOptions}
                title="Supplier"
                values={selectedForeignSuppliers}
              />

              <FilterGroup
                allCount={foreignSupplierItems.length}
                allLabel="Any status"
                onChange={(value) => {
                  setForeignStatuses((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
                }}
                onClear={() => setForeignStatuses([])}
                options={foreignStatusOptions}
                title="Freshness"
                values={selectedForeignStatuses}
              />
            </>
          ) : (
            <p className="empty-filters">No extra filters for this section.</p>
          )}
        </aside>

        <section className="foreign-workspace">
          {foreignError ? (
            <section className="notice notice-error" role="alert">
              <AlertTriangle size={20} aria-hidden="true" />
              <div>
                <strong>Foreign stock did not load</strong>
                <span>{foreignError}</span>
              </div>
            </section>
          ) : null}

          <div className="stock-toolbar">
            <label className="search-field">
              <Search size={18} aria-hidden="true" />
              <span className="visually-hidden">Search foreign stock</span>
              <input
                value={foreignQuery}
                onChange={(event) => setForeignQuery(event.target.value)}
                placeholder="Name, part number, brand"
              />
            </label>
            <div className="result-count">{isForeignLoading ? 'Loading' : foreignRowsSummary(foreignDisplayRows)}</div>
          </div>

          {isForeignLoading ? (
            <div className="loading-grid" aria-label="Loading foreign stock">
              {Array.from({ length: 8 }).map((_, index) => (
                <div className="skeleton-row" key={index} />
              ))}
            </div>
          ) : foreignDisplayRows.length === 0 ? (
            <div className="empty-state">
              <Boxes size={34} aria-hidden="true" />
              <strong>No foreign stock found</strong>
              <span>Configure the supplier feed or change the search.</span>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="foreign-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Section</th>
                    <th>Brand</th>
                    {foreignHasSupplier ? <th>Supplier</th> : null}
                    <th className="num">Price</th>
                    {foreignHasQuantity ? <th className="num">Qty</th> : null}
                    <th>Updated</th>
                    <th>Estimated delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {foreignDisplayRows.map((item) => (
                      <tr key={item.key}>
                        <td className="product-cell">
                          <strong>{item.name}</strong>
                          <span>{item.codes.length ? item.codes.slice(0, 3).join(' / ') : '-'}</span>
                        </td>
                        <td>
                          <span className="type-pill">{item.category}</span>
                        </td>
                        <td>{item.brand || '-'}</td>
                        {foreignHasSupplier ? <td>{item.supplier || '-'}</td> : null}
                        <td className="num">{formatCurrency(item.price, item.currency)}</td>
                        {foreignHasQuantity ? <td className="num">{item.quantityKnown ? formatNumber(item.available) : '-'}</td> : null}
                        <td>
                          <span>{formatDate(item.updatedAt)}</span>
                          <span className="muted">{formatNumber(item.ageDays)} days ago</span>
                          {item.possiblyStale ? <span className="stale-note">Possibly stale</span> : null}
                        </td>
                        <td className="delivery-cell">
                          <span>{formatDate(addBusinessDays(new Date(), item.deliveryBusinessDays))}</span>
                          <span className="muted">Estimate</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
      )}
    </main>
  )
}

export default App
