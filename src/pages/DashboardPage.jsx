/**
 * DashboardPage.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าหลักของ TA / Admin ใช้ดูภาพรวมทั้งระบบ
 *
 * โครงสร้าง 2 แท็บ:
 *   "ภาพรวม"  → StatCards, YoYChart, ManpowerPivot, TAWorkloadPanel, ReportPanel
 *   "รายการ"  → RequestTable เต็มหน้าพร้อม filter ครบ
 *
 * Data flow:
 *   RequestTable (hidden mount) → onStatsChange → setRequests
 *   requests → computeStats → StatCards
 *   requests → YoYChart / ManpowerPivot (analytics)
 *   selectedTA  → กรอง analyticsRequests + StatCards ให้เห็นเฉพาะ TA นั้น
 *   selectedMonth → ส่งไป RequestTable เป็น focusMonth เพื่อกรองตาราง
 *
 * Props ที่รับจาก App.jsx:
 *   user        {object}  Firebase Auth user object
 *   role        {string}  'admin' | 'ta' | 'manager'
 *   department  {string}  แผนกของ user (สำหรับ manager)
 *   isDarkMode  {boolean} สถานะ dark mode
 *   toggleDarkMode {fn}   toggle dark/light mode
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Layout from '../components/Shared/Layout'
import StatCards from '../components/Dashboard/StatCards'
import RequestTable from '../components/Dashboard/RequestTable'
import TAWorkloadPanel from '../components/Dashboard/TAWorkloadPanel'
import ReportPanel from '../components/Dashboard/ReportPanel'
import YoYChart from '../components/Dashboard/YoYChart'
import ManpowerPivot from '../components/Dashboard/ManpowerPivot'
import { useState, useMemo } from 'react'
import { BarChart2, List } from 'lucide-react'

/**
 * คำนวณ stat ทั้ง 7 ตัวที่ StatCards ต้องการ
 * รับ array ของ request → คืน object { open, assigned, offering, onboarding, closed, total, avgDaysToFill }
 * หมายเหตุ: ไม่นับ Cancelled เข้า total
 */
function computeStats(data) {
  const active = data.filter((r) => r.status !== 'Cancelled')

  // คำนวณเฉลี่ยวันปิดเคส — นับเคสที่ Closed (ใช้ closedAt) + Onboarding (ใช้วันที่เปลี่ยนสถานะจาก statusHistory)
  const filledCases = data.filter(r => {
    if (!r.createdAt) return false
    if (r.status === 'Closed') return !!r.closedAt
    if (r.status === 'Onboarding') return true
    return false
  })
  const avgDaysToFill = filledCases.length > 0
    ? Math.round(filledCases.reduce((sum, r) => {
        const start = r.createdAt?.toDate?.() ?? null
        if (!start) return sum
        let end
        if (r.status === 'Closed') {
          end = r.closedAt?.toDate?.() ?? null
        } else {
          // W.Onboarding → หาวันที่เปลี่ยนสถานะเป็น Onboarding จาก statusHistory
          const onbEntry = r.statusHistory?.find(h => h.status === 'Onboarding')
          end = onbEntry ? new Date(onbEntry.changedAt) : new Date()
        }
        if (!end) return sum
        return sum + (end - start) / (1000 * 60 * 60 * 24)
      }, 0) / filledCases.length)
    : null

  return {
    open:        active.filter(r => r.status === 'Open').length,
    assigned:    active.filter(r => ['Recruiting', 'Interviewing'].includes(r.status)).length,
    offering:    active.filter(r => r.status === 'Offering').length,
    onboarding:  active.filter(r => r.status === 'Onboarding').length,
    closed:      active.filter(r => r.status === 'Closed').length,
    total:       active.length,
    avgDaysToFill,
  }
}

// ── Tab definitions ─────────────────────────────────────────────
const TABS = [
  { v: 'overview', label: 'ภาพรวม', icon: BarChart2 },
  { v: 'list',     label: 'รายการ',  icon: List },
]

// ════════════════════════════════════════════════════════════════
export default function DashboardPage({ user, role, department, isDarkMode, toggleDarkMode }) {
  // แท็บที่เลือกอยู่ 'overview' | 'list'
  const [tab, setTab]                     = useState('overview')

  // request ทั้งหมด — ถูก feed มาจาก RequestTable ผ่าน onStatsChange
  const [requests, setRequests]           = useState([])

  // TA ที่กดเลือกใน TAWorkloadPanel เพื่อกรองข้อมูล
  const [selectedTA, setSelectedTA]       = useState(null)

  // เดือนที่กดใน YoYChart เพื่อกรองตาราง รูปแบบ "YYYY-MM" เช่น "2026-04"
  const [selectedMonth, setSelectedMonth] = useState(null)

  // กรองตามปี: null = ทั้งหมด, 2025, 2026
  const [yearFilter, setYearFilter]       = useState(null)

  /** รับ requests ทั้งหมดจาก RequestTable (hidden mount) */
  function handleStatsChange(_stats, allRequests) {
    if (allRequests) setRequests(allRequests)
  }

  /** requests กรองตามปีที่เลือก (ใช้เป็นฐานสำหรับ stats + analytics) */
  const yearFilteredRequests = useMemo(() => {
    if (!yearFilter) return requests
    return requests.filter(r => {
      const d = r.createdAt?.toDate?.()
      return d && d.getFullYear() === yearFilter
    })
  }, [requests, yearFilter])

  /**
   * คำนวณ stats โดยกรองตาม selectedTA + yearFilter
   * ถ้ายังไม่ได้เลือก TA → ใช้ทุก request (ของปีนั้น)
   */
  const stats = useMemo(() => {
    const filtered = selectedTA
      ? yearFilteredRequests.filter(r => r.assignedToName === selectedTA)
      : yearFilteredRequests
    return computeStats(filtered)
  }, [yearFilteredRequests, selectedTA])

  /**
   * Request ที่ส่งเข้า Analytics panels (YoYChart + ManpowerPivot)
   * กรองตาม selectedTA + yearFilter เหมือน stats
   */
  const analyticsRequests = useMemo(() =>
    selectedTA ? yearFilteredRequests.filter(r => r.assignedToName === selectedTA) : yearFilteredRequests,
    [yearFilteredRequests, selectedTA]
  )

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">

        {/* ── Page header + tab switcher ───────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-gray-800 dark:text-gray-100 italic tracking-tight">Dashboard</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">ภาพรวมคำขออัตรากำลังทั้งหมด</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Year filter — ทั้งหมด / 2025 / 2026 */}
            <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-slate-800 rounded-xl">
              {[null, 2025, 2026].map(y => (
                <button
                  key={y ?? 'all'}
                  onClick={() => setYearFilter(y)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    yearFilter === y
                      ? 'bg-white dark:bg-slate-900 text-gray-800 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300'
                  }`}
                >
                  {y ?? 'ทั้งหมด'}
                </button>
              ))}
            </div>

            {/* Tab switcher — เลือกระหว่าง ภาพรวม / รายการ */}
            <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-slate-800 rounded-xl">
              {TABS.map(t => (
                <button
                  key={t.v}
                  onClick={() => setTab(t.v)}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    tab === t.v
                      ? 'bg-white dark:bg-slate-900 text-gray-800 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300'
                  }`}
                >
                  <t.icon size={14} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            TAB: ภาพรวม — Analytics section
            แสดง KPI, กราฟ, pivot table, TA workload, export
        ══════════════════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <>
            {/* Banner เมื่อกำลัง filter ตาม TA */}
            {selectedTA && (
              <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <p className="text-xs font-bold text-[#008065] dark:text-emerald-400">
                  แสดงเฉพาะเคสของ: {selectedTA}
                </p>
                <button
                  onClick={() => setSelectedTA(null)}
                  className="text-[10px] font-black text-[#008065] dark:text-emerald-400 hover:underline uppercase tracking-wider"
                >
                  ✕ ล้าง
                </button>
              </div>
            )}

            {/* KPI strip — 7 cards: Open, In Progress, Offering, Onboarding, Closed, Total, Avg Fill */}
            <StatCards stats={stats} selectedTA={selectedTA} />

            {/* กราฟแท่งเปรียบเทียบปีนี้ vs ปีที่แล้ว (12 เดือน)
                กดแท่งเดือน → setSelectedMonth → RequestTable กรองตาม focusMonth */}
            <YoYChart
              requests={analyticsRequests}
              selectedMonth={selectedMonth}
              onMonthClick={setSelectedMonth}
            />

            {/* ตาราง pivot: แผนก/ตำแหน่ง × เดือน (6 เดือนล่าสุด)
                ใช้ดูว่าแผนกไหนเปิด request มากที่สุดในช่วงไหน */}
            <ManpowerPivot requests={analyticsRequests} />

            {/* Workload ของ TA แต่ละคน — แสดงเฉพาะ admin/ta
                กดการ์ด TA → setSelectedTA → กรองทั้ง stats, analytics, table */}
            {(role === 'admin' || role === 'ta') && (
              <TAWorkloadPanel
                requests={yearFilteredRequests}
                selectedTA={selectedTA}
                onSelectTA={setSelectedTA}
              />
            )}

            {/* Export panel — filter + summary + download CSV / Pivot CSV
                แสดงเฉพาะ admin/ta และต้องมีข้อมูลอย่างน้อย 1 รายการ */}
            {(role === 'admin' || role === 'ta') && yearFilteredRequests.length > 0 && (
              <ReportPanel requests={yearFilteredRequests} />
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════
            TAB: รายการ — Full request table
            RequestTable มี filter ครบ (status, dept, search, sort)
        ══════════════════════════════════════════════════════════ */}
        {tab === 'list' && (
          <RequestTable
            user={user}
            role={role}
            department={department}
            onStatsChange={handleStatsChange}
            focusTA={selectedTA}
            focusMonth={selectedMonth}
            showFilters={true}
          />
        )}

        {/* ── Hidden RequestTable mount ─────────────────────────────
            เหตุผล: Firestore onSnapshot listener ต้องทำงานตลอดเพื่อให้
            stats และ analytics ข้างบนเป็น realtime แม้ user อยู่ tab ภาพรวม
            (ถ้าไม่ mount ไว้ listener จะถูก detach เมื่อสลับ tab) */}
        {tab !== 'list' && (
          <div className="hidden">
            <RequestTable
              user={user}
              role={role}
              department={department}
              onStatsChange={handleStatsChange}
              focusTA={null}
              focusMonth={null}
              showFilters={false}
            />
          </div>
        )}

      </div>
    </Layout>
  )
}
