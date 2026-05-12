/**
 * StatCards.jsx — KPI Summary Cards
 * ─────────────────────────────────────────────────────────────────────────────
 * แถว card แสดง KPI ภาพรวมของ HC Request ทั้งหมด (หรือกรองตาม TA)
 *
 * Cards ที่แสดง (7 ตัว):
 *   Open          — รอดำเนินการ (status = 'Open')
 *   In Progress   — กำลัง Recruit (status = 'Recruiting' | 'Interviewing')
 *   Offering      — รอตอบรับ Offer (status = 'Offering')
 *   W.Onboarding  — รอเริ่มงาน (status = 'Onboarding')
 *   Closed        — เสร็จสิ้น (status = 'Closed')
 *   Total         — รวมทุกสถานะ (ไม่รวม Cancelled)
 *   Avg Fill Time — เฉลี่ยจำนวนวันที่ปิดเคส (เฉพาะ Closed + มีทั้ง createdAt/closedAt)
 *
 * Props:
 *   stats      {object}      ค่าที่คำนวณมาจาก computeStats() ใน DashboardPage
 *   selectedTA {string|null} ถ้าเลือก TA จะแสดง banner "แสดงเฉพาะเคสของ: ..."
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Inbox, UserCheck, CheckCircle, Clock, Timer, FileCheck, CalendarClock } from 'lucide-react'

// Config ของแต่ละ card: key ตรงกับ key ใน stats object จาก computeStats()
const STAT_CONFIG = [
  {
    key: 'open',
    label: 'Open',
    labelTh: 'รอดำเนินการ',
    icon: Inbox,
    color: 'text-yellow-600 dark:text-yellow-500',
    bg: 'bg-yellow-50 dark:bg-yellow-500/10',
    border: 'border-yellow-200 dark:border-yellow-500/20',
  },
  {
    key: 'assigned',
    label: 'In Progress',
    labelTh: 'กำลัง Recruit',
    icon: UserCheck,
    color: 'text-blue-600 dark:text-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    border: 'border-blue-200 dark:border-blue-500/20',
  },
  {
    key: 'offering',
    label: 'Offering',
    labelTh: 'รอตอบรับ Offer',
    icon: FileCheck,
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-50 dark:bg-indigo-500/10',
    border: 'border-indigo-200 dark:border-indigo-500/20',
  },
  {
    key: 'onboarding',
    label: 'W.Onboarding',
    labelTh: 'รอเริ่มงาน',
    icon: CalendarClock,
    color: 'text-teal-600 dark:text-teal-400',
    bg: 'bg-teal-50 dark:bg-teal-500/10',
    border: 'border-teal-200 dark:border-teal-500/20',
  },
  {
    key: 'closed',
    label: 'Closed',
    labelTh: 'เสร็จสิ้น',
    icon: CheckCircle,
    color: 'text-green-600 dark:text-green-500',
    bg: 'bg-green-50 dark:bg-green-500/10',
    border: 'border-green-200 dark:border-green-500/20',
  },
  {
    key: 'total',
    label: 'Total',
    labelTh: 'ทั้งหมด',
    icon: Clock,
    color: 'text-slate-600 dark:text-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-800/50',
    border: 'border-slate-200 dark:border-slate-800',
  },
  {
    key: 'avgDaysToFill',
    label: 'Avg Fill Time',
    labelTh: 'เฉลี่ยวันปิดเคส',
    icon: Timer,
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-500/10',
    border: 'border-purple-200 dark:border-purple-500/20',
    suffix: ' วัน', // หน่วยต่อท้ายค่า
  },
]

export default function StatCards({ stats, selectedTA }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Banner เมื่อกำลัง filter ตาม TA — แสดงเฉพาะตอนที่ selectedTA มีค่า */}
      {selectedTA && (
        <p className="text-[11px] font-black text-[#008065] dark:text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#008065]" />
          แสดงเฉพาะเคสของ: {selectedTA}
        </p>
      )}

      {/* Grid 7 cards — responsive: 2 cols → 4 cols → 7 cols */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {STAT_CONFIG.map((card) => {
          const value = stats[card.key]
          // avgDaysToFill = null หมายถึงยังไม่มีข้อมูล → แสดง '—'
          const display = value === null || value === undefined
            ? card.key === 'avgDaysToFill' ? '—' : '0'
            : `${value}${card.suffix ?? ''}`

          return (
            <div
              key={card.key}
              className={`rounded-xl border ${card.border} ${card.bg} p-5 flex flex-col gap-2 transition-colors`}
            >
              {/* Icon + label row */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">{card.label}</span>
                <card.icon size={18} className={card.color} />
              </div>
              {/* ตัวเลขหลัก */}
              <p className={`text-4xl font-black tracking-tight ${card.color}`}>{display}</p>
              {/* label ภาษาไทย */}
              <p className="text-xs text-slate-400 dark:text-slate-500 uppercase font-semibold tracking-wider font-mono">{card.labelTh}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
