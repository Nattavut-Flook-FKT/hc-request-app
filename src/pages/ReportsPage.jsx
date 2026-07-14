/**
 * ReportsPage.jsx — หน้า Reports & Pivot รวมศูนย์
 * ─────────────────────────────────────────────────────────────────────────────
 * เป้าหมาย: แทนการดู report/pivot ที่หัวหน้าเคยทำใน Google Sheets ให้มาอยู่ในระบบ
 * (อ่านจาก Firestore เท่านั้น — ไม่กระทบ logic sync ขึ้น Google Sheets)
 *
 * โครงสร้าง:
 *   - StatsListener ดึง hc_requests (realtime, limit 2000)
 *   - Global filter: ปี / แผนก / TA → ใช้ร่วมกันทุก sub-tab
 *   - Sub-tabs: สรุปเดือน · SLA · TA Performance · Onboarding · Pivot Builder
 */
import { useState, useMemo } from 'react'
import { CalendarRange, Timer, Users, UserCheck, Table2 } from 'lucide-react'
import Layout from '../components/Shared/Layout'
import StatsListener from '../components/Shared/StatsListener'
import { toDate } from '../utils/reportUtils'
import PeriodSummary from '../components/Reports/PeriodSummary'
import SLAReport from '../components/Reports/SLAReport'
import TAPerformanceReport from '../components/Reports/TAPerformanceReport'
import OnboardingReport from '../components/Reports/OnboardingReport'
import PivotBuilder from '../components/Reports/PivotBuilder'

const TABS = [
  { v: 'summary',    label: 'สรุปรายเดือน',           icon: CalendarRange },
  { v: 'sla',        label: 'ความเร็วการหาคน (SLA)',  icon: Timer },
  { v: 'ta',         label: 'ผลงานทีมสรรหา',          icon: Users },
  { v: 'onboarding', label: 'คนเตรียมเริ่มงาน',        icon: UserCheck },
  { v: 'pivot',      label: 'ตารางวิเคราะห์เอง',       icon: Table2 },
]

const YEARS = [null, 2024, 2025, 2026, 2027]

export default function ReportsPage({ user, role, isDarkMode, toggleDarkMode }) {
  const [requests, setRequests] = useState([])
  const [tab, setTab] = useState('summary')

  const currentYear = new Date().getFullYear()
  const [yearFilter, setYearFilter] = useState(currentYear)
  const [dept, setDept] = useState('')
  const [ta, setTA]     = useState('')

  const depts   = useMemo(() => [...new Set(requests.map(r => r.department).filter(Boolean))].sort(), [requests])
  const taNames = useMemo(() => [...new Set(requests.map(r => r.assignedToName).filter(Boolean))].sort(), [requests])

  const filtered = useMemo(() => requests.filter(r => {
    if (yearFilter != null) {
      const d = toDate(r.createdAt)
      if (!d || d.getFullYear() !== yearFilter) return false
    }
    if (dept && r.department !== dept) return false
    if (ta && r.assignedToName !== ta) return false
    return true
  }), [requests, yearFilter, dept, ta])

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <StatsListener onData={setRequests} />

      <div className="flex flex-col gap-6">
        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-neutral-900">รายงานสรุปการสรรหา</h1>
            <p className="mt-0.5 text-sm text-neutral-500">
              ภาพรวมคำขออัตรากำลังและผลการหาคน · {filtered.length} รายการตามตัวกรอง
            </p>
          </div>

          {/* Global filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-full border border-neutral-100 p-0.5">
              {YEARS.map(y => (
                <button key={y ?? 'all'} onClick={() => setYearFilter(y)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-normal transition-colors ${
                    yearFilter === y
                      ? 'bg-green-fresh-50 text-green-fresh-900'
                      : 'text-neutral-900 hover:bg-neutral-50'
                  }`}>
                  {y ?? 'ทั้งหมด'}
                </button>
              ))}
            </div>
            <select value={dept} onChange={e => setDept(e.target.value)}
              className="h-9 rounded-lg border border-neutral-100 bg-white px-3 text-xs font-bold text-neutral-700 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none">
              <option value="">ทุกแผนก</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={ta} onChange={e => setTA(e.target.value)}
              className="h-9 rounded-lg border border-neutral-100 bg-white px-3 text-xs font-bold text-neutral-700 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none">
              <option value="">ทุก TA</option>
              {taNames.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* ── Sub-tabs ── */}
        <div className="inline-flex w-fit flex-wrap items-center gap-0.5 rounded-full border border-neutral-100 p-0.5">
          {TABS.map(t => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-normal transition-colors ${
                tab === t.v
                  ? 'bg-green-fresh-50 text-green-fresh-900'
                  : 'text-neutral-900 hover:bg-neutral-50'
              }`}>
              <t.icon size={14} strokeWidth={1} absoluteStrokeWidth />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Active report ── */}
        {tab === 'summary'    && <PeriodSummary requests={filtered} />}
        {tab === 'sla'        && <SLAReport requests={filtered} />}
        {tab === 'ta'         && <TAPerformanceReport requests={filtered} />}
        {tab === 'onboarding' && <OnboardingReport requests={filtered} />}
        {tab === 'pivot'      && <PivotBuilder requests={filtered} />}
      </div>
    </Layout>
  )
}
