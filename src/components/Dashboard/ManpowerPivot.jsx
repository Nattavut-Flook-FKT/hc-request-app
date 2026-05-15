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

// ชื่อเดือนภาษาไทย index 0 = ม.ค.
const MONTH_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/**
 * แปลง createdAt เป็น Date object
 * รองรับทั้ง Firestore Timestamp (imported) และ ISO string (web app)
 */
function toDate(v) {
  if (!v) return null
  if (typeof v?.toDate === 'function') return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

/** สร้าง array 12 เดือนของปีที่ระบุ ["YYYY-01", ..., "YYYY-12"] */
function getYearMonths(year) {
  return Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, '0')}`
  )
}

/**
 * คืน Tailwind class สำหรับ heat-map coloring
 * intensity = val / maxCell (0–1)
 */
function cellClass(intensity) {
  if (intensity <= 0)   return null
  if (intensity < 0.25) return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
  if (intensity < 0.5)  return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300'
  if (intensity < 0.75) return 'bg-emerald-200 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-200'
  return 'bg-[#008065] text-white'
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
  const { rows, maxCell, totalsRow, grandTotal } = useMemo(() => {
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

        if (!map[key]) map[key] = { key, total: 0 }
        map[key][moKey] = (map[key][moKey] || 0) + 1
        map[key].total++
      })

    const rows = Object.values(map).sort((a, b) => b.total - a.total)

    let maxCell = 1
    rows.forEach(r => months.forEach(m => { if ((r[m] || 0) > maxCell) maxCell = r[m] }))

    const totalsRow = {}
    months.forEach(m => {
      totalsRow[m] = rows.reduce((s, r) => s + (r[m] || 0), 0)
    })

    const grandTotal = rows.reduce((s, r) => s + r.total, 0)

    return { rows, maxCell, totalsRow, grandTotal }
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
      ...months.map(m => row[m] || 0),
      row.total,
    ])

    // Totals row
    const totalsData = [
      'รวมทั้งหมด',
      ...months.map(m => totalsRow[m] || 0),
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
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-50 dark:border-slate-800">
        <div className="flex items-start justify-between gap-4 flex-wrap">

          {/* ชื่อ + คำอธิบาย + Year selector */}
          <div className="flex flex-col gap-2">
            <div>
              <h3 className="text-sm font-black text-gray-800 dark:text-gray-100 tracking-tight">
                Headcount Breakdown
              </h3>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                จำนวน HC Request ที่<span className="font-bold">เปิดใหม่</span>แต่ละเดือน แยกตาม{groupBy === 'department' ? 'แผนก' : 'ตำแหน่ง'} ·{' '}
                <span className="font-bold text-[#008065]">{grandTotal} requests</span>
                {' '}ในปี {selectedYear}
              </p>
            </div>

            {/* Year selector chips */}
            <div className="flex items-center gap-1.5">
              {availableYears.map(yr => (
                <button
                  key={yr}
                  onClick={() => setSelectedYear(yr)}
                  className={`px-3 py-1 rounded-full text-[11px] font-black tracking-wider transition-all border ${
                    selectedYear === yr
                      ? 'bg-[#008065] text-white border-[#008065] shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:border-[#008065] hover:text-[#008065]'
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:border-[#008065] hover:text-[#008065] dark:hover:text-emerald-400 text-[10px] font-black uppercase tracking-wider transition-all"
            >
              <Download size={12} />
              CSV
            </button>

            <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-slate-800 rounded-lg">
              {[{ v: 'department', l: 'แผนก' }, { v: 'position', l: 'ตำแหน่ง' }].map(t => (
                <button
                  key={t.v}
                  onClick={() => setGroupBy(t.v)}
                  className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                    groupBy === t.v
                      ? 'bg-white dark:bg-slate-900 text-gray-800 dark:text-gray-200 shadow-sm'
                      : 'text-gray-400 dark:text-slate-600 hover:text-gray-600 dark:hover:text-slate-400'
                  }`}
                >
                  {t.l}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-600" />
              <input
                type="text"
                placeholder="ค้นหา..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-7 pr-3 py-1.5 text-[11px] rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-[#008065] w-28"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Pivot Table ──────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 dark:border-slate-800">
              {/* Column หัวแถว — sticky */}
              <th className="px-5 py-3 text-left text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest sticky left-0 bg-white dark:bg-slate-900 min-w-[160px] z-10">
                {groupBy === 'department' ? 'แผนก' : 'ตำแหน่ง'}
              </th>

              {/* Month columns */}
              {months.map(m => {
                const [, mo] = m.split('-')
                const isFuture = m > nowKey
                return (
                  <th
                    key={m}
                    className={`px-3 py-3 text-center text-[10px] font-black uppercase tracking-widest min-w-[52px] ${
                      isFuture
                        ? 'text-gray-300 dark:text-slate-700'
                        : 'text-gray-400 dark:text-slate-600'
                    }`}
                  >
                    {MONTH_TH[Number(mo) - 1]}
                    {isFuture && (
                      <span className="block text-[7px] font-semibold text-gray-300 dark:text-slate-700 normal-case tracking-normal">
                        ล่วงหน้า
                      </span>
                    )}
                  </th>
                )
              })}

              {/* Column รวม */}
              <th className="px-4 py-3 text-center text-[10px] font-black text-[#008065] dark:text-emerald-400 uppercase tracking-widest min-w-[52px]">
                รวม
              </th>
            </tr>
          </thead>

          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={months.length + 2} className="px-5 py-10 text-center text-xs text-gray-400 dark:text-slate-600">
                  ไม่มีข้อมูลในปี {selectedYear}
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr
                  key={row.key}
                  className={`border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50/80 dark:hover:bg-slate-800/30 transition-colors ${
                    i % 2 !== 0 ? 'bg-gray-50/30 dark:bg-slate-800/10' : ''
                  }`}
                >
                  <td className="px-5 py-2.5 text-xs font-semibold text-gray-700 dark:text-gray-300 sticky left-0 bg-inherit z-10 whitespace-nowrap">
                    {row.key}
                  </td>

                  {months.map(m => {
                    const val = row[m] || 0
                    const cls = cellClass(val / maxCell)
                    const isFuture = m > nowKey
                    return (
                      <td key={m} className={`px-3 py-2.5 text-center ${isFuture ? 'opacity-50' : ''}`}>
                        {val > 0 ? (
                          <span className={`inline-flex items-center justify-center min-w-[22px] h-6 px-1.5 rounded text-[11px] font-black tabular-nums ${cls}`}>
                            {val}
                          </span>
                        ) : (
                          <span className="text-gray-200 dark:text-slate-800 text-[10px] select-none">—</span>
                        )}
                      </td>
                    )
                  })}

                  <td className="px-4 py-2.5 text-center">
                    <span className="text-[12px] font-black tabular-nums text-[#008065] dark:text-emerald-400">
                      {row.total}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {/* ── Total row ──────────────────────────────────────── */}
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 dark:border-slate-700">
                <td className="px-5 py-3 text-[10px] font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-slate-800/60 z-10">
                  รวมทั้งหมด
                </td>
                {months.map(m => {
                  const isFuture = m > nowKey
                  return (
                    <td key={m} className={`px-3 py-3 text-center bg-gray-50 dark:bg-slate-800/60 ${isFuture ? 'opacity-50' : ''}`}>
                      <span className="text-[12px] font-black tabular-nums text-gray-600 dark:text-slate-300">
                        {totalsRow[m] || 0}
                      </span>
                    </td>
                  )
                })}
                <td className="px-4 py-3 text-center bg-gray-50 dark:bg-slate-800/60">
                  <span className="text-[13px] font-black tabular-nums text-[#008065] dark:text-emerald-400">
                    {grandTotal}
                  </span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Footer: Heat-map legend ───────────────────────────── */}
      <div className="px-5 py-3 border-t border-gray-50 dark:border-slate-800 flex items-center gap-4 flex-wrap">
        <span className="text-[10px] font-semibold text-gray-400 dark:text-slate-600">
          สีเซลล์ = ความหนาแน่นของ Request ในเดือนนั้น:
        </span>
        <div className="flex items-center gap-1.5">
          {[
            { cls: 'bg-emerald-50 dark:bg-emerald-900/20', label: '1 (น้อย)' },
            { cls: 'bg-emerald-100 dark:bg-emerald-900/30', label: '' },
            { cls: 'bg-emerald-200 dark:bg-emerald-900/50', label: '' },
            { cls: 'bg-[#008065]', label: `${maxCell}+ (มาก)` },
          ].map((s, idx) => (
            <span key={idx} className="flex items-center gap-1">
              <span className={`w-5 h-4 rounded-sm ${s.cls}`} />
              {s.label && <span className="text-[9px] font-semibold text-gray-400 dark:text-slate-600">{s.label}</span>}
            </span>
          ))}
        </div>
        <span className="ml-auto text-[10px] text-gray-300 dark:text-slate-700">
          — = ไม่มี Request · เดือนล่วงหน้า = opacity ลด
        </span>
      </div>
    </div>
  )
}
