import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, Filter, Search, Warehouse } from 'lucide-react'
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

type StockDisplayRow = {
  available: number
  barcode: string
  brand: string
  code: string
  key: string
  name: string
  pricedUnits: number
  purchasePrice: number
  purchasePriceTotal: number
  purchaseValue: number
  section: string
  specs: string[]
}

async function fetchWarehouseData() {
  const response = await fetch('/api/warehouse')
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.message || 'Failed to load stock')
  }
  return payload as WarehouseResponse
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', { currency: 'EUR', style: 'currency' }).format(value)
}

function detectBrand(name: string) {
  const normalized = name.toLowerCase()
  if (normalized.includes('dell') || normalized.includes('poweredge') || normalized.includes('powervault')) return 'Dell'
  if (normalized.includes('hpe') || normalized.includes('hewlett') || normalized.includes('proliant')) return 'HPE'
  if (normalized.includes('hp ')) return 'HP'
  if (normalized.includes('lenovo') || normalized.includes('thinksystem')) return 'Lenovo'
  if (normalized.includes('ibm')) return 'IBM'
  if (normalized.includes('intel')) return 'Intel'
  if (normalized.includes('cisco')) return 'Cisco'
  if (normalized.includes('broadcom')) return 'Broadcom'
  if (normalized.includes('nvidia')) return 'NVIDIA'
  if (normalized.includes('seagate')) return 'Seagate'
  if (normalized.includes('samsung')) return 'Samsung'
  if (normalized.includes('kingston')) return 'Kingston'
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

function optionBreakdown(items: StockItem[], detector: (item: StockItem) => string) {
  const map = new Map<string, number>()
  items.forEach((item) => {
    const label = detector(item)
    if (!label) return
    map.set(label, (map.get(label) ?? 0) + item.available)
  })
  return [...map.entries()]
    .map<FilterOption>(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function selectedOptions(values: string[], options: FilterOption[]) {
  const available = new Set(options.map((option) => option.label))
  return values.filter((value) => available.has(value))
}

function filterByOptions(items: StockItem[], values: string[], detector: (item: StockItem) => string) {
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
        purchasePrice: 0,
        purchasePriceTotal: 0,
        purchaseValue: 0,
        section,
        specs,
      } satisfies StockDisplayRow)

    current.available += item.available
    current.purchaseValue += item.value
    if (item.purchasePrice > 0 && item.available > 0) {
      current.pricedUnits += item.available
      current.purchasePriceTotal += item.purchasePrice * item.available
    }
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

function App() {
  const [data, setData] = useState<WarehouseResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [brands, setBrands] = useState<string[]>([])
  const [conditions, setConditions] = useState<string[]>([])
  const [formFactors, setFormFactors] = useState<string[]>([])
  const [technologies, setTechnologies] = useState<string[]>([])
  const [section, setSection] = useState('all')

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

  const items = useMemo(() => (data?.items ?? []).filter((item) => item.available > 0), [data])

  const sectionItems = useMemo(() => {
    return items.filter((item) => section === 'all' || itemSection(item) === section)
  }, [items, section])

  const brandOptions = useMemo(() => optionBreakdown(sectionItems, (item) => detectBrand(item.name)), [sectionItems])

  const selectedBrands = selectedOptions(brands, brandOptions)
  const brandItems = useMemo(() => filterByOptions(sectionItems, selectedBrands, (item) => detectBrand(item.name)), [sectionItems, selectedBrands])

  const formFactorOptions = useMemo(() => optionBreakdown(brandItems, (item) => detectFormFactor(item.name)), [brandItems])
  const selectedFormFactors = selectedOptions(formFactors, formFactorOptions)
  const formFactorItems = useMemo(
    () => filterByOptions(brandItems, selectedFormFactors, (item) => detectFormFactor(item.name)),
    [brandItems, selectedFormFactors],
  )

  const technologyOptions = useMemo(() => optionBreakdown(formFactorItems, (item) => detectTechnology(item.name)), [formFactorItems])
  const selectedTechnologies = selectedOptions(technologies, technologyOptions)
  const technologyItems = useMemo(
    () => filterByOptions(formFactorItems, selectedTechnologies, (item) => detectTechnology(item.name)),
    [formFactorItems, selectedTechnologies],
  )

  const conditionOptions = useMemo(() => optionBreakdown(technologyItems, (item) => detectCondition(item.name)), [technologyItems])
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

  return (
    <main className="warehouse-shell">
      <header className="warehouse-header">
        <span className="app-mark">
          <Warehouse size={18} aria-hidden="true" />
          Rivile GAMA
        </span>
        <h1>In-stock warehouse</h1>
      </header>

      {error ? (
        <section className="notice notice-error" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>Stock did not load</strong>
            <span>{error}</span>
          </div>
        </section>
      ) : null}

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
    </main>
  )
}

export default App
