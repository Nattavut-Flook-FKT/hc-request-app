/**
 * YoYChart.jsx — Year-over-Year Bar Chart
 * ─────────────────────────────────────────────────────────────────────────────
 * แสดงจำนวน HC Request ที่เปิดใหม่แต่ละเดือน เปรียบเทียบปีนี้ vs ปีที่แล้ว
 *
 * ลักษณะกราฟ:
 *   - แท่งคู่ต่อเดือน: สีเขียว (dark-green-600) = ปีนี้, สีเทา = ปีที่แล้ว
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
    <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white">

      {/* ── Header: ชื่อ + คำอธิบาย + KPI trio ──────────────── */}
      <div className="border-b border-neutral-100 px-6 pb-4 pt-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h3 className="text-sm font-bold text-neutral-900">
              จำนวน HC Request รายเดือน
            </h3>
            {/* คำอธิบายสั้นๆ ว่ากราฟนี้ดูอะไร */}
            <p className="mt-1 max-w-md text-xs leading-relaxed text-neutral-500">
              แสดงจำนวนคำขออัตรากำลังที่เปิดใหม่แต่ละเดือน เปรียบเทียบ
              <span className="font-bold text-dark-green-700"> ปีนี้ ({thisYear})</span> กับ
              <span className="font-bold text-neutral-400"> ปีที่แล้ว ({lastYear})</span>
              <span className="ml-1 text-neutral-400">· ตัวเลขบนแท่ง = ผลต่างเทียบเดือนเดียวกันปีที่แล้ว</span>
            </p>
          </div>

          {/* KPI trio: ยอดรวมปีนี้ / ปีที่แล้ว / ผลต่าง YoY */}
          <div className="flex shrink-0 items-stretch overflow-hidden rounded-lg border border-neutral-100">
            {[
              {
                label: `ปีนี้ (${thisYear})`,
                value: totalTY,
                color: 'text-neutral-900',
                dot: 'bg-dark-green-600',
              },
              {
                label: `ปีที่แล้ว (${lastYear})`,
                value: totalLY,
                color: 'text-neutral-400',
                dot: 'bg-neutral-200',
              },
              {
                label: 'ผลต่าง YoY',
                value: (delta > 0 ? '+' : '') + delta,
                // สีแดง = เพิ่มขึ้น (หมายถึงโหลดงานมากขึ้น), เขียว = ลดลง, เทา = เท่ากัน
                color: delta > 0 ? 'text-red-600' : delta < 0 ? 'text-dark-green-700' : 'text-neutral-400',
                dot: null,
                hint: delta > 0 ? 'เพิ่มขึ้นจากปีที่แล้ว' : delta < 0 ? 'ลดลงจากปีที่แล้ว' : 'เท่ากัน',
              },
            ].map((k, i) => (
              <div
                key={k.label}
                className={`px-4 py-2.5 text-right ${i > 0 ? 'border-l border-neutral-100' : ''}`}
                title={k.hint}
              >
                <div className="mb-0.5 flex items-center justify-end gap-1.5">
                  {k.dot && (
                    <span className={`h-2 w-2 shrink-0 rounded-sm ${k.dot}`} />
                  )}
                  <p className={`text-xl font-bold leading-none tabular-nums ${k.color}`}>
                    {k.value}
                  </p>
                </div>
                <p className="text-[10px] font-bold text-neutral-400">
                  {k.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Chart area ────────────────────────────────────────── */}
      <div className="px-6 pb-3 pt-5">
        <div className="flex gap-2">

          {/* Y-axis: แสดง 0 / ครึ่ง / max เพื่อให้อ่านค่าได้ง่ายขึ้น */}
          <div
            className="flex shrink-0 flex-col items-end justify-between pb-6 text-[10px] font-bold tabular-nums text-neutral-300"
            style={{ height: `${CHART_H + 24}px` }}
          >
            <span>{maxVal}</span>
            <span>{Math.round(maxVal / 2)}</span>
            <span>0</span>
          </div>

          {/* Bars + month labels */}
          <div className="flex flex-1 flex-col gap-0">
            <div className="relative flex-1">
              {/* Grid lines แนวนอน — top / 50% / bottom */}
              <div className="absolute inset-x-0 top-0 border-t border-neutral-100" />
              <div className="absolute inset-x-0 border-t border-neutral-100" style={{ top: '50%' }} />
              <div className="absolute inset-x-0 bottom-0 border-t border-neutral-100" />

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
                      className="group relative flex flex-1 cursor-pointer flex-col items-center justify-end gap-0.5"
                      onClick={() => onMonthClick?.(isSelected ? null : moKey)}
                      title={`${MONTH_TH[mo]} — ปีนี้: ${tyVal} · ปีที่แล้ว: ${lyVal}${diff !== 0 ? ` · ผลต่าง: ${diff > 0 ? '+' : ''}${diff}` : ''}`}
                    >
                      {/* Delta badge เหนือกราฟ — แสดงเฉพาะที่มีข้อมูลและไม่ใช่เดือนอนาคต */}
                      <div className="absolute -top-5 left-0 right-0 flex items-center justify-center">
                        {diff !== 0 && tyVal > 0 && !isFuture && (
                          <span className={`text-[9px] font-bold leading-none tabular-nums ${
                            diff > 0 ? 'text-red-500' : 'text-dark-green-700'
                          }`}>
                            {diff > 0 ? '+' : ''}{diff}
                          </span>
                        )}
                      </div>

                      {/* จำนวนปีนี้ — แสดงบนแท่งสีเขียว */}
                      {tyVal > 0 && (
                        <span className={`mb-0.5 text-[10px] font-bold leading-none tabular-nums ${
                          isSelected ? 'text-dark-green-700' : 'text-neutral-500'
                        }`}>
                          {tyVal}
                        </span>
                      )}

                      {/* แท่งคู่: ปีที่แล้ว (ซ้าย/เทา) + ปีนี้ (ขวา/เขียว) */}
                      <div
                        className={`flex w-full items-end gap-0.5 transition-all ${
                          isSelected
                            ? 'rounded-sm ring-2 ring-dark-green-600 ring-offset-1 ring-offset-white'
                            : 'group-hover:opacity-75'
                        }`}
                        style={{ height: `${CHART_H}px` }}
                      >
                        {/* แท่งปีที่แล้ว */}
                        <div
                          className="flex-1 rounded-t-sm bg-neutral-200 transition-all duration-300"
                          style={{ height: `${lyPx}px` }}
                        />
                        {/* แท่งปีนี้ — ซีดถ้าเป็นเดือนอนาคต */}
                        <div
                          className={`flex-1 rounded-t-sm bg-dark-green-600 transition-all duration-300 ${isFuture ? 'opacity-20' : ''}`}
                          style={{ height: `${tyPx}px` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Month labels ใต้กราฟ */}
            <div className="mt-1.5 flex gap-1">
              {Array.from({ length: 12 }, (_, mo) => {
                const moKey      = `${thisYear}-${String(mo + 1).padStart(2, '0')}`
                const isSelected = selectedMonth === moKey
                return (
                  <div key={mo} className="flex-1 text-center">
                    <span className={`text-[10px] font-bold transition-colors ${
                      isSelected ? 'text-dark-green-700' : 'text-neutral-400'
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
      <div className="flex flex-wrap items-center gap-5 border-t border-neutral-100 px-6 py-3">
        {/* สัญลักษณ์สีของแต่ละปี */}
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-3 rounded-sm bg-dark-green-600" />
          <span className="text-[11px] font-bold text-neutral-500">ปีนี้ ({thisYear})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-3 rounded-sm bg-neutral-200" />
          <span className="text-[11px] font-bold text-neutral-500">ปีที่แล้ว ({lastYear})</span>
        </div>

        {/* อธิบายความหมาย delta badge */}
        <div className="flex items-center gap-1 text-[11px] text-neutral-400">
          <span className="font-bold text-dark-green-700">+3</span>
          <span>/</span>
          <span className="font-bold text-red-500">−2</span>
          <span className="ml-1">= ผลต่างเทียบเดือนเดียวกันปีที่แล้ว</span>
        </div>

        {/* Hint: กดได้ */}
        <div className="ml-auto flex items-center gap-1 text-[11px] text-neutral-400">
          <MousePointerClick size={11} strokeWidth={1} absoluteStrokeWidth />
          <span>กดแท่งเดือนเพื่อกรองข้อมูลในตาราง</span>
        </div>

        {/* Clear filter button — แสดงเฉพาะตอนที่มีเดือนถูกเลือก */}
        {selectedMonth && (
          <button
            onClick={() => onMonthClick?.(null)}
            className="text-[11px] font-bold text-dark-green-700 hover:underline"
          >
            ✕ ล้าง filter
          </button>
        )}
      </div>
    </div>
  )
}
