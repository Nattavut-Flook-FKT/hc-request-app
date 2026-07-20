/**
 * ItOnboardingPage.jsx — รายชื่อพนักงานใหม่สำหรับ IT (เตรียมบัญชี/อุปกรณ์)
 * ─────────────────────────────────────────────────────────────────────────────
 * แสดงเคสสถานะ Onboarding (รอเริ่มงาน) + Closed (เริ่มงานแล้ว) พร้อมอีเมลบริษัท
 * ที่ generate ไว้ตอนเปลี่ยนสถานะเป็น Onboarding (field `itEmail`)
 *
 * ตั้งใจไม่ query ผ่าน StatsListener (ดึงทุก field ของ hc_requests 2000 doc) —
 * ใช้ query แคบของตัวเอง + project เฉพาะ field ที่ IT ต้องใช้ (ไม่โชว์ reason,
 * replacementFor, rejectReason, statusHistory, cvUrl, requesterEmail ฯลฯ)
 *
 * ไม่แตะ Google Sheets/GAS — อ่านจาก Firestore โดยตรงเท่านั้น
 */
import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore'
import { db } from '../services/firebase'
import Layout from '../components/Shared/Layout'
import { KpiCard, SectionCard, ExportButtons, DataTable } from '../components/Reports/ReportUI'
import { exportWorkbook, exportCSV, dateStamp } from '../utils/exportExcel'
import { toDate, statusTH } from '../utils/reportUtils'

const COLUMNS = [
  { key: 'hcId', label: 'HCID' },
  { key: 'candidate', label: 'ผู้สมัคร', accent: true },
  { key: 'email', label: 'อีเมลบริษัท', accent: true },
  { key: 'position', label: 'ตำแหน่ง' },
  { key: 'department', label: 'แผนก' },
  { key: 'startDate', label: 'วันเริ่มงาน' },
  { key: 'status', label: 'สถานะ', align: 'center', render: r => statusTH(r.status) },
]

export default function ItOnboardingPage({ user, role, isDarkMode, toggleDarkMode }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // ไม่ใส่ orderBy ในตัว query — เลี่ยงการต้องสร้าง Firestore composite index ใหม่
    // (in-filter + orderBy คนละ field ต้องมี index) แล้ว sort ฝั่ง client แทน
    const q = query(collection(db, 'hc_requests'), where('status', 'in', ['Onboarding', 'Closed']), limit(500))
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => {
          const r = d.data()
          return {
            _key: d.id,
            hcId: r.hcId || d.id,
            candidate: r.candidateName || '—',
            email: r.itEmail || '—',
            position: r.position || '—',
            department: r.department || '—',
            startDate: r.startDate || '',
            status: r.status,
            _sortTime: toDate(r.startDate)?.getTime() ?? 0,
          }
        })
        .sort((a, b) => b._sortTime - a._sortTime) // ล่าสุดก่อน
      setRows(list)
      setLoading(false)
    }, (err) => {
      console.error('[ItOnboardingPage] snapshot error:', err)
      setLoading(false)
    })
    return unsub
  }, [])

  const waiting = rows.filter((r) => r.status === 'Onboarding').length
  const started = rows.filter((r) => r.status === 'Closed').length

  function buildAOA() {
    const header = COLUMNS.map((c) => c.label)
    return [header, ...rows.map((r) => COLUMNS.map((c) => (c.key === 'status' ? statusTH(r.status) : (r[c.key] ?? ''))))]
  }

  if (loading) {
    return (
      <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
        <div className="flex flex-col gap-4 animate-pulse">
          <div className="h-16 rounded-2xl border border-neutral-100 bg-white" />
          <div className="h-64 rounded-2xl border border-neutral-100 bg-white" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">IT Onboarding</h1>
          <p className="mt-0.5 text-sm text-neutral-500">รายชื่อพนักงานใหม่ + อีเมลบริษัท สำหรับเตรียมบัญชี/อุปกรณ์</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <KpiCard label="รอเริ่มงาน" value={waiting} accent />
          <KpiCard label="เริ่มงานแล้ว" value={started} />
        </div>

        <SectionCard
          title="รายชื่อ"
          sub={`${rows.length} รายการ`}
          action={<ExportButtons disabled={rows.length === 0}
            onExcel={() => exportWorkbook(`it-onboarding_${dateStamp()}`, [{ name: 'IT Onboarding', aoa: buildAOA() }])}
            onCSV={() => exportCSV(`it-onboarding_${dateStamp()}`, buildAOA())} />}
        >
          <DataTable columns={COLUMNS} rows={rows} emptyText="ยังไม่มีเคส Onboarding" />
        </SectionCard>
      </div>
    </Layout>
  )
}
