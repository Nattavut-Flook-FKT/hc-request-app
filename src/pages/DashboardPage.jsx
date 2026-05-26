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
import { useState, useMemo, useEffect } from 'react'
import { BarChart2, List, ChevronDown, ChevronUp } from 'lucide-react'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '../services/firebase'

/**
 * คำนวณ stat ทั้ง 7 ตัวที่ StatCards ต้องการ
 * รับ array ของ request → คืน object { open, assigned, offering, onboarding, closed, total, avgDaysToFill }
 * หมายเหตุ: ไม่นับ Cancelled เข้า total
 */
/** statuses ที่ไม่นับเข้า Total (ยกเลิก / ปฏิเสธ / พักไว้ / โอนภายใน / ลับ) */
const EXCLUDED_STATUSES = new Set(['Cancelled', 'Rejected', 'OnHold', 'Confidential', 'InternalTransfer'])

/** statuses ที่ถือว่า "ยังดำเนินการอยู่" — ใช้ตรวจ crossover ปี */
const ACTIVE_STATUSES = new Set(['Open', 'Recruiting', 'Interviewing', 'Offering', 'Onboarding'])

function computeStats(data) {
  const active = data.filter((r) => !EXCLUDED_STATUSES.has(r.status))

  // คำนวณเฉลี่ย SLA — วัดจาก Open Date → Offering Date (ตรงกับ SLA Offer ใน Sheet)
  // นับเฉพาะ Closed ที่มี closedAt เท่านั้น — ไม่นับ W.Onboarding (ยังไม่ขึ้นงานจริง)
  const filledCases = data.filter(r => r.status === 'Closed' && !!r.closedAt)
  const avgDaysToFill = filledCases.length > 0
    ? (() => {
        let total = 0, count = 0
        for (const r of filledCases) {
          // helper: แปลง changedAt ซึ่งอาจเป็น Timestamp | ISO string | Date
          const toJS = (v) => {
            if (!v) return null
            if (typeof v?.toDate === 'function') return v.toDate()  // Firestore Timestamp
            const d = new Date(v)
            return isNaN(d) ? null : d
          }

          // Start: Open Date (createdAt)
          const start = r.createdAt?.toDate?.() ?? toJS(r.createdAt) ?? null
          if (!start) continue

          // End: Offering Date (statusHistory หรือ offeringDate field)
          const offEntry = r.statusHistory?.find(h => h.status === 'Offering')
          const offerDate = toJS(offEntry?.changedAt) ?? toJS(r.offeringDate) ?? null
          if (!offerDate) continue

          const days = (offerDate - start) / (1000 * 60 * 60 * 24)
          if (days >= 0) { total += days; count++ }
        }
        return count > 0 ? Math.round(total / count) : null
      })()
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

// ── ClosedBreakdown — แสดงรายการ Closed ทั้งหมดในปีที่เลือก (Admin only) ──────
function ClosedBreakdown({ requests, yearFilter }) {
  const [open, setOpen] = useState(false)

  const closedAll = useMemo(() =>
    requests.filter(r => r.status === 'Closed'),
    [requests]
  )

  // แบ่งเป็น "เปิดในปีที่เลือก" vs "crossover จากปีก่อน"
  const sameYear  = closedAll.filter(r => r.createdAt?.toDate?.()?.getFullYear() === yearFilter)
  const crossover = closedAll.filter(r => (r.createdAt?.toDate?.()?.getFullYear() ?? 0) < yearFilter)

  if (!closedAll.length) return null

  const Row = ({ r }) => {
    const createdYr = r.createdAt?.toDate?.()?.getFullYear() ?? '?'
    const closedAtStr = r.closedAt?.toDate?.()?.toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' }) ?? '—'
    return (
      <tr className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
        <td className="px-3 py-1.5 font-mono text-xs font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">{r.hcId}</td>
        <td className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 max-w-[200px] truncate">{r.position}</td>
        <td className="px-3 py-1.5 text-xs text-gray-500 dark:text-slate-400">{r.department}</td>
        <td className="px-3 py-1.5 text-xs text-gray-500 dark:text-slate-400 max-w-[120px] truncate">{r.candidateName || '—'}</td>
        <td className="px-3 py-1.5 text-xs text-gray-500 dark:text-slate-500 whitespace-nowrap">{r.startDate || '—'}</td>
        <td className="px-3 py-1.5 text-xs text-gray-400 dark:text-slate-600 whitespace-nowrap">{closedAtStr}</td>
        <td className="px-3 py-1.5 text-xs text-gray-400 dark:text-slate-600">{createdYr}</td>
      </tr>
    )
  }

  const THead = () => (
    <thead className="sticky top-0 bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
      <tr>
        {['HCID','ตำแหน่ง','แผนก','Candidate','Onboard Date','closedAt','เปิดปี'].map(h => (
          <th key={h} className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-slate-500 whitespace-nowrap">{h}</th>
        ))}
      </tr>
    </thead>
  )

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/50 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">🔍 Closed Breakdown {yearFilter}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold">
            {closedAll.length} records total
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-bold">
            เปิดปี {yearFilter}: {sameYear.length}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 font-bold">
            crossover จากปีก่อน: {crossover.length}
          </span>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-200 dark:border-slate-700">
          {/* Crossover section */}
          {crossover.length > 0 && (
            <div>
              <p className="px-4 py-2 text-[10px] font-black text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 uppercase tracking-wider">
                🔀 Crossover จากปีก่อน — เปิดก่อนปี {yearFilter} แต่ปิดปี {yearFilter} ({crossover.length} records)
              </p>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full">
                  <THead />
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                    {crossover.sort((a,b) => (a.hcId||'').localeCompare(b.hcId||'')).map(r => <Row key={r.id} r={r} />)}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Same-year section */}
          {sameYear.length > 0 && (
            <div>
              <p className="px-4 py-2 text-[10px] font-black text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 uppercase tracking-wider border-t border-slate-200 dark:border-slate-700">
                📋 เปิดและปิดในปี {yearFilter} ({sameYear.length} records)
              </p>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full">
                  <THead />
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                    {sameYear.sort((a,b) => (a.hcId||'').localeCompare(b.hcId||'')).map(r => <Row key={r.id} r={r} />)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * StatsListener — Firestore listener น้ำหนักเบา ไม่มี DOM rendering
 * ─────────────────────────────────────────────────────────────────
 * ทำหน้าที่แทน hidden <RequestTable> เดิม:
 *   - subscribe onSnapshot บน hc_requests (limit 2000) แบบ realtime
 *   - หยุด listener เมื่อ browser tab ซ่อน → เปิดใหม่เมื่อกลับมา
 *   - ส่ง data ทั้งหมดขึ้นไปให้ DashboardPage ผ่าน onData callback
 *
 * ข้อดีเหนือ hidden RequestTable:
 *   - ไม่ render DOM เลย (return null)
 *   - ไม่มี filter/sort/pagination state
 *   - ไม่ต้องโหลด component หนักๆ ของ RequestTable
 */
function StatsListener({ onData }) {
  useEffect(() => {
    const q = query(collection(db, 'hc_requests'), orderBy('createdAt', 'desc'), limit(2000))
    let unsub = null

    const subscribe = () => {
      if (unsub) return
      unsub = onSnapshot(q, snap => {
        onData(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      })
    }

    const unsubscribe = () => {
      unsub?.()
      unsub = null
    }

    subscribe()

    // หยุด listener เมื่อ tab ซ่อน → ประหยัด Firestore reads
    const onVisibility = () => document.hidden ? unsubscribe() : subscribe()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [onData])

  return null
}

// ════════════════════════════════════════════════════════════════
export default function DashboardPage({ user, role, department, isDarkMode, toggleDarkMode }) {
  // แท็บที่เลือกอยู่ 'overview' | 'list'
  const [tab, setTab]                     = useState('overview')

  // request ทั้งหมด — feed มาจาก StatsListener โดยตรง
  const [requests, setRequests]           = useState([])

  // TA ที่กดเลือกใน TAWorkloadPanel เพื่อกรองข้อมูล
  const [selectedTA, setSelectedTA]       = useState(null)

  // เดือนที่กดใน YoYChart เพื่อกรองตาราง รูปแบบ "YYYY-MM" เช่น "2026-04"
  const [selectedMonth, setSelectedMonth] = useState(null)

  // กรองตามปี: null = ทั้งหมด, 2025, 2026
  const [yearFilter, setYearFilter]       = useState(null)


  /**
   * requests กรองตามปีที่เลือก
   *
   * Logic: นับรวมเคสที่ "เกี่ยวข้อง" กับปีนั้น ไม่ใช่แค่ createdAt
   *   1. เคสที่เปิดในปีนั้น (createdAt year === yearFilter)  → เสมอ
   *   2. เคสที่เปิดปีก่อน แต่ยังดำเนินการอยู่ในปีที่เลือก
   *      (status ไม่ใช่ Closed/Cancelled)                   → นับรวม
   *   3. เคสที่เปิดปีก่อน แต่ Closed ในปีที่เลือก
   *      (closedAt year === yearFilter)                      → นับรวม
   */
  const yearFilteredRequests = useMemo(() => {
    if (!yearFilter) return requests
    return requests.filter(r => {
      const createdYear = r.createdAt?.toDate?.()?.getFullYear()
      if (!createdYear) return false

      // เคสเปิดในปีนั้น → ตรงอยู่แล้ว
      if (createdYear === yearFilter) return true

      // เคสเปิดก่อนปีที่เลือก → ตรวจว่ายังมีชีวิตอยู่ในปีนั้น
      if (createdYear < yearFilter) {
        // ยังดำเนินการอยู่ (active statuses: Open/Recruiting/Interviewing/Offering/Onboarding)
        if (ACTIVE_STATUSES.has(r.status)) return true
        // ปิดในปีที่เลือก — ใช้หลาย source เพื่อหาปีที่ Closed จริง
        if (r.status === 'Closed') {
          // Source 1: closedAt Timestamp (web app กด Closed เอง หรือ import ที่มี Onboard Date)
          let closedYear = r.closedAt?.toDate?.()?.getFullYear() ?? null

          // Source 2: startDate string "YYYY-MM-DD" — authoritative กว่าเพราะ import ตรง
          // closedAt อาจ fallback เป็น createdAt (ปีผิด) ถ้า import ไม่มี Onboard Date
          if (r.startDate?.length >= 4) {
            const y = parseInt(r.startDate.slice(0, 4), 10)
            if (y >= 2000 && y <= 2100) closedYear = y
          }

          // Source 3: statusHistory Onboarding entry (fallback สุดท้าย)
          if (!closedYear) {
            const onbH = r.statusHistory?.find(h => h.status === 'Onboarding')
            if (onbH?.changedAt) {
              const y = new Date(onbH.changedAt).getFullYear()
              if (y >= 2000 && y <= 2100) closedYear = y
            }
          }

          if (closedYear === yearFilter) return true
        }
      }

      return false
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

            {/* ── Closed Breakdown (Admin Diagnostic) ──────────────────
                แสดงเฉพาะ admin + เมื่อเลือก year filter
                เพื่อตรวจสอบว่า Closed ทั้งหมดในปีนั้นมีรายการอะไรบ้าง
                แยกเป็น "เปิดปีนั้น" กับ "crossover จากปีก่อน"
            ─────────────────────────────────────────────────────────── */}
            {role === 'admin' && yearFilter && (
              <ClosedBreakdown
                requests={yearFilteredRequests}
                yearFilter={yearFilter}
              />
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════
            TAB: รายการ — Full request table
            RequestTable มี filter ครบ (status, dept, search, sort)
        ══════════════════════════════════════════════════════════ */}
        {/* StatsListener: Firestore listener สำหรับ analytics เท่านั้น
            ทำงานตลอดไม่ว่าจะอยู่ tab ไหน — ไม่มี DOM rendering */}
        <StatsListener onData={setRequests} />

        {/* RequestTable: แสดงเฉพาะเมื่ออยู่ tab รายการ
            limit(500) — ใช้แค่ display ไม่ต้อง feed analytics */}
        {tab === 'list' && (
          <RequestTable
            user={user}
            role={role}
            department={department}
            focusTA={selectedTA}
            focusMonth={selectedMonth}
            showFilters={true}
          />
        )}

      </div>
    </Layout>
  )
}
