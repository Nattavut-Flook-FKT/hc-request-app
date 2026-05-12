/**
 * YoYChart.jsx — Year-over-Year Bar Chart
 * ─────────────────────────────────────────────────────────────────────────────
 * แสดงจำนวน HC Request ที่เปิดใหม่แต่ละเดือน เปรียบเทียบปีนี้ vs ปีที่แล้ว
 *
 * ลักษณะกราฟ:
 *   - แท่งคู่ต่อเดือน: สีเขียว (#008065) = ปีนี้, สีเทา = ปีที่แล้ว
 *   - Y-axis ซ้ายมือแสดง 0 / ครึ่ง / max
 *   - Grid line แนวนอน 2 เส้น (50% + top)
 *   - ตัวเลขบนแท่ง = จำนวนปีนี้, ตัวเลขเล็กด้านบน = ผลต่างเทียบเดือนเดียวกันปีที่แล้ว
 *   - เดือนในอนาคต (หลังเดือนปัจจุบัน) แสดงแท่งสีซีด opacity 20%
 *
 * Interaction:
 *   กดแท่งเดือน → เรียก onMonthClick("YYYY-MM")
 *   กดซ้ำ (เดือนที่ selected) → เรียก onMonthClick(null) เพื่อ clear
 *
 * Props:
 *   requests      {Array}    ข้อมูล HC Request ทั้งหมด (จาก Firestore)
 *   onMonthClick  {Function} callback(monthKey: string|null) เมื่อกดเดือน
 *   selectedMonth {string|null} เดือนที่ถูก highlight รูปแบบ "YYYY-MM"
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react'
import { MousePointerClick } from 'lucide-react'

// ชื่อเดือนภาษาไทย index 0 = ม.ค.
const MONTH_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// ความสูงพื้นที่แท่ง (px) — ปรับตรงนี้ถ้าต้องการกราฟสูง/เตี้ยกว่านี้
const CHART_H = 96

export default function YoYChart({ requests, onMonthClick, selectedMonth }) {
  const now       = new Date()
  const thisYear  = now.getFullYear()
  const lastYear  = thisYear - 1
  const currentMo = now.getMonth() // 0-indexed (เดือนปัจจุบัน)

  /**
   * นับ request รายเดือนแยกตามปี
   * ty[0..11] = จำนวนปีนี้ แต่ละเดือน (index 0 = ม.ค.)
   * ly[0..11] = จำนวนปีที่แล้ว
   * กรอง Cancelled ออก เพราะไม่ถือว่าเป็น active request
   */
  const { ty, ly } = useMemo(() => {
    const ty = Array(12).fill(0)
    const ly = Array(12).fill(0)
    requests
      .filter(r => r.status !== 'Cancelled')
      .forEach(r => {
        const d = r.createdAt?.toDate?.()
        if (!d) return
        const yr = d.getFullYear()
        const mo = d.getMonth()
        if (yr === thisYear)      ty[mo]++
        else if (yr === lastYear) ly[mo]++
      })
    return { ty, ly }
  }, [requests, thisYear, lastYear])

  // ค่าสูงสุดในทุกเดือนทุกปี — ใช้เป็น base สำหรับคำนวณ pixel height
  const maxVal  = Math.max(...ty, ...ly, 1)

  // ยอดรวมทั้งปี
  const totalTY = ty.reduce((a, b) => a + b, 0)
  const totalLY = ly.reduce((a, b) => a + b, 0)
  const delta   = totalTY - totalLY // บวก = เพิ่มขึ้น, ลบ = ลดลง

  // ผลต่างรายเดือน ty[i] - ly[i] — แสดงเป็น badge ขนาดเล็กบนกราฟ
  const monthlyDelta = ty.map((v, i) => v - ly[i])

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">

      {/* ── Header: ชื่อ + คำอธิบาย + KPI trio ──────────────── */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-50 dark:border-slate-800">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h3 className="text-sm font-black text-gray-800 dark:text-gray-100 tracking-tight">
              จำนวน HC Request รายเดือน
            </h3>
            {/* คำอธิบายสั้นๆ ว่ากราฟนี้ดูอะไร */}
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 max-w-md leading-relaxed">
              แสดงจำนวนคำขออัตรากำลังที่เปิดใหม่แต่ละเดือน เปรียบเทียบ
              <span className="font-bold text-[#008065]"> ปีนี้ ({thisYear})</span> กับ
              <span className="font-bold text-slate-400"> ปีที่แล้ว ({lastYear})</span>
              <span className="ml-1 text-gray-400">· ตัวเลขบนแท่ง = ผลต่างเทียบเดือนเดียวกันปีที่แล้ว</span>
            </p>
          </div>

          {/* KPI trio: ยอดรวมปีนี้ / ปีที่แล้ว / ผลต่าง YoY */}
          <div className="flex items-stretch gap-0 rounded-xl border border-gray-100 dark:border-slate-800 overflow-hidden shrink-0">
            {[
              {
                label: `ปีนี้ (${thisYear})`,
                value: totalTY,
                color: 'text-gray-800 dark:text-gray-100',
                dot: '#008065',
              },
              {
                label: `ปีที่แล้ว (${lastYear})`,
                value: totalLY,
                color: 'text-gray-400 dark:text-slate-500',
                dot: '#cbd5e1',
              },
              {
                label: 'ผลต่าง YoY',
                value: (delta > 0 ? '+' : '') + delta,
                // สีแดง = เพิ่มขึ้น (หมายถึงโหลดงานมากขึ้น), เขียว = ลดลง, เทา = เท่ากัน
                color: delta > 0 ? 'text-red-500' : delta < 0 ? 'text-[#008065]' : 'text-gray-400',
                dot: null,
                hint: delta > 0 ? 'เพิ่มขึ้นจากปีที่แล้ว' : delta < 0 ? 'ลดลงจากปีที่แล้ว' : 'เท่ากัน',
              },
            ].map((k, i) => (
              <div
                key={k.label}
                className={`px-4 py-2.5 text-right ${i > 0 ? 'border-l border-gray-100 dark:border-slate-800' : ''}`}
                title={k.hint}
              >
                <div className="flex items-center gap-1.5 justify-end mb-0.5">
                  {k.dot && (
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: k.dot }} />
                  )}
                  <p className={`text-xl font-black tabular-nums leading-none ${k.color}`}>
                    {k.value}
                  </p>
                </div>
                <p className="text-[9px] font-bold text-gray-400 dark:text-slate-600 uppercase tracking-wider">
                  {k.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Chart area ────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-3">
        <div className="flex gap-2">

          {/* Y-axis: แสดง 0 / ครึ่ง / max เพื่อให้อ่านค่าได้ง่ายขึ้น */}
          <div
            className="flex flex-col justify-between items-end shrink-0 pb-6 text-[9px] tabular-nums font-bold text-gray-300 dark:text-slate-700"
            style={{ height: `${CHART_H + 24}px` }}
          >
            <span>{maxVal}</span>
            <span>{Math.round(maxVal / 2)}</span>
            <span>0</span>
          </div>

          {/* Bars + month labels */}
          <div className="flex-1 flex flex-col gap-0">
            <div className="relative flex-1">
              {/* Grid lines แนวนอน — top / 50% / bottom */}
              <div className="absolute inset-x-0 top-0 border-t border-gray-100 dark:border-slate-800/60" />
              <div className="absolute inset-x-0 border-t border-gray-100 dark:border-slate-800/60" style={{ top: '50%' }} />
              <div className="absolute inset-x-0 bottom-0 border-t border-gray-200 dark:border-slate-700" />

              {/* Bars row — ทุก 12 เดือน */}
              <div className="flex items-end gap-1" style={{ height: `${CHART_H}px` }}>
                {Array.from({ length: 12 }, (_, mo) => {
                  const tyVal = ty[mo]
                  const lyVal = ly[mo]

                  // แปลงค่าเป็น pixel โดยเทียบกับ maxVal
                  // minHeight 4px เพื่อให้เห็นแท่งแม้ค่าน้อยมาก
                  const tyPx  = maxVal > 0 ? Math.max((tyVal / maxVal) * CHART_H, tyVal > 0 ? 4 : 0) : 0
                  const lyPx  = maxVal > 0 ? Math.max((lyVal / maxVal) * CHART_H, lyVal > 0 ? 4 : 0) : 0

                  const moKey      = `${thisYear}-${String(mo + 1).padStart(2, '0')}`
                  const isSelected = selectedMonth === moKey
                  const isFuture   = mo > currentMo   // เดือนที่ยังไม่ถึง
                  const diff       = monthlyDelta[mo]

                  return (
                    <div
                      key={mo}
                      className="flex-1 flex flex-col items-center justify-end gap-0.5 cursor-pointer group relative"
                      onClick={() => onMonthClick?.(isSelected ? null : moKey)}
                      title={`${MONTH_TH[mo]} — ปีนี้: ${tyVal} · ปีที่แล้ว: ${lyVal}${diff !== 0 ? ` · ผลต่าง: ${diff > 0 ? '+' : ''}${diff}` : ''}`}
                    >
                      {/* Delta badge เหนือกราฟ — แสดงเฉพาะที่มีข้อมูลและไม่ใช่เดือนอนาคต */}
                      <div className="absolute -top-5 left-0 right-0 flex items-center justify-center">
                        {diff !== 0 && tyVal > 0 && !isFuture && (
                          <span className={`text-[8px] font-black tabular-nums leading-none ${
                            diff > 0 ? 'text-red-400' : 'text-[#008065] dark:text-emerald-400'
                          }`}>
                            {diff > 0 ? '+' : ''}{diff}
                          </span>
                        )}
                      </div>

                      {/* จำนวนปีนี้ — แสดงบนแท่งสีเขียว */}
                      {tyVal > 0 && (
                        <span className={`text-[9px] font-black tabular-nums leading-none mb-0.5 ${
                          isSelected ? 'text-[#008065] dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'
                        }`}>
                          {tyVal}
                        </span>
                      )}

                      {/* แท่งคู่: ปีที่แล้ว (ซ้าย/เทา) + ปีนี้ (ขวา/เขียว) */}
                      <div
                        className={`w-full flex items-end gap-0.5 transition-all ${
                          isSelected
                            ? 'rounded-sm ring-2 ring-[#008065] ring-offset-1 ring-offset-white dark:ring-offset-slate-900'
                            : 'group-hover:opacity-75'
                        }`}
                        style={{ height: `${CHART_H}px` }}
                      >
                        {/* แท่งปีที่แล้ว */}
                        <div
                          className="flex-1 rounded-t-sm transition-all duration-300"
                          style={{ height: `${lyPx}px`, backgroundColor: '#e2e8f0' }}
                        />
                        {/* แท่งปีนี้ — ซีดถ้าเป็นเดือนอนาคต */}
                        <div
                          className={`flex-1 rounded-t-sm transition-all duration-300 ${isFuture ? 'opacity-20' : ''}`}
                          style={{ height: `${tyPx}px`, backgroundColor: '#008065' }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Month labels ใต้กราฟ */}
            <div className="flex gap-1 mt-1.5">
              {Array.from({ length: 12 }, (_, mo) => {
                const moKey      = `${thisYear}-${String(mo + 1).padStart(2, '0')}`
                const isSelected = selectedMonth === moKey
                return (
                  <div key={mo} className="flex-1 text-center">
                    <span className={`text-[9px] font-bold transition-colors ${
                      isSelected ? 'text-[#008065] dark:text-emerald-400' : 'text-gray-400 dark:text-slate-600'
                    }`}>
                      {MONTH_TH[mo]}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer: Legend + hint + clear filter ─────────────── */}
      <div className="px-6 py-3 border-t border-gray-50 dark:border-slate-800 flex items-center gap-5 flex-wrap">
        {/* สัญลักษณ์สีของแต่ละปี */}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2.5 rounded-sm bg-[#008065]" />
          <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-500">ปีนี้ ({thisYear})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2.5 rounded-sm bg-slate-200 dark:bg-slate-700" />
          <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-500">ปีที่แล้ว ({lastYear})</span>
        </div>

        {/* อธิบายความหมาย delta badge */}
        <div className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-slate-600">
          <span className="font-black text-[#008065]">+3</span>
          <span>/</span>
          <span className="font-black text-red-400">−2</span>
          <span className="ml-1">= ผลต่างเทียบเดือนเดียวกันปีที่แล้ว</span>
        </div>

        {/* Hint: กดได้ */}
        <div className="ml-auto flex items-center gap-1 text-[10px] text-gray-400 dark:text-slate-600">
          <MousePointerClick size={11} />
          <span>กดแท่งเดือนเพื่อกรองข้อมูลในตาราง</span>
        </div>

        {/* Clear filter button — แสดงเฉพาะตอนที่มีเดือนถูกเลือก */}
        {selectedMonth && (
          <button
            onClick={() => onMonthClick?.(null)}
            className="text-[10px] text-[#008065] dark:text-emerald-400 font-bold hover:underline"
          >
            ✕ ล้าง filter
          </button>
        )}
      </div>
    </div>
  )
}
