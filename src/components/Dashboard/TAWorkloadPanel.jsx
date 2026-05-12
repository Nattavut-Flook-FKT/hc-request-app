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

// Style ของ status badge แต่ละแบบ
const STATUS_CFG = {
  Recruiting:   { label: 'Recruiting',   dot: 'bg-emerald-500', badge: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
  Interviewing: { label: 'Interviewing', dot: 'bg-orange-500',  badge: 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/20' },
  Offering:     { label: 'Offering',     dot: 'bg-indigo-500',  badge: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/20' },
  Onboarding:   { label: 'W.Onboarding', dot: 'bg-teal-500',   badge: 'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-500/20' },
  Open:         { label: 'Open',         dot: 'bg-yellow-400',  badge: 'bg-yellow-50 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 border-yellow-200 dark:border-yellow-500/20' },
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
        <p className="text-[11px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
          <Users size={12} strokeWidth={3} /> TA Workload
        </p>
        {/* ปุ่มล้าง filter — แสดงเฉพาะตอนที่กำลัง filter อยู่ */}
        {selectedTA && (
          <button
            onClick={() => onSelectTA(null)}
            className="text-[10px] font-black text-gray-400 hover:text-[#008065] dark:text-slate-500 dark:hover:text-emerald-400 uppercase tracking-wider transition-colors"
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
              className={`flex flex-col gap-2.5 p-4 rounded-2xl border-2 text-left transition-all min-w-[160px] ${
                isSelected
                  ? 'border-[#008065] bg-emerald-50/60 dark:bg-emerald-900/20 shadow-lg shadow-emerald-900/10'
                  : 'border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-md'
              }`}
            >
              {/* ชื่อ TA + จำนวนรวม */}
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm font-black leading-tight ${
                  isSelected ? 'text-[#008065] dark:text-emerald-400' : 'text-gray-800 dark:text-gray-200'
                } ${
                  isUnassigned ? 'italic text-gray-400 dark:text-slate-500' : ''
                }`}>
                  {ta.name}
                </p>
                {/* Badge จำนวนรวม */}
                <span className={`shrink-0 text-xs font-black px-2 py-0.5 rounded-full ${
                  isSelected ? 'bg-[#008065] text-white' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400'
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
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-black border ${cfg.badge}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} shrink-0`} />
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
