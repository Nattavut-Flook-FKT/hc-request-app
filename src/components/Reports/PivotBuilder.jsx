/**
 * PivotBuilder.jsx — ตาราง Pivot ยืดหยุ่น (แทนการ pivot อิสระใน Google Sheets)
 * ─────────────────────────────────────────────────────────────────────────────
 * ผู้ใช้เลือกได้เอง:
 *   - Row    : แผนก / ตำแหน่ง / TA / สถานะ / ประเภท / JG / ประเภทจ้าง
 *   - Column : เดือน / ไตรมาส / สถานะ / ประเภท / ไม่มี
 *   - Measure: จำนวน (Count) / SLA เฉลี่ย / New·Replace split
 * แสดงผลเป็นตาราง pivot พร้อม row/column total + grand total + heat-map
 * Export เป็น Excel หรือ CSV ตามตารางที่เห็นจริง
 *
 * Props:
 *   requests {Array} requests ที่ผ่าน global filter จาก ReportsPage แล้ว
 */
import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import {
  ROW_DIMENSIONS, COLUMN_DIMENSIONS, getDimensionValue, dimensionOrder,
  computeSLADays, isReplacement, statusTH,
} from '../../utils/reportUtils'
import { exportWorkbook, exportCSV, dateStamp } from '../../utils/exportExcel'

const MEASURES = [
  { value: 'count',  label: 'จำนวนคำขอ' },
  { value: 'avgSLA', label: 'เวลาหาคนเฉลี่ย (วัน)' },
  { value: 'nr',     label: 'ขอใหม่ / ขอแทนคนเดิม' },
]

// heat-map ตามความเข้มของ count — dark-green family (DS heat-map recipe)
function heatClass(intensity) {
  if (intensity <= 0)   return ''
  if (intensity < 0.25) return 'bg-dark-green-50 text-dark-green-800'
  if (intensity < 0.5)  return 'bg-dark-green-100 text-dark-green-800'
  if (intensity < 0.75) return 'bg-dark-green-200 text-dark-green-900'
  return 'bg-dark-green-600 text-neutral-50'
}

// ออเดอร์ค่าของ dimension: ใช้ canonical order ถ้ามี ไม่งั้นเรียงตาม total มากสุด
function orderValues(values, dim, totals) {
  const ord = dimensionOrder(dim)
  if (ord) {
    const present = values.filter(v => ord.includes(v)).sort((a, b) => ord.indexOf(a) - ord.indexOf(b))
    const extras  = values.filter(v => !ord.includes(v)).sort()
    return [...present, ...extras]
  }
  return [...values].sort((a, b) => (totals[b]?.count || 0) - (totals[a]?.count || 0))
}

function emptyCell() { return { count: 0, slaSum: 0, slaCount: 0, n: 0, r: 0 } }

function accumulate(cell, req) {
  cell.count++
  const sla = computeSLADays(req)
  if (sla !== '' && !isNaN(sla)) { cell.slaSum += sla; cell.slaCount++ }
  if (isReplacement(req)) cell.r++; else cell.n++
}

// ค่าที่ใช้แสดง/export ของแต่ละ cell ตาม measure
function measureDisplay(cell, measure) {
  if (!cell || cell.count === 0) return null
  if (measure === 'count')  return cell.count
  if (measure === 'avgSLA') return cell.slaCount ? Math.round(cell.slaSum / cell.slaCount) : null
  if (measure === 'nr')     return { n: cell.n, r: cell.r }
  return null
}

function measureExport(cell, measure) {
  const v = measureDisplay(cell, measure)
  if (v == null) return ''
  if (measure === 'nr') return `${v.n} / ${v.r}`
  return v
}

export default function PivotBuilder({ requests }) {
  const [rowDim, setRowDim]   = useState('department')
  const [colDim, setColDim]   = useState('month')
  const [measure, setMeasure] = useState('count')

  const pivot = useMemo(() => {
    const cells = {}        // cells[rowVal][colVal] = cell
    const rowTotals = {}    // rowTotals[rowVal] = cell
    const colTotals = {}    // colTotals[colVal] = cell
    const grand = emptyCell()
    const rowSet = new Set()
    const colSet = new Set()

    requests.forEach(req => {
      const rv = getDimensionValue(req, rowDim)
      const cv = colDim === 'none' ? 'รวม' : getDimensionValue(req, colDim)
      rowSet.add(rv); colSet.add(cv)

      if (!cells[rv]) cells[rv] = {}
      if (!cells[rv][cv]) cells[rv][cv] = emptyCell()
      if (!rowTotals[rv]) rowTotals[rv] = emptyCell()
      if (!colTotals[cv]) colTotals[cv] = emptyCell()

      accumulate(cells[rv][cv], req)
      accumulate(rowTotals[rv], req)
      accumulate(colTotals[cv], req)
      accumulate(grand, req)
    })

    const rowVals = orderValues([...rowSet], rowDim, rowTotals)
    const colVals = colDim === 'none' ? ['รวม'] : orderValues([...colSet], colDim, colTotals)

    // maxCell สำหรับ heat-map (เฉพาะ measure count)
    let maxCell = 1
    rowVals.forEach(rv => colVals.forEach(cv => {
      const c = cells[rv]?.[cv]?.count || 0
      if (c > maxCell) maxCell = c
    }))

    return { cells, rowTotals, colTotals, grand, rowVals, colVals, maxCell }
  }, [requests, rowDim, colDim])

  const rowLabel = ROW_DIMENSIONS.find(d => d.value === rowDim)?.label || rowDim
  const colLabel = COLUMN_DIMENSIONS.find(d => d.value === colDim)?.label || colDim
  const measLabel = MEASURES.find(m => m.value === measure)?.label || measure

  // แสดงค่า dimension เป็นไทยเมื่อเป็นสถานะ (key ข้างในยังเป็นอังกฤษเพื่อคงลำดับ pipeline)
  const rowDisplay = v => (rowDim === 'status' ? statusTH(v) : v)
  const colDisplay = v => (colDim === 'status' ? statusTH(v) : v)

  // ── สร้าง array-of-arrays สำหรับ export ──
  function buildAOA() {
    const { cells, rowTotals, colTotals, grand, rowVals, colVals } = pivot
    const header = [`${rowLabel} \\ ${colDim === 'none' ? measLabel : colLabel}`, ...colVals.map(colDisplay), 'รวม']
    const body = rowVals.map(rv => [
      rowDisplay(rv),
      ...colVals.map(cv => measureExport(cells[rv]?.[cv], measure)),
      measureExport(rowTotals[rv], measure),
    ])
    const totalRow = ['รวม', ...colVals.map(cv => measureExport(colTotals[cv], measure)), measureExport(grand, measure)]
    return [header, ...body, totalRow]
  }

  function handleExportExcel() {
    exportWorkbook(`pivot_${rowDim}_x_${colDim}_${measure}_${dateStamp()}`, [{ name: 'Pivot', aoa: buildAOA() }])
  }
  function handleExportCSV() {
    exportCSV(`pivot_${rowDim}_x_${colDim}_${measure}_${dateStamp()}`, buildAOA())
  }

  const { cells, rowTotals, colTotals, grand, rowVals, colVals, maxCell } = pivot

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white">
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-100 px-6 pb-4 pt-5">
        <div className="flex flex-wrap items-end gap-3">
          <Selector label="แถว (Row)"    value={rowDim}  onChange={setRowDim}  options={ROW_DIMENSIONS} />
          <Selector label="คอลัมน์ (Column)" value={colDim}  onChange={setColDim}  options={COLUMN_DIMENSIONS} />
          <Selector label="ค่า (Measure)" value={measure} onChange={setMeasure} options={MEASURES} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportExcel} disabled={rowVals.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-dark-green-600 px-3 py-2 text-xs font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:bg-neutral-50 disabled:text-neutral-300">
            <FileSpreadsheet size={14} strokeWidth={1} absoluteStrokeWidth /> Excel
          </button>
          <button onClick={handleExportCSV} disabled={rowVals.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-100 px-3 py-2 text-xs font-bold text-neutral-600 transition-colors hover:bg-neutral-50 disabled:text-neutral-300">
            <Download size={14} strokeWidth={1} absoluteStrokeWidth /> CSV
          </button>
        </div>
      </div>

      {/* ── Pivot table ── */}
      <div className="overflow-x-auto">
        {rowVals.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-neutral-400">ไม่มีข้อมูลตามตัวกรองที่เลือก</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className="sticky left-0 z-10 min-w-[160px] bg-white px-5 py-3 text-left text-[11px] font-bold text-neutral-500">
                  {rowLabel}
                </th>
                {colVals.map(cv => (
                  <th key={cv} className="min-w-[64px] px-3 py-3 text-center text-[11px] font-bold text-neutral-500">
                    {colDisplay(cv)}
                  </th>
                ))}
                <th className="min-w-[64px] px-4 py-3 text-center text-[11px] font-bold text-dark-green-700">รวม</th>
              </tr>
            </thead>
            <tbody>
              {rowVals.map((rv) => (
                <tr key={rv} className="border-b border-neutral-100 transition-colors last:border-0 hover:bg-neutral-50">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-5 py-2.5 text-xs font-bold text-neutral-700">{rowDisplay(rv)}</td>
                  {colVals.map(cv => (
                    <td key={cv} className="px-3 py-2.5 text-center">
                      <Cell cell={cells[rv]?.[cv]} measure={measure} maxCell={maxCell} />
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-center">
                    <Cell cell={rowTotals[rv]} measure={measure} maxCell={maxCell} isTotal />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-100">
                <td className="sticky left-0 z-10 bg-neutral-50 px-5 py-3 text-[11px] font-bold text-neutral-600">รวมทั้งหมด</td>
                {colVals.map(cv => (
                  <td key={cv} className="bg-neutral-50 px-3 py-3 text-center">
                    <Cell cell={colTotals[cv]} measure={measure} maxCell={maxCell} isTotal />
                  </td>
                ))}
                <td className="bg-neutral-50 px-4 py-3 text-center">
                  <Cell cell={grand} measure={measure} maxCell={maxCell} isTotal />
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Dropdown selector ──
function Selector({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold text-neutral-500">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 rounded-lg border border-neutral-100 bg-neutral-50 px-3 text-xs font-bold text-neutral-700 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

// ── Cell renderer ตาม measure ──
function Cell({ cell, measure, maxCell, isTotal }) {
  const v = measureDisplay(cell, measure)
  if (v == null) return <span className="select-none text-[11px] text-neutral-200">—</span>

  if (measure === 'nr') {
    return (
      <div className="flex items-center justify-center gap-1">
        {v.n > 0 && <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded px-1.5 text-[11px] font-bold tabular-nums bg-dark-green-100 text-dark-green-800">{v.n}N</span>}
        {v.r > 0 && <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded px-1.5 text-[11px] font-bold tabular-nums bg-orange-100 text-orange-900">{v.r}R</span>}
      </div>
    )
  }

  if (measure === 'avgSLA') {
    return (
      <span className={`inline-flex h-6 min-w-[28px] items-center justify-center rounded px-1.5 text-[11px] font-bold tabular-nums ${isTotal ? 'text-dark-green-700' : 'text-neutral-700'}`}>
        {v}
      </span>
    )
  }

  // count
  const cls = isTotal ? 'text-dark-green-700' : heatClass(cell.count / maxCell)
  return (
    <span className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded px-1.5 text-[11px] font-bold tabular-nums ${cls}`}>
      {v}
    </span>
  )
}
