/**
 * ManpowerPivot.jsx — Headcount Breakdown Pivot Table
 * ─────────────────────────────────────────────────────────────────────────────
 * ตาราง pivot แสดงจำนวน HC Request ที่เปิดใหม่แต่ละเดือน
 * แถว = แผนก หรือ ตำแหน่งงาน (สลับได้)
 * คอลัมน์ = 6 เดือนล่าสุด + คอลัมน์รวม
 *
 * ฟีเจอร์:
 *   - Toggle กลุ่มข้อมูล: แผนก (department) | ตำแหน่ง (position)
 *   - Search filter กรองชื่อแถว
 *   - Heat-map สีเขียว: ยิ่งเข้มยิ่งมี request เยอะ
 *   - แถวรวม (tfoot) แสดงยอดแต่ละเดือน
 *
 * Props:
 *   requests {Array} ข้อมูล HC Request ทั้งหมด (จาก Firestore)
 *
 * หมายเหตุ:
 *   - กรอง Cancelled ออก เพราะไม่ถือเป็น active request
 *   - นับตามวันที่ createdAt (วันที่เปิด request) ไม่ใช่วันที่ปิด
 *   - ถ้า rows = 0 component จะ return null (ไม่แสดงอะไร)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

// ชื่อเดือนภาษาไทย index 0 = ม.ค.
const MONTH_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/**
 * สร้าง array ของ 6 เดือนล่าสุด รูปแบบ "YYYY-MM"
 * เช่น ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"]
 */
function getLast6Months() {
  const now = new Date()
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

/**
 * คืน Tailwind class สำหรับ heat-map coloring
 * intensity = val / maxCell (0–1)
 *   0       → ไม่มีสี (คืน null)
 *   0–0.25  → เขียวอ่อนมาก
 *   0.25–0.5 → เขียวอ่อน
 *   0.5–0.75 → เขียวกลาง
 *   0.75+   → เขียวเข้ม (brand color)
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
  // groupBy: 'department' = แถวคือแผนก | 'position' = แถวคือตำแหน่ง
  const [groupBy, setGroupBy] = useState('department')

  // 6 เดือนล่าสุด — คำนวณครั้งเดียวตอน mount
  const months = useMemo(() => getLast6Months(), [])

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
        const d = r.createdAt?.toDate?.()
        if (!d) return

        const moKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (!months.includes(moKey)) return // ข้ามถ้าเกิน 6 เดือนย้อนหลัง

        // key คือชื่อแผนก หรือชื่อตำแหน่ง ขึ้นอยู่กับ groupBy
        const key = groupBy === 'department'
          ? (r.department || 'ไม่ระบุ')
          : (r.position   || 'ไม่ระบุ')

        if (!map[key]) map[key] = { key, total: 0 }
        map[key][moKey] = (map[key][moKey] || 0) + 1
        map[key].total++
      })

    const rows = Object.values(map).sort((a, b) => b.total - a.total)

    // maxCell ใช้เป็น scale ของ heat-map (ค่าสูงสุดในทุก cell)
    let maxCell = 1
    rows.forEach(r => months.forEach(m => { if ((r[m] || 0) > maxCell) maxCell = r[m] }))

    // totalsRow = ผลรวมแต่ละคอลัมน์เดือน (แถว footer)
    const totalsRow = {}
    months.forEach(m => {
      totalsRow[m] = rows.reduce((s, r) => s + (r[m] || 0), 0)
    })

    // grandTotal = ผลรวมทั้งหมด (มุมขวาล่าง)
    const grandTotal = rows.reduce((s, r) => s + r.total, 0)

    return { rows, maxCell, totalsRow, grandTotal }
  }, [requests, groupBy, months])

  // กรองแถวตาม search input
  const filtered = search
    ? rows.filter(r => r.key.toLowerCase().includes(search.toLowerCase()))
    : rows

  // ไม่มีข้อมูลเลย → ไม่แสดง component
  if (rows.length === 0) return null

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">

      {/* ── Header: ชื่อ + คำอธิบาย + controls ──────────────── */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-50 dark:border-slate-800">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black text-gray-800 dark:text-gray-100 tracking-tight">
              Headcount Breakdown
            </h3>
            {/* คำอธิบายว่าตารางนี้แสดงอะไร */}
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 leading-relaxed">
              จำนวน HC Request ที่<span className="font-bold">เปิดใหม่</span>แต่ละเดือน แยกตาม{groupBy === 'department' ? 'แผนก' : 'ตำแหน่ง'} · 6 เดือนล่าสุด ·{' '}
              <span className="font-bold text-[#008065]">{grandTotal} requests</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle แถวตาม department หรือ position */}
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

            {/* Search กรองชื่อแถว */}
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

      {/* ── Pivot Table ───────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 dark:border-slate-800">
              {/* Column หัวแถว — sticky เพื่อเลื่อนแนวนอนได้ */}
              <th className="px-5 py-3 text-left text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest sticky left-0 bg-white dark:bg-slate-900 min-w-[160px] z-10">
                {groupBy === 'department' ? 'แผนก' : 'ตำแหน่ง'}
              </th>

              {/* Column header ของแต่ละเดือน */}
              {months.map(m => {
                const [yr, mo] = m.split('-')
                return (
                  <th
                    key={m}
                    className="px-3 py-3 text-center text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest min-w-[56px]"
                  >
                    <span className="block">{MONTH_TH[Number(mo) - 1]}</span>
                    <span className="text-[8px] font-bold text-gray-300 dark:text-slate-700">{yr}</span>
                  </th>
                )
              })}

              {/* Column รวม — สีเขียวเพื่อเน้น */}
              <th className="px-4 py-3 text-center text-[10px] font-black text-[#008065] dark:text-emerald-400 uppercase tracking-widest min-w-[52px]">
                รวม
              </th>
            </tr>
          </thead>

          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={months.length + 2} className="px-5 py-10 text-center text-xs text-gray-400 dark:text-slate-600">
                  ไม่พบข้อมูล
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr
                  key={row.key}
                  className={`border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50/80 dark:hover:bg-slate-800/30 transition-colors ${
                    i % 2 !== 0 ? 'bg-gray-50/30 dark:bg-slate-800/10' : '' // zebra stripe
                  }`}
                >
                  {/* ชื่อแผนก/ตำแหน่ง — sticky ซ้ายมือ */}
                  <td className="px-5 py-2.5 text-xs font-semibold text-gray-700 dark:text-gray-300 sticky left-0 bg-inherit z-10 whitespace-nowrap">
                    {row.key}
                  </td>

                  {/* Cell แต่ละเดือน — แสดง count พร้อม heat-map color */}
                  {months.map(m => {
                    const val = row[m] || 0
                    const cls = cellClass(val / maxCell)
                    return (
                      <td key={m} className="px-3 py-2.5 text-center">
                        {val > 0 ? (
                          <span className={`inline-flex items-center justify-center min-w-[22px] h-6 px-1.5 rounded text-[11px] font-black tabular-nums ${cls}`}>
                            {val}
                          </span>
                        ) : (
                          // ไม่มีข้อมูลแสดงเส้นประ
                          <span className="text-gray-200 dark:text-slate-800 text-[10px] select-none">—</span>
                        )}
                      </td>
                    )
                  })}

                  {/* ยอดรวมของแถว */}
                  <td className="px-4 py-2.5 text-center">
                    <span className="text-[12px] font-black tabular-nums text-[#008065] dark:text-emerald-400">
                      {row.total}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {/* ── Total row ───────────────────────────────────────── */}
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 dark:border-slate-700">
                <td className="px-5 py-3 text-[10px] font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-slate-800/60 z-10">
                  รวมทั้งหมด
                </td>
                {months.map(m => (
                  <td key={m} className="px-3 py-3 text-center bg-gray-50 dark:bg-slate-800/60">
                    <span className="text-[12px] font-black tabular-nums text-gray-600 dark:text-slate-300">
                      {totalsRow[m] || 0}
                    </span>
                  </td>
                ))}
                {/* Grand total มุมขวาล่าง */}
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
          {/* แสดง scale จากน้อย (อ่อน) ไปมาก (เข้ม) */}
          {[
            { cls: 'bg-emerald-50 dark:bg-emerald-900/20', label: '1 (น้อย)' },
            { cls: 'bg-emerald-100 dark:bg-emerald-900/30', label: '' },
            { cls: 'bg-emerald-200 dark:bg-emerald-900/50', label: '' },
            { cls: 'bg-[#008065]', label: `${maxCell}+ (มาก)` },
          ].map((s, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className={`w-5 h-4 rounded-sm ${s.cls}`} />
              {s.label && <span className="text-[9px] font-semibold text-gray-400 dark:text-slate-600">{s.label}</span>}
            </span>
          ))}
        </div>
        <span className="ml-auto text-[10px] text-gray-300 dark:text-slate-700">
          — = ไม่มี Request ในเดือนนั้น
        </span>
      </div>
    </div>
  )
}
