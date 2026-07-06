/**
 * TAWorkloadPanel.jsx — TA Workload Overview
 * ─────────────────────────────────────────────────────────────────────────────
 * แสดงสรุปงาน active ของ TA แต่ละคน แบบ card กดได้
 *
 * ลักษณะ:
 *   - แสดงเฉพาะ request ที่ status = Active (ไม่รวม Closed / Cancelled)
 *   - การ์ดแต่ละใบ = TA 1 คน แสดง: ชื่อ, จำนวนรวม, breakdown ตามสถานะ
 *   - เรียงตาม total มากสุดก่อน, "ยังไม่ assign" อยู่ท้ายสุด
 *   - กดการ์ด → เรียก onSelectTA(name) เพื่อ filter ตาราง + stats
 *   - กดซ้ำ (ที่ selected) → เรียก onSelectTA(null) เพื่อ clear filter
 *
 * Props:
 *   requests   {Array}       ข้อมูล HC Request ทั้งหมด
 *   selectedTA {string|null} TA ที่กำลัง filter อยู่ (ถ้ามี)
 *   onSelectTA {Function}    callback(name: string|null)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react'
import { Users } from 'lucide-react'

// Style ของ status badge แต่ละแบบ — DS Light-variant recipe
const STATUS_CFG = {
  Recruiting:   { label: 'Recruiting',   dot: 'bg-blue-500',       badge: 'bg-blue-50 text-blue-900 border-blue-100' },
  Interviewing: { label: 'Interviewing', dot: 'bg-orange-500',     badge: 'bg-orange-50 text-orange-900 border-orange-100' },
  Offering:     { label: 'Offering',     dot: 'bg-purple-500',     badge: 'bg-purple-50 text-purple-900 border-purple-100' },
  Onboarding:   { label: 'W.Onboarding', dot: 'bg-teal-500',       badge: 'bg-teal-50 text-teal-900 border-teal-100' },
  Open:         { label: 'Open',         dot: 'bg-yellow-400',     badge: 'bg-yellow-50 text-yellow-900 border-yellow-100' },
}

// สถานะที่ถือว่า "active" (ยังทำงานอยู่)
const ACTIVE_STATUSES = ['Open', 'Recruiting', 'Interviewing', 'Offering', 'Onboarding']

// ลำดับแสดง badge สถานะในการ์ด
const STATUS_ORDER = ['Recruiting', 'Interviewing', 'Offering', 'Onboarding', 'Open']

export default function TAWorkloadPanel({ requests, selectedTA, onSelectTA }) {
  /**
   * จัดกลุ่ม active requests ตาม assignedToName
   * คืน array ของ { name, total, byStatus: { [status]: count } }
   * เรียงตาม total มากสุดก่อน, ยังไม่ assign → ท้ายสุด
   */
  const taData = useMemo(() => {
    const map = new Map()

    for (const req of requests) {
      if (!ACTIVE_STATUSES.includes(req.status)) continue
      const name = req.assignedToName || '— ยังไม่ได้รับ —'
      if (!map.has(name)) map.set(name, { name, total: 0, byStatus: {} })
      const entry = map.get(name)
      entry.total++
      entry.byStatus[req.status] = (entry.byStatus[req.status] || 0) + 1
    }

    return [...map.values()].sort((a, b) => {
      if (a.name === '— ยังไม่ได้รับ —') return 1  // ดัน "ยังไม่ assign" ไปท้าย
      if (b.name === '— ยังไม่ได้รับ —') return -1
      return b.total - a.total
    })
  }, [requests])

  // ไม่มีข้อมูล active → ซ่อน component ทั้งหมด
  if (taData.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {/* ── Section header ─────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
          <Users size={12} strokeWidth={1} absoluteStrokeWidth /> TA Workload
        </p>
        {/* ปุ่มล้าง filter — แสดงเฉพาะตอนที่กำลัง filter อยู่ */}
        {selectedTA && (
          <button
            onClick={() => onSelectTA(null)}
            className="text-[11px] font-bold text-neutral-400 transition-colors hover:text-dark-green-700"
          >
            ✕ ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* ── TA cards ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        {taData.map((ta) => {
          const isSelected   = selectedTA === ta.name
          const isUnassigned = ta.name === '— ยังไม่ได้รับ —'

          return (
            <button
              key={ta.name}
              onClick={() => onSelectTA(isSelected ? null : ta.name)}
              className={`flex min-w-[160px] flex-col gap-2.5 rounded-2xl border p-4 text-left transition-colors ${
                isSelected
                  ? 'border-dark-green-100 bg-dark-green-50'
                  : 'border-neutral-100 bg-white hover:border-dark-green-100 hover:bg-dark-green-50/40'
              }`}
            >
              {/* ชื่อ TA + จำนวนรวม */}
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm font-bold leading-tight ${
                  isSelected ? 'text-dark-green-900' : 'text-neutral-900'
                } ${
                  isUnassigned ? 'italic text-neutral-400' : ''
                }`}>
                  {ta.name}
                </p>
                {/* Badge จำนวนรวม */}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                  isSelected ? 'bg-dark-green-600 text-neutral-50' : 'bg-neutral-100 text-neutral-600'
                }`}>
                  {ta.total}
                </span>
              </div>

              {/* Breakdown ตามสถานะ — แสดงเฉพาะสถานะที่มีค่า > 0 */}
              <div className="flex flex-wrap gap-1">
                {STATUS_ORDER.map((status) => {
                  const count = ta.byStatus[status]
                  if (!count) return null
                  const cfg = STATUS_CFG[status]
                  return (
                    <span
                      key={status}
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${cfg.badge}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} />
                      {cfg.label} {count}
                    </span>
                  )
                })}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
