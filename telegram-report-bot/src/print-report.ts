import 'dotenv/config'
import { buildSalesReportMessage, loadCurrentMonthSalesReport } from './sales-report.ts'

loadCurrentMonthSalesReport()
  .then((report) => {
    console.log(buildSalesReportMessage(report))
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
