/**
 * StatCards.jsx — KPI Summary Cards
 * ─────────────────────────────────────────────────────────────────────────────
 * แถว card แสดง KPI ภาพรวมของ HC Request ทั้งหมด (หรือกรองตาม TA)
 *
 * UI: FKT Design System — white card · no shadow at rest (DS-#023) · weight 400/700 ·
 *     sentence case · strokeWidth 1 · status ใช้ functional color-coding
 *     (DS-#010 exception · Light recipe 06-badge-chip §4: tint-50 chip + family-600 icon + family text stop)
 *
 * Cards (7): Open · In progress · Offering · Onboarding · Closed · Total · Avg SLA offer
 *
 * Props:
 *   stats {object} ค่าจาก computeStats() ใน DashboardPage
 *
 * NOTE: class สีต้องเป็น literal string เต็ม (chip/icon/num) เพื่อให้ Tailwind สแกนเจอ —
 *       ห้ามประกอบ class แบบ dynamic `bg-${family}-50`
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Inbox, UserCheck, CheckCircle, Clock, Timer, FileCheck, CalendarClock } from 'lucide-react'

// แต่ละ card: key ตรงกับ stats · chip/icon/num = DS family ตามความหมายของ status
const STAT_CONFIG = [
  { key: 'open',          label: 'Open',          labelTh: 'รอดำเนินการ',        icon: Inbox,         chip: 'bg-yellow-50',      icon_: 'text-yellow-600',      num: 'text-yellow-900' },
  { key: 'assigned',      label: 'In progress',   labelTh: 'กำลัง recruit',      icon: UserCheck,     chip: 'bg-blue-50',        icon_: 'text-blue-600',        num: 'text-blue-800' },
  { key: 'offering',      label: 'Offering',      labelTh: 'รอตอบรับ offer',     icon: FileCheck,     chip: 'bg-orange-50',      icon_: 'text-orange-600',      num: 'text-orange-900' },
  { key: 'onboarding',    label: 'Onboarding',    labelTh: 'รอเริ่มงาน',         icon: CalendarClock, chip: 'bg-teal-50',        icon_: 'text-teal-700',        num: 'text-teal-800' },
  { key: 'closed',        label: 'Closed',        labelTh: 'เสร็จสิ้น',          icon: CheckCircle,   chip: 'bg-green-fresh-50',  icon_: 'text-green-fresh-600', num: 'text-green-fresh-900' },
  { key: 'total',         label: 'Total',         labelTh: 'ทั้งหมด',            icon: Clock,         chip: 'bg-dark-green-50',  icon_: 'text-dark-green-600',  num: 'text-dark-green-800' },
  { key: 'avgDaysToFill', label: 'Avg SLA offer', labelTh: 'เฉลี่ยวันถึง offer', icon: Timer,         chip: 'bg-neutral-100',    icon_: 'text-neutral-500',     num: 'text-neutral-900', suffix: ' วัน' },
]

export default function StatCards({ stats }) {
  return (
    // Grid 7 cards — responsive: 2 → 4 → 7 cols
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
      {STAT_CONFIG.map((card) => {
        const value = stats[card.key]
        // avgDaysToFill = null หมายถึงยังไม่มีข้อมูล → แสดง '—'
        const display = value === null || value === undefined
          ? card.key === 'avgDaysToFill' ? '—' : '0'
          : `${value}${card.suffix ?? ''}`

        return (
          <div
            key={card.key}
            className="flex flex-col gap-3 rounded-[18px] border border-neutral-100 bg-white p-5"
          >
            {/* Label + icon chip (tint-50 · family-600 icon) */}
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-neutral-600">{card.label}</span>
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.chip}`}>
                <card.icon size={16} strokeWidth={1} absoluteStrokeWidth className={card.icon_} />
              </span>
            </div>
            {/* ตัวเลขหลัก — สีตาม family (functional) · weight 700 · tabular */}
            <p className={`text-3xl font-bold tabular-nums ${card.num}`}>{display}</p>
            {/* label ภาษาไทย — Caption · neutral-500 · sentence case */}
            <p className="text-xs text-neutral-500">{card.labelTh}</p>
          </div>
        )
      })}
    </div>
  )
}
