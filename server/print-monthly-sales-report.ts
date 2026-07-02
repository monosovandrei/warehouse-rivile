import 'dotenv/config'
import { buildSalesReportMessage, loadCurrentMonthSalesReport, loadSalesReport } from './sales-report.ts'

function normalizeDateArg(value: string) {
  const trimmed = value.trim()
  const ddmmyyyy = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`
  return trimmed
}

const [, , fromArg, toArg] = process.argv
const reportPromise =
  fromArg || toArg
    ? loadSalesReport(normalizeDateArg(fromArg ?? ''), normalizeDateArg(toArg ?? ''))
    : loadCurrentMonthSalesReport()

reportPromise
  .then((report) => {
    console.log(buildSalesReportMessage(report))
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
