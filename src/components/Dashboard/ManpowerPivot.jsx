/**
 * ManpowerPivot.jsx — Headcount Breakdown Pivot Table
 * ─────────────────────────────────────────────────────────────────────────────
 * ตาราง pivot แสดงจำนวน HC Request ที่เปิดใหม่แต่ละเดือน
 * แถว = แผนก หรือ ตำแหน่งงาน (สลับได้)
 * คอลัมน์ = 12 เดือน (ม.ค.–ธ.ค.) ของปีที่เลือก + คอลัมน์รวม
 *
 * ฟีเจอร์:
 *   - Year selector: กดเลือกปี (ดึงจากข้อมูล + ปีปัจจุบัน)
 *   - แสดงเดือนล่วงหน้า (future months ของปีนั้นก็โชว์)
 *   - Toggle กลุ่มข้อมูล: แผนก (department) | ตำแหน่ง (position)
 *   - Search filter กรองชื่อแถว
 *   - Heat-map สีเขียว: ยิ่งเข้มยิ่งมี request เยอะ
 *   - แถวรวม (tfoot) แสดงยอดแต่ละเดือน
 *
 * Props:
 *   requests {Array} ข้อมูล HC Request ทั้งหมด (จาก Firestore)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo, useState } from 'react'
import { Search, Download } from 'lucide-react'
import { MONTH_TH, toDate } from '../../utils/reportUtils'

/** สร้าง array 12 เดือนของปีที่ระบุ ["YYYY-01", ..., "YYYY-12"] */
function getYearMonths(year) {
  return Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, '0')}`
  )
}

/** Badge คู่ N (New HC, เขียว) / R (Replace, ส้ม) — แสดงแยกชนิดแทนตัวเลขรวมตัวเดียว */
function NRChips({ n, r }) {
  return (
    <div className="flex items-center justify-center gap-1">
      {n > 0 && (
        <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded px-1.5 text-[11px] font-bold tabular-nums bg-dark-green-100 text-dark-green-800">
          {n}N
        </span>
      )}
      {r > 0 && (
        <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded px-1.5 text-[11px] font-bold tabular-nums bg-orange-100 text-orange-900">
          {r}R
        </span>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
export default function ManpowerPivot({ requests }) {
  const [search,  setSearch]  = useState('')
  const [groupBy, setGroupBy] = useState('department')

  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(currentYear)

  /** ปีที่แสดงใน selector — fixed 2024–2027 */
  const availableYears = [2024, 2025, 2026, 2027]

  /** 12 เดือนของปีที่เลือก */
  const months = useMemo(() => getYearMonths(selectedYear), [selectedYear])

  /** เดือนปัจจุบัน "YYYY-MM" เพื่อ mark future months */
  const nowKey = useMemo(() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
  }, [])

  /**
   * สร้าง rows ของตาราง pivot
   * แต่ละ row = { key: string, [YYYY-MM]: count, total: number }
   * เรียงตาม total มากสุดก่อน
   */
  const { rows, totalsRow, grandTotal, grandTotalN, grandTotalR } = useMemo(() => {
    const map = {}

    requests
      .filter(r => r.status !== 'Cancelled')
      .forEach(r => {
        const d = toDate(r.createdAt)
        if (!d) return

        const moKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (!months.includes(moKey)) return // ข้ามถ้าไม่อยู่ในปีที่เลือก

        const key = groupBy === 'department'
          ? (r.department || 'ไม่ระบุ')
          : (r.position   || 'ไม่ระบุ')
        const isNew = r.requestType === 'New HC'

        if (!map[key]) map[key] = { key, total: 0, totalN: 0, totalR: 0 }
        if (!map[key][moKey]) map[key][moKey] = { total: 0, n: 0, r: 0 }
        map[key][moKey].total++
        if (isNew) { map[key][moKey].n++; map[key].totalN++ } else { map[key][moKey].r++; map[key].totalR++ }
        map[key].total++
      })

    const rows = Object.values(map).sort((a, b) => b.total - a.total)

    const totalsRow = {}
    months.forEach(m => {
      totalsRow[m] = rows.reduce((acc, r) => {
        const cell = r[m]
        if (cell) { acc.total += cell.total; acc.n += cell.n; acc.r += cell.r }
        return acc
      }, { total: 0, n: 0, r: 0 })
    })

    const grandTotal  = rows.reduce((s, r) => s + r.total, 0)
    const grandTotalN = rows.reduce((s, r) => s + r.totalN, 0)
    const grandTotalR = rows.reduce((s, r) => s + r.totalR, 0)

    return { rows, totalsRow, grandTotal, grandTotalN, grandTotalR }
  }, [requests, groupBy, months])

  // กรองแถวตาม search input
  const filtered = search
    ? rows.filter(r => r.key.toLowerCase().includes(search.toLowerCase()))
    : rows

  /** Export ตารางที่แสดงอยู่เป็น CSV (UTF-8 BOM เพื่อให้ Excel อ่านภาษาไทยได้) */
  function handleExportCSV() {
    const groupLabel = groupBy === 'department' ? 'แผนก' : 'ตำแหน่ง'

    // Header row: [แผนก, ม.ค.2026, ก.พ.2026, ..., รวม]
    const headers = [
      groupLabel,
      ...months.map(m => {
        const [yr, mo] = m.split('-')
        return `${MONTH_TH[Number(mo) - 1]}${yr}`
      }),
      'รวม',
    ]

    // Data rows
    const dataRows = filtered.map(row => [
      row.key,
      ...months.map(m => row[m]?.total || 0),
      row.total,
    ])

    // Totals row
    const totalsData = [
      'รวมทั้งหมด',
      ...months.map(m => totalsRow[m]?.total || 0),
      grandTotal,
    ]

    const allRows = [headers, ...dataRows, totalsData]
    const csv = allRows.map(row => row.map(c => `"${c}"`).join(',')).join('\n')

    // BOM + download
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `headcount-breakdown-${selectedYear}-${groupBy}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ไม่มีข้อมูลเลย → ไม่แสดง component
  if (rows.length === 0 && availableYears.length === 0) return null

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="border-b border-neutral-100 px-6 pb-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">

          {/* ชื่อ + คำอธิบาย + Year selector */}
          <div className="flex flex-col gap-2">
            <div>
              <h3 className="text-sm font-bold text-neutral-900">
                Headcount Breakdown
              </h3>
              <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                จำนวน HC Request ที่<span className="font-bold">เปิดใหม่</span>แต่ละเดือน แยกตาม{groupBy === 'department' ? 'แผนก' : 'ตำแหน่ง'} ·{' '}
                <span className="font-bold text-dark-green-700">{grandTotal} คำขอ</span>
                {' '}({grandTotalN} ตำแหน่งใหม่ / {grandTotalR} ตำแหน่งแทน) ในปี {selectedYear}
              </p>
            </div>

            {/* Year selector chips */}
            <div className="flex items-center gap-1.5">
              {availableYears.map(yr => (
                <button
                  key={yr}
                  onClick={() => setSelectedYear(yr)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                    selectedYear === yr
                      ? 'border-dark-green-600 bg-dark-green-600 text-neutral-50'
                      : 'border-neutral-100 bg-white text-neutral-500 hover:border-dark-green-100 hover:text-dark-green-700'
                  }`}
                >
                  {yr}
                </button>
              ))}
            </div>
          </div>

          {/* Controls: export + toggle + search */}
          <div className="flex items-center gap-2">
            {/* Export CSV */}
            <button
              onClick={handleExportCSV}
              title={`Export CSV ปี ${selectedYear}`}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-100 bg-white px-3 py-1.5 text-[11px] font-bold text-neutral-500 transition-colors hover:border-dark-green-100 hover:text-dark-green-700"
            >
              <Download size={12} strokeWidth={1} absoluteStrokeWidth />
              CSV
            </button>

            <div className="flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5">
              {[{ v: 'department', l: 'แผนก' }, { v: 'position', l: 'ตำแหน่ง' }].map(t => (
                <button
                  key={t.v}
                  onClick={() => setGroupBy(t.v)}
                  className={`rounded-md px-3 py-1 text-[11px] font-bold transition-colors ${
                    groupBy === t.v
                      ? 'bg-white text-neutral-900'
                      : 'text-neutral-400 hover:text-neutral-600'
                  }`}
                >
                  {t.l}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search size={11} strokeWidth={1} absoluteStrokeWidth className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                placeholder="ค้นหา..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-28 rounded-lg border border-neutral-100 bg-white py-1.5 pl-7 pr-3 text-[11px] text-neutral-700 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Pivot Table ──────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-neutral-100">
              {/* Column หัวแถว — sticky */}
              <th className="sticky left-0 z-10 min-w-[160px] bg-white px-5 py-3 text-left text-[11px] font-bold text-neutral-500">
                {groupBy === 'department' ? 'แผนก' : 'ตำแหน่ง'}
              </th>

              {/* Month columns */}
              {months.map(m => {
                const [, mo] = m.split('-')
                const isFuture = m > nowKey
                return (
                  <th
                    key={m}
                    className={`min-w-[52px] px-3 py-3 text-center text-[11px] font-bold ${
                      isFuture
                        ? 'text-neutral-300'
                        : 'text-neutral-500'
                    }`}
                  >
                    {MONTH_TH[Number(mo) - 1]}
                    {isFuture && (
                      <span className="block text-[10px] font-normal text-neutral-300">
                        ล่วงหน้า
                      </span>
                    )}
                  </th>
                )
              })}

              {/* Column รวม */}
              <th className="min-w-[52px] px-4 py-3 text-center text-[11px] font-bold text-dark-green-700">
                รวม
              </th>
            </tr>
          </thead>

          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={months.length + 2} className="px-5 py-10 text-center text-xs text-neutral-400">
                  ไม่มีข้อมูลในปี {selectedYear}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr
                  key={row.key}
                  className="border-b border-neutral-100 transition-colors last:border-0 hover:bg-neutral-50"
                >
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-5 py-2.5 text-xs font-bold text-neutral-700">
                    {row.key}
                  </td>

                  {months.map(m => {
                    const cell = row[m]
                    const val = cell?.total || 0
                    const isFuture = m > nowKey
                    return (
                      <td key={m} className={`px-3 py-2.5 text-center ${isFuture ? 'opacity-50' : ''}`}>
                        {val > 0 ? (
                          <NRChips n={cell.n} r={cell.r} />
                        ) : (
                          <span className="select-none text-[11px] text-neutral-200">—</span>
                        )}
                      </td>
                    )
                  })}

                  <td className="px-4 py-2.5 text-center">
                    <NRChips n={row.totalN} r={row.totalR} />
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {/* ── Total row ──────────────────────────────────────── */}
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-neutral-100">
                <td className="sticky left-0 z-10 bg-neutral-50 px-5 py-3 text-[11px] font-bold text-neutral-600">
                  รวมทั้งหมด
                </td>
                {months.map(m => {
                  const isFuture = m > nowKey
                  const cell = totalsRow[m] || { total: 0, n: 0, r: 0 }
                  return (
                    <td key={m} className={`bg-neutral-50 px-3 py-3 text-center ${isFuture ? 'opacity-50' : ''}`}>
                      {cell.total > 0 ? (
                        <NRChips n={cell.n} r={cell.r} />
                      ) : (
                        <span className="select-none text-[11px] text-neutral-300">—</span>
                      )}
                    </td>
                  )
                })}
                <td className="bg-neutral-50 px-4 py-3 text-center">
                  <NRChips n={grandTotalN} r={grandTotalR} />
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Footer: N/R legend ───────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 border-t border-neutral-100 px-5 py-3">
        <span className="text-[11px] font-bold text-neutral-400">
          ประเภทคำขอ:
        </span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-5 min-w-[24px] items-center justify-center rounded bg-dark-green-100 text-[11px] font-bold text-dark-green-800">N</span>
            <span className="text-[11px] font-bold text-neutral-400">New HC</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-5 min-w-[24px] items-center justify-center rounded bg-orange-100 text-[11px] font-bold text-orange-900">R</span>
            <span className="text-[11px] font-bold text-neutral-400">Replace</span>
          </span>
        </div>
        <span className="ml-auto text-[11px] text-neutral-300">
          — = ไม่มี Request · เดือนล่วงหน้า = opacity ลด
        </span>
      </div>
    </div>
  )
}
